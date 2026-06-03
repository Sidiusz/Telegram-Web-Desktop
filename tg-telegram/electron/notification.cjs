'use strict';
const { BrowserWindow, screen, ipcMain, shell } = require('electron');

let _getMainWindow = null;
let _notifWin = null;
let _hideTimer = null;

function init(getMainWindow) {
    _getMainWindow = getMainWindow;

    ipcMain.on('notif-close', () => hideNotif());
    ipcMain.on('notif-open', () => {
        hideNotif();
        const win = _getMainWindow && _getMainWindow();
        if (win) {
            win.show();
            win.focus();
        }
    });
}

function hideNotif() {
    if (_hideTimer) {
        clearTimeout(_hideTimer);
        _hideTimer = null;
    }

    if (_notifWin && !_notifWin.isDestroyed()) {
        try {
            _notifWin.webContents.executeJavaScript('window.__hideNotif && window.__hideNotif()').catch(() => {});
        } catch (e) {}

        setTimeout(() => {
            if (_notifWin && !_notifWin.isDestroyed()) {
                _notifWin.close();
            }
            _notifWin = null;
        }, 240);
    }
}

function getPopupPosition(width, height) {
    const point = screen.getCursorScreenPoint ? screen.getCursorScreenPoint() : { x: 0, y: 0 };
    const display = screen.getDisplayNearestPoint ? screen.getDisplayNearestPoint(point) : screen.getPrimaryDisplay();
    const workArea = display && display.workArea ? display.workArea : {
        x: 0,
        y: 0,
        width: (display && display.workAreaSize && display.workAreaSize.width) || 0,
        height: (display && display.workAreaSize && display.workAreaSize.height) || 0,
    };

    return {
        x: Math.max(workArea.x, workArea.x + workArea.width - width - 16),
        y: Math.max(workArea.y, workArea.y + workArea.height - height - 16),
    };
}

