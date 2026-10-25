'use strict';
const { transformedJsResponse } = require('./tg-bundle-patch.cjs');
const fs = require('fs');
const path = require('path');

const RELAY_RUNTIME = fs.readFileSync(
    path.join(__dirname, 'tg-flowseal-relay-runtime.js'), 'utf8'
);

const RPC_INVOKE_PATTERN = /try\{let ([A-Za-z_$][\w$]*)=await ([A-Za-z_$][\w$]*)\.invoke\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\);return ([A-Za-z_$][\w$]*)\(\1\),/;

function patchTelegramPrivacy(body) {
    const match = RPC_INVOKE_PATTERN.exec(body);
    if (!match) return { body, patched: false };

    const original = match[0];
    const requestVar = match[3];
    const guarded = original.replace(
        'try{',
        `try{if(globalThis.__twdPrivacyShouldBlock&&globalThis.__twdPrivacyShouldBlock(${requestVar}))return;`
    ).replace(`${match[2]}.invoke(${match[3]},${match[4]},${match[5]},${match[6]})`,
        `globalThis.__twdInvokeWithMediaRecovery(${requestVar},()=>${match[2]}.invoke(${match[3]},${match[4]},${match[5]},${match[6]}))`);
    return {
        body: body.slice(0, match.index) + guarded + body.slice(match.index + original.length),
        patched: true,
    };
}

// Web A downloads files through exported (per-DC media) senders with sender.send(GetFile),
// not through invokeRequest, so the RPC hook above never sees them. Hook the sender itself.
const SENDER_SEND_PATTERN = /send\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)=!1\)\{let ([A-Za-z_$][\w$]*)=this\._splitMessageIdRequest\(\1\)([\s\S]{0,400}?),\4\[0\]\.promise\}/;

function patchTelegramMediaSenders(body) {
    const match = SENDER_SEND_PATTERN.exec(body);
    if (!match) return { body, patched: false };
    const [all, req, signal, longPoll, states, middle] = match;
    const hooked = `send(${req},${signal},${longPoll}=!1){let ${states}=this._splitMessageIdRequest(${req})${middle},` +
        `this._isExported&&globalThis.__twdWatchSend?globalThis.__twdWatchSend(this,${req},${states}[0].promise,${signal}):${states}[0].promise}`;
    return { body: body.slice(0, match.index) + hooked + body.slice(match.index + all.length), patched: true };
}

// Web A drops to its HTTP transport after one failed WebSocket attempt and then retries only over
// HTTP, which proxy mode blocks, so one bad reconnect left Telegram offline until a restart.
// Reads of the flag (never its assignments) also honour the relay's switch.
const HTTP_TRANSPORT_READ = /this\._shouldAllowHttpTransport(?!\s*=(?!=))/g;

function patchTelegramHttpFallback(body) {
    let count = 0;
    const out = body.replace(HTTP_TRANSPORT_READ, () => {
        count++;
        return '(this._shouldAllowHttpTransport&&!globalThis.__twdBlockHttpTransport)';
    });
    return { body: out, patched: count > 0, count };
}

function workerProxyChannel(urlString) {
    try {
        const u = new URL(urlString);
        const channel = String(u.searchParams.get('__twd_proxy_channel') || '');
        return /^__twd_proxy_[a-f0-9]{32}$/.test(channel) ? channel : '';
    } catch (_) { return ''; }
}

function isTaggedTelegramWorker(urlString) {
    try {
        const u = new URL(urlString);
        return u.hostname === 'web.telegram.org' && u.pathname.startsWith('/a/') &&
            /\/(?:worker-[^/]+|index\.worker-[^/]+)\.js$/i.test(u.pathname) &&
            u.searchParams.get('__twd_proxy') === '1' &&
            !!workerProxyChannel(urlString);
    } catch (_) { return false; }
}

async function injectTelegramWorkerProxy(response, urlString) {
    if (!isTaggedTelegramWorker(urlString)) return response;

    const source = await response.text();
    const privacyPatch = patchTelegramPrivacy(source);
    const senderPatch = patchTelegramMediaSenders(privacyPatch.body);
    const httpPatch = patchTelegramHttpFallback(senderPatch.body);
    const body = httpPatch.body;
    if (httpPatch.patched) console.log(`[TG-PROXY] HTTP fallback gated by proxy mode (${httpPatch.count} reads)`);
    else if (/_shouldAllowHttpTransport/.test(source)) console.warn('[TG-PROXY] HTTP fallback flag was not found in the MTProto worker');
    if (!senderPatch.patched && /upload\.GetFile/.test(source)) {
        console.warn('[TG-PROXY] media sender hook was not found in the MTProto worker');
    }
    const channel = workerProxyChannel(urlString);
    const { getProxyBootstrap } = require('./tg-flowseal-route.cjs');
    const initialProxy = getProxyBootstrap();
    const runtime = RELAY_RUNTIME
        .replace('__TWD_PROXY_CHANNEL__', JSON.stringify(channel))
        .replace('__TWD_PROXY_BOOTSTRAP__', JSON.stringify(initialProxy));

    if (!privacyPatch.patched) {
        if (/messages\.(?:ReadHistory|SetTyping|ReadMessageContents)|channels\.ReadHistory/.test(source)) {
            console.warn('[TWD-PRIVACY] Telegram RPC hook was not found in the MTProto worker');
        }
    } else {
        console.log('[TWD-PRIVACY] Telegram RPC hook installed');
    }

    // The transformed worker contains our current routing/privacy runtime. Never persist it
    // across app versions; Telegram's original worker may still be cached normally.
    console.log('[TG-PROXY] wrapped Telegram MTProto WebSocket transport');
    // The per-launch channel makes every URL unique; Vary:* stops the SW caching a copy (with its token) per launch.
    return transformedJsResponse(response, runtime + '\n' + body, { vary: '*' });
}

module.exports = {
    injectTelegramWorkerProxy,
    isTaggedTelegramWorker,
    workerProxyChannel,
    patchTelegramPrivacy,
    patchTelegramMediaSenders,
    patchTelegramHttpFallback,
};
