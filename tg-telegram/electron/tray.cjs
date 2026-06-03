'use strict';
const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;
let baseIcon = nativeImage.createEmpty(); // исходная иконка без значка

function createTray(getWindow) {
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

    if (!baseIcon.isEmpty()) {
        baseIcon = baseIcon.resize({ width: 32, height: 32, quality: 'best' });
    }

    tray = new Tray(baseIcon);
    tray.setToolTip('Telegram Web Desktop');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Показать',
            click: () => {
                const win = getWindow();
                if (win) { win.show(); win.focus(); }
            }
        },
        { type: 'separator' },
        {
            label: 'Выйти',
            click: () => app.quit()
        }
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        const win = getWindow();
        if (win) {
            if (win.isVisible()) { win.focus(); }
            else { win.show(); win.focus(); }
        }
    });

    return tray;
}

// Генерируем SVG-значок: исходная иконка + красный кружок с числом
function makeBadgeIcon(count) {
    if (baseIcon.isEmpty()) return baseIcon;

    const label = count > 99 ? '99+' : String(count);
    const isWide = label.length >= 3;
    const bW = isWide ? 20 : 14;  // ширина бейджа
    const bH = 14;
    const bX = 32 - bW;           // правый верхний угол
    const bY = 0;
    const rx = bH / 2;
    const fontSize = isWide ? 8 : 9;

    // Берём PNG base64 исходной иконки
    const base64 = baseIcon.toPNG().toString('base64');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="32" height="32">
  <image href="data:image/png;base64,${base64}" width="32" height="32"/>
  <rect x="${bX}" y="${bY}" width="${bW}" height="${bH}" rx="${rx}" ry="${rx}" fill="#F23C34"/>
  <text x="${bX + bW/2}" y="${bY + bH/2}" text-anchor="middle" dominant-baseline="central"
        font-family="Arial Black,Arial,sans-serif" font-size="${fontSize}" font-weight="900" fill="#fff">${label}</text>
</svg>`;

    try {
        return nativeImage.createFromDataURL(
            'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
        );
    } catch (e) {
        return baseIcon;
    }
}

function updateTrayBadge(count) {
    if (!tray) return;
    if (count > 0) {
        tray.setImage(makeBadgeIcon(count));
        tray.setToolTip('Telegram Web Desktop (' + count + ')');
    } else {
        tray.setImage(baseIcon);
        tray.setToolTip('Telegram Web Desktop');
    }
}

module.exports = { createTray, updateTrayBadge };
