'use strict';
const { ipcMain, shell, dialog, app, Menu, MenuItem } = require('electron');
const { pathToFileURL } = require('url');
const { init: initNotifications, queueNotification } = require('./notification.cjs');
const { loadSettings, saveSettings } = require('./settings.cjs');
const { loadDownloads, saveDownloads, deleteDownload } = require('./downloads.cjs');
const { getAddons, deleteAddon, openAddonsFolder, toggleAddon } = require('./addons.cjs');
const path = require('path');
const fs = require('fs');
const { updateTrayBadge, setTrayLang, setTrayImageFromDataURL, getTrayBaseDataURL } = require('./tray.cjs');
const { checkForUpdate, downloadUpdate, scheduleChecks, init: initUpdater, fetchChangelog, fetchReleases } = require('./updater.cjs');

const TG_URL = 'https://web.telegram.org/a/';

// Windows-style dedup: «file.jpg» → «file (1).jpg», как в Проводнике.
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

// Язык интерфейса (приходит из рендерера, см. report_lang). Для строк уведомлений
// в main-процессе, где T() из inject недоступен.
let _uiLang = 'ru';
const NTR = {
    open:          { ru: 'Открыть',                   en: 'Open' },
    read:          { ru: 'Прочитано',                 en: 'Read' },
    anon:          { ru: 'Анонимный пользователь',    en: 'Anonymous user' },
    new_msg_hidden:{ ru: 'Вам пришло новое сообщение', en: 'You have a new message' },
};
const ntr = (k) => { const e = NTR[k]; return (e && (e[_uiLang] || e.en)) || k; };

let state = {
    downloads: [],
    downloadCounter: 0,
    settings: null,
    lastNotificationCount: null,
};

function initState() {
    state.settings = loadSettings();
    state.downloads = loadDownloads();
    if (state.downloads.length > 0) {
        state.downloadCounter = Math.max(...state.downloads.map(d => d.id));
    }
}

function getState() { return state; }

