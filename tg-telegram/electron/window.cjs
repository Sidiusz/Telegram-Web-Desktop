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

    const baseScripts = [EXTERNAL_JS, AUDIO_JS, UI_JS];

    mainWindow.webContents.on('dom-ready', () => {
        mainWindow.webContents.executeJavaScript(NOTIF_INTERCEPT_JS).catch(e => console.error('[NOTIF]', e));
    });

    const injectAll = () => {
        // NOTIF_INTERCEPT_JS первым и в общем наборе: иначе после self-reload TG
        // (service worker) перехват Notification терялся (watchdog его не возвращал).
        const allScripts = [NOTIF_INTERCEPT_JS, ...baseScripts, ...loadAddonScripts()];
        for (const script of allScripts) {
            mainWindow.webContents.executeJavaScript(script).catch(e => console.error('[SCRIPT]', e));
        }
    };

    mainWindow.webContents.on('did-finish-load', () => {
        const s = loadSettings();
        if (s.devtools_enabled) mainWindow.webContents.openDevTools();
        injectAll();
    });

    // Watchdog: when TG refreshes itself ("Reload" in the chat list) it reloads the
    // page via a service worker — sometimes did-finish-load fires on an intermediate
    // load and we miss injecting the final SW page, so our menu/panels vanish until
    // restart. We check the window.__tgUIInjected marker and re-inject everything if
    // it's gone (a fresh document without our injection).
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

        // Editable field
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
            // Selected (read-only) text
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

        // origName = name as in the message (before " (1)"); the renderer matches mid
        // by it. filename = the actual saved name (for the manager).
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
    // Бейдж таскбара пропадает при холодном старте (кнопки ещё нет в момент
    // setBadgeCount) и при восстановлении из трея — переприменяем на show/restore.
    const reapplyBadge = () => { try { app.setBadgeCount(state.lastNotificationCount || 0); } catch (e) {} };
    mainWindow.on('show', reapplyBadge);
    mainWindow.on('restore', reapplyBadge);

    // Колоночная вёрстка TG webZ кэширует ширину окна (через ResizeObserver) и НЕ
    // обновляет её, если окно сменило монитор без «настоящего» изменения размера или
    // если страница перезагрузилась в момент перехода — средняя колонка остаётся
    // узкой (TG считает окно ~1220px вместо реальных 1600 → чат сжат). Синтетический
    // resize-event не помогает (ResizeObserver слушает реальный размер). Дёргаем
    // рамку на 1px и возвращаем — это поднимает ResizeObserver, и TG пересчитывает
    // колонки под фактическую ширину. Делаем после загрузки и при смене дисплея.
    // Дёргаем масштаб на 0.001 и возвращаем: меняется CSS-ширина вьюпорта (innerWidth)
    // → поднимается ResizeObserver TG → пересчёт колонок. Через zoom, а не размер окна,
    // чтобы не разворачивать развёрнутое окно и без видимого скачка.
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
