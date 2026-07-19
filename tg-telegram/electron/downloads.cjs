'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function downloadsPath() {
    return path.join(app.getPath('userData'), 'downloads.json');
}

function loadDownloads() {
    try {
        const data = fs.readFileSync(downloadsPath(), 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

function saveDownloads(downloads) {
    try {
        fs.writeFileSync(downloadsPath(), JSON.stringify(downloads));
    } catch (e) {}
}

// Live DownloadItems by id — lets the renderer cancel an in-flight download.
const activeItems = new Map();

function trackActive(id, item) { activeItems.set(id, item); }
function untrackActive(id) { activeItems.delete(id); }
function cancelActive(id) {
    const item = activeItems.get(id);
    if (!item) return false;
    try { item.cancel(); return true; } catch (e) { return false; }
}

function deleteDownload(downloads, id) {
    const item = downloads.find(d => d.id === id);
    if (item && item.path) {
        try { fs.unlinkSync(item.path); } catch (e) {}
    }
    const updated = downloads.filter(d => d.id !== id);
    saveDownloads(updated);
    return updated;
}

module.exports = { loadDownloads, saveDownloads, deleteDownload, trackActive, untrackActive, cancelActive };