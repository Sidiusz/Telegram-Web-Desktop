'use strict';

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const LOCAL_HOST = '127.0.0.1';
const DEFAULT_ADAPTER_PORT = 18443;

function getAdapterPort() {
    const port = Number(process.env.TG_WS_PROXY_WEB_PORT || DEFAULT_ADAPTER_PORT);
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_ADAPTER_PORT;
}

function makePacScript(proxyPort) {
    return `function FindProxyForURL(url, host) {
  host = String(host || '').toLowerCase();
  if (/^(?:zws|kws)[1-5](?:-1)?\\.web\\.telegram\\.org$/.test(host)) {
    return 'PROXY ${LOCAL_HOST}:${proxyPort}';
  }
  return 'DIRECT';
}\n`;
}

function installTgWsProxyStartupPac() {
    const proxyPort = getAdapterPort();
    const pacPath = path.join(os.tmpdir(), 'telegram-web-desktop-tg-ws-proxy.pac');
    fs.writeFileSync(pacPath, makePacScript(proxyPort), 'utf8');
    const pacUrl = pathToFileURL(pacPath).href;

    // Must happen before app.ready / Chromium Network Service creation. Unlike
    // session.setProxy(), the command-line PAC is inherited by worker/network
    // contexts from process startup, including WebSocket traffic.
    app.commandLine.appendSwitch('proxy-pac-url', pacUrl);
    return { proxyPort, pacPath, pacUrl };
}

module.exports = {
    installTgWsProxyStartupPac,
    makePacScript,
    getAdapterPort,
};
