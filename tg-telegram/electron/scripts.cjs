'use strict';
// Scripts injected into the Telegram page. Sources live in ./inject/* as plain
// .js (no string escaping) — here they are only read and assembled. UI_JS is
// stitched together from the logical fragments in ./inject/ui/* into a single
// IIFE (shared scope — functions/state see each other).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const rd = p => fs.readFileSync(path.join(__dirname, 'inject', p), 'utf8');

// Only the executable "tail" (bootstrap) order matters — it runs last; function
// declarations are hoisted, so their relative order is not critical.
const UI_PARTS = [
    'core.js',                   // INV, CSS, ensureCSS/toast
    'lang.js',                   // i18n: curLang / T
    'downloads-registry.js',     // window.__tgdl: bind downloads to messages
    'notifications-settings.js', // built-in notification settings
    'modal.js',                  // showModal / makePanel / openPanel
    'native-panels.js',          // native "Downloads" / "App settings" panels
    'settings-render.js',        // render app settings + auto-save
    'notif-ui.js',               // corner notifications, update progress, download indicator
    'inject.js',                 // injectMenu / injectSettingsRows
    'bootstrap.js',              // tryInject / waitBody / start observers
];

function buildUiJs() {
    // Guard marker: a re-run of UI_JS in the same document is a no-op (no duplicate
    // intervals/handlers). The watchdog in main reads the same marker: if it's gone
    // (TG reloaded/swapped the page during its own update) — re-inject everything.
    const parts = UI_PARTS.map(name => rd(path.join('ui', name)));
    return '(function(){\nif(window.__tgUIInjected)return;window.__tgUIInjected=true;\n' + parts.join('\n') + '\n})();';
}

function readAll() {
    return {
        NOTIF_INTERCEPT_JS: rd('notif-intercept.js'),
        AUDIO_JS: rd('audio.js'),
        EXTERNAL_JS: rd('external.js'),
        UI_JS: buildUiJs(),
    };
}

// В проде (asar — файлы инъекций неизменны) читаем и собираем один раз. В деве
// (распакованный запуск) читаем заново на каждый инжект, чтобы правки inject/*
// подхватывались простой перезагрузкой окна, без перезапуска приложения — как уже
// делает loadAddonScripts() для аддонов.
let _cache = null;
function getScripts() {
    if (app.isPackaged) {
        if (!_cache) _cache = readAll();
        return _cache;
    }
    return readAll();
}

module.exports = { getScripts };
