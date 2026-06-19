'use strict';
const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;
let baseIcon = nativeImage.createEmpty();
let _getWindow = null;
let _lang = 'ru';
let _lastCount = 0;

const TR = {
    ru: { show:'Показать', settings:'Настройки', read:'Прочитать всё', quit:'Выйти' },
    en: { show:'Show',     settings:'Settings',  read:'Mark all as read', quit:'Quit' },
};
const tr = k => (TR[_lang] || TR.en)[k];

// Renderer reports Telegram's UI language (report_lang IPC) — relocalize the menu.
function setTrayLang(lang) {
    _lang = (lang === 'ru') ? 'ru' : 'en';
    if (tray) tray.setContextMenu(buildMenu(_lastCount));
}

function createTray(getWindow) {
    _getWindow = getWindow;
    const iconPaths = [
        path.join(__dirname, 'icons', 'icon.png'),
        path.join(__dirname, '..', 'icons', 'icon.png'),
        path.join(__dirname, 'icon.png'),
    ];
    for (const p of iconPaths) {
        try {
            const img = nativeImage.createFromPath(p);
            if (!img.isEmpty()) { baseIcon = img; break; }
        } catch (e) {}
    }
    if (!baseIcon.isEmpty()) baseIcon = baseIcon.resize({ width: 32, height: 32, quality: 'best' });

    tray = new Tray(baseIcon);
    tray.setToolTip('Telegram Web Desktop');
    tray.setContextMenu(buildMenu(0));
    tray.on('click', () => { const w = _getWindow && _getWindow(); if (w) { w.show(); w.focus(); } });
    return tray;
}

// 16x16 monochrome icon for menu items (pure-shape SVG → nativeImage).
function menuIcon(inner) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cfcfcf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    try {
        const img = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
        return img.isEmpty() ? undefined : img;
    } catch (e) { return undefined; }
}
const IC = {
    show:     () => menuIcon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
    settings: () => menuIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    read:     () => menuIcon('<path d="M20 6L9 17l-5-5"/>'),
    quit:     () => menuIcon('<path d="M18 6L6 18M6 6l12 12"/>'),
};

function runInPage(js) {
    const w = _getWindow && _getWindow();
    if (!w) return;
    w.webContents.executeJavaScript(js).catch(() => {});
}

function buildMenu(count) {
    const items = [
        { label: tr('show'), icon: IC.show(), click: () => { const w = _getWindow && _getWindow(); if (w) { w.show(); w.focus(); } } },
        { label: tr('settings'), icon: IC.settings(), click: () => { const w = _getWindow && _getWindow(); if (w) { w.show(); w.focus(); runInPage('window.__tgOpenAppSettings&&window.__tgOpenAppSettings()'); } } },
    ];
    if (count > 0) {
        items.push({ label: tr('read'), icon: IC.read(), click: () => runInPage('window.__tgMarkAllRead&&window.__tgMarkAllRead()') });
    }
    items.push({ type: 'separator' });
    items.push({ label: tr('quit'), icon: IC.quit(), click: () => app.quit() });
    return Menu.buildFromTemplate(items);
}

// Electron does not rasterize SVG → nativeImage here, so the badge is drawn on a
// canvas in the renderer and sent as a PNG data URL (createFromDataURL supports PNG).
function setTrayImageFromDataURL(dataURL) {
    if (!tray) return;
    if (dataURL) {
        try { const img = nativeImage.createFromDataURL(dataURL); if (!img.isEmpty()) tray.setImage(img); } catch (e) {}
    } else {
        tray.setImage(baseIcon);
    }
}

function updateTrayBadge(count) {
    _lastCount = count;
    if (!tray) return;
    tray.setToolTip(count > 0 ? ('Telegram Web Desktop (' + count + ')') : 'Telegram Web Desktop');
    tray.setContextMenu(buildMenu(count));
}

function getTrayBaseDataURL() {
    try { return baseIcon.isEmpty() ? null : baseIcon.toDataURL(); } catch (e) { return null; }
}

module.exports = { createTray, updateTrayBadge, setTrayLang, setTrayImageFromDataURL, getTrayBaseDataURL };
