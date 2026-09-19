'use strict';
const Store = require('electron-store').default;
const { TextDecoder } = require('util');

const store = new Store({ name: 'settings' });
const legacyAddonStore = new Store({ name: 'addon-states' });

const _win1251Decoder = new TextDecoder('windows-1251');
const _utf8Decoder = new TextDecoder('utf-8', { fatal: true });
let _win1251Reverse = null;
function repairLegacyUtf8Mojibake(value) {
    if (typeof value !== 'string' || !value) return value;
    if (!_win1251Reverse) {
        _win1251Reverse = new Map();
        for (let i = 0; i < 256; i++) {
            const ch = _win1251Decoder.decode(Uint8Array.of(i));
            if (ch && !_win1251Reverse.has(ch)) _win1251Reverse.set(ch, i);
        }
    }
    const bytes = [];
    for (const ch of value) {
        const cp = ch.codePointAt(0);
        if (cp < 0x80) bytes.push(cp);
        else if (_win1251Reverse.has(ch)) bytes.push(_win1251Reverse.get(ch));
        else return value;
    }
    try {
        const repaired = _utf8Decoder.decode(Uint8Array.from(bytes));
        return repaired && repaired !== value ? repaired : value;
    } catch (_) {
        return value;
    }
}

const DEFAULTS = {
    save_path: null,
    minimize_to_tray: true,
    popup_notifications: true,

    notif_sound: true,
    notif_duration: 6,
    notif_volume: 0.8,

    notif_cat_private: true, 
    notif_cat_group: true,   
    notif_cat_channel: true, 
    notif_hide_text: false,  
    notif_hide_sender: false,
    whatsnew_shown_version: null,
    devtools_enabled: false,
    update_check_interval: '1h',
    skipped_version: null,
    appearance_message_layout: 'left',
    appearance_hide_ads: true,
    messages_show_deleted: false,
    messages_edit_history: false,
    feed_sources: [],
    proxy_mode: 'auto',
    proxy_auto_latched: false,
    proxy_domain_source: 'flowseal',
    proxy_custom_domains: [],
    proxy_pinned_domain: '',
    proxy_worker_enabled: false,
    proxy_worker_domains: [],
    proxy_auto_failures: 1,
    proxy_auto_window_sec: 12,
    proxy_web_fallback: true,
    proxy_web_fallback_latched: false,
    proxy_dc_ips: { 1: '149.154.175.50', 2: '149.154.167.51', 3: '149.154.175.100', 4: '149.154.167.91', 5: '149.154.171.5', 203: '91.105.192.100' },
};

function cloneDefault(value) {
    if (Array.isArray(value)) return value.slice();
    if (value && typeof value === 'object') return { ...value };
    return value;
}

function migrateLegacyBuiltinFeatures() {
    if (store.get('_builtin_features_migrated_131', false) === true) return;
    const disabled = legacyAddonStore.get('disabled_addons', []);
    const enabled = legacyAddonStore.get('enabled_addons', []);
    const standard = 'embedded:desktop_like_standart.js';
    const wide = 'embedded:desktop_like_wide.js';
    const ads = 'embedded:hide_ads.js';

    if (!store.has('appearance_message_layout')) {
        let layout = 'left';
        if (enabled.includes(wide) && !disabled.includes(wide)) layout = 'wide';
        else if (disabled.includes(standard) && !enabled.includes(standard)) layout = 'native';
        store.set('appearance_message_layout', layout);
    }
    if (!store.has('appearance_hide_ads')) {
        store.set('appearance_hide_ads', !disabled.includes(ads));
    }

    // Built-ins are no longer add-ons. Keep only actual user add-on state.
    legacyAddonStore.set('disabled_addons', disabled.filter(k => !String(k).startsWith('embedded:')));
    legacyAddonStore.set('enabled_addons', enabled.filter(k => !String(k).startsWith('embedded:')));
    store.set('_builtin_features_migrated_131', true);
}

function loadSettings() {
    migrateLegacyBuiltinFeatures();
    const out = {};
    for (const key of Object.keys(DEFAULTS)) {
        const fallback = DEFAULTS[key];
        const raw = store.get(key, fallback);
        if (raw === null || raw === undefined) {
            out[key] = cloneDefault(fallback);
            continue;
        }
        const normalized = normalizeSetting(key, raw);
        out[key] = normalized === INVALID ? cloneDefault(fallback) : normalized;
        if (key === 'save_path' && normalized !== INVALID && normalized !== raw) store.set(key, normalized);
    }
    return out;
}

