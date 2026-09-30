'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notifBridge', {
    onAdd: (cb) => ipcRenderer.on('notif-add', (_e, data) => cb(data)),
    sendShape: (count) => ipcRenderer.send('notif-shape', { count }),
    sendEmpty: () => ipcRenderer.send('notif-empty'),
    sendAction: (action, peerId) => ipcRenderer.send('notif-action', { action, peerId }),
});
