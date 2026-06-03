'use strict';
const { BrowserWindow, session, app, Menu, MenuItem } = require('electron');
const path = require('path');
const { NOTIF_INTERCEPT_JS, EXTERNAL_JS, AUDIO_JS, UI_JS } = require('./scripts.cjs');
const { loadAddonScripts } = require('./addons.cjs');
const { saveDownloads } = require('./downloads.cjs');
const { loadSettings } = require('./settings.cjs');

const TG_URL = 'https://web.telegram.org/a/';

let mainWindow = null;
let forceQuit = false;

app.on('before-quit', () => { forceQuit = true; });

function getWindow() { return mainWindow; }

function createWindow(state) {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(true);
    });
    session.defaultSession.setPermissionCheckHandler(() => true);

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 640,
        minHeight: 480,
        backgroundColor: '#0e1621',
        title: 'Telegram Web Desktop',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            spellcheck: false,
            bypassCSP: true,
        },
    });

    mainWindow.webContents.on('console-message', (e, level, message) => {
        if (
            message.includes('Failed to fetch') ||
            message.includes('MTProtoSender') ||
            message.includes('Using fallback') ||
            message.includes('HTTP connection failed') ||
            message.includes('WebSocket connection') ||
            message.includes('Bad authKeyId') ||
            message.includes('PromisedWebSockets') ||
            message.includes('CORS policy') ||
            message.includes('[ERROR]') ||
            message.includes('[WARN]')
        ) return;
        const levels = ['', 'INFO', 'WARN', 'ERROR'];
        console.log(`[PAGE ${levels[level] || level}]`, message);
    });

    const baseScripts = [EXTERNAL_JS, AUDIO_JS, UI_JS];

    mainWindow.webContents.on('dom-ready', () => {
        mainWindow.webContents.executeJavaScript(NOTIF_INTERCEPT_JS).catch(e => console.error('[NOTIF]', e));
    });

    mainWindow.webContents.on('did-finish-load', () => {
        const s = loadSettings();
        if (s.devtools_enabled) mainWindow.webContents.openDevTools();

        const allScripts = [...baseScripts, ...loadAddonScripts()];
        for (const script of allScripts) {
            mainWindow.webContents.executeJavaScript(script).catch(e => console.error('[SCRIPT]', e));
        }
    });

    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const isF12 = input.key === 'F12';
        const isCtrlShiftI = (input.control || input.meta) && input.shift &&
                             (input.key === 'I' || input.key === 'i');
        if (isF12 || isCtrlShiftI) {
            if (mainWindow.webContents.isDevToolsOpened()) {
                mainWindow.webContents.closeDevTools();
            } else {
                mainWindow.webContents.openDevTools();
            }
        }
    });

    mainWindow.webContents.on('context-menu', (e, params) => {
        if (params.mediaType !== 'image' || !params.srcURL) return;

        const menu = new Menu();

        menu.append(new MenuItem({
            label: 'Сохранить изображение',
            click: () => {
                mainWindow.webContents.downloadURL(params.srcURL);
            },
        }));

        menu.append(new MenuItem({
            label: 'Копировать изображение',
            click: () => {
                mainWindow.webContents.copyImageAt(params.x, params.y);
            },
        }));

        menu.popup({ window: mainWindow });
    });

    mainWindow.on('blur', () => {
        mainWindow.webContents.executeJavaScript(`
            Object.defineProperty(document, 'hidden', {get: () => true, configurable: true});
            Object.defineProperty(document, 'visibilityState', {get: () => 'hidden', configurable: true});
            Object.defineProperty(document, 'hasFocus', {value: () => false, configurable: true});
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('blur'));
        `).catch(() => {});
    });

    mainWindow.on('focus', () => {
        mainWindow.webContents.executeJavaScript(`
            Object.defineProperty(document, 'hidden', {get: () => false, configurable: true});
            Object.defineProperty(document, 'visibilityState', {get: () => 'visible', configurable: true});
            Object.defineProperty(document, 'hasFocus', {value: () => true, configurable: true});
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('focus'));
        `).catch(() => {});
    });

    mainWindow.webContents.session.on('will-download', (event, item) => {
        const settings = loadSettings();
        const originalFilename = item.getFilename();

        const downloadDir = settings.save_path || app.getPath('downloads');
        item.setSavePath(path.join(downloadDir, originalFilename));

        state.downloadCounter += 1;
        const id = state.downloadCounter;
        const savePath = item.getSavePath();
        const filename = path.basename(savePath) || originalFilename;

        state.downloads.push({ id, url: item.getURL(), filename, path: savePath, status: 'downloading' });
        saveDownloads(state.downloads);

        mainWindow.webContents.send('download-event', { type: 'start', id, filename });

        item.on('updated', (event, dlState) => {
            if (dlState === 'interrupted') {
                const dl = state.downloads.find(d => d.id === id);
                if (dl) { dl.status = 'failed'; saveDownloads(state.downloads); }
                mainWindow.webContents.send('download-event', { type: 'done', id, status: 'failed' });
            } else {
                mainWindow.webContents.send('download-event', {
                    type: 'progress',
                    id,
                    received: item.getReceivedBytes(),
                    total: item.getTotalBytes(),
                });
            }
        });

        item.once('done', (event, dlState) => {
            const dl = state.downloads.find(d => d.id === id);
            if (dl) {
                dl.status = dlState === 'completed' ? 'completed' : 'failed';
                dl.path = item.getSavePath();
                saveDownloads(state.downloads);
            }
            mainWindow.webContents.send('download-event', {
                type: 'done',
                id,
                status: dlState === 'completed' ? 'completed' : 'failed',
            });
        });
    });

    mainWindow.webContents.on('will-navigate', (e, url) => {
        if (url.startsWith('blob:')) {
            e.preventDefault();
            mainWindow.webContents.downloadURL(url);
        }
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('blob:')) {
            mainWindow.webContents.downloadURL(url);
        }
        return { action: 'deny' };
    });
    mainWindow.on('ready-to-show', () => mainWindow.show());
    mainWindow.on('close', (e) => {
        if (forceQuit) return;
        const settings = loadSettings();
        if (settings.minimize_to_tray) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.loadURL(TG_URL);
    return mainWindow;
}

module.exports = { createWindow, getWindow };
