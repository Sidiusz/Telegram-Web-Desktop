'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tgBridge', {
    invoke: (cmd, args) => ipcRenderer.invoke(cmd, args || {}),
    onDownloadEvent: (cb) => ipcRenderer.on('download-event', (_e, data) => cb(data)),
    // Уведомления теперь показываются прямо в окне приложения
    onNotification: (cb) => ipcRenderer.on('show-notification', (_e, data) => cb(data)),
    // Обновления
    onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, data) => cb(data)),
    onUpdateProgress: (cb) => ipcRenderer.on('update-download-progress', (_e, data) => cb(data)),
    onUpdateDone: (cb) => ipcRenderer.on('update-download-done', (_e, data) => cb(data)),
});

// Перехват window.Notification / Service Worker / Push живёт в notif-intercept.js
// (инъектится в dom-ready и в re-inject набор). Здесь дубль не нужен — он только
// перетирался и засорял захват nativeNotification в notif-intercept.