const BOOL_KEYS = new Set([
    'minimize_to_tray','popup_notifications','notif_sound','notif_cat_private',
    'notif_cat_group','notif_cat_channel','notif_hide_text','notif_hide_sender',
    'devtools_enabled','appearance_hide_ads','messages_show_deleted','messages_edit_history',
    'proxy_auto_latched','proxy_worker_enabled',
    'proxy_web_fallback','proxy_web_fallback_latched',
]);
const UPDATE_INTERVALS = new Set(['30m','1h','12h','24h','3d','7d','30d','never']);
const MESSAGE_LAYOUTS = new Set(['native','left','wide']);
const PROXY_MODES = new Set(['auto','always','off']);
const PROXY_DOMAIN_SOURCES = new Set(['flowseal','custom']);
const INVALID = Symbol('invalid-setting');

function normalizeSetting(k, v) {
    if (BOOL_KEYS.has(k)) return typeof v === 'boolean' ? v : INVALID;
    if (k === 'notif_duration') {
        const n = Number(v); return Number.isFinite(n) ? Math.max(2, Math.min(30, Math.round(n))) : INVALID;
    }
    if (k === 'notif_volume') {
        const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : INVALID;
    }
    if (k === 'proxy_auto_failures') {
        const n = Number(v); return Number.isFinite(n) ? Math.max(1, Math.min(10, Math.round(n))) : INVALID;
    }
    if (k === 'proxy_auto_window_sec') {
        const n = Number(v); return Number.isFinite(n) ? Math.max(3, Math.min(120, Math.round(n))) : INVALID;
    }
    if (k === 'update_check_interval') return UPDATE_INTERVALS.has(v) ? v : INVALID;
    if (k === 'appearance_message_layout') return MESSAGE_LAYOUTS.has(v) ? v : INVALID;
    if (k === 'proxy_mode') return PROXY_MODES.has(v) ? v : INVALID;
    if (k === 'proxy_domain_source') return PROXY_DOMAIN_SOURCES.has(v) ? v : INVALID;
    if (k === 'save_path') return typeof v === 'string' && v.length <= 32767 ? repairLegacyUtf8Mojibake(v) : INVALID;
    if (k === 'whatsnew_shown_version' || k === 'skipped_version') {
        return typeof v === 'string' && v.length <= 64 ? v : INVALID;
    }
    if (k === 'proxy_pinned_domain') {
        return typeof v === 'string' && v.length <= 253 ? v : INVALID;
    }
    if (k === 'feed_sources') {
        if (!Array.isArray(v) || v.length > 200) return INVALID;
        const out = [];
        const seen = new Set();
        for (const item of v) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return INVALID;
            const id = String(item.id == null ? '' : item.id);
            let n;
            try { n = BigInt(id); } catch (_) { return INVALID; }
            if (n >= 0n || seen.has(id)) continue;
            const title = typeof item.title === 'string' ? item.title.slice(0, 160) : '';
            const username = typeof item.username === 'string' ? item.username.replace(/^@/, '').slice(0, 64) : '';
            seen.add(id);
            out.push({ id, title, username });
        }
        return out;
    }
    if (k === 'proxy_custom_domains' || k === 'proxy_worker_domains') {
        if (!Array.isArray(v) || v.length > 64) return INVALID;
        const out = [];
        for (const item of v) {
            if (typeof item !== 'string' || item.length > 253) return INVALID;
            out.push(item);
        }
        return out;
    }
    if (k === 'proxy_dc_ips') {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return INVALID;
        const entries = Object.entries(v);
        if (entries.length > 16) return INVALID;
        const out = {};
        for (const [dc, ip] of entries) {
            if (!/^\d{1,3}$/.test(dc) || typeof ip !== 'string' || ip.length > 64) return INVALID;
            out[dc] = ip;
        }
        return out;
    }
    return v;
}

function saveSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
    for (const [k, v] of Object.entries(settings)) {
        // Renderer settings are intentionally constrained to the schema above.
        // Never let arbitrary IPC input create new keys or poison expected types.
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
        if (v === null || v === undefined) { store.delete(k); continue; }
        const normalized = normalizeSetting(k, v);
        if (normalized !== INVALID) store.set(k, normalized);
    }
}

module.exports = { loadSettings, saveSettings };
