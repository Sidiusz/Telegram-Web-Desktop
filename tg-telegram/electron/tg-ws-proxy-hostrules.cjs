'use strict';

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOCAL_HOST = '127.0.0.1';
const DEFAULT_ADAPTER_PORT = 18443;

function standardConfigPath() {
    if (process.platform === 'win32') {
        const base = process.env.APPDATA || app.getPath('appData');
        return path.join(base, 'TgWsProxy', 'config.json');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'TgWsProxy', 'config.json');
    }
    const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(base, 'TgWsProxy', 'config.json');
}

function hasValidProxyConfig() {
    const configPath = process.env.TG_WS_PROXY_CONFIG || standardConfigPath();
    try {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        let secret = String(process.env.TG_WS_PROXY_SECRET || cfg.secret || '').trim().toLowerCase();
        if (secret.length === 34 && (secret.startsWith('dd') || secret.startsWith('ee'))) secret = secret.slice(2);
        return /^[0-9a-f]{32}$/.test(secret);
    } catch (_) {
        return false;
    }
}

function installTgWsProxyEndpointRules() {
    if (!hasValidProxyConfig()) return false;

    const configuredPort = Number(process.env.TG_WS_PROXY_WEB_PORT || DEFAULT_ADAPTER_PORT);
    const localPort = Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535
        ? configuredPort
        : DEFAULT_ADAPTER_PORT;

    const rules = [];
    for (let dc = 1; dc <= 5; dc += 1) {
        // Chromium host mapping patterns match hostnames, not "hostname:port".
        // The replacement side may contain a port and rewrites only this app's
        // network endpoint; the original URL hostname/SNI stays intact.
        rules.push(`MAP zws${dc}.web.telegram.org ${LOCAL_HOST}:${localPort}`);
        rules.push(`MAP zws${dc}-1.web.telegram.org ${LOCAL_HOST}:${localPort}`);
    }

    const previous = app.commandLine.getSwitchValue('host-rules');
    app.commandLine.appendSwitch('host-rules', [previous, ...rules].filter(Boolean).join(', '));
    return true;
}

module.exports = { installTgWsProxyEndpointRules };
