'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tgBridge', {
    invoke: (cmd, args) => ipcRenderer.invoke(cmd, args || {}),
    onDownloadEvent: (cb) => ipcRenderer.on('download-event', (_e, data) => cb(data)),

    onNotification: (cb) => ipcRenderer.on('show-notification', (_e, data) => cb(data)),

    onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, data) => cb(data)),
    onUpdateProgress: (cb) => ipcRenderer.on('update-download-progress', (_e, data) => cb(data)),
    onUpdateDone: (cb) => ipcRenderer.on('update-download-done', (_e, data) => cb(data)),
});