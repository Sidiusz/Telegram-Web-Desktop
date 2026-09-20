'use strict';
const { contextBridge, ipcRenderer } = require('electron');

let _proxyBootstrap = { active: false, domains: [], revision: 0 };
let _historyBootstrap = { showDeleted: false, showDisappearing: false, saveDeleted: false, saveDisappearing: false, editHistory: false, scope: 'client' };
let _privacyBootstrap = {
    noReadReceipts: false, noTyping: false,
    noReadForceOn: [], noReadForceOff: [], noTypingForceOn: [], noTypingForceOff: [],
};
try { const boot = ipcRenderer.sendSync('get_proxy_bootstrap'); if (boot && typeof boot === 'object') _proxyBootstrap = boot; } catch (_) {}
try { const boot = ipcRenderer.sendSync('get_history_bootstrap'); if (boot && typeof boot === 'object') _historyBootstrap = boot; } catch (_) {}
try { const boot = ipcRenderer.sendSync('get_privacy_bootstrap'); if (boot && typeof boot === 'object') _privacyBootstrap = boot; } catch (_) {}

const _proxyChannelBytes = new Uint8Array(16);
crypto.getRandomValues(_proxyChannelBytes);
const _proxyChannelName = '__twd_proxy_' + Array.from(_proxyChannelBytes, b => b.toString(16).padStart(2, '0')).join('');
let _proxyChannel = null;
try {
    _proxyChannel = new BroadcastChannel(_proxyChannelName);
    _proxyChannel.onmessage = (event) => {
        const data = event && event.data;
        if (data && data.__twdProxyHello === true) {
            try { _proxyChannel.postMessage({ __twdProxyConfig: _proxyBootstrap, __twdPrivacyConfig: _privacyBootstrap }); } catch (_) {}
        }
    };
} catch (_) {}

function publishProxyState(payload) {
    _proxyBootstrap = payload && typeof payload === 'object' ? payload : _proxyBootstrap;
    try {
        if (_proxyChannel) _proxyChannel.postMessage({ __twdProxyConfig: _proxyBootstrap });
    } catch (_) {}
}
ipcRenderer.on('proxy-state-changed', (_e, payload) => publishProxyState(payload));
function publishPrivacyState(payload) {
    _privacyBootstrap = payload && typeof payload === 'object' ? payload : _privacyBootstrap;
    try {
        if (_proxyChannel) _proxyChannel.postMessage({ __twdPrivacyConfig: _privacyBootstrap });
    } catch (_) {}
    try {
        contextBridge.executeInMainWorld({
            func: state => {
                try { window.dispatchEvent(new CustomEvent('__twd_privacy_config', { detail: state })); } catch (_) {}
            },
            args: [{
                noReadReceipts: _privacyBootstrap.noReadReceipts === true,
                noTyping: _privacyBootstrap.noTyping === true,
                noReadForceOn: _privacyBootstrap.noReadForceOn || [],
                noReadForceOff: _privacyBootstrap.noReadForceOff || [],
                noTypingForceOn: _privacyBootstrap.noTypingForceOn || [],
                noTypingForceOff: _privacyBootstrap.noTypingForceOff || [],
            }],
        });
    } catch (_) {}
}
ipcRenderer.on('privacy-state-changed', (_e, payload) => publishPrivacyState(payload));

