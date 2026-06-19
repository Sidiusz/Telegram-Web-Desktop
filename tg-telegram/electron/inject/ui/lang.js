// Lightweight i18n. Language follows Telegram's UI (<html lang>): "ru*" → Russian,
// everything else → English (fallback). T(key) returns the localized string.
function curLang(){
    var l=(document.documentElement.lang||navigator.language||'en').toLowerCase();
    return l.indexOf('ru')===0 ? 'ru' : 'en';
}
var L={
    // burger menu / panel titles
    downloads:      {ru:'Загрузки',                 en:'Downloads'},
    addons:         {ru:'Дополнения',               en:'Add-ons'},
    app_settings:   {ru:'Настройки приложения',     en:'App settings'},
    changelog:      {ru:'Список изменений',          en:'Changelog'},
    check_updates:  {ru:'Проверить обновления',      en:'Check for updates'},
    // tray
    tray_show:      {ru:'Показать',                  en:'Show'},
    tray_settings:  {ru:'Настройки',                 en:'Settings'},
    tray_read_all:  {ru:'Прочитать всё',             en:'Mark all as read'},
    tray_quit:      {ru:'Выйти',                     en:'Quit'},
    // downloads panel
    dl_clear:       {ru:'Очистить',                  en:'Clear'},
    dl_clear_t:     {ru:'Очистить загрузки',         en:'Clear downloads'},
    dl_clear_m:     {ru:'Удалить все записи загрузок?<br><small style="color:#aaa">Файлы на диске также будут удалены.</small>', en:'Remove all download records?<br><small style="color:#aaa">Files on disk will be deleted too.</small>'},
    dl_empty:       {ru:'Нет загрузок',              en:'No downloads'},
    dl_done:        {ru:'Завершено',                 en:'Completed'},
    dl_waiting:     {ru:'Ожидание…',                 en:'Waiting…'},
    dl_show_folder: {ru:'Показать в папке',          en:'Show in folder'},
    dl_delete:      {ru:'Удалить',                   en:'Delete'},
    dl_not_found:   {ru:'Файл не найден',            en:'File not found'},
    dl_del_t:       {ru:'Удалить загрузку',          en:'Delete download'},
    // add-ons panel
    ad_folder:      {ru:'Папка',                     en:'Folder'},
    ad_builtin:     {ru:'Встроенные',                en:'Built-in'},
    ad_user:        {ru:'Пользовательские (.js / .crx)', en:'Custom (.js / .crx)'},
    ad_none:        {ru:'Нет пользовательских дополнений', en:'No custom add-ons'},
    ad_apply:       {ru:'Применить (перезагрузить)', en:'Apply (reload)'},
    addon_off:      {ru:'Выключено',                 en:'Off'},
    ad_del_t:       {ru:'Удалить дополнение',        en:'Delete add-on'},
    // changelog
    cl_current:     {ru:'текущая',                   en:'current'},
    cl_nodesc:      {ru:'Без описания',              en:'No description'},
    cl_empty:       {ru:'Список изменений пуст.',     en:'Changelog is empty.'},
    // common
    loading:        {ru:'Загрузка…',                 en:'Loading…'},
    load_error:     {ru:'Ошибка загрузки',           en:'Load error'},
    error:          {ru:'Ошибка',                    en:'Error'},
    ok:             {ru:'ОК',                        en:'OK'},
    cancel:         {ru:'ОТМЕНА',                    en:'CANCEL'},
    del_upper:      {ru:'УДАЛИТЬ',                   en:'DELETE'},
};
function T(k){ var e=L[k]; if(!e) return k; return e[curLang()]||e.en||k; }
