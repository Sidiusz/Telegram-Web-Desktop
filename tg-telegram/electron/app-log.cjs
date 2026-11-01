'use strict';

// Packaged Windows builds have no console, so the main process log is mirrored to
// <userData>/logs/main.log and the recent proxy lines are kept for "Copy diagnostics".

const fs = require('fs');
const path = require('path');
const util = require('util');

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PROXY_LINES = 200;
const PROXY_LINE_RE = /\[TG-PROXY/;

let logDir = '';
let stream = null;
const proxyLines = [];

function stamp() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function rotate(file) {
    try {
        if (fs.statSync(file).size < MAX_FILE_BYTES) return;
        fs.renameSync(file, file.replace(/\.log$/, '.old.log'));
    } catch (_) {}
}

function record(level, args) {
    let text;
    try { text = util.format(...args); } catch (_) { return; }
    const line = `${stamp()} ${level} ${text}`;
    if (PROXY_LINE_RE.test(text)) {
        proxyLines.push(line);
        if (proxyLines.length > PROXY_LINES) proxyLines.splice(0, proxyLines.length - PROXY_LINES);
    }
    if (stream) {
        try { stream.write(line + '\n'); } catch (_) {}
    }
}

function installAppLog(dir) {
    if (logDir) return logDir;
    logDir = dir;
    try {
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'main.log');
        rotate(file);
        stream = fs.createWriteStream(file, { flags: 'a' });
        stream.on('error', () => { stream = null; });
    } catch (_) { stream = null; }
    for (const [method, level] of [['log', 'INFO'], ['info', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR']]) {
        const original = console[method].bind(console);
        console[method] = (...args) => {
            record(level, args);
            try { original(...args); } catch (_) {}
        };
    }
    record('INFO', [`[TWD-LOG] log started, ${process.platform} ${process.arch}, electron ${process.versions.electron}`]);
    return logDir;
}

function getLogDir() { return logDir; }
function getProxyLogLines() { return proxyLines.slice(); }

module.exports = { installAppLog, getLogDir, getProxyLogLines };
