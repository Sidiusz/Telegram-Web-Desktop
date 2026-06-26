'use strict';
// Scripts injected into the Telegram page. Sources live in ./inject/* as plain
// .js (read & assembled here, no string escaping); UI_JS stitches the ./inject/ui/* fragments into one IIFE with shared scope.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const rd = p => fs.readFileSync(path.join(__dirname, 'inject', p), 'utf8');

// Only bootstrap's position matters (it runs last) — function declarations are hoisted, so the rest can be in any order.
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
    // Guard marker: re-running UI_JS in the same document is a no-op (no duplicate
    // intervals/handlers). The main-process watchdog checks the same marker and re-injects everything if it's gone (TG swapped the page during its own update).
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

// In prod (asar — injection files are immutable) read and assemble once. In dev
// (unpacked), read fresh on every inject so edits to inject/* are picked up by a window reload alone, no app restart — same as loadAddonScripts() does for addons.
let _cache = null;
function getScripts() {
    if (app.isPackaged) {
        if (!_cache) _cache = readAll();
        return _cache;
    }
    return readAll();
}

module.exports = { getScripts };
