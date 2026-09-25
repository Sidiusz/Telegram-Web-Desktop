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

    handle('get_settings', () => {
        state.settings = loadSettings();
        return state.settings;
    });
    ipcMain.on('get_history_bootstrap', (event) => {
        try {
            const win = getWindow();
            const s = state.settings || loadSettings();
            event.returnValue = win && !win.isDestroyed() && event.sender === win.webContents ? {
                showDeleted: s.messages_show_deleted === true,
                showDisappearing: s.messages_show_disappearing === true,
                saveDeleted: s.messages_save_deleted === true,
                saveDisappearing: s.messages_save_disappearing === true,
                editHistory: s.messages_edit_history === true,
                savePublic: s.messages_save_public === true,
                scope: s.messages_history_scope || 'client',
            } : null;
        } catch (_) { event.returnValue = null; }
    });
    ipcMain.on('get_privacy_bootstrap', (event) => {
        try {
            const win = getWindow();
            const s = state.settings || loadSettings();
            event.returnValue = win && !win.isDestroyed() && event.sender === win.webContents ? {
                noReadReceipts: s.privacy_no_read_receipts === true,
                noTyping: s.privacy_no_typing === true,
                noReadForceOn: s.privacy_no_read_force_on || [],
                noReadForceOff: s.privacy_no_read_force_off || [],
                noTypingForceOn: s.privacy_no_typing_force_on || [],
                noTypingForceOff: s.privacy_no_typing_force_off || [],
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
    handle('get_window_state', () => {
        const win = getWindow();
        return win && !win.isDestroyed() ? {
            visible: win.isVisible(),
            minimized: win.isMinimized(),
        } : { visible: false, minimized: true };
    });

    handle('get_proxy_status', () => Object.assign(getProxyStatus(), { fallback: getFallbackInfo() }));
    handle('set_proxy_mode', (e, { mode }) => {
        const status = setProxyMode(mode); state.settings = loadSettings(); return status;
    });
    handle('reset_proxy_auto', () => {
        const status = resetAutoProxy(); state.settings = loadSettings(); return status;
    });
    handle('reconnect_proxy', () => {
        const status = forceProxyReconnect('renderer-network-stall');
        state.settings = loadSettings();
        return status;
    });
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
        const hideAvatar = hideSender || settings.notif_hide_avatar === true;
        queueNotification({
            title: hideSender ? ntr('anon') : (sender || title || 'Telegram'),
            body: hideText ? ntr('new_msg_hidden') : body,
            icon: hideAvatar ? '' : icon,
            anon: hideSender,
            peerId,
            btnOpen: ntr('open'),
            btnRead: ntr('read'),
            playSound: settings.notif_sound !== false,
            duration: settings.notif_duration || 6,
        });
    });

    // UI Lab visual variants bypass user privacy so every state can be inspected.
    // The settings preview uses the real duration/privacy/avatar settings, but still
    // bypasses popup/category enablement because clicking «Check» is an explicit test.
    handle('preview_notification', (e, { mode, icon, peerId, title, body, previewSettings } = {}) => {
        const allowed = new Set(['normal','hidden-text','hidden-sender','hidden-all','no-avatar','long-text','settings']);
        const variant = allowed.has(mode) ? mode : 'normal';
        const settings = state.settings || loadSettings();
        const settingsPreview = variant === 'settings';
        const explicit = previewSettings && typeof previewSettings === 'object' ? previewSettings : null;
        const hideSender = settingsPreview
            ? (explicit ? explicit.hideSender === true : settings.notif_hide_sender === true)
            : (variant === 'hidden-sender' || variant === 'hidden-all');
        const hideText = settingsPreview
            ? (explicit ? explicit.hideText === true : settings.notif_hide_text === true)
            : (variant === 'hidden-text' || variant === 'hidden-all');
        const hideAvatar = settingsPreview
            ? (hideSender || (explicit ? explicit.hideAvatar === true : settings.notif_hide_avatar === true))
            : (hideSender || variant === 'no-avatar');
        const previewBody = variant === 'long-text'
            ? (body || 'Длинный тестовый текст уведомления для проверки переноса строк, высоты карточки и поведения кнопок в расширенном desktop popup.')
            : (body || 'Тестовое сообщение для проверки desktop popup.');
        queueNotification({
            title: hideSender ? ntr('anon') : (title || (settingsPreview ? 'Telegram' : 'UI Lab')),
            body: hideText ? ntr('new_msg_hidden') : previewBody,
            icon: hideAvatar ? '' : icon,
            anon: hideSender,
            peerId,
            btnOpen: ntr('open'),
            btnRead: ntr('read'),
            playSound: false,
            duration: settingsPreview
                ? (explicit && Number.isFinite(Number(explicit.duration)) ? Number(explicit.duration) : (settings.notif_duration || 6))
                : 12,
        });
        return { ok: true, mode: variant };
    });

    handle('save_settings', (e, { settings }) => {
        const current = loadSettings();
        state.settings = current;
        const previousPrivacy = {
            noReadReceipts: current.privacy_no_read_receipts === true,
            noTyping: current.privacy_no_typing === true,
            noReadForceOn: current.privacy_no_read_force_on || [],
            noReadForceOff: current.privacy_no_read_force_off || [],
            noTypingForceOn: current.privacy_no_typing_force_on || [],
            noTypingForceOff: current.privacy_no_typing_force_off || [],
        };
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
        const proxyConfigKeys = [
            'proxy_mode','proxy_auto_latched','proxy_domain_source','proxy_custom_domains','proxy_pinned_domain',
            'proxy_worker_enabled','proxy_worker_domains','proxy_auto_failures','proxy_auto_window_sec',
            'proxy_web_fallback','proxy_web_fallback_latched','proxy_dc_ips',
        ];
        const proxyConfigChanged = proxyConfigKeys.some(k => JSON.stringify(current[k]) !== JSON.stringify(state.settings[k]));
        const privacy = {
            noReadReceipts: state.settings.privacy_no_read_receipts === true,
            noTyping: state.settings.privacy_no_typing === true,
            noReadForceOn: state.settings.privacy_no_read_force_on || [],
            noReadForceOff: state.settings.privacy_no_read_force_off || [],
            noTypingForceOn: state.settings.privacy_no_typing_force_on || [],
            noTypingForceOff: state.settings.privacy_no_typing_force_off || [],
        };
        if (JSON.stringify(privacy) !== JSON.stringify(previousPrivacy)) {
            const win = getWindow();
            if (win && !win.isDestroyed()) win.webContents.send('privacy-state-changed', privacy);
        }
        {
            const win = getWindow();
            if (win && !win.isDestroyed()) win.webContents.send('settings-changed', state.settings);
        }
        if (proxyConfigChanged) configureProxySettings(state.settings);
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
    handle('get_downloads', () => state.downloads.map(d => {
        const exists = d.path ? fs.existsSync(d.path) : false;
        let recv = Number.isSafeInteger(d.recv) && d.recv >= 0 ? d.recv : 0;
        let total = Number.isSafeInteger(d.total) && d.total >= 0 ? d.total : 0;
        // Backfill old completed records created before byte counts were persisted.
        if (exists && d.status === 'completed' && !total) {
            try { total = Math.max(0, Number(fs.statSync(d.path).size) || 0); } catch (_) {}
        }
        if (d.status === 'completed' && total && !recv) recv = total;
        return {
            id: d.id,
            filename: d.filename,
            status: d.status,
            recv,
            total,
            mid: d.mid,
            peerId: d.peerId,
            exists,
        };
    }));

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

    handle('delete_download', async (e, { id } = {}) => {
        const safeId = normalizeDownloadId(id);
        if (safeId == null) return { error: 'invalid-id' };
        cancelActive(safeId);
        await cancelBlobSaveByDownloadId(safeId);
        state.downloads = deleteDownload(state.downloads, safeId);
        return { ok: true };
    });

    handle('cancel_download', async (e, { id } = {}) => {
        const safeId = normalizeDownloadId(id);
        if (safeId == null) return { error: 'invalid-id' };
        if (cancelActive(safeId)) return { ok: true };
        return { ok: await cancelBlobSaveByDownloadId(safeId) };
    });

    handle('open_downloads_folder', async () => {
        const settings = state.settings || loadSettings();
        const dir = path.resolve(settings.save_path || app.getPath('downloads'));
        try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
        const error = await shell.openPath(dir);
        return error ? { error } : { ok: true };
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

    handle('prepare_extended_pins', async () => {
        const win = getWindow();
        if (!win || win.isDestroyed()) return { error: 'no-window' };
        // The renderer removes only Telegram's calls/main JS entries from
        // CacheStorage before invoking this. Do not clear CacheStorage here:
        // tt-media / tt-media-avatars live there as well.
        setTimeout(() => {
            if (win && !win.isDestroyed()) win.webContents.reloadIgnoringCache();
        }, 0);
        return { ok: true };
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

    // blob: URLs belong to the renderer and cannot be opened by main directly.
    // Preload reads the blob as a ReadableStream and awaits one IPC write per chunk.
    // This keeps memory bounded to a small chunk and provides real disk backpressure
    // without ever creating a whole-file base64/data URL.
    const blobSaves = new Map();
    const blobSaveByDownloadId = new Map();
    let blobSaveSeq = 0;

    function emitBlobDownload(payload) {
        const win = getWindow();
        if (win && !win.isDestroyed()) {
            try { win.webContents.send('download-event', payload); } catch (_) {}
        }
    }
    function getBlobSave(event, streamId) {
        const item = blobSaves.get(String(streamId || ''));
        return item && item.senderId === event.sender.id ? item : null;
    }
    function bufferFromBlobChunk(raw) {
        if (raw instanceof ArrayBuffer) return Buffer.from(raw);
        if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
        return null;
    }
    function detachBlobSender(item) {
        if (!item || !item.sender || !item.senderDestroyedHandler) return;
        try { item.sender.removeListener('destroyed', item.senderDestroyedHandler); } catch (_) {}
        item.sender = null;
        item.senderDestroyedHandler = null;
    }
    async function failBlobSave(item, status = 'failed') {
        if (!item || item.finished) return false;
        item.finished = true;
        detachBlobSender(item);
        blobSaves.delete(item.streamId);
        blobSaveByDownloadId.delete(item.id);
        try { await item.file.close(); } catch (_) {}
        try { await fs.promises.unlink(item.temp); } catch (_) {}
        const rec = state.downloads.find(d => d.id === item.id);
        if (rec) {
            rec.status = status;
            rec.recv = item.received;
            rec.total = item.expectedTotal;
            saveDownloads(state.downloads);
        }
        emitBlobDownload({
            type: 'done',
            id: item.id,
            status,
            filename: item.savedName,
            origName: item.safeName,
            received: item.received,
            total: item.expectedTotal,
        });
        return true;
    }
    async function cancelBlobSaveByDownloadId(id) {
        const streamId = blobSaveByDownloadId.get(id);
        if (!streamId) return false;
        return failBlobSave(blobSaves.get(streamId), 'cancelled');
    }

    handle('begin_blob_save', async (event, { filename, total } = {}) => {
        const safeName = sanitizeFilename(filename || 'file');
        const declaredTotal = Number(total);
        const expectedTotal = Number.isSafeInteger(declaredTotal) && declaredTotal >= 0 ? declaredTotal : 0;
        const settings = state.settings || loadSettings();
        const dir = settings.save_path || app.getPath('downloads');
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (e) {
            return { error: e && e.message ? e.message : 'mkdir-failed' };
        }

        const dest = uniquePath(path.join(dir, safeName));
        const temp = dest + '.' + process.pid + '.' + Date.now() + '.twd-part';
        let file;
        try {
            file = await fs.promises.open(temp, 'wx');
        } catch (e) {
            return { error: e && e.message ? e.message : 'open-failed' };
        }

        const streamId = event.sender.id + '-' + Date.now().toString(36) + '-' + (++blobSaveSeq).toString(36);
        state.downloadCounter += 1;
        const id = state.downloadCounter;
        const savedName = path.basename(dest);
        const item = {
            streamId,
            senderId: event.sender.id,
            id,
            file,
            temp,
            dest,
            safeName,
            savedName,
            expectedTotal,
            received: 0,
            busy: false,
            finished: false,
            sender: event.sender,
            senderDestroyedHandler: null,
        };
        blobSaves.set(streamId, item);
        blobSaveByDownloadId.set(id, streamId);
        state.downloads.push({
            id, url: '', filename: savedName, path: dest, status: 'downloading',
            recv: 0, total: expectedTotal,
        });
        saveDownloads(state.downloads);
        emitBlobDownload({ type: 'start', id, filename: savedName, origName: safeName, total: expectedTotal });

        item.senderDestroyedHandler = () => {
            const live = blobSaves.get(streamId);
            if (live) failBlobSave(live, 'failed');
        };
        event.sender.once('destroyed', item.senderDestroyedHandler);
        return { ok: true, streamId, id };
    });

    handle('append_blob_chunk', async (event, { streamId, chunk } = {}) => {
        const item = getBlobSave(event, streamId);
        if (!item || item.finished) return { error: 'missing-stream' };
        if (item.busy) return { error: 'stream-busy' };
        const buf = bufferFromBlobChunk(chunk);
        if (!buf) return { error: 'invalid-chunk' };
        if (buf.length > 1024 * 1024) return { error: 'chunk-too-large' };

        item.busy = true;
        try {
            let offset = 0;
            while (offset < buf.length) {
                const result = await item.file.write(buf, offset, buf.length - offset, null);
                if (!result || result.bytesWritten <= 0) throw new Error('short-write');
                offset += result.bytesWritten;
            }
            item.received += buf.length;
            const rec = state.downloads.find(d => d.id === item.id);
            if (rec) {
                rec.recv = item.received;
                rec.total = item.expectedTotal;
            }
            emitBlobDownload({
                type: 'progress',
                id: item.id,
                received: item.received,
                total: item.expectedTotal,
            });
            return { ok: true, received: item.received };
        } catch (e) {
            await failBlobSave(item, 'failed');
            return { error: e && e.message ? e.message : 'write-failed' };
        } finally {
            item.busy = false;
        }
    });

    handle('finish_blob_save', async (event, { streamId } = {}) => {
        const item = getBlobSave(event, streamId);
        if (!item || item.finished) return { error: 'missing-stream' };
        if (item.busy) return { error: 'stream-busy' };
        if (item.expectedTotal && item.received !== item.expectedTotal) {
            await failBlobSave(item, 'failed');
            return { error: 'size-mismatch' };
        }

        try {
            await item.file.close();
            await fs.promises.rename(item.temp, item.dest);
        } catch (e) {
            await failBlobSave(item, 'failed');
            return { error: e && e.message ? e.message : 'finish-failed' };
        }

        item.finished = true;
        detachBlobSender(item);
        blobSaves.delete(item.streamId);
        blobSaveByDownloadId.delete(item.id);
        const rec = state.downloads.find(d => d.id === item.id);
        if (rec) {
            rec.status = 'completed';
            rec.path = item.dest;
            rec.recv = item.received;
            rec.total = item.expectedTotal;
            saveDownloads(state.downloads);
        }
        emitBlobDownload({
            type: 'done',
            id: item.id,
            status: 'completed',
            filename: item.savedName,
            origName: item.safeName,
            received: item.received,
            total: item.expectedTotal,
        });
        return { ok: true, id: item.id };
    });

    handle('abort_blob_save', async (event, { streamId } = {}) => {
        const item = getBlobSave(event, streamId);
        if (!item) return { ok: true };
        await failBlobSave(item, 'cancelled');
        return { ok: true };
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
