'use strict';
const fs = require('fs');
const path = require('path');

function uniquePath(p) {
    if (!fs.existsSync(p)) return p;
    const dir = path.dirname(p);
    const ext = path.extname(p);
    const base = path.basename(p, ext);
    for (let i = 1; i < 10000; i++) {
        const cand = path.join(dir, `${base} (${i})${ext}`);
        if (!fs.existsSync(cand)) return cand;
    }
    return p;
}

function sanitizeFilename(name) {
    let s = String(name || 'file').trim() || 'file';
    s = s.replace(/[\0-\x1F\/\\:*?"<>|]/g, '_');
    s = s.replace(/^\.+/, '').replace(/\.+$/, '');
    if (!s) s = 'file';
    if (s.length > 180) {
        const ext = path.extname(s);
        const base = path.basename(s, ext);
        s = base.slice(0, 180 - ext.length) + ext;
    }
    return s;
}

function sanitizePathForDownloads(dir, filename) {
    const safe = sanitizeFilename(filename);
    return uniquePath(path.join(dir, safe));
}

module.exports = { uniquePath, sanitizeFilename, sanitizePathForDownloads };
