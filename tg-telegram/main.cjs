'use strict';
const { app, Menu } = require('electron');

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
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});