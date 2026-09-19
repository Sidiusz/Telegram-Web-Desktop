'use strict';
const { contextBridge, ipcRenderer } = require('electron');

let _proxyBootstrap = { active: false, domains: [], revision: 0 };
let _historyBootstrap = { showDeleted: false, editHistory: false };
let _feedBootstrap = { sources: [] };
try { const boot = ipcRenderer.sendSync('get_proxy_bootstrap'); if (boot && typeof boot === 'object') _proxyBootstrap = boot; } catch (_) {}
try { const boot = ipcRenderer.sendSync('get_history_bootstrap'); if (boot && typeof boot === 'object') _historyBootstrap = boot; } catch (_) {}
try { const boot = ipcRenderer.sendSync('get_feed_bootstrap'); if (boot && typeof boot === 'object') _feedBootstrap = boot; } catch (_) {}
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
        func: (initial, historyConfig, feedConfig) => {
            window.__twdProxyState = initial;
            const proxyWorkers = new Set();
            const historyEnabled = !!(historyConfig && (historyConfig.showDeleted || historyConfig.editHistory));
            const feedSourceIds = new Set(Array.isArray(feedConfig && feedConfig.sources) ? feedConfig.sources.map(String) : []);
            const feedByMessageId = new Map();
            const historyTracked = new Map();
            const historyByMessageId = new Map();
            const historyDeletedByChat = new Map();
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
            window.addEventListener('__twd_feed_config', e => {
                const ids = e && e.detail && Array.isArray(e.detail.sources) ? e.detail.sources : [];
                feedSourceIds.clear();
                ids.map(String).filter(Boolean).forEach(id => feedSourceIds.add(id));
            });
            function feedText(content) {
                try {
                    const candidates = [
                        content && content.text,
                        content && content.caption,
                        content && content.photo && content.photo.caption,
                        content && content.video && content.video.caption,
                        content && content.document && content.document.caption,
                        content && content.animation && content.animation.caption
                    ];
                    for (const value of candidates) {
                        if (typeof value === 'string' && value) return value;
                        if (value && value.text != null && String(value.text)) return String(value.text);
                    }
                } catch (_) {}
                return '';
            }
            function feedMedia(content) {
                if (!content || typeof content !== 'object') return null;
                const keys = ['photo','video','animation','document','audio','voice','sticker','poll','location','contact'];
                for (const type of keys) {
                    const media = content[type];
                    if (!media) continue;
                    const thumb = media.thumbnail && media.thumbnail.dataUri ? String(media.thumbnail.dataUri) : '';
                    return {
                        type,
                        thumbnail: thumb,
                        fileName: media.fileName ? String(media.fileName) : '',
                        duration: Number(media.duration) || 0,
                    };
                }
                return null;
            }
            function feedPackMessage(message, chatId, messageId) {
                const reactions = [];
                try {
                    for (const r of (message && message.reactions && message.reactions.results) || []) {
                        if (!r || !r.reaction) continue;
                        reactions.push({
                            count: Number(r.count) || 0,
                            emoji: r.reaction.emoticon ? String(r.reaction.emoticon) : '',
                        });
                    }
                } catch (_) {}
                return {
                    chatId: String(chatId),
                    messageId: String(messageId),
                    text: feedText(message && message.content),
                    date: Number(message && message.date) || Math.floor(Date.now() / 1000),
                    media: feedMedia(message && message.content),
                    viewsCount: Number(message && message.viewsCount) || 0,
                    forwardsCount: Number(message && message.forwardsCount) || 0,
                    reactions,
                    isEdited: !!(message && (message.isEdited || message.editDate)),
                };
            }
            function feedEmit(detail) {
                if (!detail) return;
                const q = window.__twdFeedUpdateQueue || (window.__twdFeedUpdateQueue = []);
                q.push(detail);
                if (q.length > 1500) q.splice(0, q.length - 1500);
                try { window.dispatchEvent(new CustomEvent('__twd_feed_update', { detail })); } catch (_) {}
            }
            function feedHandleWorkerMessage(event) {
                if (!feedSourceIds.size) return;
                const payloads = event && event.data && event.data.payloads;
                if (!Array.isArray(payloads)) return;
                payloads.forEach(payload => {
                    if (!payload || payload.type !== 'updates' || !Array.isArray(payload.updates)) return;
                    payload.updates.forEach(update => {
                        if (!update || typeof update !== 'object') return;
                        if (update['@type'] === 'updateMessage') {
                            const message = update.message;
                            const chatId = String(update.chatId != null ? update.chatId : message && message.chatId != null ? message.chatId : '');
                            const messageId = String(update.id != null ? update.id : message && message.id != null ? message.id : '');
                            if (!message || !chatId || !messageId || !feedSourceIds.has(chatId)) return;
                            feedByMessageId.set(messageId, chatId);
                            feedEmit({ kind: update.isFromNew === true ? 'new' : 'edit', item: feedPackMessage(message, chatId, messageId) });
                            return;
                        }
                        if (update['@type'] === 'deleteMessages' && Array.isArray(update.ids)) {
                            const explicitChat = update.chatId != null ? String(update.chatId) : '';
                            update.ids.forEach(rawId => {
                                const messageId = String(rawId);
                                const chatId = explicitChat || feedByMessageId.get(messageId) || '';
                                if (!chatId || !feedSourceIds.has(chatId)) return;
                                feedByMessageId.delete(messageId);
                                feedEmit({ kind: 'delete', chatId, messageId });
                            });
                        }
                    });
                });
            }
            function historyActiveChatId() {
                try {
                    const avatar = document.querySelector('#MiddleColumn .MiddleHeader .Avatar[data-peer-id]');
                    const peerId = avatar && avatar.getAttribute('data-peer-id');
                    if (peerId) return String(peerId);
                    const match = String(location.hash || '').match(/#(-?\d+)/);
                    return match ? match[1] : '';
                } catch (_) { return ''; }
            }
            function historyIsPrivate(chatId) {
                try { return BigInt(String(chatId)) > 0n; } catch (_) { return false; }
            }
            function historyMessageText(message) {
                try {
                    const text = message && message.content && message.content.text;
                    return String(text && text.text != null ? text.text : '');
                } catch (_) { return ''; }
            }
            function historyKey(chatId, messageId) {
                return String(chatId) + ':' + String(messageId);
            }
            function historyEmit(detail) {
                if (!historyEnabled || !detail) return;
                const q = window.__twdHistoryUpdateQueue || (window.__twdHistoryUpdateQueue = []);
                q.push(detail);
                if (q.length > 1500) q.splice(0, q.length - 1500);
                try { window.dispatchEvent(new CustomEvent('__twd_history_update', { detail })); } catch (_) {}
            }
            function historyDomSnapshot(chatId, messageId) {
                try {
                    if (historyActiveChatId() !== String(chatId)) return null;
                    const selector = '#MiddleColumn .Message[data-message-id="' + CSS.escape(String(messageId)) + '"]';
                    const node = document.querySelector(selector);
                    if (!node) return null;
                    const candidates = ['.message-text','.text-content','.TranslatableMessage','.message-content .content-inner','.message-content .caption'];
                    let text = '';
                    for (const sel of candidates) {
                        const el = node.querySelector(sel);
                        if (el && String(el.innerText || el.textContent || '').trim()) {
                            text = String(el.innerText || el.textContent || '').trim();
                            break;
                        }
                    }
                    return { chatId: String(chatId), messageId: String(messageId), text, timestamp: Date.now() };
                } catch (_) { return null; }
            }
            function historyRemember(item) {
                if (!item || !item.chatId || !item.messageId) return;
                const key = historyKey(item.chatId, item.messageId);
                historyTracked.set(key, item);
                historyByMessageId.set(String(item.messageId), key);
                if (historyTracked.size > 5000) {
                    const first = historyTracked.keys().next().value;
                    const old = historyTracked.get(first);
                    historyTracked.delete(first);
                    if (old && historyByMessageId.get(String(old.messageId)) === first) historyByMessageId.delete(String(old.messageId));
                }
            }
            function historyTrackMessage(update) {
                if (!historyEnabled || !update || update['@type'] !== 'updateMessage') return;
                const message = update.message;
                if (!message || !message.content) return;
                const chatId = String(update.chatId != null ? update.chatId : message.chatId != null ? message.chatId : '');
                const messageId = String(update.id != null ? update.id : message.id != null ? message.id : '');
                if (!chatId || !messageId) return;
                const active = historyActiveChatId();
                if (!historyIsPrivate(chatId) && active !== chatId) return;
                const key = historyKey(chatId, messageId);
                let previous = historyTracked.get(key);
                if (!previous && update.isFromNew !== true && active === chatId) previous = historyDomSnapshot(chatId, messageId);
                const current = { chatId, messageId, text: historyMessageText(message), timestamp: Date.now() };
                historyRemember(current);
                historyEmit({
                    kind: update.isFromNew === true ? 'new' : 'edit',
                    chatId,
                    messageId,
                    text: current.text,
                    oldText: previous ? String(previous.text || '') : null,
                    timestamp: current.timestamp
                });
            }
            function historyScrubState(value) {
                if (!value || !value.messages || !value.messages.byChatId || !historyDeletedByChat.size) return value;
                let copy;
                try { copy = structuredClone(value); } catch (_) { return value; }
                let changed = false;
                historyDeletedByChat.forEach((ids, chatId) => {
                    const bucket = copy.messages && copy.messages.byChatId && copy.messages.byChatId[chatId];
                    if (!bucket) return;
                    ids.forEach((mid) => {
                        if (bucket.byId && Object.prototype.hasOwnProperty.call(bucket.byId, mid)) {
                            delete bucket.byId[mid];
                            changed = true;
                        }
                        if (bucket.ephemeralById && Object.prototype.hasOwnProperty.call(bucket.ephemeralById, mid)) {
                            delete bucket.ephemeralById[mid];
                            changed = true;
                        }
                    });
                    Object.values(bucket.threadsById || {}).forEach((thread) => {
                        if (!thread) return;
                        const local = thread.localState || {};
                        ['listedIds','lastViewportIds','pinnedIds'].forEach((name) => {
                            if (!Array.isArray(local[name])) return;
                            const next = local[name].filter((id) => !ids.has(String(id)));
                            if (next.length !== local[name].length) {
                                local[name] = next;
                                changed = true;
                            }
                        });
                        if (thread.threadInfo && ids.has(String(thread.threadInfo.lastMessageId))) {
                            thread.threadInfo.lastMessageId = undefined;
                            changed = true;
                        }
                    });
                });
                return changed ? copy : value;
            }
            function historyScrubPersisted() {
                if (!historyConfig || historyConfig.showDeleted !== true || !historyDeletedByChat.size) return;
                try {
                    const req = indexedDB.open('tt-data');
                    req.onsuccess = function() {
                        const db = req.result;
                        let tx;
                        try { tx = db.transaction('store', 'readwrite'); } catch (_) { try { db.close(); } catch (_) {} return; }
                        const cursor = tx.objectStore('store').openCursor();
                        cursor.onsuccess = function() {
                            const c = cursor.result;
                            if (!c) return;
                            if (/^tt-global-state(?:_\d+)?$/.test(String(c.key || ''))) {
                                const next = historyScrubState(c.value);
                                if (next !== c.value) {
                                    try { c.update(next); } catch (_) {}
                                }
                            }
                            c.continue();
                        };
                        tx.oncomplete = tx.onerror = function() { try { db.close(); } catch (_) {} };
                    };
                } catch (_) {}
            }
            function historyMarkDeleted(item) {
                if (!item) return;
                let set = historyDeletedByChat.get(String(item.chatId));
                if (!set) historyDeletedByChat.set(String(item.chatId), set = new Set());
                set.add(String(item.messageId));
            }
            function historyProtectDelete(update) {
                if (!historyConfig || historyConfig.showDeleted !== true || !update || !Array.isArray(update.ids)) return true;
                const active = historyActiveChatId();
                const explicitChat = update.chatId != null ? String(update.chatId) : '';
                const protectedItems = [];
                const remaining = [];
                update.ids.forEach((rawId) => {
                    const messageId = String(rawId);
                    let item = null;
                    if (explicitChat) {
                        const key = historyKey(explicitChat, messageId);
                        item = historyTracked.get(key) || null;
                        if (!item && active === explicitChat) item = historyDomSnapshot(explicitChat, messageId);
                        if (item && !historyIsPrivate(explicitChat) && active !== explicitChat) item = null;
                    } else {
                        const key = historyByMessageId.get(messageId);
                        item = key ? historyTracked.get(key) || null : null;
                        if (item && !historyIsPrivate(item.chatId) && active !== item.chatId) item = null;
                        if (!item && active && !historyIsPrivate(active)) item = historyDomSnapshot(active, messageId);
                    }
                    if (!item) {
                        remaining.push(rawId);
                        return;
                    }
                    historyRemember(item);
                    historyMarkDeleted(item);
                    protectedItems.push({ chatId: String(item.chatId), messageId, text: String(item.text || ''), timestamp: Date.now() });
                });
                if (protectedItems.length) {
                    historyEmit({ kind: 'delete', items: protectedItems, timestamp: Date.now() });
                    queueMicrotask(historyScrubPersisted);
                }
                update.ids = remaining;
                return remaining.length > 0;
            }
            function historyHandleWorkerMessage(event) {
                if (!historyEnabled) return;
                const payloads = event && event.data && event.data.payloads;
                if (!Array.isArray(payloads)) return;
                payloads.forEach((payload) => {
                    if (!payload || payload.type !== 'updates' || !Array.isArray(payload.updates)) return;
                    const kept = [];
                    payload.updates.forEach((update) => {
                        if (!update || typeof update !== 'object') {
                            kept.push(update);
                            return;
                        }
                        if (update['@type'] === 'updateMessage') historyTrackMessage(update);
                        if (update['@type'] === 'deleteMessages' && !historyProtectDelete(update)) return;
                        kept.push(update);
                    });
                    payload.updates = kept;
                });
            }
            if (historyConfig && historyConfig.showDeleted === true && window.IDBObjectStore && !window.__twdHistoryIdbPut) {
                try {
                    const nativePut = IDBObjectStore.prototype.put;
                    const wrappedPut = function(value, key) {
                        if (/^tt-global-state(?:_\d+)?$/.test(String(key || ''))) value = historyScrubState(value);
                        return nativePut.call(this, value, key);
                    };
                    Object.defineProperty(window, '__twdHistoryIdbPut', { value: wrappedPut });
                    IDBObjectStore.prototype.put = wrappedPut;
                } catch (_) {}
            }
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
                        try {
                            this.addEventListener('message', function(event) {
                                feedHandleWorkerMessage(event);
                                historyHandleWorkerMessage(event);
                            });
                        } catch (_) {}
                        if (tagged) { proxyWorkers.add(this); try { this.postMessage({ __twdProxyConfig: window.__twdProxyState }); } catch (_) {} }
                    }
                };
                Object.defineProperty(window, '__twdNativeWorker', { value: NativeWorker });
            }
            try {
                if (!window.__twdProxyChannel) window.__twdProxyChannel = new BroadcastChannel('__twd_proxy_v1');
                window.__twdProxyChannel.postMessage(initial);
            } catch (_) {}
        }, args: [_proxyBootstrap, _historyBootstrap, _feedBootstrap],
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
    'check_update_manual','skip_version','download_update','get_addons','delete_addon','toggle_addon','apply_addons','apply_features',
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