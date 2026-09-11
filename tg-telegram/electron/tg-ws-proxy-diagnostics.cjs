'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let installed = false;

function append(message) {
    try {
        const file = path.join(app.getPath('userData'), 'tg-ws-proxy-bridge.log');
        fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`);
    } catch (_) {}
}

function installTgWsProxyDiagnostics(electronSession) {
    if (installed || !electronSession?.webRequest) return;
    installed = true;

    const filter = { urls: ['ws://*/*', 'wss://*/*'] };

    electronSession.webRequest.onBeforeRequest(filter, (details, callback) => {
        append(`[tg-ws-proxy] WS REQUEST type=${details.resourceType || '?'} url=${details.url}`);
        callback({ cancel: false });
    });

    electronSession.webRequest.onCompleted(filter, (details) => {
        append(`[tg-ws-proxy] WS COMPLETED status=${details.statusCode || 0} url=${details.url}`);
    });

    electronSession.webRequest.onErrorOccurred(filter, (details) => {
        append(`[tg-ws-proxy] WS ERROR error=${details.error || '?'} url=${details.url}`);
    });

    append('[tg-ws-proxy] WebSocket diagnostics installed');
}

module.exports = { installTgWsProxyDiagnostics };