try {
    contextBridge.executeInMainWorld({
        func: (proxyChannelName, historyConfig) => {
            const historyEnabled = true;
            window.addEventListener('__twd_history_config', e => {
                historyConfig = Object.assign({}, historyConfig || {}, e.detail || {});
            });
            const historyTracked = new Map();
            const historyByMessageId = new Map();
            const historyDeletedByChat = new Map();
            // A unique query per renderer boot prevents Chromium/Telegram's service worker
            // from reusing an older already-patched transport worker after an app update.
            const proxyWorkerNonce = Date.now().toString(36) + Math.random().toString(36).slice(2);
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
            function historyIsEphemeral(message) {
                try {
                    return Number(message && message.ttl) > 0 || Number(message && message.ttlExpiresIn) > 0 || !!(message && message.selfDestructType);
                } catch (_) { return false; }
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
                if (!historyEnabled || !update || (update['@type'] !== 'newMessage' && update['@type'] !== 'updateMessage')) return;
                const message = update.message;
                if (!message || !message.content) return;
                const chatId = String(update.chatId != null ? update.chatId : message.chatId != null ? message.chatId : '');
                const messageId = String(update.id != null ? update.id : message.id != null ? message.id : '');
                if (!chatId || !messageId || !historyIsPrivate(chatId)) return;
                const active = historyActiveChatId();
                const key = historyKey(chatId, messageId);
                let previous = historyTracked.get(key);
                if (!previous && update['@type'] === 'updateMessage' && update.isFromNew !== true && active === chatId) previous = historyDomSnapshot(chatId, messageId);
                const current = { chatId, messageId, text: historyMessageText(message), ephemeral: historyIsEphemeral(message), outgoing: message.isOutgoing === true || message.is_outgoing === true, timestamp: Date.now() };
                historyRemember(current);
                historyEmit({
                    kind: (update['@type'] === 'newMessage' || update.isFromNew === true) ? 'new' : 'edit',
                    chatId,
                    messageId,
                    text: current.text,
                    oldText: previous ? String(previous.text || '') : null,
                    ephemeral: current.ephemeral === true,
                    outgoing: current.outgoing === true,
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
                if (!historyConfig || (!historyConfig.showDeleted && !historyConfig.showDisappearing) || !historyDeletedByChat.size) return;
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
                if (!historyConfig || !update || !Array.isArray(update.ids)) return true;
                const active = historyActiveChatId();
                const explicitChat = update.chatId != null ? String(update.chatId) : '';
                if (explicitChat && !historyIsPrivate(explicitChat)) return true;
                const captured = [];
                const remaining = [];
                let blockedAny = false;
                update.ids.forEach((rawId) => {
                    const messageId = String(rawId);
                    let item = null;
                    if (explicitChat) {
                        const key = historyKey(explicitChat, messageId);
                        item = historyTracked.get(key) || null;
                        if (!item && active === explicitChat) item = historyDomSnapshot(explicitChat, messageId);
                    } else {
                        const key = historyByMessageId.get(messageId);
                        item = key ? historyTracked.get(key) || null : null;
                        if (!item && active) item = historyDomSnapshot(active, messageId);
                    }
                    if (!item || !historyIsPrivate(item.chatId)) {
                        remaining.push(rawId);
                        return;
                    }
                    const ephemeral = item.ephemeral === true;
                    const show = ephemeral ? historyConfig.showDisappearing === true : historyConfig.showDeleted === true;
                    const block = show && active === String(item.chatId);
                    historyRemember(item);
                    if (block) {
                        blockedAny = true;
                        historyMarkDeleted(item);
                    } else {
                        remaining.push(rawId);
                    }
                    captured.push({ chatId: String(item.chatId), messageId, text: String(item.text || ''), ephemeral, outgoing: item.outgoing === true, timestamp: Date.now() });
                });
                if (captured.length) {
                    historyEmit({ kind: 'delete', items: captured, timestamp: Date.now() });
                    if (blockedAny) queueMicrotask(historyScrubPersisted);
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
                        if (update['@type'] === 'newMessage' || update['@type'] === 'updateMessage') historyTrackMessage(update);
                        if (update['@type'] === 'deleteMessages' && !historyProtectDelete(update)) return;
                        kept.push(update);
                    });
                    payload.updates = kept;
                });
            }
            if (window.IDBObjectStore && !window.__twdHistoryIdbPut) {
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
                                u.searchParams.set('__twd_proxy_channel', proxyChannelName);
                                target = u.toString(); tagged = true;
                            }
                        } catch (_) {}
                        super(target, options);
                        try { this.addEventListener('message', historyHandleWorkerMessage); } catch (_) {}
                    }
                };
                Object.defineProperty(window, '__twdNativeWorker', { value: NativeWorker });
            }
        }, args: [_proxyChannelName, _historyBootstrap],
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
    'get_settings','get_app_info','get_window_state','get_proxy_status','set_proxy_mode','reset_proxy_auto','reconnect_proxy','save_proxy_options',
    'refresh_proxy_domains','test_proxy_connectivity','show_notification','preview_notification','save_settings','toggle_devtools','open_url','open_default_apps',
    'open_folder_dialog','get_downloads','bind_download','forget_download','delete_download','cancel_download',
    'open_downloads_folder','open_download_folder','open_download_file','clear_cache','fetch_changelog','fetch_changelog_structured',
    'check_update_manual','skip_version','download_update','get_addons','delete_addon','toggle_addon','apply_addons','apply_features',
    'show_image_context_menu','open_addons_folder','report_lang','set_tray_image','get_tray_base',
    'set_notifications_count','privacy_allow_read_once'
]);
function twdInvoke(cmd, args) {
    if (!TWD_ALLOWED_INVOKE.has(cmd)) return Promise.reject(new Error('IPC command is not allowed'));
    if (cmd === 'privacy_allow_read_once') {
        let peerId = '';
        try {
            const raw = String(args && args.peerId || '');
            if (/^-?\d{1,24}$/.test(raw)) peerId = raw;
        } catch (_) {}
        try {
            if (_proxyChannel) _proxyChannel.postMessage({ __twdPrivacyAllowReadOnce: peerId });
        } catch (_) {}
        return Promise.resolve({ ok: true });
    }
    return ipcRenderer.invoke(cmd, args || {});
}

