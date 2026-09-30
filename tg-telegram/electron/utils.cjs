'use strict';
const fs = require('fs');
const path = require('path');

// Paths of downloads still in flight: they do not exist on disk yet but must not be handed out twice.
const reservedPaths = new Set();
function pathKey(p) { return path.resolve(p).toLowerCase(); }
function isTaken(p) { return reservedPaths.has(pathKey(p)) || fs.existsSync(p); }
function reservePath(p) {
    const key = pathKey(p);
    reservedPaths.add(key);
    return () => reservedPaths.delete(key);
}

function uniquePath(p) {
    if (!isTaken(p)) return p;
    const dir = path.dirname(p);
    const ext = path.extname(p);
    const base = path.basename(p, ext);
    for (let i = 1; i < 10000; i++) {
        const cand = path.join(dir, `${base} (${i})${ext}`);
        if (!isTaken(cand)) return cand;
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
    // Windows maps "NUL.tar.gz" to the device too: check the part before the first dot.
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s.split('.')[0].trim())) s = '_' + s;
    if (s.length > 180) {
        const finalExt = path.extname(s);
        const base = path.basename(s, finalExt);
        s = base.slice(0, Math.max(1, 180 - finalExt.length)) + finalExt;
        s = s.replace(/[. ]+$/, '');
    }
    return s || 'file';
}

// Mark-of-the-Web so SmartScreen and Office Protected View treat saved Telegram files as downloaded.
function markFromInternet(file, hostUrl = 'https://web.telegram.org/') {
    if (process.platform !== 'win32') return false;
    try {
        fs.writeFileSync(file + ':Zone.Identifier', `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${hostUrl}\r\n`);
        return true;
    } catch (_) { return false; }
}

module.exports = { uniquePath, reservePath, sanitizeFilename, markFromInternet };