function buildHtml() {
    return String.raw`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
    * { box-sizing: border-box; }
    html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: transparent;
        user-select: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .wrap {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
        padding: 0;
    }
    .card {
        width: 360px;
        min-height: 92px;
        max-width: 360px;
        background: rgba(30, 39, 51, 0.98);
        border-radius: 14px;
        padding: 14px 16px 12px;
        box-shadow: 0 10px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06);
        color: #fff;
        opacity: 0;
        transform: translateY(12px);
        transition: opacity .2s ease, transform .2s ease;
    }
    .card.show { opacity: 1; transform: translateY(0); }
    .card.hide { opacity: 0; transform: translateY(8px); }
    .top {
        display: flex;
        gap: 12px;
        align-items: center;
    }
    .avatar {
        width: 40px;
        height: 40px;
        flex: 0 0 40px;
        border-radius: 50%;
        overflow: hidden;
        background: #2b5278;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 17px;
        font-weight: 700;
        color: #fff;
    }
    .avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .body {
        flex: 1;
        min-width: 0;
    }
    .title {
        font-size: 13px;
        font-weight: 700;
        line-height: 1.3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .text {
        margin-top: 2px;
        font-size: 12px;
        line-height: 1.35;
        color: #c2c9d1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .progress {
        margin-top: 10px;
        height: 2px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(255,255,255,0.08);
    }
    .bar {
        width: 100%;
        height: 100%;
        background: #5288c1;
        transform-origin: left center;
    }
</style>
</head>
<body>
<div class="wrap">
    <div class="card" id="card">
        <div class="top">
            <div class="avatar" id="avatar"></div>
            <div class="body">
                <div class="title" id="title">Новое уведомление в Телеграм!</div>
                <div class="text" id="text">вам новое сообщение в Телеграм!</div>
                <div class="progress"><div class="bar" id="bar"></div></div>
            </div>
        </div>
    </div>
</div>
<script>
    const { ipcRenderer } = require('electron');
    const card = document.getElementById('card');
    const avatar = document.getElementById('avatar');
    const titleEl = document.getElementById('title');
    const textEl = document.getElementById('text');
    const barEl = document.getElementById('bar');

    let hideTimeout = null;
    let startTime = null;
    const DURATION = 5000;

    function normalize(value, fallback) {
        const text = String(value == null ? '' : value).trim();
        return text || fallback;
    }

    function firstLetter(value) {
        const t = normalize(value, 'T');
        return t[0].toUpperCase();
    }

    function playPing() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            const ctx = new AC();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.00001, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.18);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.2);
            osc.onended = () => {
                try { ctx.close(); } catch (e) {}
            };
        } catch (e) {}
    }

    function setAvatar(title, icon) {
        avatar.innerHTML = '';
        if (icon) {
            const img = document.createElement('img');
            img.src = icon;
            img.onerror = () => {
                avatar.textContent = firstLetter(title);
            };
            avatar.appendChild(img);
            return;
        }
        avatar.textContent = firstLetter(title);
    }

    function setData(data) {
        const title = normalize(data && (data.sender || data.chatName || data.title), 'Новое уведомление в Телеграм!');
        const text = normalize(data && data.body, 'вам новое сообщение в Телеграм!');
        titleEl.textContent = title;
        textEl.textContent = text;
        setAvatar(title, data && data.icon ? data.icon : '');
        if (!data || data.playSound !== false) playPing();
    }

    function startFadeOut() {
        card.classList.remove('show');
        card.classList.add('hide');
    }

    window.__hideNotif = startFadeOut;

    function showProgress() {
        startTime = null;
        function tick(ts) {
            if (!startTime) startTime = ts;
            const ratio = Math.max(0, 1 - (ts - startTime) / DURATION);
            barEl.style.width = (ratio * 100) + '%';
            if (ratio > 0) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    requestAnimationFrame(() => {
        card.classList.add('show');
        showProgress();
    });

    ipcRenderer.on('notif-data', (_e, data) => {
        if (hideTimeout) clearTimeout(hideTimeout);
        setData(data || {});
        hideTimeout = setTimeout(() => startFadeOut(), 5000);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') ipcRenderer.send('notif-close');
    });
</script>
</body>
</html>`;
}

function queueNotification(data) {
    const title = String((data && data.title) || '').trim() || 'Новое уведомление в Телеграм!';
    const body = String((data && data.body) || '').trim() || 'вам новое сообщение в Телеграм!';
    const icon = String((data && data.icon) || '');
    const playSound = data && data.playSound !== false;

    if (_notifWin && !_notifWin.isDestroyed()) {
        _notifWin.close();
        _notifWin = null;
    }
    if (_hideTimer) {
        clearTimeout(_hideTimer);
        _hideTimer = null;
    }

    const { x, y } = getPopupPosition(360, 92);

    _notifWin = new BrowserWindow({
        width: 360,
        height: 92,
        x,
        y,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: false,
        show: false,
        hasShadow: false,
        backgroundThrottling: false,
        roundedCorners: true,
        type: 'notification',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false,
            sandbox: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            navigateOnDragDrop: false,
        },
    });

    _notifWin.setAlwaysOnTop(true, 'screen-saver');
    try {
        _notifWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch (e) {}

    const html = buildHtml();
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);

    _notifWin.webContents.once('did-finish-load', () => {
        if (!_notifWin || _notifWin.isDestroyed()) return;
        _notifWin.webContents.send('notif-data', {
            title,
            body,
            icon,
            playSound,
        });
        _notifWin.showInactive();
        _hideTimer = setTimeout(() => hideNotif(), 5000);
    });

    _notifWin.loadURL(dataUrl).catch(() => {
        try {
            if (_notifWin && !_notifWin.isDestroyed()) {
                _notifWin.close();
            }
        } catch (e) {}
        _notifWin = null;
    });

    _notifWin.on('closed', () => {
        _notifWin = null;
    });
}

module.exports = { init, queueNotification };
