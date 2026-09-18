'use strict';
const { contextBridge, ipcRenderer } = require('electron');

let _proxyBootstrap = { active: false, domains: [], revision: 0 };
try { const boot = ipcRenderer.sendSync('get_proxy_bootstrap'); if (boot && typeof boot === 'object') _proxyBootstrap = boot; } catch (_) {}
function publishProxyState(payload) {
    _proxyBootstrap = payload && typeof payload === 'object' ? payload : _proxyBootstrap;
    try {
        contextBridge.executeInMainWorld({
            func: (state) => {
                window.__twdProxyState = state;
                try {
                    if (!window.__twdProxyChannel) window.__twdProxyChannel = new BroadcastChannel('__twd_proxy_v1');
                    window.__twdProxyChannel.postMessage(state);
                } catch (_) {}
                try { window.dispatchEvent(new CustomEvent('__twd_proxy_state', { detail: state })); } catch (_) {}
            },
            args: [_proxyBootstrap],
        });
    } catch (_) {}
}
ipcRenderer.on('proxy-state-changed', (_e, payload) => publishProxyState(payload));
contextBridge.exposeInMainWorld('__twdProxyRouter', { get: () => ({ ..._proxyBootstrap, domains: (_proxyBootstrap.domains || []).slice(), workerDomains: (_proxyBootstrap.workerDomains || []).slice() }) });

try {
    contextBridge.executeInMainWorld({
        func: (initial) => {
            window.__twdProxyState = initial;
            const proxyWorkers = new Set();
            // A unique query per renderer boot prevents Chromium/Telegram's service worker
            // from reusing an older already-patched transport worker after an app update.
            const proxyWorkerNonce = Date.now().toString(36) + Math.random().toString(36).slice(2);
            window.addEventListener('__twd_proxy_state', e => {
                const next = e.detail || window.__twdProxyState || initial;
                window.__twdProxyState = next;
                for (const worker of Array.from(proxyWorkers)) {
                    try { worker.postMessage({ __twdProxyConfig: next }); }
                    catch (_) { proxyWorkers.delete(worker); }
                }
            });
            const NativeWorker = window.Worker;
            if (NativeWorker && !window.__twdNativeWorker) {
                window.Worker = class RoutedWorker extends NativeWorker {
                    constructor(url, options) {
                        let target = url, tagged = false;
                        try {
                            const u = new URL(String(url), window.location.href);
                            if (u.hostname === 'web.telegram.org' && u.pathname.startsWith('/a/') && /\/(?:worker-[^/]+|index\.worker-[^/]+)\.js$/i.test(u.pathname)) {
                                u.searchParams.set('__twd_proxy', '1');
                                u.searchParams.set('__twd_proxy_rev', proxyWorkerNonce);
                                target = u.toString(); tagged = true;
                            }
                        } catch (_) {}
                        super(target, options);
                        if (tagged) { proxyWorkers.add(this); try { this.postMessage({ __twdProxyConfig: window.__twdProxyState }); } catch (_) {} }
                    }
                };
                Object.defineProperty(window, '__twdNativeWorker', { value: NativeWorker });
            }
            try {
                if (!window.__twdProxyChannel) window.__twdProxyChannel = new BroadcastChannel('__twd_proxy_v1');
                window.__twdProxyChannel.postMessage(initial);
            } catch (_) {}
        }, args: [_proxyBootstrap],
    });
} catch (_) {}

// Keep Telegram's media/upload pipelines alive when window is blurred/minimized.
// Document.hidden/visibilityState are overridden once at preload (document_start)
// and never redefined — window.cjs only flips the backing variable.
let _tgHidden = false;
// BrowserWindow starts with show:false, so don't pretend the page is focused
// until Electron actually shows/focuses the window.
let _tgHasFocus = false;
try {
    Object.defineProperty(Document.prototype, 'hidden', {
        get: () => _tgHidden,
        configurable: true,
    });
    Object.defineProperty(Document.prototype, 'visibilityState', {
        get: () => (_tgHidden ? 'hidden' : 'visible'),
        configurable: true,
    });
    Document.prototype.hasFocus = function() { return _tgHasFocus; };
} catch (e) {}
function _tgWakeForeground() {
    _tgHasFocus = true;
    _tgHidden = false;
    try { document.dispatchEvent(new Event('visibilitychange')); } catch (e) {}
    try { window.dispatchEvent(new Event('focus')); } catch (e) {}
}
contextBridge.exposeInMainWorld('__tgHiddenCtrl', {
    setHidden: (v, force = false) => {
        const next = !!v;
        if (next === _tgHidden && !force) return;
        _tgHidden = next;
        try { document.dispatchEvent(new Event('visibilitychange')); } catch (e) {}
        try { window.dispatchEvent(new Event(next ? 'blur' : 'focus')); } catch (e) {}
    },
    setHasFocus: (v) => { _tgHasFocus = !!v; },
    wakeForeground: () => _tgWakeForeground(),
});

function _tgInstallForegroundObserver() {
    const body = document.body;
    if (!body || body.__twdForegroundObserver) return;
    body.__twdForegroundObserver = true;
    let coolingDown = false;
    new MutationObserver(() => {
        if (!_tgHasFocus || !body.classList.contains('in-background') || coolingDown) return;
        coolingDown = true;
        queueMicrotask(() => _tgWakeForeground());
        setTimeout(() => { coolingDown = false; }, 250);
    }).observe(body, { attributes: true, attributeFilter: ['class'] });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _tgInstallForegroundObserver, { once: true });
else _tgInstallForegroundObserver();

const TWD_ALLOWED_INVOKE = new Set([
    'get_settings','get_app_info','get_proxy_status','set_proxy_mode','reset_proxy_auto','reconnect_proxy','save_proxy_options',
    'refresh_proxy_domains','test_proxy_connectivity','show_notification','preview_notification','save_settings','toggle_devtools','open_url','open_default_apps',
    'open_folder_dialog','get_downloads','bind_download','forget_download','delete_download','cancel_download',
    'open_download_folder','open_download_file','clear_cache','fetch_changelog','fetch_changelog_structured',
    'check_update_manual','skip_version','download_update','get_addons','delete_addon','toggle_addon','apply_addons',
    'show_image_context_menu','save_blob','open_addons_folder','report_lang','set_tray_image','get_tray_base',
    'set_notifications_count'
]);
function twdInvoke(cmd, args) {
    if (!TWD_ALLOWED_INVOKE.has(cmd)) return Promise.reject(new Error('IPC command is not allowed'));
    return ipcRenderer.invoke(cmd, args || {});
}

contextBridge.exposeInMainWorld('tgBridge', {
    invoke: twdInvoke,
    onDownloadEvent: (cb) => ipcRenderer.on('download-event', (_e, data) => cb(data)),

    onNotification: (cb) => ipcRenderer.on('show-notification', (_e, data) => cb(data)),

    onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, data) => cb(data)),
    onUpdateProgress: (cb) => ipcRenderer.on('update-download-progress', (_e, data) => cb(data)),
    onUpdateDone: (cb) => ipcRenderer.on('update-download-done', (_e, data) => cb(data)),
});