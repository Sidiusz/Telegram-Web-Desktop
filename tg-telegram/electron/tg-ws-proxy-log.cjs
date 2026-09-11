'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const util = require('util');

let installed = false;
let logPath = null;

function startTgWsProxyFileLog() {
    if (installed) return logPath;
    installed = true;

    try {
        const userData = app.getPath('userData');
        fs.mkdirSync(userData, { recursive: true });
        logPath = path.join(userData, 'tg-ws-proxy-bridge.log');
        fs.writeFileSync(logPath, `=== Telegram Web Desktop TG WS Proxy log ===\nStarted: ${new Date().toISOString()}\n`, 'utf8');
    } catch (error) {
        logPath = null;
        return null;
    }

    for (const level of ['log', 'warn', 'error']) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            original(...args);
            try {
                const text = util.format(...args);
                if (text.includes('[tg-ws-proxy]')) {
                    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${level.toUpperCase()} ${text}\n`, 'utf8');
                }
            } catch (_) {}
        };
    }

    console.log(`[tg-ws-proxy] file log: ${logPath}`);
    return logPath;
}

module.exports = { startTgWsProxyFileLog };