async function twdSaveBlob(blobUrl, filename) {
    const url = String(blobUrl || '');
    if (!url.startsWith('blob:')) return { error: 'invalid-url' };

    let response;
    try {
        response = await fetch(url);
    } catch (e) {
        return { error: e && e.message ? e.message : 'blob-fetch-failed' };
    }
    if (!response || !response.ok || !response.body) return { error: 'blob-fetch-failed' };

    const totalHeader = Number(response.headers.get('content-length'));
    const total = Number.isSafeInteger(totalHeader) && totalHeader >= 0 ? totalHeader : 0;
    const begin = await ipcRenderer.invoke('begin_blob_save', {
        filename: String(filename || 'file'),
        total,
    });
    if (!begin || begin.error || !begin.streamId) return begin || { error: 'stream-start-failed' };

    const streamId = String(begin.streamId);
    const reader = response.body.getReader();
    const MAX_IPC_CHUNK = 1024 * 1024;

    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            const view = next.value;
            for (let offset = 0; offset < view.byteLength; offset += MAX_IPC_CHUNK) {
                const end = Math.min(view.byteLength, offset + MAX_IPC_CHUNK);
                const chunk = view.buffer.slice(view.byteOffset + offset, view.byteOffset + end);
                const result = await ipcRenderer.invoke('append_blob_chunk', { streamId, chunk });
                if (!result || result.error) throw new Error(result && result.error || 'stream-write-failed');
            }
        }
        return await ipcRenderer.invoke('finish_blob_save', { streamId });
    } catch (e) {
        try { await ipcRenderer.invoke('abort_blob_save', { streamId }); } catch (_) {}
        return { error: e && e.message ? e.message : 'blob-stream-failed' };
    } finally {
        try { reader.releaseLock(); } catch (_) {}
    }
}

contextBridge.exposeInMainWorld('tgBridge', {
    invoke: twdInvoke,
    saveBlob: twdSaveBlob,
    onDownloadEvent: (cb) => ipcRenderer.on('download-event', (_e, data) => cb(data)),

    onNotification: (cb) => ipcRenderer.on('show-notification', (_e, data) => cb(data)),

    onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, data) => cb(data)),
    onUpdateProgress: (cb) => ipcRenderer.on('update-download-progress', (_e, data) => cb(data)),
    onUpdateDone: (cb) => ipcRenderer.on('update-download-done', (_e, data) => cb(data)),
});