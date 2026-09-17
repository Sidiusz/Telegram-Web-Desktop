'use strict';
const { app, Menu, powerSaveBlocker } = require('electron');
const path = require('path');

// Do not grant CSP-bypass privileges to the global http/https schemes.
// The narrowly-scoped Telegram /a response transform in window.cjs is the only
// place where CSP is relaxed for compatibility with our injected UI.

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
// Keep timers alive (our incoming-message interceptor) when window is backgrounded/hidden
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Dev only (unpackaged): expose CDP for local UI testing. Never in shipped builds.
if (!app.isPackaged) app.commandLine.appendSwitch('remote-debugging-port', '9222');

const { createWindow, getWindow } = require('./electron/window.cjs');
const { createTray } = require('./electron/tray.cjs');
const { initState, getState, registerIpc } = require('./electron/ipc.cjs');
const { startEmbeddedFlowsealBridge, stopEmbeddedFlowsealBridge } = require('./electron/tg-flowseal-bridge.cjs');

// Dev/test runs can use an isolated profile without competing with the installed app.
// Production behavior is unchanged unless these explicit test-only env vars are set.
if (!app.isPackaged) {
    const devProfile = process.env.TWD_DEV_PROFILE;
    if (devProfile) app.setPath('userData', path.resolve(devProfile));
    else app.setPath('userData', path.join(app.getPath('appData'), 'Telegram Web Desktop'));
}

// Register tg:// only from an installed build. `app.isPackaged` is also true for
// dist/win-unpacked, so test builds must not steal the OS association.
function isInstalledBuildPath() {
    if (!app.isPackaged) return false;
    if (process.env.TWD_REGISTER_PROTOCOL === '1') return true;
    const exe = path.resolve(process.execPath).toLowerCase();
    const roots = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
        process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)
        .map(v => path.resolve(v).toLowerCase() + path.sep);
    return roots.some(root => exe.startsWith(root));
}
if (isInstalledBuildPath()) { try { app.setAsDefaultProtocolClient('tg'); } catch (_) {} }

function handleTgUrl(tgUrl) {
    const win = getWindow();
    if (!win) return;
    win.show();
    win.focus();
    // webZ reads tgaddr from the hash only at app startup. loadURL to a URL that
    // differs only by hash is a same-document nav (no reload) → the effect never
    // re-runs and the link is ignored. A unique query param forces a full load.
    const internalUrl = 'https://web.telegram.org/a/?_tgdl=' + Date.now()
        + '#?tgaddr=' + encodeURIComponent(tgUrl);
    win.webContents.loadURL(internalUrl);
}

// t.me/<...> https links → tg:// so webZ resolves them via the same deep-link path.
function normalizeToTg(url) {
    if (!url || typeof url !== 'string') return null;
    if (/^tg:\/\//i.test(url)) return url;
    let u;
    try { u = new URL(url); } catch (_) { return null; }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!['t.me', 'telegram.me', 'telegram.dog'].includes(host)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    const first = parts[0];
    const action = first.toLowerCase();
    if (first.startsWith('+') || action === 'joinchat') {
        const invite = first.startsWith('+') ? first.slice(1) : (parts[1] || '');
        return invite ? 'tg://join?invite=' + encodeURIComponent(invite) : null;
    }
    if (action === 'c' && /^\d+$/.test(parts[1] || '') && /^\d+$/.test(parts[2] || '')) {
        const qs = new URLSearchParams();
        qs.set('channel', parts[1]);
        if (parts[3] && /^\d+$/.test(parts[3])) { qs.set('thread', parts[2]); qs.set('post', parts[3]); }
        else qs.set('post', parts[2]);
        for (const [k, v] of u.searchParams) qs.append(k, v);
        return 'tg://privatepost?' + qs.toString();
    }
    if (action === 'share' && (parts[1] || '').toLowerCase() === 'url') {
        return 'tg://msg_url?' + u.searchParams.toString();
    }
    if (['proxy', 'socks'].includes(action)) {
        return 'tg://' + action + '?' + u.searchParams.toString();
    }
    const actionMap = { addstickers: 'set', addemoji: 'set', setlanguage: 'lang', login: 'code', invoice: 'slug', giftcode: 'slug' };
    if (actionMap[action] && parts[1]) {
        const qs = new URLSearchParams(u.searchParams);
        qs.set(actionMap[action], parts[1]);
        return 'tg://' + action + '?' + qs.toString();
    }
    const offset = action === 's' ? 1 : 0;
    const domain = parts[offset];
    if (!domain) return null;
    const qs = new URLSearchParams(u.searchParams);
    qs.set('domain', domain);
    if (parts[offset + 1] && /^\d+$/.test(parts[offset + 1])) qs.set('post', parts[offset + 1]);
    return 'tg://resolve?' + qs.toString();
}

function getTgUrlFromArgs(argv) {
    var raw = argv.find(arg => arg.startsWith('tg://') || /^https?:\/\/(t\.me|telegram\.me|telegram\.dog)\//i.test(arg));
    return normalizeToTg(raw);
}

const initialDeepLink = getTgUrlFromArgs(process.argv);
const gotLock = process.env.TWD_ALLOW_MULTI_INSTANCE === '1' ||
    app.requestSingleInstanceLock({ deepLink: initialDeepLink || '' });
if (!gotLock) {
    app.quit();
} else {
    // Forward the parsed deep link through Electron's additionalData channel too.
    // On Windows the secondary argv is not reliable for custom protocols on every launch path.
    app.on('second-instance', (event, argv, workingDirectory, additionalData) => {
        const win = getWindow();
        if (win) { win.show(); win.focus(); }
        const tgUrl = normalizeToTg(additionalData?.deepLink) || getTgUrlFromArgs(argv);
        if (tgUrl) handleTgUrl(tgUrl);
    });
}

if (gotLock) {
app.whenReady().then(async () => {
    try { powerSaveBlocker.start('prevent-app-suspension'); } catch(e) {}
    initState();
    try { await startEmbeddedFlowsealBridge(); } catch (e) { console.error('[TG-PROXY-BRIDGE] startup failed:', e); }
    const state = getState();
    registerIpc(getWindow);
    createWindow(state, rawUrl => { const tgUrl = normalizeToTg(rawUrl); if (tgUrl) handleTgUrl(tgUrl); });
    createTray(getWindow);

    Menu.setApplicationMenu(null);

    if (initialDeepLink) {
        const win = getWindow();
        win.webContents.once('did-finish-load', () => handleTgUrl(initialDeepLink));
    }
});

app.on('before-quit', () => { void stopEmbeddedFlowsealBridge().catch(() => {}); });

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
}