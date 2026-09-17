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
// Dev only (unpackaged): expose CDP for local UI/smoke testing. Never in shipped builds.
if (!app.isPackaged) app.commandLine.appendSwitch('remote-debugging-port', process.env.TWD_CDP_PORT || '9222');

const { createWindow, getWindow } = require('./electron/window.cjs');
const { createTray } = require('./electron/tray.cjs');
const { initState, getState, registerIpc } = require('./electron/ipc.cjs');
const { startEmbeddedFlowsealBridge, stopEmbeddedFlowsealBridge } = require('./electron/tg-flowseal-bridge.cjs');
const { normalizeToTg, getTgUrlFromArgs } = require('./electron/deep-links.cjs');

// Dev/test runs can use an isolated profile without competing with the installed app.
// Production behavior is unchanged unless these explicit test-only env vars are set.
if (!app.isPackaged) {
    const devProfile = process.env.TWD_DEV_PROFILE;
    if (devProfile) app.setPath('userData', path.resolve(devProfile));
    else app.setPath('userData', path.join(app.getPath('appData'), 'Telegram Web Desktop'));
}

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
    try { powerSaveBlocker.start('prevent-app-suspension'); } catch(e) {}
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