'use strict';
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
    );
    return {
        body: body.slice(0, match.index) + guarded + body.slice(match.index + original.length),
        patched: true,
    };
}

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
    const body = privacyPatch.body;
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
    return transformedJsResponse(response, runtime + '\n' + body);
}

module.exports = {
    injectTelegramWorkerProxy,
    isTaggedTelegramWorker,
    workerProxyChannel,
    patchTelegramPrivacy,
};
