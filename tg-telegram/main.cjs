'use strict';
const { app, Menu } = require('electron');
const path = require('path');

// Do not grant CSP-bypass privileges to the global http/https schemes.
// The narrowly-scoped Telegram /a response transform in window.cjs is the only
// place where CSP is relaxed for compatibility with our injected UI.

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Dev/test only: expose CDP for local UI/smoke testing. Packaged test builds may opt in
// explicitly with TWD_ALLOW_MULTI_INSTANCE + TWD_CDP_PORT; normal shipped runs never do.
if (!app.isPackaged || (process.env.TWD_ALLOW_MULTI_INSTANCE === '1' && process.env.TWD_CDP_PORT)) {
    app.commandLine.appendSwitch('remote-debugging-port', process.env.TWD_CDP_PORT || '9222');
}

// Dev/test runs can use an isolated profile without competing with the installed app.
// Packaged builds only honor it together with the explicit multi-instance test flag.
const devProfile = process.env.TWD_DEV_PROFILE;
if (devProfile && (!app.isPackaged || process.env.TWD_ALLOW_MULTI_INSTANCE === '1')) {
    app.setPath('userData', path.resolve(devProfile));
} else if (!app.isPackaged) {
    app.setPath('userData', path.join(app.getPath('appData'), 'Telegram Web Desktop'));
}

// Modules that create electron-store instances must be loaded only after userData
// is finalized, otherwise a dev instance silently reads/writes the installed profile.
const { createWindow, getWindow } = require('./electron/window.cjs');
const { createTray } = require('./electron/tray.cjs');
const { initState, getState, registerIpc } = require('./electron/ipc.cjs');
const { startEmbeddedFlowsealBridge, stopEmbeddedFlowsealBridge } = require('./electron/tg-flowseal-bridge.cjs');
const { normalizeToTg, getTgUrlFromArgs } = require('./electron/deep-links.cjs');

// Register tg:// only from an installed build. `app.isPackaged` is also true for
// dist/win-unpacked, so test builds must not steal the OS association.
function isInstalledBuildPath() {
    if (!app.isPackaged) return false;
    if (process.env.TWD_REGISTER_PROTOCOL === '1') return true;
    const exe = path.resolve(process.execPath).toLowerCase();
    const roots = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
        process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)
        .map(v => path.resolve(v).toLowerCase() + path.sep);
    return roots.some(root => exe.startsWith(root));
}
if (isInstalledBuildPath()) { try { app.setAsDefaultProtocolClient('tg'); } catch (_) {} }

function showMainWindow(win, maximize = true) {
    if (!win || win.isDestroyed()) return;
    try { if (win.isMinimized()) win.restore(); } catch (_) {}
    try { if (maximize && !win.isMaximized()) win.maximize(); } catch (_) {}
    win.show();
    win.focus();
}

function handleTgUrl(tgUrl) {
    const win = getWindow();
    if (!win) return;
    showMainWindow(win, true);
    // webZ reads tgaddr from the hash only at app startup. loadURL to a URL that
    // differs only by hash is a same-document nav (no reload) → the effect never
    // re-runs and the link is ignored. A unique query param forces a full load.
    const internalUrl = 'https://web.telegram.org/a/?_tgdl=' + Date.now()
        + '#?tgaddr=' + encodeURIComponent(tgUrl);
    win.webContents.loadURL(internalUrl);
}

const initialDeepLink = getTgUrlFromArgs(process.argv);
const isAutostartLaunch = (argv = process.argv) => argv.some(arg =>
    ['--autostart', '--startup', '--hidden'].includes(String(arg).toLowerCase()));
const initialAutostart = isAutostartLaunch(process.argv);
const gotLock = process.env.TWD_ALLOW_MULTI_INSTANCE === '1' ||
    app.requestSingleInstanceLock({ deepLink: initialDeepLink || '', autostart: initialAutostart });
if (!gotLock) {
    app.quit();
} else {
    // Forward the parsed deep link through Electron's additionalData channel too.
    // On Windows the secondary argv is not reliable for custom protocols on every launch path.
    app.on('second-instance', (event, argv, workingDirectory, additionalData) => {
        const win = getWindow();
        const tgUrl = normalizeToTg(additionalData?.deepLink) || getTgUrlFromArgs(argv);
        const autostart = additionalData?.autostart === true || isAutostartLaunch(argv);
        if (tgUrl) handleTgUrl(tgUrl);
        else if (!autostart) showMainWindow(win, true);
    });
}

if (gotLock) {
app.whenReady().then(async () => {
    initState();
    try { await startEmbeddedFlowsealBridge(); } catch (e) { console.error('[TG-PROXY-BRIDGE] startup failed:', e); }
    const state = getState();
    registerIpc(getWindow);
    createWindow(
        state,
        rawUrl => { const tgUrl = normalizeToTg(rawUrl); if (tgUrl) handleTgUrl(tgUrl); },
        { startHidden: initialAutostart }
    );
    createTray(getWindow);

    Menu.setApplicationMenu(null);

    if (initialDeepLink) {
        const win = getWindow();
        win.webContents.once('did-finish-load', () => handleTgUrl(initialDeepLink));
    }
});

app.on('before-quit', () => { void stopEmbeddedFlowsealBridge().catch(() => {}); });

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
}