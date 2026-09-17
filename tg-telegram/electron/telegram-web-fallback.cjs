'use strict';

const { net, app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const REPO = 'TelegramOrg/Telegram-web-z';
const API_HEAD = `https://api.github.com/repos/${REPO}/commits/master`;
const GIT_INFO_REFS = `https://github.com/${REPO}.git/info/refs?service=git-upload-pack`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/`;
let pinnedRef = null;
let loggedFallback = false;
let refRefreshStarted = false;

function cacheRoot() { return path.join(app.getPath('userData'), 'web-a-fallback-cache'); }
function metaPath() { return path.join(cacheRoot(), 'meta.json'); }
function validRef(ref) { return /^[0-9a-f]{40}$/i.test(String(ref || '')); }
function loadStoredRef() {
    try { const m = JSON.parse(fs.readFileSync(metaPath(), 'utf8')); return validRef(m.ref) ? m.ref : ''; }
    catch (_) { return ''; }
}
async function storeRef(ref) {
    if (!validRef(ref)) return;
    await fsp.mkdir(cacheRoot(), { recursive: true });
    await fsp.writeFile(metaPath(), JSON.stringify({ ref, updatedAt: Date.now() }), 'utf8');
}


const MIME = Object.freeze({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
});

function distPathFromTelegramUrl(urlString) {
    const u = new URL(urlString);
    if (u.hostname !== 'web.telegram.org' || !(u.pathname === '/a' || u.pathname.startsWith('/a/'))) return null;
    const rel = u.pathname.replace(/^\/a\/?/, '') || 'index.html';
    return rel.includes('..') ? null : rel;
}
function mimeFor(filePath, fallback) {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.webmanifest')) return MIME['.webmanifest'];
    return MIME[path.extname(lower)] || fallback || 'application/octet-stream';
}async function resolveRemoteRef() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
        const r = await net.fetch(API_HEAD, {
            bypassCustomProtocolHandlers: true, signal: ctrl.signal,
            headers: { 'User-Agent': 'Telegram-Web-Desktop', Accept: 'application/vnd.github+json' },
        });
        if (r.ok) {
            const data = await r.json();
            if (validRef(data && data.sha)) return data.sha;
        }
        const refs = await net.fetch(GIT_INFO_REFS, {
            bypassCustomProtocolHandlers: true, signal: ctrl.signal,
            headers: { 'User-Agent': 'Telegram-Web-Desktop' },
        });
        if (refs.ok) {
            const text = await refs.text();
            const match = /([0-9a-f]{40})\s+refs\/heads\/master/i.exec(text);
            if (match) return match[1];
        }
    } finally { clearTimeout(timer); }
    return '';
}

function startRefRefreshForNextSession() {
    if (refRefreshStarted) return;
    refRefreshStarted = true;
    resolveRemoteRef().then(async ref => {
        if (!validRef(ref)) return;
        await storeRef(ref);
        const keep = new Set([pinnedRef, ref].filter(Boolean));
        try {
            for (const e of await fsp.readdir(cacheRoot(), { withFileTypes: true })) {
                if (e.isDirectory() && validRef(e.name) && !keep.has(e.name)) {
                    await fsp.rm(path.join(cacheRoot(), e.name), { recursive: true, force: true });
                }
            }
        } catch (_) {}
    }).catch(() => {});
}
async function resolvePinnedRef() {
    if (pinnedRef) return pinnedRef;
    const stored = loadStoredRef();
    if (stored) {
        pinnedRef = stored;
        startRefRefreshForNextSession();
        return pinnedRef;
    }
    pinnedRef = await resolveRemoteRef();
    if (!validRef(pinnedRef)) throw new Error('Unable to resolve Telegram Web A commit');
    await storeRef(pinnedRef).catch(() => {});
    return pinnedRef;
}
function assetCachePath(ref, rel) {
    return path.join(cacheRoot(), ref, ...String(rel).split('/').filter(Boolean));
}

async function writeAssetCache(filePath, body) {
    try {
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        const tmp = `${filePath}.${process.pid}.tmp`;
        await fsp.writeFile(tmp, body);
        await fsp.rename(tmp, filePath).catch(async () => {
            await fsp.rm(tmp, { force: true }).catch(() => {});
        });
    } catch (_) {}
}
async function fetchTelegramWebAFallback(urlString) {
    const rel = distPathFromTelegramUrl(urlString);
    if (!rel) throw new Error('Not a Telegram Web A asset');
    const ref = await resolvePinnedRef();
    const cacheFile = assetCachePath(ref, rel);
    try {
        const body = await fsp.readFile(cacheFile);
        if (!loggedFallback) {
            loggedFallback = true;
            console.log(`[TG-PROXY] Web A fallback cache hit: TelegramOrg ${String(ref).slice(0, 12)}`);
        }
        return new Response(body, { headers: { 'content-type': mimeFor(rel) } });
    } catch (_) {}
    const upstreamUrl = `${RAW_BASE}${ref}/dist/${rel}`;
    const upstream = await net.fetch(upstreamUrl, { bypassCustomProtocolHandlers: true });
    if (!upstream.ok) throw new Error(`Web A fallback HTTP ${upstream.status}: ${rel}`);
    if (!loggedFallback) {
        loggedFallback = true;
        console.log(`[TG-PROXY] Web A fallback pinned to TelegramOrg ${String(ref).slice(0, 12)}`);
    }
    const headers = new Headers(upstream.headers);
    headers.set('content-type', mimeFor(rel, headers.get('content-type')));
    for (const h of ['content-length','content-encoding','x-content-type-options','content-security-policy','content-security-policy-report-only','x-frame-options']) headers.delete(h);
    const copy = upstream.clone();
    copy.arrayBuffer().then(buf => writeAssetCache(cacheFile, Buffer.from(buf))).catch(() => {});
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}

function getFallbackInfo() { return { ref: pinnedRef || '', source: 'TelegramOrg/Telegram-web-z' }; }

module.exports = { fetchTelegramWebAFallback, distPathFromTelegramUrl, getFallbackInfo };