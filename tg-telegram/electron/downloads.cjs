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

function deleteDownload(downloads, id) {
    const item = downloads.find(d => d.id === id);
    if (item && item.path) {
        try { fs.unlinkSync(item.path); } catch (e) {}
    }
    const updated = downloads.filter(d => d.id !== id);
    saveDownloads(updated);
    return updated;
}

module.exports = { loadDownloads, saveDownloads, deleteDownload };