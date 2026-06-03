'use strict';
const Store = require('electron-store').default;

const store = new Store({ name: 'settings' });

const DEFAULTS = {
    save_path: null,
    link_ask: true,
    auto_reload_enabled: false,
    auto_reload_interval: 3600,
    auto_reload_on_idle: false,
    idle_timeout: 300,
    minimize_to_tray: false,
    popup_notifications: false,
    background_notifications_enabled: false,
    webnotif_hint_shown: false,
    devtools_enabled: false,
    update_check_interval: '1h', // 30m | 1h | 12h | 24h | 3d | 7d | 30d | never
    skipped_version: null,
};

function loadSettings() {
    return {
        save_path: store.get('save_path', DEFAULTS.save_path),
        link_ask: store.get('link_ask', DEFAULTS.link_ask),
        auto_reload_enabled: store.get('auto_reload_enabled', DEFAULTS.auto_reload_enabled),
        auto_reload_interval: store.get('auto_reload_interval', DEFAULTS.auto_reload_interval),
        auto_reload_on_idle: store.get('auto_reload_on_idle', DEFAULTS.auto_reload_on_idle),
        idle_timeout: store.get('idle_timeout', DEFAULTS.idle_timeout),
        minimize_to_tray: store.get('minimize_to_tray', DEFAULTS.minimize_to_tray),
        popup_notifications: store.get('popup_notifications', DEFAULTS.popup_notifications),
        background_notifications_enabled: store.get('background_notifications_enabled', DEFAULTS.background_notifications_enabled),
        webnotif_hint_shown: store.get('webnotif_hint_shown', DEFAULTS.webnotif_hint_shown),
        devtools_enabled: store.get('devtools_enabled', DEFAULTS.devtools_enabled),
        update_check_interval: store.get('update_check_interval', DEFAULTS.update_check_interval),
        skipped_version: store.get('skipped_version', DEFAULTS.skipped_version),
    };
}

function saveSettings(settings) {
    for (const [k, v] of Object.entries(settings)) {
        if (v === null || v === undefined) store.delete(k);
        else store.set(k, v);
    }
}

function getSkipDomains() {
    return store.get('skip_domains', []);
}

function addSkipDomain(domain) {
    const domains = getSkipDomains();
    if (!domains.includes(domain)) {
        domains.push(domain);
        store.set('skip_domains', domains);
    }
}

module.exports = { loadSettings, saveSettings, getSkipDomains, addSkipDomain };
