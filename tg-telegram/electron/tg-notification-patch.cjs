'use strict';

const NOTIFY_CHUNK_RE = /\/assets\/lock-[^/]+\.js$/i;
const NOTIFY_MARKER = 'showMessageNotification';
const ICON_WAIT_MS = 1500;

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

// Web A downloads the chat avatar before it emits a message notification. A stalled
// media route or an evicted avatar would otherwise hold every later notification forever.
function patchTelegramNotifications(body) {
    const source = String(body || '');
    if (!source.includes(NOTIFY_MARKER)) return { body: source, iconPatched: false, sinkPatched: false };
    if (source.includes('__twdNotifyIcon(')) return { body: source, iconPatched: true, sinkPatched: source.includes('__twdNotifySink(') };
    const at = source.indexOf(`type:\`${NOTIFY_MARKER}\``);
    if (at < 0) return { body: source, iconPatched: false, sinkPatched: false };
    const fnStart = source.lastIndexOf('async function ', at);
    if (fnStart < 0 || at - fnStart > 4000) return { body: source, iconPatched: false, sinkPatched: false };
    let segment = source.slice(fnStart, at);

    const icon = /let ([A-Za-z_$][\w$]*)=await ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\),\{title:/.exec(segment);
    let iconPatched = false;
    if (icon) {
        segment = segment.slice(0, icon.index) +
            `let ${icon[1]}=await __twdNotifyIcon(()=>${icon[2]}(${icon[3]})),{title:` +
            segment.slice(icon.index + icon[0].length);
        iconPatched = true;
    }

    // Without an active service-worker controller Web A silently drops the notification.
    const post = 'navigator.serviceWorker?.controller&&navigator.serviceWorker.controller.postMessage(';
    const postAt = segment.lastIndexOf(post);
    let sinkPatched = false;
    if (postAt >= 0 && segment.length - postAt <= post.length + 2) {
        segment = segment.slice(0, postAt) + '__twdNotifySink(' + segment.slice(postAt + post.length);
        sinkPatched = true;
    }
    if (!iconPatched && !sinkPatched) return { body: source, iconPatched, sinkPatched };

    const helper = `
function __twdNotifyIcon(load){let p;try{p=Promise.resolve(load()).catch(()=>{})}catch(_){p=Promise.resolve()}return Promise.race([p,new Promise(r=>setTimeout(r,${ICON_WAIT_MS}))])}
function __twdNotifySink(m){try{if(typeof globalThis.__twdConsumeSwNotification==='function'&&globalThis.__twdConsumeSwNotification(m))return}catch(_){}const c=navigator.serviceWorker&&navigator.serviceWorker.controller;c&&c.postMessage(m)}
`;
    return {
        body: source.slice(0, fnStart) + segment + source.slice(at) + helper,
        iconPatched,
        sinkPatched,
    };
}

async function injectTelegramNotifications(response, urlString) {
    let u;
    try { u = new URL(urlString); } catch (_) { return response; }
    if (u.hostname !== 'web.telegram.org' || !NOTIFY_CHUNK_RE.test(u.pathname)) return response;
    const source = await response.text();
    const patched = patchTelegramNotifications(source);
    if (patched.iconPatched && patched.sinkPatched) console.log('[TWD-NOTIF] Telegram notification hooks installed');
    else if (source.includes(NOTIFY_MARKER)) console.warn(`[TWD-NOTIF] Telegram notification hooks partial: icon=${patched.iconPatched} sink=${patched.sinkPatched}`);
    return transformedJsResponse(response, patched.body);
}

module.exports = { injectTelegramNotifications, patchTelegramNotifications };