function registerIpc(getWindow) {
    initNotifications(getWindow);
    initUpdater(getWindow);
    scheduleChecks();

    ipcMain.handle('get_settings', () => state.settings);

    ipcMain.handle('get_app_info', () => ({
        version: app.getVersion(),
    }));

    ipcMain.handle('show_notification', (e, { title, body, icon, sender, peerId }) => {
        const settings = state.settings || loadSettings();
        if (!settings.popup_notifications) return;

        const hideSender = settings.notif_hide_sender === true;
        const hideText = settings.notif_hide_text === true;
        queueNotification({
            title: hideSender ? ntr('anon') : (sender || title || 'Telegram'),
            body: hideText ? ntr('new_msg_hidden') : body,
            icon: hideSender ? '' : icon,
            anon: hideSender,
            peerId,
            btnOpen: ntr('open'),
            btnRead: ntr('read'),
            playSound: settings.notif_sound !== false,
            duration: settings.notif_duration || 6,
        });
    });

    ipcMain.handle('save_settings', (e, { settings }) => {
        saveSettings(settings);
        state.settings = loadSettings();
        // Интервал автопроверки обновлений мог измениться — перепланируем сразу,
        // чтобы смена применялась без перезапуска.
        scheduleChecks();
    });

    // Open/close DevTools instantly without a reload
    ipcMain.handle('toggle_devtools', (e, { open }) => {
        const win = getWindow();
        if (!win) return;
        if (open) win.webContents.openDevTools();
        else win.webContents.closeDevTools();
    });

    ipcMain.handle('open_url', (e, { url }) => {
        shell.openExternal(url);
    });

    ipcMain.handle('open_folder_dialog', async () => {
        const win = getWindow();
        const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
        if (result.canceled || !result.filePaths.length) return null;
        return result.filePaths[0];
    });

    // Check existence on the fly: the filesystem is the source of truth, since a
    // saved status:'completed' may be stale (file deleted from Explorer). When
    // exists===false the renderer does not restore the "downloaded" checkmark
    // (see restoreForChat).
    ipcMain.handle('get_downloads', () => state.downloads.map(d => ({
        ...d,
        exists: d.path ? fs.existsSync(d.path) : false,
    })));

    // Bind a download to a message (to restore status after restart)
    ipcMain.handle('bind_download', (e, { id, mid, peerId }) => {
        const item = state.downloads.find(d => d.id === id);
        if (item) {
            if (mid != null) item.mid = String(mid);
            if (peerId != null) item.peerId = String(peerId);
            saveDownloads(state.downloads);
        }
    });

    // File gone: drop the binding for this mid so "downloaded" is not restored
    // after restart.
    ipcMain.handle('forget_download', (e, { mid }) => {
        if (mid == null) return;
        let changed = false;
        for (const d of state.downloads) {
            if (String(d.mid) === String(mid)) { delete d.mid; delete d.peerId; changed = true; }
        }
        if (changed) saveDownloads(state.downloads);
    });

    ipcMain.handle('delete_download', (e, { id }) => {
        state.downloads = deleteDownload(state.downloads, id);
    });

    ipcMain.handle('open_download_folder', (e, { id }) => {
        const item = state.downloads.find(d => d.id === id);
        if (item && item.path && fs.existsSync(item.path)) shell.showItemInFolder(item.path);
        else return { error: 'missing' };
    });

    ipcMain.handle('open_download_file', (e, { id }) => {
        const item = state.downloads.find(d => d.id === id);
        if (item && item.path && fs.existsSync(item.path)) shell.openPath(item.path);
        else return { error: 'missing' };
    });

    ipcMain.handle('clear_cache', async () => {
        const win = getWindow();
        if (win) {
            // НЕ трогаем 'serviceworkers': их снос ломает TG после перезагрузки
            // («Service Worker is disabled», отваливается стриминг медиа и часть
            // функционала, аватарки-blob перестают грузиться). Чистим только кэши.
            await win.webContents.session.clearStorageData({
                storages: ['appcache', 'filesystem', 'shadercache', 'cachestorage'],
            });
            await win.webContents.session.clearCache();
            win.loadURL(TG_URL);
        }
    });

    // ── Updates ───────────────────────────────────────────────────────────────
    ipcMain.handle('fetch_changelog', async () => {
        try {
            const text = await fetchChangelog();
            return { text };
        } catch (e) {
            return { error: e.message };
        }
    });

    // Structured per-version changelog (for the block "Changelog" screen)
    ipcMain.handle('fetch_changelog_structured', async () => {
        try {
            const versions = await fetchReleases();
            if (versions && versions.length) return { current: app.getVersion(), versions };
            return { error: 'empty' };
        } catch (e) {
            return { error: e.message };
        }
    });

    ipcMain.handle('check_update_manual', async () => {
        try {
            const result = await checkForUpdate({ silent: false });
            return result;
        } catch (e) {
            return { error: e.message };
        }
    });

    ipcMain.handle('skip_version', (e, { version }) => {
        const s = loadSettings();
        saveSettings(Object.assign({}, s, { skipped_version: version }));
    });

    ipcMain.handle('download_update', async (e, { url, filename }) => {
        const win = getWindow();
        try {
            const destPath = await downloadUpdate(url, filename, (received, total) => {
                if (win && !win.isDestroyed()) {
                    win.webContents.send('update-download-progress', { received, total });
                }
            });

            if (win && !win.isDestroyed()) {
                win.webContents.send('update-download-done', { path: destPath });
            }

            shell.openExternal('file:///' + destPath.replace(/\\/g, '/'))
                .catch(() => {
                    shell.openPath(destPath);
                });

        } catch (e) {
            if (win && !win.isDestroyed()) {
                win.webContents.send('update-download-done', { error: e.message });
            }
            console.error('Download update error:', e);
        }
    });
    // ──────────────────────────────────────────────────────────────────────────

    ipcMain.handle('get_addons', () => getAddons());

    ipcMain.handle('delete_addon', (e, { name }) => deleteAddon(name));

    ipcMain.handle('toggle_addon', (e, { key, enabled }) => {
        toggleAddon(key, enabled);
    });

    ipcMain.handle('apply_addons', () => {
        const win = getWindow();
        if (win) win.webContents.reload();
    });

    ipcMain.handle('show_image_context_menu', (e, { srcURL, x, y }) => {
        const win = getWindow();
        if (!win) return;
        const menu = new Menu();
        menu.append(new MenuItem({
            label: 'Сохранить изображение',
            click: () => win.webContents.downloadURL(srcURL),
        }));
        menu.append(new MenuItem({
            label: 'Копировать изображение',
            click: () => win.webContents.copyImageAt(x, y),
        }));
        menu.popup({ window: win });
    });

    // Сохранение blob-файла из медиа-просмотрщика. TG отдаёт «Загрузку» как
    // <a download href="blob:...">, но webContents.downloadURL(blob:) в Electron не
    // работает (blob живёт в рендерере, недоступен из main) — клик «пытался открыть
    // blob» вместо скачивания. Поэтому рендерер сам fetch'ит blob → dataURL и шлёт
    // байты сюда, а main пишет файл в папку сохранений и регистрирует в менеджере.
    ipcMain.handle('save_blob', (e, { dataUrl, filename }) => {
        try {
            const m = /^data:([^;,]*)?(;base64)?,([\s\S]*)$/.exec(dataUrl || '');
            if (!m) return { error: 'bad-data' };
            const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
            const settings = state.settings || loadSettings();
            const dir = settings.save_path || app.getPath('downloads');
            const safeName = String(filename || 'file').replace(/[\/:*?"<>|]/g, '_').trim() || 'file';
            const dest = uniquePath(path.join(dir, safeName));
            fs.writeFileSync(dest, buf);

            state.downloadCounter += 1;
            const id = state.downloadCounter;
            const savedName = path.basename(dest);
            state.downloads.push({ id, url: '', filename: savedName, path: dest, status: 'completed' });
            saveDownloads(state.downloads);

            const win = getWindow();
            if (win && !win.isDestroyed()) {
                // Тот же контракт, что и will-download: start → done, чтобы карточка
                // появилась в менеджере загрузок.
                win.webContents.send('download-event', { type: 'start', id, filename: savedName, origName: safeName });
                win.webContents.send('download-event', { type: 'done', id, status: 'completed' });
            }
            return { ok: true, id, path: dest };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('open_addons_folder', () => openAddonsFolder());

    // Renderer reports Telegram's UI language → localize tray menu.
    ipcMain.handle('report_lang', (e, { lang }) => {
        _uiLang = (String(lang || '').toLowerCase().indexOf('ru') === 0) ? 'ru' : 'en';
        setTrayLang(lang);
    });

    // Tray icon PNG drawn on a canvas in the renderer (SVG→nativeImage fails here).
    ipcMain.handle('set_tray_image', (e, { dataURL }) => {
        setTrayImageFromDataURL(dataURL);
    });

    // Base tray logo (PNG data URL) so the renderer can composite logo + badge.
    ipcMain.handle('get_tray_base', () => getTrayBaseDataURL());

    ipcMain.handle('get_hint_img_url', () => {
        const imgPath = path.join(__dirname, 'assets', 'webnotif-hint.png');
        return pathToFileURL(imgPath).href;
    });

    ipcMain.handle('set_notifications_count', (e, { count }) => {
        const n = parseInt(count) || 0;
        state.lastNotificationCount = n;
        // Нативный бейдж Electron на иконке таскбара (сам рисуется, без «attention»-
        // подсветки кнопки). При холодном старте/восстановлении из трея кнопки ещё нет —
        // переприменяем в window.cjs на событие show/restore.
        try { app.setBadgeCount(n); } catch (e) {}
        updateTrayBadge(n);
    });

    ipcMain.handle('set_window_title', (e, { title }) => {
        const win = getWindow();
        if (win) win.setTitle(title);
    });
}

module.exports = { initState, getState, registerIpc };
