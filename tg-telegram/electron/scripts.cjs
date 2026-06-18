'use strict';
// Инъектируемые в страницу Telegram скрипты. Их исходники вынесены в ./inject/*
// как обычные .js (без экранирования строк) — здесь они только читаются и
// собираются. UI_JS склеивается из логических фрагментов ./inject/ui/* в один
// IIFE (общая область видимости — функции/состояние видят друг друга).
const fs = require('fs');
const path = require('path');

const rd = p => fs.readFileSync(path.join(__dirname, 'inject', p), 'utf8');

const NOTIF_INTERCEPT_JS = rd('notif-intercept.js');
const AUDIO_JS = rd('audio.js');
const EXTERNAL_JS = rd('external.js');

// Порядок важен только для исполняемого «хвоста» (bootstrap) — он идёт последним;
// объявления функций поднимаются (hoisting), поэтому их взаимный порядок не критичен.
const UI_PARTS = [
    'core.js',                   // INV, CSS, ensureCSS/toast
    'downloads-registry.js',     // window.__tgdl: привязка загрузок к сообщениям
    'notifications-settings.js', // вшитые настройки уведомлений
    'modal.js',                  // showModal / makePanel / openPanel
    'native-panels.js',          // нативные панели «Загрузки»/«Настройки приложения»
    'settings-render.js',        // рендер настроек приложения + автосохранение
    'notif-ui.js',               // угловые уведомления, прогресс обновления
    'inject.js',                 // injectMenu / injectSettingsRows
    'bootstrap.js',              // tryInject / waitBody / запуск наблюдателей
].map(name => rd(path.join('ui', name)));

const UI_JS = '(function(){\n' + UI_PARTS.join('\n') + '\n})();';

module.exports = { NOTIF_INTERCEPT_JS, AUDIO_JS, EXTERNAL_JS, UI_JS };
