'use strict';
const { app, Menu } = require('electron');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
// Keep timers alive (our incoming-message interceptor) when window is backgrounded/hidden
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Dev only (unpackaged): expose CDP for local UI testing. Never in shipped builds.
if (!app.isPackaged) app.commandLine.appendSwitch('remote-debugging-port', '9222');

let reloadInterval = null;

const { createWindow, getWindow } = require('./electron/window.cjs');
const { createTray } = require('./electron/tray.cjs');
const { initState, getState, registerIpc } = require('./electron/ipc.cjs');

app.setAsDefaultProtocolClient('tg');

function handleTgUrl(tgUrl) {
    const win = getWindow();
    if (!win) return;
    win.show();
    win.focus();
    const internalUrl = 'https://web.telegram.org/a/#?tgaddr=' + encodeURIComponent(tgUrl);
    win.webContents.loadURL(internalUrl);
}

function getTgUrlFromArgs(argv) {
    return argv.find(arg => arg.startsWith('tg://')) || null;
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

app.whenReady().then(() => {
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

    reloadInterval = setInterval(() => {
        const s = state.settings;
        if (!s) return;
        const win = getWindow();
        if (!win) return;

        if (s.auto_reload_on_idle) {
            const idle = (Date.now() - state.lastActivity) / 1000;
            if (idle >= s.idle_timeout) {
                win.webContents.reload();
                state.lastActivity = Date.now();
                return;
            }
        }
        if (s.auto_reload_enabled) {
            if (!state.lastReload) state.lastReload = Date.now();
            const elapsed = (Date.now() - state.lastReload) / 1000;
            if (elapsed >= s.auto_reload_interval) {
                win.webContents.reload();
                state.lastReload = Date.now();
            }
        }
    }, 10000);
});

app.on('window-all-closed', () => {
    if (reloadInterval) clearInterval(reloadInterval);
    if (process.platform !== 'darwin') app.quit();
});