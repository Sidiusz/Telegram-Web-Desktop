'use strict';
const fs = require('fs');
const path = require('path');
const { getProxyBootstrap } = require('./tg-flowseal-route.cjs');

const RELAY_RUNTIME = fs.readFileSync(
    path.join(__dirname, 'tg-flowseal-relay-runtime.js'), 'utf8'
);

function isTaggedTelegramWorker(urlString) {
    try {
        const u = new URL(urlString);
        return u.hostname === 'web.telegram.org' && u.pathname.startsWith('/a/') &&
            /\/(?:worker-[^/]+|index\.worker-[^/]+)\.js$/i.test(u.pathname) && u.searchParams.get('__twd_proxy') === '1';
    } catch (_) { return false; }
}

function patchTelegramTransport(source) {
    let count = 0;
    const patched = source.replace(
        /this\.client=new WebSocket\(this\.website,([`'"])binary\1\),this\.client\.binaryType=([`'"])arraybuffer\2/g,
        () => {
            count++;
            return 'this.client=new WebSocket(globalThis.__twdFlowsealRoute(this.website),`binary`),globalThis.__twdFlowsealAttach(this.client,this.website),this.client.binaryType=`arraybuffer`';
        }
    );
    if (count === 0) return { patched: false, source };
    if (count !== 1) {
        console.error(`[TG-PROXY] Telegram transport patch mismatch: connect=${count}`);
        return { patched: false, source };
    }
    return { patched: true, source: patched };
}
async function injectTelegramWorkerProxy(response, urlString) {
    if (!isTaggedTelegramWorker(urlString)) return response;
    const body = await response.text();
    const result = patchTelegramTransport(body);
    if (!result.patched) {
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        return new Response(body, {
            status: response.status, statusText: response.statusText, headers,
        });
    }

    const runtime = RELAY_RUNTIME.replace(
        '__TWD_PROXY_INITIAL__', JSON.stringify(getProxyBootstrap())
    );
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/javascript; charset=utf-8');
    // Never persist our transformed worker. The underlying Telegram asset may be
    // cached, but every app boot must run the current bridge transform again.
    headers.set('cache-control', 'no-store, no-cache, must-revalidate');
    headers.set('pragma', 'no-cache');
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.delete('content-security-policy');
    console.log('[TG-PROXY] patched Telegram MTProto transport for embedded bridge');
    return new Response(runtime + '\n' + result.source, {
        status: response.status, statusText: response.statusText, headers,
    });
}

module.exports = { injectTelegramWorkerProxy, isTaggedTelegramWorker, patchTelegramTransport };