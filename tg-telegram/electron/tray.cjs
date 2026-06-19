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

// Logo + pill badge in the corner. Nested <image> needs BOTH href and xlink:href
// so it renders across rasterizers; if the composite still fails, fall back to a
// pure-shape red circle that always renders.
function makeBadgeIcon(count) {
    if (baseIcon.isEmpty()) return makeCircleCountIcon(count);
    const label = count > 99 ? '99+' : String(count);
    const isWide = label.length >= 3;
    const bW = isWide ? 22 : 16, bH = 16;
    const bX = 32 - bW, bY = 32 - bH;
    const fontSize = isWide ? 9 : 11;
    const b64 = baseIcon.toPNG().toString('base64');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="32" height="32">
  <image href="data:image/png;base64,${b64}" xlink:href="data:image/png;base64,${b64}" width="32" height="32"/>
  <rect x="${bX}" y="${bY}" width="${bW}" height="${bH}" rx="${bH/2}" ry="${bH/2}" fill="#F23C34" stroke="#1c1c1c" stroke-width="1.5"/>
  <text x="${bX + bW/2}" y="${bY + bH/2 + 0.5}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial Black,Arial,sans-serif" font-size="${fontSize}" font-weight="900" fill="#fff">${label}</text>
</svg>`;
    try {
        const img = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
        return img.isEmpty() ? makeCircleCountIcon(count) : img;
    } catch (e) {
        return makeCircleCountIcon(count);
    }
}

// Pure-shape fallback: whole tray icon becomes a red count circle.
function makeCircleCountIcon(count) {
    const label = count > 99 ? '99+' : String(count);
    const fontSize = label.length >= 3 ? 13 : 16;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
  <circle cx="16" cy="16" r="15" fill="#F23C34"/>
  <text x="16" y="16.5" text-anchor="middle" dominant-baseline="central"
        font-family="Arial Black,Arial,sans-serif" font-size="${fontSize}" font-weight="900" fill="#fff">${label}</text>
</svg>`;
    try {
        const img = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
        return img.isEmpty() ? baseIcon : img;
    } catch (e) { return baseIcon; }
}

function updateTrayBadge(count) {
    _lastCount = count;
    if (!tray) return;
    if (count > 0) {
        tray.setImage(makeBadgeIcon(count));
        tray.setToolTip('Telegram Web Desktop (' + count + ')');
    } else {
        tray.setImage(baseIcon);
        tray.setToolTip('Telegram Web Desktop');
    }
    tray.setContextMenu(buildMenu(count));
}

module.exports = { createTray, updateTrayBadge, setTrayLang };
