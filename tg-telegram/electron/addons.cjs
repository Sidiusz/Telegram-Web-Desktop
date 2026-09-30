'use strict';
const fs   = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const AdmZip = require('adm-zip');
const Store  = require('electron-store').default;

const addonStore = new Store({ name: 'addon-states' });

const MAX_JS_BYTES = 8 * 1024 * 1024;
const MAX_CRX_BYTES = 64 * 1024 * 1024;
const MAX_CRX_MANIFEST_BYTES = 1024 * 1024;
const MAX_CRX_SCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_CRX_TOTAL_SCRIPT_BYTES = 16 * 1024 * 1024;
const MAX_CRX_SCRIPTS = 64;

function addonFileWithinLimit(filePath, ext) {
    try {
        const st = fs.statSync(filePath);
        if (!st.isFile()) return false;
        return st.size <= (ext === 'crx' ? MAX_CRX_BYTES : MAX_JS_BYTES);
    } catch (_) { return false; }
}

// ── Папки ─────────────────────────────────────────────────────────────────────

// Пользовательские аддоны — в userData
function userAddonsDir() {
    const dir = path.join(app.getPath('userData'), 'addons');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// Обратная совместимость — старый код звал addonsDir()
function addonsDir() { return userAddonsDir(); }

// ── Парсинг метаданных из JS-файла ───────────────────────────────────────────

function parseMeta(content) {
    const get = (tag) => {
        const m = content.match(new RegExp('@' + tag + '\\s+(.+)'));
        return m ? m[1].trim() : null;
    };
    return {
        name:        get('name'),
        version:     get('version'),
        description: get('description'),
        group:       get('group'),
    };
}

// ── Состояние включён/выключен ────────────────────────────────────────────────

function isEnabled(addonKey, group) {
    const disabled = addonStore.get('disabled_addons', []);
    const enabled  = addonStore.get('enabled_addons', []);
    if (disabled.includes(addonKey)) return false;
    if (enabled.includes(addonKey)) return true;
    // User-authored mutually-exclusive groups are opt-in; ordinary add-ons remain
    // enabled by default for backward compatibility with the existing add-on API.
    return group ? false : true;
}

function normalizeAddonKey(addonKey) {
    const raw = String(addonKey || '');
    const m = /^user:([a-zA-Z0-9._-]+\.(?:js|crx))$/i.exec(raw);
    if (!m) return null;
    const name = m[1];
    const fullPath = path.join(userAddonsDir(), name);
    const ext = path.extname(name).toLowerCase().slice(1);
    if (!addonFileWithinLimit(fullPath, ext)) return null;
    return 'user:' + name;
}

function toggleAddon(addonKey, enabled) {
    const safeKey = normalizeAddonKey(addonKey);
    if (!safeKey) return false;
    let disabled = addonStore.get('disabled_addons', []);
    let explicitlyEnabled = addonStore.get('enabled_addons', []);
    if (enabled) {
        disabled = disabled.filter(k => k !== safeKey);
        if (!explicitlyEnabled.includes(safeKey)) explicitlyEnabled.push(safeKey);
    } else {
        if (!disabled.includes(safeKey)) disabled.push(safeKey);
        explicitlyEnabled = explicitlyEnabled.filter(k => k !== safeKey);
    }
    addonStore.set('disabled_addons', disabled);
    addonStore.set('enabled_addons', explicitlyEnabled);
    return true;
}

// ── Список аддонов ────────────────────────────────────────────────────────────

function readAddonsFromDir(dir) {
    const result = [];
    try {
        for (const entry of fs.readdirSync(dir)) {
            const ext = path.extname(entry).toLowerCase().slice(1);
            if (ext !== 'js' && ext !== 'crx') continue;
            const fullPath = path.join(dir, entry);
            if (!addonFileWithinLimit(fullPath, ext)) continue;
            const addonKey = 'user:' + entry;
            let version = null;
            let displayName = entry;
            let group = null;
            try {
                if (ext === 'js') {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const meta = parseMeta(content);
                    if (meta.version)     version     = meta.version;
                    if (meta.name)        displayName = meta.name;
                    if (meta.group)       group       = meta.group;
                }
            } catch (e) {}
            result.push({
                name:        entry,
                display_name: displayName,
                addon_type:  ext,
                version,
                group,
                key:         addonKey,
                enabled:     isEnabled(addonKey, group),
            });
        }
    } catch (e) {}
    return result;
}

function getAddons() {
    return readAddonsFromDir(userAddonsDir());
}

// ── Удаление (только пользовательские) ───────────────────────────────────────

function deleteAddon(name) {
    const safe = path.basename(String(name || ''));
    if (!safe || safe === '.' || safe === '..') return;
    if (!/^[a-zA-Z0-9._-]+\.(js|crx)$/i.test(safe)) return;
    try { fs.unlinkSync(path.join(userAddonsDir(), safe)); } catch (e) {}
    // Чистим состояние: выкидываем ключ из ОБОИХ списков (не включаем заново —
    // иначе в enabled_addons копится мусор для уже удалённых файлов).
    const key = 'user:' + safe;
    addonStore.set('disabled_addons', addonStore.get('disabled_addons', []).filter(k => k !== key));
    addonStore.set('enabled_addons', addonStore.get('enabled_addons', []).filter(k => k !== key));
}

// ── Открыть папку ─────────────────────────────────────────────────────────────

function openAddonsFolder() {
    shell.openPath(userAddonsDir());
}

// ── Извлечение скриптов из CRX ────────────────────────────────────────────────

function extractCrxContentScripts(data) {
    try {
        if (!Buffer.isBuffer(data) || data.length < 16 || data.length > MAX_CRX_BYTES) return null;
        const magic = data.slice(0, 4).toString('ascii');
        if (magic !== 'Cr24') return null;
        const headerSize = data.readUInt32LE(8);
        const zipStart   = 12 + headerSize;
        if (headerSize > data.length - 12 || zipStart >= data.length) return null;
        const zip = new AdmZip(data.slice(zipStart));
        const manifestEntry = zip.getEntry('manifest.json');
        if (!manifestEntry || !manifestEntry.header || manifestEntry.header.size > MAX_CRX_MANIFEST_BYTES) return null;
        const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
        const scripts = [];
        let totalBytes = 0;
        if (Array.isArray(manifest.content_scripts)) {
            for (const cs of manifest.content_scripts) {
                if (!Array.isArray(cs.js)) continue;
                for (const jsFileRaw of cs.js) {
                    if (scripts.length >= MAX_CRX_SCRIPTS) return null;
                    const jsFile = String(jsFileRaw || '');
                    if (!jsFile || jsFile.length > 1024) return null;
                    const entry = zip.getEntry(jsFile);
                    if (!entry || !entry.header) continue;
                    const size = Number(entry.header.size) || 0;
                    if (size < 0 || size > MAX_CRX_SCRIPT_BYTES || totalBytes + size > MAX_CRX_TOTAL_SCRIPT_BYTES) return null;
                    const content = entry.getData();
                    if (content.length > MAX_CRX_SCRIPT_BYTES || totalBytes + content.length > MAX_CRX_TOTAL_SCRIPT_BYTES) return null;
                    totalBytes += content.length;
                    scripts.push(content.toString('utf8'));
                }
            }
        }
        return scripts;
    } catch (e) { return null; }
}

// ── Загрузка скриптов (только enabled) ───────────────────────────────────────

function loadScriptsFromDir(dir) {
    const scripts = [];
    try {
        for (const entry of fs.readdirSync(dir)) {
            const ext      = path.extname(entry).toLowerCase().slice(1);
            if (ext !== 'js' && ext !== 'crx') continue;
            const addonKey = 'user:' + entry;
            const fullPath = path.join(dir, entry);
            if (!addonFileWithinLimit(fullPath, ext)) continue;

            if (ext === 'js') {
                let content;
                try { content = fs.readFileSync(fullPath, 'utf8'); } catch (e) { continue; }
                // User add-ons may opt into a mutually-exclusive group via metadata.
                const group = parseMeta(content).group || null;
                if (!isEnabled(addonKey, group)) continue;
                scripts.push(content);
            } else if (ext === 'crx') {
                if (!isEnabled(addonKey)) continue;
                try {
                    const data      = fs.readFileSync(fullPath);
                    const extracted = extractCrxContentScripts(data);
                    if (extracted) scripts.push(...extracted);
                } catch (e) {}
            }
        }
    } catch (e) {}
    return scripts;
}

function loadAddonScripts() {
    return loadScriptsFromDir(userAddonsDir());
}

module.exports = {
    addonsDir, userAddonsDir,
    getAddons, deleteAddon, openAddonsFolder,
    loadAddonScripts, toggleAddon,
};
