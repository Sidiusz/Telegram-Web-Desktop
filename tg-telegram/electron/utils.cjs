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
    // Never silently fall back to an existing path: callers use this helper for
    // downloads and update installers, where an overwrite is worse than a failure.
    throw new Error('Unable to allocate a unique file name');
}

function sanitizeFilename(name) {
    let s = String(name || 'file').trim() || 'file';
    s = s.replace(/[\0-\x1F\/\\:*?"<>|]/g, '_');
    // Windows trims trailing dots/spaces and treats names such as CON, NUL, COM1,
    // etc. as device files even when an extension is present. Normalize those
    // before joining with the downloads directory.
    s = s.replace(/^\.+/, '').replace(/[. ]+$/, '');
    if (!s) s = 'file';
    const ext = path.extname(s);
    const stem = path.basename(s, ext);
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) s = '_' + s;
    if (s.length > 180) {
        const finalExt = path.extname(s);
        const base = path.basename(s, finalExt);
        s = base.slice(0, Math.max(1, 180 - finalExt.length)) + finalExt;
        s = s.replace(/[. ]+$/, '');
    }
    return s || 'file';
}

function sanitizePathForDownloads(dir, filename) {
    const safe = sanitizeFilename(filename);
    return uniquePath(path.join(dir, safe));
}

module.exports = { uniquePath, sanitizeFilename, sanitizePathForDownloads };
