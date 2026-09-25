const MEDIA_CHUNK_RE = /\/assets\/Checkbox-[^/]+\.js$/i;
const MEDIA_MARKER = 'Failed to fetch media';

function transformedJsResponse(response, body) {
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/javascript; charset=utf-8');
    headers.set('cache-control', 'no-store, no-cache, must-revalidate');
    headers.set('pragma', 'no-cache');
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.delete('content-security-policy');
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patchTelegramMediaCache(body) {
    const source = String(body || '');
    if (!source.includes(MEDIA_MARKER) || source.includes('__twdMediaCacheSet')) {
        return { body: source, patched: source.includes('__twdMediaCacheSet') };
    }
    const getter = /function ([A-Za-z_$][\w$]*)\(e\)\{return ([A-Za-z_$][\w$]*)\.get\(e\)\}/.exec(source);
    if (!getter) return { body: source, patched: false };

    const getterFn = getter[1];
    const cacheVar = getter[2];
    const setPattern = new RegExp(`${escapeRegex(cacheVar)}\\.set\\(`, 'g');
    const setterCount = (source.match(setPattern) || []).length;
    if (setterCount < 2) return { body: source, patched: false };

    const unloadPattern = new RegExp(
        `async function ([A-Za-z_$][\\w$]*)\\(e\\)\\{${escapeRegex(cacheVar)}\\.delete\\(e\\);`
    );
    if (!unloadPattern.test(source)) return { body: source, patched: false };

    let out = source.replace(setPattern, '__twdMediaCacheSet(');
    out = out.replace(unloadPattern, (match, fn) =>
        `async function ${fn}(e){__twdMediaCacheDrop(e);`
    );

    const getterNeedle = `function ${getterFn}(e){return ${cacheVar}.get(e)}`;
    const insertAt = out.indexOf(getterNeedle);
    if (insertAt < 0) return { body: source, patched: false };
    const helper = `
let __twdMediaCacheRevoked=0;
function __twdMediaCacheRefs(){const s=new Set;try{document.querySelectorAll('img[src^="blob:"],video[src^="blob:"],audio[src^="blob:"],source[src^="blob:"]').forEach(n=>{const v=n.currentSrc||n.src;if(v)s.add(v)})}catch(_){}return s}
function __twdMediaCacheTrim(){if(${cacheVar}.size<=96)return;const refs=__twdMediaCacheRefs();for(const[k,v]of ${cacheVar}){if(${cacheVar}.size<=64)break;if(typeof v!=='string'||!v.startsWith('blob:')||refs.has(v))continue;${cacheVar}.delete(k);try{URL.revokeObjectURL(v);__twdMediaCacheRevoked++}catch(_){}}}
function __twdMediaCacheSet(k,v){${cacheVar}.delete(k);${cacheVar}.set(k,v);__twdMediaCacheTrim();return v}
function __twdMediaCacheDrop(k){const v=${cacheVar}.get(k);${cacheVar}.delete(k);if(typeof v==='string'&&v.startsWith('blob:'))setTimeout(()=>{if(!__twdMediaCacheRefs().has(v))try{URL.revokeObjectURL(v);__twdMediaCacheRevoked++}catch(_){}},1000)}
globalThis.__twdMediaCacheStats=()=>{let blobEntries=0;for(const v of ${cacheVar}.values())if(typeof v==='string'&&v.startsWith('blob:'))blobEntries++;return{entries:${cacheVar}.size,blobEntries,revoked:__twdMediaCacheRevoked,highWater:96,target:64}};
`;
    return { body: out.slice(0, insertAt) + helper + out.slice(insertAt), patched: true };
}

async function injectTelegramMediaCache(response, urlString) {
    let u;
    try { u = new URL(urlString); } catch (_) { return response; }
    if (u.hostname !== 'web.telegram.org' || !MEDIA_CHUNK_RE.test(u.pathname)) return response;
    const source = await response.text();
    const patched = patchTelegramMediaCache(source);
    if (patched.patched) console.log('[TWD-MEMORY] Telegram media cache LRU installed');
    else console.warn('[TWD-MEMORY] Telegram media cache module was not recognized');
    return transformedJsResponse(response, patched.body);
}

module.exports = { injectTelegramMediaCache, patchTelegramMediaCache };
