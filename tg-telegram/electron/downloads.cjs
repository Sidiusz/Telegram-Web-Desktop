'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function downloadsPath() {
    return path.join(app.getPath('userData'), 'downloads.json');
}

const VALID_STATUSES = new Set(['downloading', 'completed', 'failed', 'cancelled']);

function normalizeDownloadRecord(raw, fromDisk) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = Number(raw.id);
    if (!Number.isInteger(id) || id <= 0 || id > Number.MAX_SAFE_INTEGER) return null;

    const filePath = typeof raw.path === 'string' && path.isAbsolute(raw.path) ? raw.path : '';
    const filename = String(raw.filename || (filePath ? path.basename(filePath) : '') || 'file').slice(0, 512);
    let status = VALID_STATUSES.has(raw.status) ? raw.status : 'failed';
    // Electron DownloadItem objects do not survive an app restart. A persisted
    // "downloading" entry is therefore stale, not an active transfer.
    if (fromDisk && status === 'downloading') status = 'failed';

    const out = {
        id,
        url: typeof raw.url === 'string' ? raw.url.slice(0, 8192) : '',
        filename,
        path: filePath,
        status,
    };
    const recv = Number(raw.recv);
    const total = Number(raw.total);
    if (Number.isSafeInteger(recv) && recv >= 0) out.recv = recv;
    if (Number.isSafeInteger(total) && total >= 0) out.total = total;
    const mid = String(raw.mid == null ? '' : raw.mid);
    const peerId = String(raw.peerId == null ? '' : raw.peerId);
    if (/^-?\d{1,32}$/.test(mid)) out.mid = mid;
    if (/^-?\d{1,32}$/.test(peerId)) out.peerId = peerId;
    return out;
}

function normalizeDownloads(downloads, fromDisk) {
    if (!Array.isArray(downloads)) return [];
    // A corrupted file must not create an unbounded renderer/main-process payload.
    return downloads.slice(-5000).map(d => normalizeDownloadRecord(d, fromDisk)).filter(Boolean);
}

function loadDownloads() {
    try {
        const data = fs.readFileSync(downloadsPath(), 'utf8');
        return normalizeDownloads(JSON.parse(data), true);
    } catch (e) {
        return [];
    }
}

function saveDownloads(downloads) {
    try {
        const p = downloadsPath();
        const tmp = p + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(normalizeDownloads(downloads, false)));
        fs.renameSync(tmp, p);
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