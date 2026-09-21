'use strict';
const { BrowserWindow, session, app, net, Menu, MenuItem, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { getScripts } = require('./scripts.cjs');
const { loadAddonScripts } = require('./addons.cjs');
const { loadFeatureScripts } = require('./features.cjs');
const { saveDownloads, trackActive, untrackActive } = require('./downloads.cjs');
const { loadSettings } = require('./settings.cjs');
const { uniquePath } = require('./utils.cjs');
const { installFlowsealWsRoute, noteTelegramLoadFailure, isWebFallbackEnabled } = require('./tg-flowseal-route.cjs');
const { fetchTelegramWebAFallback } = require('./telegram-web-fallback.cjs');
const { injectTelegramWorkerProxy } = require('./tg-flowseal-worker.cjs');

const TG_URL = 'https://web.telegram.org/a/';
const WEBSYNC_HOSTS = new Set(['t.me', 'telegram.me', 'telegram.dog']);
function isTelegramWebsyncUrl(urlString) {
    try {
        const u = new URL(urlString);
        return WEBSYNC_HOSTS.has(u.hostname) && u.pathname === '/_websync_';
    } catch (_) { return false; }
}
function telegramWebsyncNoopResponse() {
    return new Response('// Telegram Web Desktop: browser websync is not needed here.\n', {
        status: 200,
        headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
    });
}

let mainWindow = null;
let forceQuit = false;

app.on('before-quit', () => { forceQuit = true; });

function getWindow() {
    if (!mainWindow) return null;
    try { return mainWindow.isDestroyed() ? null : mainWindow; } catch (_) { return null; }
}

function createWindow(state, onTelegramLink, options = {}) {
    const startHidden = options.startHidden === true;
    const initialSettings = loadSettings();
    installFlowsealWsRoute(session.defaultSession, initialSettings);
    let webAMode = initialSettings.proxy_web_fallback !== false && initialSettings.proxy_web_fallback_latched === true
        ? 'fallback' : 'auto';
    if (webAMode === 'fallback') console.log('[TG-PROXY] Web A fallback pre-armed from previous direct failure');
    let fallbackReloadScheduled = false;
    function isWebAUrl(url, protocol) {
        try {
            const u = new URL(url);
            return (!protocol || u.protocol === protocol) && u.hostname === 'web.telegram.org' &&
                (u.pathname === '/a' || u.pathname.startsWith('/a/'));
        } catch (_) { return false; }
    }
    function isWebAEntry(url) {
        try {
            const u = new URL(url);
            return u.hostname === 'web.telegram.org' && (u.pathname === '/a' || u.pathname === '/a/');
        } catch (_) { return false; }
    }
    function scheduleFallbackReload() {
        if (fallbackReloadScheduled || !mainWindow || mainWindow.isDestroyed()) return;
        fallbackReloadScheduled = true;
        setTimeout(() => {
            fallbackReloadScheduled = false;
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(TG_URL);
        }, 50);
    }
    const WEB_A_ENTRY_TIMEOUT_MS = 8000;
    async function fetchTelegramAsset(request, url) {
        if (webAMode === 'fallback') return fetchTelegramWebAFallback(url);
        const entry = isWebAEntry(url);
        const timeoutSignal = entry ? AbortSignal.timeout(WEB_A_ENTRY_TIMEOUT_MS) : null;
        try {
            const response = await net.fetch(request, {
                bypassCustomProtocolHandlers: true,
                ...(timeoutSignal ? { signal: timeoutSignal } : {}),
            });
            if (entry && webAMode === 'auto') webAMode = 'direct';
            return response;
        } catch (e) {
            noteTelegramLoadFailure(e && e.message ? e.message : e);
            if (!isWebFallbackEnabled()) throw e;
            webAMode = 'fallback';
            // If the entry document itself failed/timed out, serve the pinned build
            // directly in this same navigation. For a later asset failure, restart the
            // shell once so the whole page comes from one consistent source.
            if (entry) return fetchTelegramWebAFallback(url);
            scheduleFallbackReload();
            throw e;
        }
    }

    const ALLOWED_PERMS = new Set([
        'notifications', 'media', 'mediaKeySystem',
        'clipboard-read', 'clipboard-sanitized-write',
        'display-capture', 'window-management',
    ]);
    function isTrustedPermissionOrigin(raw) {
        try {
            const u = new URL(String(raw || ''));
            return u.protocol === 'https:' && u.hostname === 'web.telegram.org' &&
                   (u.pathname === '/a' || u.pathname.startsWith('/a/') || u.pathname === '/');
        } catch (_) { return false; }
    }
    function isMainTelegramContents(webContents) {
        return !!(mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents);
    }
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        try {
            if (!isMainTelegramContents(webContents)) return callback(false);
            const url = (details && (details.requestingUrl || details.embeddingUrl)) || webContents.getURL() || '';
            if (!isTrustedPermissionOrigin(url)) return callback(false);
            if (!ALLOWED_PERMS.has(permission)) return callback(false);
            return callback(true);
        } catch (_) { return callback(false); }
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
        try {
            if (!isMainTelegramContents(webContents)) return false;
            const raw = requestingOrigin || (details && (details.requestingUrl || details.embeddingUrl)) || webContents.getURL() || '';
            return isTrustedPermissionOrigin(raw) && ALLOWED_PERMS.has(permission);
        } catch (_) { return false; }
    });

    // Telegram now delivers CSP via <meta http-equiv="Content-Security-Policy"> (see /a/ HTML)
    // – stripping response headers alone is no longer enough and the page stays white
    // (inline executeJavaScript / service-worker bootstraps are blocked). Intercept the
    // HTML document and remove the meta tag. Uses session.protocol.handle + net.fetch
    // (bypassCustomProtocolHandlers avoids recursion). Falls back to header strip only
    // if handle is unavailable/rejected.
    try {
        const ses = session.defaultSession;
        const canHandle = typeof ses.protocol.handle === 'function';
        let already = false;
        try { already = ses.protocol.isProtocolHandled ? ses.protocol.isProtocolHandled('https') : false; } catch (_) {}
        if (canHandle && !already) {
            ses.protocol.handle('https', async (request) => {
                const url = request.url;
                if (isTelegramWebsyncUrl(url)) return telegramWebsyncNoopResponse();
                const isTgCandidate = isWebAUrl(url, 'https:');
                if (!isTgCandidate) {
                    return net.fetch(request, { bypassCustomProtocolHandlers: true });
                }
                let resp = await fetchTelegramAsset(request, url);
                resp = await injectTelegramWorkerProxy(resp, url);
                const ct = (resp.headers.get('content-type') || '').toLowerCase();
                if (!ct.includes('text/html')) return resp;
                let body = await resp.text();
                const before = body.length;
                body = body.replace(/<meta[^>]*http-equiv=["']content-security-policy["'][^>]*>/gi, '');
                body = body.replace(/<meta[^>]*http-equiv=["']content-security-policy-report-only["'][^>]*>/gi, '');
                if (body.length === before) return resp;
                const headers = new Headers(resp.headers);
                headers.delete('content-security-policy');
                headers.delete('content-security-policy-report-only');
                headers.delete('x-frame-options');
                headers.delete('content-length');
                headers.delete('Content-Length');
                return new Response(body, { status: resp.status, statusText: resp.statusText, headers });
            });
            // Mirror for http (TG may redirect http→https, but cover it)
            try {
                const httpAlready = ses.protocol.isProtocolHandled ? ses.protocol.isProtocolHandled('http') : false;
                if (!httpAlready) {
                    ses.protocol.handle('http', async (request) => {
                        const url = request.url;
                        if (isTelegramWebsyncUrl(url)) return telegramWebsyncNoopResponse();
                        const isTgCandidate = isWebAUrl(url, 'http:');
                        if (!isTgCandidate) return net.fetch(request, { bypassCustomProtocolHandlers: true });
                        let resp = await fetchTelegramAsset(request, url);
                        resp = await injectTelegramWorkerProxy(resp, url);
                        const ct = (resp.headers.get('content-type') || '').toLowerCase();
                        if (!ct.includes('text/html')) return resp;
                        let body = await resp.text();
                        const before = body.length;
                        body = body.replace(/<meta[^>]*http-equiv=["']content-security-policy["'][^>]*>/gi, '');
                        body = body.replace(/<meta[^>]*http-equiv=["']content-security-policy-report-only["'][^>]*>/gi, '');
                        if (body.length === before) return resp;
                        const headers = new Headers(resp.headers);
                        headers.delete('content-security-policy');
                        headers.delete('content-security-policy-report-only');
                        headers.delete('x-frame-options');
                        headers.delete('content-length');
                        headers.delete('Content-Length');
                        return new Response(body, { status: resp.status, statusText: resp.statusText, headers });
                    });
                }
            } catch (_) {}
        }
    } catch (e) {
        console.error('[CSP] protocol.handle failed, fallback to header strip only:', e.message);
    }

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
            sandbox: true,
            spellcheck: false,
            backgroundThrottling: false,
        },
    });

    // CSP can be delivered as HTTP header (older) or as <meta http-equiv> (current).
    // protocol.handle above strips the meta; this strips the header variant.
    // Keys are lower-cased by Electron but be defensive and strip case-insensitively.
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        if (!/^https:\/\/web\.telegram\.org\/a(?:\/|[?#]|$)/i.test(details.url || '')) {
            return callback({ responseHeaders: details.responseHeaders || {} });
        }
        const headers = details.responseHeaders || {};
        for (const key of Object.keys(headers)) {
            const lk = key.toLowerCase();
            if (lk === 'content-security-policy' || lk === 'content-security-policy-report-only' || lk === 'x-frame-options') {
                delete headers[key];
            }
        }
        callback({ responseHeaders: headers });
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

    mainWindow.webContents.on('dom-ready', () => {
        const { NOTIF_INTERCEPT_JS } = getScripts();
        mainWindow.webContents.executeJavaScript(NOTIF_INTERCEPT_JS).catch(e => console.error('[NOTIF]', e));
    });

    let injectPromise = null;
    const injectAll = () => {
        if (injectPromise || !mainWindow || mainWindow.isDestroyed()) return injectPromise;
        injectPromise = (async () => {
            // Keep ordering deterministic and avoid piling many executeJavaScript
            // calls onto WebContents while a load is still settling.
            const { NOTIF_INTERCEPT_JS, EXTERNAL_JS, AUDIO_JS, UI_JS } = getScripts();
            const settings = loadSettings();
            const allScripts = [NOTIF_INTERCEPT_JS, EXTERNAL_JS, AUDIO_JS, UI_JS, ...loadFeatureScripts(settings), ...loadAddonScripts()];
            for (const script of allScripts) {
                if (!mainWindow || mainWindow.isDestroyed()) break;
                try { await mainWindow.webContents.executeJavaScript(script); }
                catch (e) { console.error('[SCRIPT]', e); }
            }
        })().finally(() => { injectPromise = null; });
        return injectPromise;
    };

    mainWindow.webContents.on('did-finish-load', () => {
        const s = loadSettings();
        if (s.devtools_enabled) mainWindow.webContents.openDevTools();
        void injectAll();
    });

    // Watchdog: TG's self-reload ("Reload" in the chat list) goes through a service
    // worker, and did-finish-load can fire on an intermediate load and miss the final page.
    // Verify the notification interceptor independently from the UI marker: a long-lived
    // page can keep our UI while Telegram restores browser notification globals underneath it.
    setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading() || injectPromise) return;
        mainWindow.webContents.executeJavaScript(
            '!!window.__tgUIInjected && !!window.__tgNotifIntercept && !!window.__twdNotifHealthTimer && typeof window.__twdNotifRepair === "function"',
            true
        )
            .then(ok => { if (!ok) void injectAll(); })
            .catch(() => {});
    }, 3000);

    // Developer tools are a user-controlled capability. When disabled, consume every
    // common DevTools accelerator and also close any DevTools window opened through
    // another Electron path. This keeps the setting authoritative rather than merely
    // controlling whether DevTools auto-open at startup.
    const devToolsAllowed = () => {
        try { return loadSettings().devtools_enabled === true; }
        catch (_) { return false; }
    };
    mainWindow.webContents.on('devtools-opened', () => {
        if (!devToolsAllowed() && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.closeDevTools();
        }
    });
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const key = String(input.key || '').toLowerCase();
        const command = !!(input.control || input.meta);
        const devToolsShortcut =
            key === 'f12' ||
            (command && input.shift && (key === 'i' || key === 'j' || key === 'c')) ||
            (input.meta && input.alt && (key === 'i' || key === 'j' || key === 'c'));
        if (!devToolsShortcut) return;

        event.preventDefault();
        if (!devToolsAllowed()) {
            if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools();
            return;
        }
        if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools();
        else mainWindow.webContents.openDevTools();
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
            if (menu.items.length) menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({ role: 'copy', label: 'Копировать' }));
        }

        if (!menu.items.length) return;
        menu.popup({ window: mainWindow });
    });

    // Preload overrides Document.prototype.hidden/visibilityState/hasFocus once.
    // Wake Telegram explicitly when Electron shows/focuses the window: Web A can
    // otherwise keep body.in-background after auth even though the DOM is ready.
    const wakeTelegramForeground = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.executeJavaScript(
            `try{window.__tgHiddenCtrl&&window.__tgHiddenCtrl.wakeForeground()}catch(e){}`
        ).catch(()=>{});
    };
    mainWindow.on('blur', () => {
        mainWindow.webContents.executeJavaScript(`try{window.__tgHiddenCtrl&&window.__tgHiddenCtrl.setHasFocus(false)}catch(e){}`).catch(()=>{});
    });
    mainWindow.on('focus', wakeTelegramForeground);

    mainWindow.webContents.session.on('will-download', (event, item) => {
        const settings = loadSettings();
        const rawName = item.getFilename();
        const { sanitizeFilename } = require('./utils.cjs');
        const originalFilename = sanitizeFilename(rawName);

        const downloadDir = settings.save_path || app.getPath('downloads');
        try {
            fs.mkdirSync(downloadDir, { recursive: true });
        } catch (e) {
            console.error('[DOWNLOAD] save directory is unavailable:', e && e.message ? e.message : e);
            try { item.cancel(); } catch (_) {}
            return;
        }
        item.setSavePath(uniquePath(path.join(downloadDir, originalFilename)));

        state.downloadCounter += 1;
        const id = state.downloadCounter;
        const savePath = item.getSavePath();
        const filename = path.basename(savePath) || originalFilename;

        state.downloads.push({
            id, url: item.getURL(), filename, path: savePath, status: 'downloading',
            recv: 0, total: Math.max(0, Number(item.getTotalBytes()) || 0),
        });
        saveDownloads(state.downloads);
        trackActive(id, item);

        // origName is the name as sent in the message (renderer matches mid by it); filename is the actual saved name (for the manager).
        mainWindow.webContents.send('download-event', {
            type: 'start', id, filename, origName: originalFilename,
            total: Math.max(0, Number(item.getTotalBytes()) || 0),
        });

        item.on('updated', (event, dlState) => {
            if (dlState === 'interrupted') {
                const dl = state.downloads.find(d => d.id === id);
                if (dl) {
                    dl.status = 'failed';
                    dl.recv = Math.max(0, Number(item.getReceivedBytes()) || 0);
                    dl.total = Math.max(0, Number(item.getTotalBytes()) || 0);
                    saveDownloads(state.downloads);
                }
                mainWindow.webContents.send('download-event', {
                    type: 'done', id, status: 'failed',
                    received: Math.max(0, Number(item.getReceivedBytes()) || 0),
                    total: Math.max(0, Number(item.getTotalBytes()) || 0),
                });
            } else {
                const received = Math.max(0, Number(item.getReceivedBytes()) || 0);
                const total = Math.max(0, Number(item.getTotalBytes()) || 0);
                const dl = state.downloads.find(d => d.id === id);
                if (dl) { dl.recv = received; dl.total = total; }
                mainWindow.webContents.send('download-event', {
                    type: 'progress',
                    id,
                    received,
                    total,
                });
            }
        });

        item.once('done', (event, dlState) => {
            untrackActive(id);
            const status = dlState === 'completed' ? 'completed' : (dlState === 'cancelled' ? 'cancelled' : 'failed');
            // User-cancelled: drop the partial file.
            if (status === 'cancelled' && savePath) { try { fs.unlinkSync(savePath); } catch (e) {} }
            const dl = state.downloads.find(d => d.id === id);
            if (dl) {
                dl.status = status;
                dl.path = item.getSavePath();
                dl.recv = Math.max(0, Number(item.getReceivedBytes()) || 0);
                dl.total = Math.max(0, Number(item.getTotalBytes()) || 0);
                saveDownloads(state.downloads);
            }
            mainWindow.webContents.send('download-event', {
                type: 'done', id, status,
                received: Math.max(0, Number(item.getReceivedBytes()) || 0),
                total: Math.max(0, Number(item.getTotalBytes()) || 0),
            });
        });
    });

    // Hard-locks the /A (webZ) version. /K is a separate app (webK) our injections/
    // addons aren't built for — any navigation/redirect to /k is cancelled and sent back to /A.
    const isKVersionUrl = (url) => {
        try {
            const u = new URL(url);
            return /(^|\.)telegram\.org$/i.test(u.hostname) && /^\/k(\/|$)/.test(u.pathname);
        } catch (e) { return false; }
    };
    const forceAVersion = (e) => {
        if (e) e.preventDefault();
        // Doesn't reload needlessly while already on /A — only loads when we'd actually land on /K.
        mainWindow.loadURL(TG_URL);
    };

    const isTrustedMainUrl = (url) => {
        try {
            const u = new URL(url);
            return u.protocol === 'https:' && u.hostname === 'web.telegram.org' &&
                   (u.pathname === '/a' || u.pathname.startsWith('/a/'));
        } catch (_) { return false; }
    };
    const openExternalWebUrl = (url) => {
        try {
            const u = new URL(url);
            const host = u.hostname.toLowerCase().replace(/^www\./, '');
            const isTelegramLink = u.protocol === 'tg:' ||
                ((u.protocol === 'https:' || u.protocol === 'http:') &&
                 ['t.me', 'telegram.me', 'telegram.dog'].includes(host));
            if (isTelegramLink && typeof onTelegramLink === 'function') {
                onTelegramLink(u.toString());
                return;
            }
            if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.toString()).catch(() => {});
        } catch (_) {}
    };

    mainWindow.webContents.on('will-navigate', (e, url) => {
        if (isKVersionUrl(url)) { forceAVersion(e); return; }
        if (url.startsWith('blob:')) { e.preventDefault(); return; }
        if (!isTrustedMainUrl(url)) {
            e.preventDefault();
            openExternalWebUrl(url);
        }
    });
    mainWindow.webContents.on('will-redirect', (e, url) => {
        if (isKVersionUrl(url)) { forceAVersion(e); return; }
        if (!isTrustedMainUrl(url)) {
            e.preventDefault();
            openExternalWebUrl(url);
        }
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isKVersionUrl(url)) { mainWindow.loadURL(TG_URL); return { action: 'deny' }; }
        if (!isTrustedMainUrl(url)) openExternalWebUrl(url);
        return { action: 'deny' };
    });

    // A renderer crash used to leave a perfectly valid BrowserWindow showing a white
    // surface, while the tray still held a reference to it. Recover the Telegram page
    // in-place, but cap retries so a deterministic startup crash cannot spin forever.
    const rendererRecoveries = [];
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        if (forceQuit || !mainWindow || mainWindow.isDestroyed()) return;
        const now = Date.now();
        while (rendererRecoveries.length && now - rendererRecoveries[0] > 60000) rendererRecoveries.shift();
        if (rendererRecoveries.length >= 3) {
            console.error('[WINDOW] renderer repeatedly failed; automatic reload stopped', details);
            return;
        }
        rendererRecoveries.push(now);
        console.error('[WINDOW] renderer process gone; reloading Telegram', details);
        setTimeout(() => {
            if (!forceQuit && mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(TG_URL).catch(() => {});
        }, 300);
    });

    mainWindow.on('ready-to-show', () => {
        if (process.env.TWD_SMOKE_HIDDEN === '1' || startHidden) return;
        if (!mainWindow || mainWindow.isDestroyed()) return;
        try { if (!mainWindow.isMaximized()) mainWindow.maximize(); } catch (_) {}
        mainWindow.show();
        mainWindow.focus();
    });
    // Taskbar badge vanishes on cold start (button doesn't exist yet when setBadgeCount runs) and on restore from tray — reapplied on show/restore.
    const reapplyBadge = () => { try { app.setBadgeCount(state.lastNotificationCount || 0); } catch (e) {} };

    // Chromium can occasionally keep a valid, fully rendered DOM while the Windows
    // compositor surface stays blank after a renderer reload. Force a few full paints
    // around load/show/restore instead of making the user minimize or restart the app.
    let repaintTimers = [];
    function repaintWindowSurface() {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        for (const timer of repaintTimers) clearTimeout(timer);
        repaintTimers = [];
        const repaint = () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            try { mainWindow.webContents.invalidate(); } catch (_) {}
        };
        repaint();
        repaintTimers.push(setTimeout(repaint, 60));
        repaintTimers.push(setTimeout(repaint, 220));
    }

    mainWindow.on('show', () => { reapplyBadge(); wakeTelegramForeground(); repaintWindowSurface(); });
    mainWindow.on('restore', () => { reapplyBadge(); wakeTelegramForeground(); repaintWindowSurface(); });

    // TG's column layout caches window width via ResizeObserver and won't recompute after a
    // monitor change or mid-transition reload (chat stays narrow); a synthetic resize event doesn't trigger it, but nudging zoom by 0.001 does (no visible jump, unlike resizing the frame).
    let _nudging = false;
    function nudgeRelayout() {
        if (_nudging || !mainWindow || mainWindow.isDestroyed()) return;
        _nudging = true;
        repaintWindowSurface();
        try {
            const wc = mainWindow.webContents;
            const z = wc.getZoomFactor();
            wc.setZoomFactor(z + 0.001);
            setTimeout(() => {
                try { wc.setZoomFactor(z); } catch (e) {}
                repaintWindowSurface();
                _nudging = false;
            }, 50);
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
    mainWindow.webContents.on('did-finish-load', () => {
        repaintWindowSurface();
        setTimeout(nudgeRelayout, 500);
    });
    mainWindow.webContents.on('did-stop-loading', repaintWindowSurface);
    mainWindow.on('hide', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.executeJavaScript(`try{window.__tgHiddenCtrl&&window.__tgHiddenCtrl.setHasFocus(false)}catch(e){}`).catch(()=>{});
    });
    mainWindow.on('close', (e) => {
        if (forceQuit) return;
        const settings = loadSettings();
        if (settings.minimize_to_tray) {
            e.preventDefault();
            mainWindow.hide();
        }
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
        // The notification popup is another BrowserWindow, so relying on
        // window-all-closed can leave the process/tray alive after the main window is
        // gone. If X really closed the main window (not hide-to-tray), terminate the
        // app explicitly; otherwise tray actions later target a destroyed object.
        if (!forceQuit) setImmediate(() => { if (!forceQuit) app.quit(); });
    });

    mainWindow.loadURL(TG_URL);
    return mainWindow;
}

module.exports = { createWindow, getWindow };
