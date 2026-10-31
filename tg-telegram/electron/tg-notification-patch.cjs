'use strict';
const { transformedJsResponse } = require('./tg-bundle-patch.cjs');
// Web A moved the notification module from the lock chunk to useMultiaccountInfo; accept both.
const NOTIFY_CHUNK_RE = /\/assets\/(?:lock|useMultiaccountInfo)-[^/]+\.js$/i;
const NOTIFY_MARKER = 'showMessageNotification';
const ICON_WAIT_MS = 1500;

// Web A downloads the chat avatar before it emits a message notification. A stalled
// media route or an evicted avatar would otherwise hold every later notification forever.
function patchTelegramNotifications(body) {
    const source = String(body || '');
    if (!source.includes(NOTIFY_MARKER)) return { body: source, iconPatched: false, sinkPatched: false, gatePatched: false, runtimeExposed: false };
    if (source.includes('function __twdNotifyIcon(')) {
        return {
            body: source,
            iconPatched: source.includes('await __twdNotifyIcon('),
            sinkPatched: source.includes('__twdNotifySink({'),
            gatePatched: source.includes('=__twdNotifyFlags('),
            runtimeExposed: source.includes('__twdTelegramRuntime='),
        };
    }
    const at = source.indexOf(`type:\`${NOTIFY_MARKER}\``);
    const none = { body: source, iconPatched: false, sinkPatched: false, gatePatched: false, runtimeExposed: false };
    if (at < 0) return none;
    const fnStart = source.lastIndexOf('async function ', at);
    if (fnStart < 0 || at - fnStart > 4000) return none;
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
    // Web A returns silently while its cached hasWebNotifications flag is false. A failed push
    // subscription or a stale account state flips it at any moment, so the notify gate must not
    // depend on it: the desktop popup_notifications setting owns enablement.
    const gate = /\{hasWebNotifications:([A-Za-z_$][\w$]*)\}=([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)/.exec(segment);
    let gatePatched = false;
    if (gate) {
        segment = segment.slice(0, gate.index) +
            `{hasWebNotifications:${gate[1]}}=__twdNotifyFlags(${gate[2]}(${gate[3]}))` +
            segment.slice(gate.index + gate[0].length);
        gatePatched = true;
    }
    if (!iconPatched && !sinkPatched && !gatePatched) return { body: source, iconPatched, sinkPatched, gatePatched, runtimeExposed: false };

    // This chunk imports Web A's getGlobal/getActions; publish them for the desktop UI (Vite has no webpack registry).
    // Minifier-assigned parameter names change between Web A builds; match any identifier.
    const getGlobal = /\{chat:[\w$]+,message:[\w$]+,isReaction:[\w$]+=!1\}\)\{let [\w$]+=([\w$]+)\(\),\{hasWebNotifications/.exec(source);
    const getActions = /else\{let [\w$]+=([\w$]+)\(\),[\w$]+=\{body:[\w$]+,icon:/.exec(source);
    const runtime = getGlobal && getActions
        ? `globalThis.__twdTelegramRuntime={getGlobal:()=>${getGlobal[1]}(),getActions:()=>${getActions[1]}()};\n`
        : '';
    const helper = `
function __twdNotifyFlags(v){return Object.assign({},v,{hasWebNotifications:!0})}
globalThis.__twdNotifGatePatched=${gatePatched};
function __twdNotifyIcon(load){let p;try{p=Promise.resolve(load()).catch(()=>{})}catch(_){p=Promise.resolve()}return Promise.race([p,new Promise(r=>setTimeout(r,${ICON_WAIT_MS}))])}
function __twdNotifySink(m){try{if(typeof globalThis.__twdConsumeSwNotification==='function'&&globalThis.__twdConsumeSwNotification(m))return}catch(_){}const c=navigator.serviceWorker&&navigator.serviceWorker.controller;c&&c.postMessage(m)}
${runtime}`;
    return {
        body: source.slice(0, fnStart) + segment + source.slice(at) + helper,
        iconPatched,
        sinkPatched,
        gatePatched,
        runtimeExposed: !!runtime,
    };
}

async function injectTelegramNotifications(response, urlString) {
    let u;
    try { u = new URL(urlString); } catch (_) { return response; }
    if (u.hostname !== 'web.telegram.org' || !NOTIFY_CHUNK_RE.test(u.pathname)) return response;
    const source = await response.text();
    const patched = patchTelegramNotifications(source);
    if (patched.iconPatched && patched.sinkPatched && patched.gatePatched && patched.runtimeExposed) console.log('[TWD-NOTIF] Telegram notification hooks installed');
    else if (source.includes(NOTIFY_MARKER)) {
        console.warn(`[TWD-NOTIF] Telegram notification hooks partial: icon=${patched.iconPatched} sink=${patched.sinkPatched} gate=${patched.gatePatched} runtime=${patched.runtimeExposed}`);
    }
    return transformedJsResponse(response, patched.body);
}

module.exports = { injectTelegramNotifications, patchTelegramNotifications };
