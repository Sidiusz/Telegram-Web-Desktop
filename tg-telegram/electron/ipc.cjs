'use strict';
const { ipcMain, shell, dialog, app, Menu, MenuItem } = require('electron');
const { pathToFileURL } = require('url');
const { init: initNotifications, queueNotification } = require('./notification.cjs');
const { loadSettings, saveSettings, getSkipDomains, addSkipDomain } = require('./settings.cjs');
const { loadDownloads, saveDownloads, deleteDownload } = require('./downloads.cjs');
const { getAddons, deleteAddon, openAddonsFolder, toggleAddon } = require('./addons.cjs');
const path = require('path');
const { updateTrayBadge } = require('./tray.cjs');
const { checkForUpdate, downloadUpdate, scheduleChecks, init: initUpdater, fetchChangelog } = require('./updater.cjs');

const TG_URL = 'https://web.telegram.org/a/';

let state = {
    downloads: [],
    downloadCounter: 0,
    lastActivity: Date.now(),
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

    ipcMain.handle('show_notification', (e, { title, body, icon, sender, chatName }) => {
        const settings = state.settings || loadSettings();
        if (!settings.popup_notifications) return;

        const payload = {
            title,
            body,
            icon,
            sender,
            chatName,
            playSound: true,
        };

        queueNotification(payload);

        const win = getWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('show-notification', payload);
        }
    });

    ipcMain.handle('save_settings', (e, { settings }) => {
        saveSettings(settings);
        state.settings = loadSettings();
    });

    // Мгновенно открывает/закрывает DevTools без перезагрузки
    ipcMain.handle('toggle_devtools', (e, { open }) => {
        const win = getWindow();
        if (!win) return;
        if (open) win.webContents.openDevTools();
        else win.webContents.closeDevTools();
    });

    ipcMain.handle('get_skip_domains', () => getSkipDomains());

    ipcMain.handle('add_skip_domain', (e, { domain }) => addSkipDomain(domain));

    ipcMain.handle('open_url', (e, { url }) => {
        shell.openExternal(url);
    });

    ipcMain.handle('open_folder_dialog', async () => {
        const win = getWindow();
        const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
        if (result.canceled || !result.filePaths.length) return null;
        return result.filePaths[0];
    });

    ipcMain.handle('get_downloads', () => state.downloads);

    ipcMain.handle('delete_download', (e, { id }) => {
        state.downloads = deleteDownload(state.downloads, id);
    });

    ipcMain.handle('open_download_folder', (e, { id }) => {
        const item = state.downloads.find(d => d.id === id);
        if (item && item.path) shell.showItemInFolder(item.path);
    });

    ipcMain.handle('open_download_file', (e, { id }) => {
        const item = state.downloads.find(d => d.id === id);
        if (item && item.path) shell.openPath(item.path);
    });

    ipcMain.handle('clear_cache', async () => {
        const win = getWindow();
        if (win) {
            await win.webContents.session.clearStorageData({
                storages: ['appcache', 'filesystem', 'shadercache', 'serviceworkers', 'cachestorage'],
            });
            win.loadURL(TG_URL);
        }
    });

    // ── Обновления ────────────────────────────────────────────────────────────
    ipcMain.handle('fetch_changelog', async () => {
        try {
            const text = await fetchChangelog();
            return { text };
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

    ipcMain.handle('open_addons_folder', () => openAddonsFolder());

    ipcMain.handle('report_user_active', () => {
        state.lastActivity = Date.now();
    });

    ipcMain.handle('get_hint_img_url', () => {
        const imgPath = path.join(__dirname, 'assets', 'webnotif-hint.png');
        return pathToFileURL(imgPath).href;
    });

    ipcMain.handle('set_notifications_count', (e, { count }) => {
        const n = parseInt(count) || 0;
        const prev = typeof state.lastNotificationCount === 'number' ? state.lastNotificationCount : null;
        const win = getWindow();

        if (win) {
            if (n > 0) {
                const label = n > 99 ? '99+' : String(n);
                const isWide = label.length >= 3;
                const W = isWide ? 44 : 32;
                const H = 32;
                const rx = H / 2;
                const fontSize = isWide ? 18 : 20;
                const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect x="0" y="0" width="${W}" height="${H}" rx="${rx}" ry="${rx}" fill="#F23C34"/>
  <text x="${W/2}" y="${H/2}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial Black,Arial,sans-serif" font-size="${fontSize}" font-weight="900" fill="#fff">${label}</text>
</svg>`;
                try {
                    const img = require('electron').nativeImage.createFromDataURL(
                        'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
                    );
                    win.setOverlayIcon(img, label + ' непрочитанных');
                } catch (e) {}
            } else {
                try { win.setOverlayIcon(null, ''); } catch (e) {}
            }
        }

        const settings = state.settings || loadSettings();
        const shouldPopup = !!settings.popup_notifications;

        if (prev !== null && n > prev && shouldPopup) {
            queueNotification({
                title: 'Новое уведомление в Телеграм!',
                body: 'вам новое сообщение в Телеграм!',
                playSound: true,
            });
        }

        state.lastNotificationCount = n;
        updateTrayBadge(n);
    });

    ipcMain.handle('set_window_title', (e, { title }) => {
        const win = getWindow();
        if (win) win.setTitle(title);
    });
}

module.exports = { initState, getState, registerIpc };
