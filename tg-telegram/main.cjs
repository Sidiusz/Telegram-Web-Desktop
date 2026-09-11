'use strict';
const { app, Menu, protocol, powerSaveBlocker, session } = require('electron');
const path = require('path');
const { startTgWsProxyFileLog } = require('./electron/tg-ws-proxy-log.cjs');

startTgWsProxyFileLog();

// Electron 40 removed webPreferences.bypassCSP — without it Telegram's CSP
// (now delivered via <meta http-equiv> in addition to headers) blocks our
// inline injections and the page stays white. Register https/http as CSP-
// bypassing so executeJavaScript / inline scripts are not subject to page CSP.
// Must be before app ready and only once.
try {
    protocol.registerSchemesAsPrivileged([
        { scheme: 'https', privileges: { standard: true, secure: true, bypassCSP: true, allowServiceWorkers: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
        { scheme: 'http',  privileges: { standard: true, secure: true, bypassCSP: true, allowServiceWorkers: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
    ]);
} catch (e) { /* already registered (e.g. by Sentry) */ }

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
// Keep timers alive (our incoming-message interceptor) when window is backgrounded/hidden
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Dev only (unpackaged): expose CDP for local UI testing. Never in shipped builds.
if (!app.isPackaged) app.commandLine.appendSwitch('remote-debugging-port', '9222');

const { createWindow, getWindow } = require('./electron/window.cjs');
const { createTray } = require('./electron/tray.cjs');
const { initState, getState, registerIpc } = require('./electron/ipc.cjs');
const {
    installTgWsProxyHostRules,
    startTgWsProxyHostBridge,
} = require('./electron/tg-ws-proxy-hostbridge.cjs');

// This switch must be installed before Chromium's network service starts.
// It only remaps Telegram Web A DC hosts (zws1..zws5 and media variants)
// inside this Electron process to the local adapter. No system DNS/hosts/proxy
// settings are changed.
try {
    installTgWsProxyHostRules();
} catch (e) {
    console.error('[tg-ws-proxy] failed to install host resolver rules:', e);
}

// TEMP DEBUG: trace who calls app.quit(); dev (unpackaged) shares the installed app's profile
const _origQuit = app.quit.bind(app);
app.quit = (...a) => { console.error('[DBG] app.quit() called from:\n' + new Error().stack); return _origQuit(...a); };
if (!app.isPackaged && !process.env.TWD_DEV_PROFILE) {
    app.setPath('userData', path.join(app.getPath('appData'), 'Telegram Web Desktop'));
    console.error('[DBG] userData →', app.getPath('userData'));
}

// Register as tg:// handler (replaces the official app). When packaged the plain
// call points the registry at our exe. Unpackaged (electron .), Windows would
// otherwise register bare electron.exe with no app path → tg:// links launch an
// empty Electron. Pass execPath + resolved app dir so dev runs work too.
if (app.isPackaged) {
    app.setAsDefaultProtocolClient('tg');
} else {
    app.setAsDefaultProtocolClient('tg', process.execPath, [path.resolve(process.argv[1])]);
}

function handleTgUrl(tgUrl) {
    const win = getWindow();
    if (!win) return;
    win.show();
    win.focus();
    // webZ reads tgaddr from the hash only at app startup. loadURL to a URL that
    // differs only by hash is a same-document nav (no reload) → the effect never
    // re-runs and the link is ignored. A unique query param forces a full load.
    const internalUrl = 'https://web.telegram.org/a/?_tgdl=' + Date.now()
        + '#?tgaddr=' + encodeURIComponent(tgUrl);
    win.webContents.loadURL(internalUrl);
}

// t.me/<...> https links → tg:// so webZ resolves them via the same deep-link path.
function normalizeToTg(url) {
    if (!url) return null;
    if (url.startsWith('tg://')) return url;
    var m = /^https?:\/\/(?:t\.me|telegram\.me|telegram\.dog)\/(.+)$/i.exec(url);
    if (!m) return null;
    var rest = m[1];
    if (rest.charAt(0) === '+' || /^joinchat\//i.test(rest)) {
        return 'tg://join?invite=' + encodeURIComponent(rest.replace(/^joinchat\//i, '').replace(/^\+/, ''));
    }
    var parts = rest.split(/[?#]/)[0].split('/');
    var domain = parts[0];
    if (!domain) return null;
    var tg = 'tg://resolve?domain=' + encodeURIComponent(domain);
    if (parts[1] && /^\d+$/.test(parts[1])) tg += '&post=' + parts[1];
    return tg;
}

function getTgUrlFromArgs(argv) {
    var raw = argv.find(arg => arg.startsWith('tg://') || /^https?:\/\/(t\.me|telegram\.me|telegram\.dog)\//i.test(arg));
    return normalizeToTg(raw);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    // Already running — second instance forwards its args here
    app.on('second-instance', (event, argv) => {
        const win = getWindow();
        if (win) { win.show(); win.focus(); }
        const tgUrl = getTgUrlFromArgs(argv);
        if (tgUrl) handleTgUrl(tgUrl);
    });
}

app.whenReady().then(async () => {
    try { powerSaveBlocker.start('prevent-app-suspension'); } catch(e) {}

    // The browser still requests the original wss://zwsN.web.telegram.org URL.
    // Chromium resolves only those DC endpoints to the fixed loopback adapter
    // port, preserving the original hostname/SNI. The adapter then translates
    // Web A's obfuscated transport to Flowseal TG WS Proxy's local MTProxy port.
    try {
        await startTgWsProxyHostBridge(session.defaultSession);
    } catch (e) {
        console.error('[tg-ws-proxy] host bridge failed to start:', e);
    }

    initState();
    const state = getState();
    registerIpc(getWindow);
    createWindow(state);
    createTray(getWindow);

    Menu.setApplicationMenu(null);

    const tgUrl = getTgUrlFromArgs(process.argv);
    if (tgUrl) {
        const win = getWindow();
        win.webContents.once('did-finish-load', () => handleTgUrl(tgUrl));
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});