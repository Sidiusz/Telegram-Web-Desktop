'use strict';
const { ipcMain, shell, dialog, app, Menu, MenuItem } = require('electron');
const { init: initNotifications, queueNotification } = require('./notification.cjs');
const { loadSettings, saveSettings } = require('./settings.cjs');
const { configureProxySettings, setProxyMode, resetAutoProxy, forceProxyReconnect, updateProxyOptions, getProxyStatus, getProxyBootstrap, refreshFlowsealDomains, testProxyConnectivity } = require('./tg-flowseal-route.cjs');
const { getFallbackInfo } = require('./telegram-web-fallback.cjs');
const { loadDownloads, saveDownloads, deleteDownload, cancelActive } = require('./downloads.cjs');
const { getAddons, deleteAddon, openAddonsFolder, toggleAddon } = require('./addons.cjs');
const { uniquePath, sanitizeFilename } = require('./utils.cjs');
const path = require('path');
const fs = require('fs');
const { updateTrayBadge, setTrayLang, setTrayImageFromDataURL, getTrayBaseDataURL } = require('./tray.cjs');
const { checkForUpdate, downloadPendingUpdate, scheduleChecks, init: initUpdater, fetchChangelog, fetchReleases } = require('./updater.cjs');

const TG_URL = 'https://web.telegram.org/a/';


const SAFE_OPEN_EXTS = new Set([
    '.jpg','.jpeg','.png','.gif','.webp','.bmp','.avif','.heic','.tif','.tiff',
    '.mp4','.mkv','.webm','.mov','.avi','.m4v','.mp3','.ogg','.opus','.wav','.flac','.m4a','.aac',
    '.pdf','.txt','.md','.csv','.json','.docx','.xlsx','.pptx','.odt','.ods','.odp',
    '.zip','.rar','.7z','.tar','.gz','.tgz'
]);
function isSafeToOpenPath(filePath) {
    return SAFE_OPEN_EXTS.has(path.extname(String(filePath || '')).toLowerCase());
}
function isSafeExternalUrl(raw) {
    try { const u = new URL(String(raw || '')); return u.protocol === 'https:' || u.protocol === 'http:'; }
    catch (_) { return false; }
}
function isSafeImageResourceUrl(raw) {
    const s = String(raw || '');
    if (/^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,/i.test(s)) return s.length <= 32 * 1024 * 1024;
    try {
        const u = new URL(s);
        return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'blob:';
    } catch (_) { return false; }
}
function normalizeDownloadId(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
}

// UI language (set via report_lang) — used for notification strings in main, where the renderer's T() isn't available.
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
    // Message anti-delete/edit history is session-only. Remove files left by pre-1.3.1 builds.
    for (const name of ['message-history.json', 'message-history.json.bak']) {
        try { fs.unlinkSync(path.join(app.getPath('userData'), name)); } catch (_) {}
    }
    state.downloads = loadDownloads();
    if (state.downloads.length > 0) {
        state.downloadCounter = Math.max(...state.downloads.map(d => d.id));
    }
}

function getState() { return state; }

