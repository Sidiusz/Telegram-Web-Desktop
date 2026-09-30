'use strict';

const { net, app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const REPO = 'TelegramOrg/Telegram-web-z';
// Reviewed Web A build bundled with this desktop release. Never follow master at
// runtime: a remote branch move must not silently replace executable fallback JS.
// Bump this SHA deliberately together with a desktop release after smoke testing.
const FALLBACK_REF = '9cb10b20797dc09e33fcffee0ba390bb429c66d3';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/`;
let loggedFallback = false;

function cacheRoot() { return path.join(app.getPath('userData'), 'web-a-fallback-cache'); }


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
    const ref = FALLBACK_REF;
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

function getFallbackInfo() { return { ref: FALLBACK_REF, source: 'TelegramOrg/Telegram-web-z' }; }

module.exports = { fetchTelegramWebAFallback, distPathFromTelegramUrl, getFallbackInfo };