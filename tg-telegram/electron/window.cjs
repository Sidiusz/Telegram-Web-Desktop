'use strict';
const { BrowserWindow, session, app, Menu, MenuItem, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// Windows-style dedup: if the file exists, append " (1)", " (2)", … like Explorer.
function uniquePath(p) {
    if (!fs.existsSync(p)) return p;
    const dir = path.dirname(p);
    const ext = path.extname(p);
    const base = path.basename(p, ext);
    for (let i = 1; i < 10000; i++) {
        const cand = path.join(dir, `${base} (${i})${ext}`);
        if (!fs.existsSync(cand)) return cand;
    }
    return p;
}
const { getScripts } = require('./scripts.cjs');
const { loadAddonScripts } = require('./addons.cjs');
const { saveDownloads, trackActive, untrackActive } = require('./downloads.cjs');
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
            backgroundThrottling: false,
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

    mainWindow.webContents.on('dom-ready', () => {
        const { NOTIF_INTERCEPT_JS } = getScripts();
        mainWindow.webContents.executeJavaScript(NOTIF_INTERCEPT_JS).catch(e => console.error('[NOTIF]', e));
    });

    const injectAll = () => {
        // getScripts() re-reads inject/* on every call in dev, so edits land on a reload.
        // NOTIF_INTERCEPT_JS must come first: otherwise, after TG's own self-reload (service worker), the Notification intercept got lost and the watchdog never restored it.
        const { NOTIF_INTERCEPT_JS, EXTERNAL_JS, AUDIO_JS, UI_JS } = getScripts();
        const allScripts = [NOTIF_INTERCEPT_JS, EXTERNAL_JS, AUDIO_JS, UI_JS, ...loadAddonScripts()];
        for (const script of allScripts) {
            mainWindow.webContents.executeJavaScript(script).catch(e => console.error('[SCRIPT]', e));
        }
    };

    mainWindow.webContents.on('did-finish-load', () => {
        const s = loadSettings();
        if (s.devtools_enabled) mainWindow.webContents.openDevTools();
        injectAll();
    });

    // Watchdog: TG's self-reload ("Reload" in the chat list) goes through a service
    // worker, and did-finish-load can fire on an intermediate load and miss the final page — checks the __tgUIInjected marker and re-injects everything if it's gone.
    setInterval(() => {
        if (mainWindow.isDestroyed()) return;
        mainWindow.webContents.executeJavaScript('!!window.__tgUIInjected', true)
            .then(ok => { if (!ok) injectAll(); })
            .catch(() => {});
    }, 3000);

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
        const menu = new Menu();
        const ef = params.editFlags || {};

        if (params.mediaType === 'image' && params.srcURL) {
            menu.append(new MenuItem({
                label: 'Сохранить изображение',
                click: () => mainWindow.webContents.downloadURL(params.srcURL),
            }));
            menu.append(new MenuItem({
                label: 'Копировать изображение',
                click: () => mainWindow.webContents.copyImageAt(params.x, params.y),
            }));
        }

        if (params.isEditable) {
            if (menu.items.length) menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({ role: 'undo',   label: 'Отменить',  enabled: ef.canUndo }));
            menu.append(new MenuItem({ role: 'redo',   label: 'Повторить', enabled: ef.canRedo }));
            menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({ role: 'cut',    label: 'Вырезать',  enabled: ef.canCut }));
            menu.append(new MenuItem({ role: 'copy',   label: 'Копировать', enabled: ef.canCopy }));
            menu.append(new MenuItem({ role: 'paste',  label: 'Вставить',  enabled: ef.canPaste }));
            menu.append(new MenuItem({ role: 'delete', label: 'Удалить',   enabled: ef.canDelete }));
            menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({ role: 'selectAll', label: 'Выделить всё', enabled: ef.canSelectAll }));
        } else if (params.selectionText && params.selectionText.trim()) {
            if (menu.items.length) menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({ role: 'copy', label: 'Копировать' }));
        }

        if (!menu.items.length) return;
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
        item.setSavePath(uniquePath(path.join(downloadDir, originalFilename)));

        state.downloadCounter += 1;
        const id = state.downloadCounter;
        const savePath = item.getSavePath();
        const filename = path.basename(savePath) || originalFilename;

        state.downloads.push({ id, url: item.getURL(), filename, path: savePath, status: 'downloading' });
        saveDownloads(state.downloads);
        trackActive(id, item);

        // origName is the name as sent in the message (renderer matches mid by it); filename is the actual saved name (for the manager).
        mainWindow.webContents.send('download-event', { type: 'start', id, filename, origName: originalFilename });

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
            untrackActive(id);
            const status = dlState === 'completed' ? 'completed' : (dlState === 'cancelled' ? 'cancelled' : 'failed');
            // User-cancelled: drop the partial file.
            if (status === 'cancelled' && savePath) { try { fs.unlinkSync(savePath); } catch (e) {} }
            const dl = state.downloads.find(d => d.id === id);
            if (dl) {
                dl.status = status;
                dl.path = item.getSavePath();
                saveDownloads(state.downloads);
            }
            mainWindow.webContents.send('download-event', { type: 'done', id, status });
        });
    });

    // Hard-locks the /A (webZ) version. /K is a separate app (webK) our injections/
    // addons aren't built for — any navigation/redirect to /k is cancelled and sent back to /A.
    const isKVersionUrl = (url) => {
        try {
            const u = new URL(url);
            return /(^|\.)telegram\.org$/i.test(u.hostname) && /^\/k(\/|$)/.test(u.pathname);
        } catch (e) { return false; }
    };
    const forceAVersion = (e) => {
        if (e) e.preventDefault();
        // Doesn't reload needlessly while already on /A — only loads when we'd actually land on /K.
        mainWindow.loadURL(TG_URL);
    };

    mainWindow.webContents.on('will-navigate', (e, url) => {
        if (isKVersionUrl(url)) { forceAVersion(e); return; }
        // blob: always means "download" (the viewer gives an <a download href=blob:>). The
        // renderer does the actual download (bootstrap.js → save_blob). Just block navigation here — webContents.downloadURL(blob:) doesn't work in Electron and pops a "choose an app" dialog.
        if (url.startsWith('blob:')) e.preventDefault();
    });
    mainWindow.webContents.on('will-redirect', (e, url) => {
        if (isKVersionUrl(url)) forceAVersion(e);
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isKVersionUrl(url)) { mainWindow.loadURL(TG_URL); return { action: 'deny' }; }
        return { action: 'deny' };   // don't open blob/external links in a new window (see external.js)
    });
    mainWindow.on('ready-to-show', () => mainWindow.show());
    // Taskbar badge vanishes on cold start (button doesn't exist yet when setBadgeCount runs) and on restore from tray — reapplied on show/restore.
    const reapplyBadge = () => { try { app.setBadgeCount(state.lastNotificationCount || 0); } catch (e) {} };
    mainWindow.on('show', reapplyBadge);
    mainWindow.on('restore', reapplyBadge);

    // TG's column layout caches window width via ResizeObserver and won't recompute after a
    // monitor change or mid-transition reload (chat stays narrow); a synthetic resize event doesn't trigger it, but nudging zoom by 0.001 does (no visible jump, unlike resizing the frame).
    let _nudging = false;
    function nudgeRelayout() {
        if (_nudging || mainWindow.isDestroyed()) return;
        _nudging = true;
        try {
            const wc = mainWindow.webContents;
            const z = wc.getZoomFactor();
            wc.setZoomFactor(z + 0.001);
            setTimeout(() => { try { wc.setZoomFactor(z); } catch (e) {} _nudging = false; }, 50);
        } catch (e) { _nudging = false; }
    }
    let _lastDisplayId = null;
    try { _lastDisplayId = screen.getDisplayMatching(mainWindow.getBounds()).id; } catch (e) {}
    mainWindow.on('moved', () => {
        try {
            const d = screen.getDisplayMatching(mainWindow.getBounds());
            if (d && d.id !== _lastDisplayId) { _lastDisplayId = d.id; nudgeRelayout(); }
        } catch (e) {}
    });
    mainWindow.webContents.on('did-finish-load', () => { setTimeout(nudgeRelayout, 500); });
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
