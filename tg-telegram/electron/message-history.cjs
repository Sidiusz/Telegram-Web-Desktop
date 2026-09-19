'use strict';

const Store = require('electron-store').default;

const store = new Store({ name: 'message-history' });

const MAX_RECORDS = 3000;
const MAX_EDITS = 20;
const MAX_TEXT = 20000;
const MAX_HTML = 65536;
const MAX_BATCH = 300;

function cleanId(v) {
    const s = String(v == null ? '' : v).trim();
    return s && s.length <= 128 ? s : null;
}

function cleanText(v, max) {
    const s = String(v == null ? '' : v);
    return s.length > max ? s.slice(0, max) : s;
}

function cleanSnapshot(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const chatId = cleanId(raw.chatId);
    const messageId = cleanId(raw.messageId);
    if (!chatId || !messageId) return null;
    const ts = Number(raw.timestamp);
    return {
        chatId,
        messageId,
        text: cleanText(raw.text, MAX_TEXT),
        html: cleanText(raw.html, MAX_HTML),
        own: raw.own === true,
        sender: cleanText(raw.sender, 512),
        timeText: cleanText(raw.timeText, 128),
        timestamp: Number.isFinite(ts) ? Math.max(0, Math.floor(ts)) : Date.now(),
    };
}

function loadRecords() {
    const records = store.get('records', {});
    return records && typeof records === 'object' && !Array.isArray(records) ? records : {};
}

function trimRecords(records) {
    const keys = Object.keys(records);
    if (keys.length <= MAX_RECORDS) return;
    keys.sort((a, b) => {
        const aa = records[a] && Number(records[a].updatedAt || records[a].timestamp || 0);
        const bb = records[b] && Number(records[b].updatedAt || records[b].timestamp || 0);
        return aa - bb;
    });
    for (let i = 0; i < keys.length - MAX_RECORDS; i++) delete records[keys[i]];
}

function syncSnapshots(items, trackEdits) {
    if (!Array.isArray(items)) return { ok: false, changed: 0 };
    const records = loadRecords();
    let changed = 0;
    for (const raw of items.slice(0, MAX_BATCH)) {
        const snap = cleanSnapshot(raw);
        if (!snap) continue;
        const key = snap.chatId + ':' + snap.messageId;
        const prev = records[key];
        if (!prev) {
            records[key] = Object.assign({}, snap, {
                edits: [],
                deleted: false,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            changed++;
            continue;
        }

        const textChanged = snap.text !== String(prev.text || '');
        const htmlChanged = snap.html !== String(prev.html || '');
        if (textChanged && trackEdits === true) {
            const edits = Array.isArray(prev.edits) ? prev.edits.slice(-MAX_EDITS + 1) : [];
            const last = edits[edits.length - 1];
            const old = {
                text: cleanText(prev.text, MAX_TEXT),
                html: cleanText(prev.html, MAX_HTML),
                timestamp: Date.now(),
            };
            if (!last || last.text !== old.text || last.html !== old.html) edits.push(old);
            prev.edits = edits;
        }
        if (textChanged || htmlChanged) {
            const wasDeleted = prev.deleted === true;
            const deletedAt = prev.deletedAt;
            Object.assign(prev, snap);
            if (wasDeleted) {
                prev.deleted = true;
                prev.deletedAt = deletedAt || Date.now();
            }
            prev.updatedAt = Date.now();
            changed++;
        } else {
            // Metadata can become available after the first render.
            prev.sender = snap.sender || prev.sender || '';
            prev.timeText = snap.timeText || prev.timeText || '';
            prev.own = snap.own;
            prev.timestamp = snap.timestamp || prev.timestamp;
        }
    }
    if (changed) {
        trimRecords(records);
        store.set('records', records);
    }
    return { ok: true, changed };
}

function markDeleted(items) {
    if (!Array.isArray(items)) return { ok: false, changed: 0 };
    const records = loadRecords();
    let changed = 0;
    for (const raw of items.slice(0, MAX_BATCH)) {
        const chatId = cleanId(raw && raw.chatId);
        const messageId = cleanId(raw && raw.messageId);
        if (!chatId || !messageId) continue;
        const key = chatId + ':' + messageId;
        const rec = records[key];
        if (!rec || rec.deleted) continue;
        rec.deleted = true;
        rec.deletedAt = Date.now();
        rec.updatedAt = Date.now();
        changed++;
    }
    if (changed) {
        trimRecords(records);
        store.set('records', records);
    }
    return { ok: true, changed };
}

function getChatRecords(chatIdRaw) {
    const chatId = cleanId(chatIdRaw);
    if (!chatId) return [];
    const records = loadRecords();
    return Object.values(records)
        .filter(r => r && r.chatId === chatId && (r.deleted || (Array.isArray(r.edits) && r.edits.length)))
        .sort((a, b) => {
            const aa = Number(a.messageId);
            const bb = Number(b.messageId);
            if (Number.isFinite(aa) && Number.isFinite(bb) && aa !== bb) return aa - bb;
            return Number(a.timestamp || 0) - Number(b.timestamp || 0);
        })
        .slice(-1000)
        .map(r => ({
            chatId: r.chatId,
            messageId: r.messageId,
            text: r.text || '',
            html: r.html || '',
            own: r.own === true,
            sender: r.sender || '',
            timeText: r.timeText || '',
            timestamp: Number(r.timestamp || 0),
            deleted: r.deleted === true,
            deletedAt: Number(r.deletedAt || 0),
            edits: Array.isArray(r.edits) ? r.edits.slice(-MAX_EDITS) : [],
        }));
}

function clearHistory() {
    store.delete('records');
    return { ok: true };
}

module.exports = { syncSnapshots, markDeleted, getChatRecords, clearHistory };