function registerIpc(getWindow) {
    const approvedSavePaths = new Map();
    const isTrustedEvent = (event) => {
        try {
            const win = getWindow();
            if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
            const raw = (event.senderFrame && event.senderFrame.url) || event.sender.getURL() || '';
            const u = new URL(raw);
            return u.protocol === 'https:' && u.hostname === 'web.telegram.org' && (u.pathname === '/a' || u.pathname.startsWith('/a/'));
        } catch (_) { return false; }
    };
    const handle = (channel, listener) => ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedEvent(event)) throw new Error('Forbidden IPC sender');
        return listener(event, ...args);
    });

    initNotifications(getWindow);
    initUpdater(getWindow);
    scheduleChecks();

    handle('get_settings', () => state.settings);
    ipcMain.on('get_history_bootstrap', (event) => {
        try {
            const win = getWindow();
            const s = state.settings || loadSettings();
            event.returnValue = win && !win.isDestroyed() && event.sender === win.webContents ? {
                showDeleted: s.messages_show_deleted === true,
                editHistory: s.messages_edit_history === true,
            } : null;
        } catch (_) { event.returnValue = null; }
    });
    ipcMain.on('get_feed_bootstrap', (event) => {
        try {
            const win = getWindow();
            const s = state.settings || loadSettings();
            event.returnValue = win && !win.isDestroyed() && event.sender === win.webContents ? {
                sources: Array.isArray(s.feed_sources) ? s.feed_sources.map(x => String(x && x.id || '')).filter(Boolean) : [],
            } : null;
        } catch (_) { event.returnValue = null; }
    });
    ipcMain.on('get_proxy_bootstrap', (event) => {
        // Preload asks synchronously at document_start, before senderFrame.url is guaranteed
        // to contain the committed Telegram URL. Bind this one channel to the exact main WebContents.
        try {
            const win = getWindow();
            event.returnValue = win && !win.isDestroyed() && event.sender === win.webContents ? getProxyBootstrap() : null;
        } catch (_) { event.returnValue = null; }
    });

    handle('get_app_info', () => ({
        version: app.getVersion(),
    }));

    handle('get_proxy_status', () => Object.assign(getProxyStatus(), { fallback: getFallbackInfo() }));
    handle('set_proxy_mode', (e, { mode }) => {
        const status = setProxyMode(mode); state.settings = loadSettings(); return status;
    });
    handle('reset_proxy_auto', () => {
        const status = resetAutoProxy(); state.settings = loadSettings(); return status;
    });
    handle('reconnect_proxy', () => forceProxyReconnect('renderer-network-stall'));
    handle('save_proxy_options', (e, options) => {
        const status = updateProxyOptions(options || {}); state.settings = loadSettings(); return status;
    });
    handle('refresh_proxy_domains', async () => {
        const result = await refreshFlowsealDomains(); return Object.assign(result, { status: getProxyStatus() });
    });
    handle('test_proxy_connectivity', () => testProxyConnectivity());

    handle('show_notification', (e, { title, body, icon, sender, peerId }) => {
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

    // UI Lab-only visual previews. These intentionally bypass the user's notification
    // privacy toggles so every popup state can be inspected without mutating settings.
    handle('preview_notification', (e, { mode, icon, peerId, title, body } = {}) => {
        const allowed = new Set(['normal','hidden-text','hidden-sender','hidden-all','no-avatar','long-text']);
        const variant = allowed.has(mode) ? mode : 'normal';
        const hideSender = variant === 'hidden-sender' || variant === 'hidden-all';
        const hideText = variant === 'hidden-text' || variant === 'hidden-all';
        const previewBody = variant === 'long-text'
            ? (body || 'Длинный тестовый текст уведомления для проверки переноса строк, высоты карточки и поведения кнопок в расширенном desktop popup.')
            : (body || 'Тестовое сообщение для проверки desktop popup.');
        queueNotification({
            title: hideSender ? ntr('anon') : (title || 'UI Lab'),
            body: hideText ? ntr('new_msg_hidden') : previewBody,
            icon: (hideSender || variant === 'no-avatar') ? '' : icon,
            anon: hideSender,
            peerId,
            btnOpen: ntr('open'),
            btnRead: ntr('read'),
            playSound: false,
            duration: 12,
        });
        return { ok: true, mode: variant };
    });

    handle('save_settings', (e, { settings }) => {
        const current = state.settings || loadSettings();
        const next = Object.assign({}, settings || {});
        if (Object.prototype.hasOwnProperty.call(next, 'save_path') && next.save_path !== current.save_path) {
            const grant = approvedSavePaths.get(e.sender.id);
            let accepted = false;
            try {
                const requested = path.resolve(String(next.save_path || ''));
                accepted = !!grant && grant.expires >= Date.now() && requested === grant.path && fs.statSync(requested).isDirectory();
            } catch (_) {}
            if (!accepted) next.save_path = current.save_path;
            else approvedSavePaths.delete(e.sender.id);
        }
        saveSettings(next);
        state.settings = loadSettings();
        configureProxySettings(state.settings);
        scheduleChecks();
        if (state.settings.devtools_enabled !== true) {
            const win = getWindow();
            if (win && !win.isDestroyed() && win.webContents.isDevToolsOpened()) {
                win.webContents.closeDevTools();
            }
        }
    });

    // DevTools may only be opened after the persisted setting has been enabled.
    // Closing is always allowed so disabling the setting takes effect immediately.
    handle('toggle_devtools', (e, { open }) => {
        const win = getWindow();
        if (!win) return;
        if (!open) {
            win.webContents.closeDevTools();
            return { open: false };
        }
        const settings = state.settings || loadSettings();
        if (settings.devtools_enabled !== true) return { error: 'disabled', open: false };
        win.webContents.openDevTools();
        return { open: true };
    });

    handle('open_url', (e, { url }) => {
        if (!isSafeExternalUrl(url)) return { error: 'invalid-url' };
        return shell.openExternal(String(url));
    });

    // Windows owns the default-app decision. We only open our per-user entry;
    // never try to write the protected UserChoice association ourselves.
    handle('open_default_apps', () => {
        if (process.platform !== 'win32') return { error: 'unsupported' };
        const appName = encodeURIComponent('Telegram Web Desktop');
        return shell.openExternal('ms-settings:defaultapps?registeredAppUser=' + appName);
    });

    handle('open_folder_dialog', async (e) => {
        const win = getWindow();
        const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
        if (result.canceled || !result.filePaths.length) return null;
        const selected = path.resolve(result.filePaths[0]);
        approvedSavePaths.set(e.sender.id, { path: selected, expires: Date.now() + 60_000 });
        return selected;
    });

    // Check existence on the fly — the filesystem is the source of truth, since a saved
    // 'completed' status can be stale; exists===false tells the renderer to skip the checkmark (see restoreForChat).
    // Renderer only needs presentation/binding metadata. Do not expose absolute
    // local paths or source URLs from the desktop filesystem to the Telegram page.
    handle('get_downloads', () => state.downloads.map(d => ({
        id: d.id,
        filename: d.filename,
        status: d.status,
        mid: d.mid,
        peerId: d.peerId,
        exists: d.path ? fs.existsSync(d.path) : false,
    })));

    // Bind a download to a message (to restore status after restart).
    handle('bind_download', (e, { id, mid, peerId } = {}) => {
        const safeId = Number(id);
        const safeMid = String(mid == null ? '' : mid);
        const safePeer = String(peerId == null ? '' : peerId);
        if (!Number.isInteger(safeId) || safeId <= 0) return { error: 'invalid-id' };
        if (!/^-?\d{1,32}$/.test(safeMid) || !/^-?\d{1,32}$/.test(safePeer)) return { error: 'invalid-binding' };
        const item = state.downloads.find(d => d.id === safeId);
        if (!item) return { error: 'missing' };
        item.mid = safeMid;
        item.peerId = safePeer;
        saveDownloads(state.downloads);
        return { ok: true };
    });

    // File gone: drop the binding for this mid so "downloaded" isn't restored after restart.
    handle('forget_download', (e, { mid } = {}) => {
        const safeMid = String(mid == null ? '' : mid);
        if (!/^-?\d{1,32}$/.test(safeMid)) return { error: 'invalid-mid' };
        let changed = false;
        for (const d of state.downloads) {
            if (String(d.mid) === safeMid) { delete d.mid; delete d.peerId; changed = true; }
        }
        if (changed) saveDownloads(state.downloads);
        return { ok: true };
    });

    handle('delete_download', (e, { id } = {}) => {
        const safeId = normalizeDownloadId(id);
        if (safeId == null) return { error: 'invalid-id' };
        state.downloads = deleteDownload(state.downloads, safeId);
        return { ok: true };
    });

    handle('cancel_download', (e, { id } = {}) => {
        const safeId = normalizeDownloadId(id);
        if (safeId == null) return { error: 'invalid-id' };
        return { ok: cancelActive(safeId) };
    });

    handle('open_download_folder', (e, { id } = {}) => {
        const safeId = normalizeDownloadId(id);
        if (safeId == null) return { error: 'invalid-id' };
        const item = state.downloads.find(d => d.id === safeId);
        if (item && item.path && fs.existsSync(item.path)) shell.showItemInFolder(item.path);
        else return { error: 'missing' };
    });

    handle('open_download_file', async (e, { id } = {}) => {
        const safeId = normalizeDownloadId(id);
        if (safeId == null) return { error: 'invalid-id' };
        const item = state.downloads.find(d => d.id === safeId);
        if (!item || !item.path || !fs.existsSync(item.path)) return { error: 'missing' };
        if (!isSafeToOpenPath(item.path)) {
            shell.showItemInFolder(item.path);
            return { error: 'unsafe-open' };
        }
        const error = await shell.openPath(item.path);
        return error ? { error } : { ok: true };
    });

    handle('clear_cache', async () => {
        const win = getWindow();
        if (win) {
            // Don't touch 'serviceworkers' — removing it breaks TG after reload ("Service
            // Worker is disabled", media streaming and blob avatars stop loading). Clear caches only.
            await win.webContents.session.clearStorageData({
                storages: ['appcache', 'filesystem', 'shadercache', 'cachestorage'],
            });
            await win.webContents.session.clearCache();
            win.loadURL(TG_URL);
        }
    });

    handle('fetch_changelog', async () => {
        try {
            const text = await fetchChangelog();
            return { text };
        } catch (e) {
            return { error: e.message };
        }
    });

    // Structured per-version changelog (for the block "Changelog" screen)
    handle('fetch_changelog_structured', async () => {
        try {
            const versions = await fetchReleases();
            if (versions && versions.length) return { current: app.getVersion(), versions };
            return { error: 'empty' };
        } catch (e) {
            return { error: e.message };
        }
    });

    handle('check_update_manual', async () => {
        try {
            const result = await checkForUpdate({ silent: false });
            return result;
        } catch (e) {
            return { error: e.message };
        }
    });

    handle('skip_version', (e, { version } = {}) => {
        const v = String(version == null ? '' : version).trim();
        if (!/^[0-9A-Za-z.+_-]{1,64}$/.test(v)) return { error: 'invalid-version' };
        const s = loadSettings();
        saveSettings(Object.assign({}, s, { skipped_version: v }));
        return { ok: true };
    });

    handle('download_update', async () => {
        const win = getWindow();
        try {
            // URL, filename and checksum are resolved in main from our GitHub release.
            // Renderer input is deliberately ignored for the update trust boundary.
            const destPath = await downloadPendingUpdate((received, total) => {
                if (win && !win.isDestroyed()) {
                    win.webContents.send('update-download-progress', { received, total });
                }
            });

            if (win && !win.isDestroyed()) {
                win.webContents.send('update-download-done', { ok: true });
            }
            const openError = await shell.openPath(destPath);
            if (openError) throw new Error(openError);
        } catch (e) {
            if (win && !win.isDestroyed()) {
                win.webContents.send('update-download-done', { error: e.message });
            }
            console.error('Download update error:', e);
        }
    });

    handle('get_addons', () => getAddons());

    handle('delete_addon', (e, { name }) => deleteAddon(name));

    handle('toggle_addon', (e, { key, enabled }) => {
        toggleAddon(key, enabled);
    });

    handle('apply_addons', () => {
        const win = getWindow();
        if (win) win.webContents.reload();
    });

    handle('apply_features', () => {
        const win = getWindow();
        if (win) win.webContents.reload();
    });

    handle('show_image_context_menu', (e, { srcURL, x, y, downloadId }) => {
        const win = getWindow();
        if (!win) return;
        const menu = new Menu();
        const ru = _uiLang === 'ru';
        const safeSrcURL = isSafeImageResourceUrl(srcURL) ? String(srcURL) : '';
        if (safeSrcURL) {
            menu.append(new MenuItem({
                label: ru ? 'Сохранить изображение' : 'Save image',
                click: () => win.webContents.downloadURL(safeSrcURL),
            }));
            const bx = win.getContentBounds();
            const safeX = Number.isFinite(Number(x)) ? Math.max(0, Math.min(bx.width - 1, Math.round(Number(x)))) : 0;
            const safeY = Number.isFinite(Number(y)) ? Math.max(0, Math.min(bx.height - 1, Math.round(Number(y)))) : 0;
            menu.append(new MenuItem({
                label: ru ? 'Копировать изображение' : 'Copy image',
                click: () => win.webContents.copyImageAt(safeX, safeY),
            }));
        }
        // "Open folder" for already-downloaded media — same as .File documents.
        const safeDownloadId = normalizeDownloadId(downloadId);
        if (safeDownloadId != null) {
            const item = state.downloads.find(d => d.id === safeDownloadId);
            if (item && item.path && fs.existsSync(item.path)) {
                if (menu.items.length) menu.append(new MenuItem({ type: 'separator' }));
                menu.append(new MenuItem({
                    label: ru ? 'Открыть папку' : 'Open folder',
                    click: () => shell.showItemInFolder(item.path),
                }));
            }
        }
        if (menu.items.length) menu.popup({ window: win });
    });

    // webContents.downloadURL(blob:) doesn't work in Electron (blob lives in the renderer,
    // unreachable from main), so the renderer fetches it to a dataURL and sends the bytes here to be written and registered.
    handle('save_blob', async (e, { dataUrl, filename } = {}) => {
        try {
            const rawData = String(dataUrl || '');
            if (rawData.length > 384 * 1024 * 1024) return { error: 'too-large' };
            const m = /^data:([^;,]*)?(;base64)?,([\s\S]*)$/.exec(rawData);
            if (!m) return { error: 'bad-data' };
            const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
            if (buf.length > 384 * 1024 * 1024) return { error: 'too-large' };
            const settings = state.settings || loadSettings();
            const dir = settings.save_path || app.getPath('downloads');
            const safeName = sanitizeFilename(filename || 'file');
            const dest = uniquePath(path.join(dir, safeName));
            // Large viewer media must not block Electron's main loop while being written.
            await fs.promises.writeFile(dest, buf);

            state.downloadCounter += 1;
            const id = state.downloadCounter;
            const savedName = path.basename(dest);
            state.downloads.push({ id, url: '', filename: savedName, path: dest, status: 'completed' });
            saveDownloads(state.downloads);

            const win = getWindow();
            if (win && !win.isDestroyed()) {
                // Same contract as will-download (start → done) so the card shows up in the download manager.
                win.webContents.send('download-event', { type: 'start', id, filename: savedName, origName: safeName });
                win.webContents.send('download-event', { type: 'done', id, status: 'completed' });
            }
            // Do not disclose the absolute filesystem path back into the Telegram renderer.
            return { ok: true, id };
        } catch (err) {
            return { error: err.message };
        }
    });

    handle('open_addons_folder', () => openAddonsFolder());

    // Renderer reports Telegram's UI language → localize tray menu.
    handle('report_lang', (e, { lang }) => {
        _uiLang = (String(lang || '').toLowerCase().indexOf('ru') === 0) ? 'ru' : 'en';
        setTrayLang(lang);
    });

    // Tray icon PNG drawn on a canvas in the renderer (SVG→nativeImage fails here).
    handle('set_tray_image', (e, { dataURL } = {}) => {
        const raw = String(dataURL || '');
        if (!raw) { setTrayImageFromDataURL(''); return { ok: true }; }
        if (raw.length > 1024 * 1024 || !/^data:image\/png;base64,/i.test(raw)) return { error: 'invalid-image' };
        setTrayImageFromDataURL(raw);
        return { ok: true };
    });

    // Base tray logo (PNG data URL) so the renderer can composite logo + badge.
    handle('get_tray_base', () => getTrayBaseDataURL());

    handle('set_notifications_count', (e, { count } = {}) => {
        const parsed = Number.parseInt(count, 10);
        const n = Number.isFinite(parsed) ? Math.max(0, Math.min(9999, parsed)) : 0;
        state.lastNotificationCount = n;
        // Electron's native taskbar badge (self-drawn, no "attention" flash). On cold start/
        // restore-from-tray the button doesn't exist yet — window.cjs reapplies it on show/restore.
        try { app.setBadgeCount(n); } catch (e) {}
        updateTrayBadge(n);
    });

}

module.exports = { initState, getState, registerIpc };
