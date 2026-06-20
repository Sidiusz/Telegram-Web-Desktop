'use strict';
const Store = require('electron-store').default;

const store = new Store({ name: 'settings' });

const DEFAULTS = {
    save_path: null,
    minimize_to_tray: false,
    popup_notifications: true,
    background_notifications_enabled: false,
    // ── Наши уведомления ────────────────────────────────────────────────────
    notif_sound: true,           // играть фирменный звук
    notif_duration: 6,           // сек — сколько живёт карточка
    notif_volume: 0.8,           // 0..1 — громкость звука
    // Категории КОМУ показывать/озвучивать (по типу чата)
    notif_cat_private: true,     // личные сообщения (peerId > 0)
    notif_cat_group: true,       // группы (peerId < 0)
    notif_cat_channel: true,     // каналы (peerId < 0)
    notif_hide_text: false,      // скрывать текст входящих → «Вам пришло новое сообщение»
    notif_hide_sender: false,    // скрывать имя/аватар → «Анонимный пользователь»
    webnotif_hint_shown: false,
    whatsnew_shown_version: null,   // версия, для которой уже показали «Что нового»
    devtools_enabled: false,
    update_check_interval: '1h',
    skipped_version: null,
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
    };
}

function saveSettings(settings) {
    for (const [k, v] of Object.entries(settings)) {
        if (v === null || v === undefined) store.delete(k);
        else store.set(k, v);
    }
}

module.exports = { loadSettings, saveSettings };
