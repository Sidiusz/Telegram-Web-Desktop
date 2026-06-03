'use strict';
const { app, Menu } = require('electron');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let reloadInterval = null;

const { createWindow, getWindow } = require('./electron/window.cjs');
const { createTray } = require('./electron/tray.cjs');
const { initState, getState, registerIpc } = require('./electron/ipc.cjs');

// Регистрируемся как обработчик tg:// — браузер будет открывать нас
app.setAsDefaultProtocolClient('tg');

// Навигирует окно по tg:// ссылке через web.telegram.org
function handleTgUrl(tgUrl) {
    const win = getWindow();
    if (!win) return;
    win.show();
    win.focus();
    const internalUrl = 'https://web.telegram.org/a/#?tgaddr=' + encodeURIComponent(tgUrl);
    win.webContents.loadURL(internalUrl);
}

// Извлекает tg:// URL из аргументов командной строки
function getTgUrlFromArgs(argv) {
    return argv.find(arg => arg.startsWith('tg://')) || null;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    // Приложение уже запущено — второй экземпляр передаёт аргументы сюда
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
	const win = getWindow();
    if (win) {
        //win.webContents.openDevTools();
    }

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