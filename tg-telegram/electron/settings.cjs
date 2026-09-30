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
    notif_hide_avatar: false,
    whatsnew_shown_version: null,
    devtools_enabled: false,
    update_check_interval: '24h',
    skipped_version: null,
    appearance_message_layout: 'left',
    appearance_hide_ads: true,
    appearance_startup_theme: 'dark',
    messages_show_deleted: false,
    messages_show_disappearing: false,
    messages_save_deleted: false,
    messages_save_disappearing: false,
    messages_edit_history: false,
    messages_save_public: false,
    messages_history_scope: 'client',
    messages_extended_pins: false,
    message_filter_enabled: false,
    message_filter_standard: true,
    message_filter_hashtags: true,
    message_filter_short_links: true,
    message_filter_ref_links: true,
    message_filter_private: false,
    message_filter_mark_only: false,
    message_filter_ignore_symbols: false,
    message_filter_short_disabled: [],
    message_filter_ref_disabled: [],
    message_filter_custom: [],
    privacy_no_read_receipts: false,
    privacy_no_typing: false,
    privacy_no_read_force_on: [],
    privacy_no_read_force_off: [],
    privacy_no_typing_force_on: [],
    privacy_no_typing_force_off: [],
    proxy_mode: 'auto',
    proxy_auto_latched: false,
    proxy_domain_source: 'flowseal',
    proxy_custom_domains: [],
    proxy_pinned_domain: '',
    proxy_last_good_control_domain: '',
    proxy_last_good_media_domain: '',
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
    'notif_cat_group','notif_cat_channel','notif_hide_text','notif_hide_sender','notif_hide_avatar',
    'devtools_enabled','appearance_hide_ads','messages_show_deleted','messages_show_disappearing',
    'messages_save_deleted','messages_save_disappearing','messages_edit_history','messages_save_public','messages_extended_pins',
    'message_filter_enabled','message_filter_standard','message_filter_hashtags','message_filter_short_links','message_filter_ref_links',
    'message_filter_private','message_filter_mark_only','message_filter_ignore_symbols',
    'privacy_no_read_receipts','privacy_no_typing',
    'proxy_auto_latched','proxy_worker_enabled',
    'proxy_web_fallback','proxy_web_fallback_latched',
]);
const UPDATE_INTERVALS = new Set(['30m','1h','12h','24h','3d','7d','30d','never']);
const MESSAGE_LAYOUTS = new Set(['native','left','wide']);
const STARTUP_THEMES = new Set(['light','dark']);
const MESSAGE_HISTORY_SCOPES = new Set(['chat','client','always']);
const PROXY_MODES = new Set(['auto','always','off']);
const PROXY_DOMAIN_SOURCES = new Set(['flowseal','custom']);
const PRIVACY_PEER_LIST_KEYS = new Set([
    'privacy_no_read_force_on','privacy_no_read_force_off',
    'privacy_no_typing_force_on','privacy_no_typing_force_off',
]);
const MESSAGE_FILTER_DOMAIN_LIST_KEYS = new Set(['message_filter_short_disabled','message_filter_ref_disabled']);
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
    if (k === 'appearance_startup_theme') return STARTUP_THEMES.has(v) ? v : INVALID;
    if (k === 'messages_history_scope') return MESSAGE_HISTORY_SCOPES.has(v) ? v : INVALID;
    if (k === 'proxy_mode') return PROXY_MODES.has(v) ? v : INVALID;
    if (k === 'proxy_domain_source') return PROXY_DOMAIN_SOURCES.has(v) ? v : INVALID;
    if (k === 'save_path') return typeof v === 'string' && v.length <= 32767 ? repairLegacyUtf8Mojibake(v) : INVALID;
    if (k === 'whatsnew_shown_version' || k === 'skipped_version') {
        return typeof v === 'string' && v.length <= 64 ? v : INVALID;
    }
    if (k === 'proxy_pinned_domain' || k === 'proxy_last_good_control_domain' || k === 'proxy_last_good_media_domain') {
        return typeof v === 'string' && v.length <= 253 ? v : INVALID;
    }
    if (PRIVACY_PEER_LIST_KEYS.has(k)) {
        if (!Array.isArray(v) || v.length > 4096) return INVALID;
        const out = [];
        for (const item of v) {
            const id = String(item);
            if (!/^-?\d{1,24}$/.test(id)) return INVALID;
            if (!out.includes(id)) out.push(id);
        }
        return out;
    }
    if (MESSAGE_FILTER_DOMAIN_LIST_KEYS.has(k)) {
        if (!Array.isArray(v) || v.length > 128) return INVALID;
        const out = [];
        for (const item of v) {
            const domain = String(item || '').trim().toLowerCase();
            if (!/^[a-z0-9.-]{1,253}$/.test(domain)) return INVALID;
            if (!out.includes(domain)) out.push(domain);
        }
        return out;
    }
    if (k === 'message_filter_custom') {
        if (!Array.isArray(v) || v.length > 256) return INVALID;
        const out = [];
        for (const item of v) {
            const phrase = String(item || '').trim();
            if (!phrase || phrase.length > 160) return INVALID;
            if (!out.includes(phrase)) out.push(phrase);
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
