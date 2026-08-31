'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Keep Telegram's media/upload pipelines alive when window is blurred/minimized.
// Document.hidden/visibilityState are overridden once at preload (document_start)
// and never redefined — window.cjs only flips the backing variable.
let _tgHidden = false;
let _tgHasFocus = true;
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
contextBridge.exposeInMainWorld('__tgHiddenCtrl', {
    setHidden: (v) => {
        const next = !!v;
        if (next === _tgHidden) return;
        _tgHidden = next;
        try { document.dispatchEvent(new Event('visibilitychange')); } catch (e) {}
        try { window.dispatchEvent(new Event(next ? 'blur' : 'focus')); } catch (e) {}
    },
    setHasFocus: (v) => { _tgHasFocus = !!v; },
});

contextBridge.exposeInMainWorld('tgBridge', {
    invoke: (cmd, args) => ipcRenderer.invoke(cmd, args || {}),
    onDownloadEvent: (cb) => ipcRenderer.on('download-event', (_e, data) => cb(data)),

    onNotification: (cb) => ipcRenderer.on('show-notification', (_e, data) => cb(data)),

    onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, data) => cb(data)),
    onUpdateProgress: (cb) => ipcRenderer.on('update-download-progress', (_e, data) => cb(data)),
    onUpdateDone: (cb) => ipcRenderer.on('update-download-done', (_e, data) => cb(data)),
});