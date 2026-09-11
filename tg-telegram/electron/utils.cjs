'use strict';

const fs = require('fs');
const path = require('path');

// Produce a filename that is safe on Windows, macOS and Linux. Keep only the
// basename so a value received from update metadata can never escape the
// download directory.
function sanitizeFilename(value) {
    if (value == null) return '';

    let name = path.basename(String(value).trim())
        .replace(/[\x00-\x1f\x80-\x9f]/g, '')
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/[. ]+$/g, '')
        .trim();

    if (!name || name === '.' || name === '..') return '';

    // Windows device names are reserved even when followed by an extension.
    const stem = name.split('.')[0].toUpperCase();
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) {
        name = '_' + name;
    }

    // Leave room for a possible " (n)" suffix added by uniquePath().
    if (name.length > 220) {
        const ext = path.extname(name);
        const base = path.basename(name, ext);
        name = base.slice(0, Math.max(1, 220 - ext.length)) + ext;
    }

    return name;
}

// Return a non-existing path without overwriting an existing download.
// Example: update.exe -> update (2).exe -> update (3).exe ...
function uniquePath(targetPath) {
    if (!fs.existsSync(targetPath)) return targetPath;

    const dir = path.dirname(targetPath);
    const ext = path.extname(targetPath);
    const base = path.basename(targetPath, ext);

    for (let i = 2; i < 10000; i += 1) {
        const candidate = path.join(dir, `${base} (${i})${ext}`);
        if (!fs.existsSync(candidate)) return candidate;
    }

    // Extremely unlikely fallback that still avoids overwriting anything.
    return path.join(dir, `${base} (${Date.now()})${ext}`);
}

module.exports = { sanitizeFilename, uniquePath };
