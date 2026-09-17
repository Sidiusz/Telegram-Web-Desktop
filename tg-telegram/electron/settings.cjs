'use strict';
const Store = require('electron-store').default;

const store = new Store({ name: 'settings' });

const DEFAULTS = {
    save_path: null,
    minimize_to_tray: false,
    popup_notifications: true,
    background_notifications_enabled: false,


    notif_sound: true,
    notif_duration: 6,
    notif_volume: 0.8,

    notif_cat_private: true, 
    notif_cat_group: true,   
    notif_cat_channel: true, 
    notif_hide_text: false,  
    notif_hide_sender: false,
    webnotif_hint_shown: false,
    whatsnew_shown_version: null,
    devtools_enabled: false,
    update_check_interval: '1h',
    skipped_version: null,
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

function loadSettings() {
    return {
        save_path: store.get('save_path', DEFAULTS.save_path),
        minimize_to_tray: store.get('minimize_to_tray', DEFAULTS.minimize_to_tray),
        popup_notifications: store.get('popup_notifications', DEFAULTS.popup_notifications),
        background_notifications_enabled: store.get('background_notifications_enabled', DEFAULTS.background_notifications_enabled),
        notif_sound: store.get('notif_sound', DEFAULTS.notif_sound),
        notif_duration: store.get('notif_duration', DEFAULTS.notif_duration),
        notif_volume: store.get('notif_volume', DEFAULTS.notif_volume),
        notif_cat_private: store.get('notif_cat_private', DEFAULTS.notif_cat_private),
        notif_cat_group: store.get('notif_cat_group', DEFAULTS.notif_cat_group),
        notif_cat_channel: store.get('notif_cat_channel', DEFAULTS.notif_cat_channel),
        notif_hide_text: store.get('notif_hide_text', DEFAULTS.notif_hide_text),
        notif_hide_sender: store.get('notif_hide_sender', DEFAULTS.notif_hide_sender),
        webnotif_hint_shown: store.get('webnotif_hint_shown', DEFAULTS.webnotif_hint_shown),
        whatsnew_shown_version: store.get('whatsnew_shown_version', DEFAULTS.whatsnew_shown_version),
        devtools_enabled: store.get('devtools_enabled', DEFAULTS.devtools_enabled),
        update_check_interval: store.get('update_check_interval', DEFAULTS.update_check_interval),
        skipped_version: store.get('skipped_version', DEFAULTS.skipped_version),
        proxy_mode: store.get('proxy_mode', DEFAULTS.proxy_mode),
        proxy_auto_latched: store.get('proxy_auto_latched', DEFAULTS.proxy_auto_latched),
        proxy_domain_source: store.get('proxy_domain_source', DEFAULTS.proxy_domain_source),
        proxy_custom_domains: store.get('proxy_custom_domains', DEFAULTS.proxy_custom_domains),
        proxy_pinned_domain: store.get('proxy_pinned_domain', DEFAULTS.proxy_pinned_domain),
        proxy_worker_enabled: store.get('proxy_worker_enabled', DEFAULTS.proxy_worker_enabled),
        proxy_worker_domains: store.get('proxy_worker_domains', DEFAULTS.proxy_worker_domains),
        proxy_auto_failures: store.get('proxy_auto_failures', DEFAULTS.proxy_auto_failures),
        proxy_auto_window_sec: store.get('proxy_auto_window_sec', DEFAULTS.proxy_auto_window_sec),
        proxy_web_fallback: store.get('proxy_web_fallback', DEFAULTS.proxy_web_fallback),
        proxy_web_fallback_latched: store.get('proxy_web_fallback_latched', DEFAULTS.proxy_web_fallback_latched),
        proxy_dc_ips: store.get('proxy_dc_ips', DEFAULTS.proxy_dc_ips),
    };
}

function saveSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
    for (const [k, v] of Object.entries(settings)) {
        // Renderer settings are intentionally constrained to the schema above.
        // Never let arbitrary IPC input create new electron-store keys.
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
        if (v === null || v === undefined) store.delete(k);
        else store.set(k, v);
    }
}

module.exports = { loadSettings, saveSettings };
