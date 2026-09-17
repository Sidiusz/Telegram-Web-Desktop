'use strict';
const { app, Menu, powerSaveBlocker } = require('electron');
const path = require('path');

// Do not grant CSP-bypass privileges to the global http/https schemes.
// The narrowly-scoped Telegram /a response transform in window.cjs is the only
// place where CSP is relaxed for compatibility with our injected UI.

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
const { startEmbeddedFlowsealBridge, stopEmbeddedFlowsealBridge } = require('./electron/tg-flowseal-bridge.cjs');

// Dev/test runs can use an isolated profile without competing with the installed app.
// Production behavior is unchanged unless these explicit test-only env vars are set.
if (!app.isPackaged) {
    const devProfile = process.env.TWD_DEV_PROFILE;
    if (devProfile) app.setPath('userData', path.resolve(devProfile));
    else app.setPath('userData', path.join(app.getPath('appData'), 'Telegram Web Desktop'));
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

const gotLock = process.env.TWD_ALLOW_MULTI_INSTANCE === '1' || app.requestSingleInstanceLock();
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
    initState();
    try { await startEmbeddedFlowsealBridge(); } catch (e) { console.error('[TG-PROXY-BRIDGE] startup failed:', e); }
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

app.on('before-quit', () => { void stopEmbeddedFlowsealBridge().catch(() => {}); });

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});