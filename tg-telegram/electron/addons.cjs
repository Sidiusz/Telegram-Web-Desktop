'use strict';
const fs   = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const AdmZip = require('adm-zip');
const Store  = require('electron-store').default;

const addonStore = new Store({ name: 'addon-states' });

// ── Папки ─────────────────────────────────────────────────────────────────────

// Встроенные аддоны — внутри пакета, рядом с этим файлом
function embeddedAddonsDir() {
    return path.join(__dirname, 'embedded_addons');
}

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

// Группы с дефолтным аддоном: пока пользователь явно не выбрал другой вариант в
// группе и явно не отключил дефолт — дефолтный аддон включён «из коробки».
const GROUP_DEFAULTS = { desktop_like_chat: 'embedded:desktop_like_standart.js' };
const GROUP_MEMBERS  = { desktop_like_chat: ['embedded:desktop_like_standart.js', 'embedded:desktop_like_wide.js'] };

function isEnabled(addonKey, group) {
    const disabled = addonStore.get('disabled_addons', []);
    const enabled  = addonStore.get('enabled_addons', []);
    // Явно выключен — выключен
    if (disabled.includes(addonKey)) return false;
    // Явно включён — включён
    if (enabled.includes(addonKey)) return true;
    // Аддоны с группой (взаимоисключающие) — по умолчанию выключены, КРОМЕ дефолта
    // группы: он включён, пока в группе явно не выбран ДРУГОЙ аддон (явное отключение
    // самого дефолта уже отсечено проверкой disabled выше).
    if (group) {
        const def = GROUP_DEFAULTS[group];
        if (def && addonKey === def) {
            const members = GROUP_MEMBERS[group] || [];
            const anotherEnabled = members.some(m => m !== def && enabled.includes(m));
            if (!anotherEnabled) return true;
        }
        return false;
    }
    // Остальные — по умолчанию включены (например hide_ads)
    return true;
}

function toggleAddon(addonKey, enabled) {
    let disabled = addonStore.get('disabled_addons', []);
    let explicitlyEnabled = addonStore.get('enabled_addons', []);
    if (enabled) {
        disabled = disabled.filter(k => k !== addonKey);
        if (!explicitlyEnabled.includes(addonKey)) explicitlyEnabled.push(addonKey);
    } else {
        if (!disabled.includes(addonKey)) disabled.push(addonKey);
        explicitlyEnabled = explicitlyEnabled.filter(k => k !== addonKey);
    }
    addonStore.set('disabled_addons', disabled);
    addonStore.set('enabled_addons', explicitlyEnabled);
}

// ── Список аддонов ────────────────────────────────────────────────────────────

function readAddonsFromDir(dir, embedded) {
    const result = [];
    try {
        for (const entry of fs.readdirSync(dir)) {
            const ext = path.extname(entry).toLowerCase().slice(1);
            if (ext !== 'js' && ext !== 'crx') continue;
            const addonKey = (embedded ? 'embedded:' : 'user:') + entry;
            let version = null;
            let displayName = entry;
            let group = null;
            try {
                if (ext === 'js') {
                    const content = fs.readFileSync(path.join(dir, entry), 'utf8');
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
                embedded,
                key:         addonKey,
                enabled:     isEnabled(addonKey, group),
            });
        }
    } catch (e) {}
    return result;
}

function getAddons() {
    const embedded = readAddonsFromDir(embeddedAddonsDir(), true);
    const user     = readAddonsFromDir(userAddonsDir(),     false);
    return [...embedded, ...user];
}

// ── Удаление (только пользовательские) ───────────────────────────────────────

function deleteAddon(name) {
    try { fs.unlinkSync(path.join(userAddonsDir(), name)); } catch (e) {}
    // Чистим состояние: выкидываем ключ из ОБОИХ списков (не включаем заново —
    // иначе в enabled_addons копится мусор для уже удалённых файлов).
    const key = 'user:' + name;
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
        if (data.length < 16) return null;
        const magic = data.slice(0, 4).toString('ascii');
        if (magic !== 'Cr24') return null;
        const headerSize = data.readUInt32LE(8);
        const zipStart   = 12 + headerSize;
        if (zipStart >= data.length) return null;
        const zip = new AdmZip(data.slice(zipStart));
        const manifestEntry = zip.getEntry('manifest.json');
        if (!manifestEntry) return null;
        const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
        const scripts = [];
        if (Array.isArray(manifest.content_scripts)) {
            for (const cs of manifest.content_scripts) {
                if (Array.isArray(cs.js)) {
                    for (const jsFile of cs.js) {
                        const entry = zip.getEntry(jsFile);
                        if (entry) scripts.push(entry.getData().toString('utf8'));
                    }
                }
            }
        }
        return scripts;
    } catch (e) { return null; }
}

// ── Загрузка скриптов (только enabled) ───────────────────────────────────────

function loadScriptsFromDir(dir, embedded) {
    const scripts = [];
    try {
        for (const entry of fs.readdirSync(dir)) {
            const ext      = path.extname(entry).toLowerCase().slice(1);
            if (ext !== 'js' && ext !== 'crx') continue;
            const addonKey = (embedded ? 'embedded:' : 'user:') + entry;
            const fullPath = path.join(dir, entry);

            if (ext === 'js') {
                let content;
                try { content = fs.readFileSync(fullPath, 'utf8'); } catch (e) { continue; }
                // Группу читаем здесь же. Без неё isEnabled считает grouped-аддоны
                // включёнными по умолчанию и инжектит ВСЕ из группы, хотя в UI
                // выбран «Выкл» (баг на свежей установке, до первого выбора).
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
    return [
        ...loadScriptsFromDir(embeddedAddonsDir(), true),
        ...loadScriptsFromDir(userAddonsDir(),     false),
    ];
}

module.exports = {
    addonsDir, userAddonsDir, embeddedAddonsDir,
    getAddons, deleteAddon, openAddonsFolder,
    loadAddonScripts, toggleAddon,
};