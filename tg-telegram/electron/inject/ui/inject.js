// Старые слайд-панели (_tgst_/_tgcl_) больше не нужны: настройки/загрузки/
// дополнения/чейнджлог рисуются нативными панелями поверх #Settings.
function ensurePanels(){}

// ── ИНЖЕКТ МЕНЮ: Строго по структуре DOM без догадок ────────────────────
function injectMenu(){
    // Ищем иконку "Избранное" — она всегда есть в главном меню
    const savedIcons = document.querySelectorAll('.icon-saved-messages');
    savedIcons.forEach(icon => {
        // Находим родительский bubble-контейнер
        const bubble = icon.closest('.bubble.menu-container');
        if(!bubble) return;
        
        // Если наши пункты уже добавлены в этот bubble — пропускаем
        if(bubble.querySelector('#_tgmi_dl_')) return;

        function mi(id, ico, label, cb){
            const el = document.createElement('div');
            el.id = id;
            el.setAttribute('role', 'menuitem');
            el.setAttribute('tabindex', '0');
            el.className = 'MenuItem compact';
            el.innerHTML = '<i class="icon ' + ico + '" aria-hidden="true"></i><span>' + label + '</span>';
            el.addEventListener('click', () => {
                bubble.classList.remove('open', 'shown'); // закрываем меню
                setTimeout(cb, 60);
            });
            return el;
        }

        // Динамически берем классы разделителя из DOM, чтобы не сломалось при обновлениях ТГ (заменяет h039vb1K NGKaFgra)
        let sepClass = 'h039vb1K NGKaFgra'; // дефолт на крайний случай
        const existingSep = Array.from(bubble.children).find(el => el.tagName === 'DIV' && !el.hasAttribute('role') && !el.className.includes('MenuItem') && el.innerHTML.trim() === '');
        if(existingSep) sepClass = existingSep.className;

        const sep1 = document.createElement('div'); sep1.className = sepClass;
        const sep2 = document.createElement('div'); sep2.className = sepClass;

        const dl = mi('_tgmi_dl_', 'icon-download', 'Загрузки', () => openDownloadsNative());
        const ad = mi('_tgmi_ad_', 'icon-bots', 'Дополнения', () => openAddonsNative());
        const st = mi('_tgmi_st_', 'icon-settings', 'Настройки приложения', () => openAppSettingsNative());
        const cl = mi('_tgmi_cl_', 'icon-info', 'Список изменений', () => openChangelogNative());
        const upd = mi('_tgmi_upd_', 'icon-reload', 'Проверить обновления', async () => {
            toast('Проверка обновлений...', 'icon-reload');
            try {
                const r = await INV('check_update_manual');
                if (!r || r.upToDate) toast('Установлена последняя версия', 'icon-check');
                else if (r.error) toast('Ошибка: ' + r.error, 'icon-close');
            } catch(e) { toast('Ошибка проверки', 'icon-close'); }
        });

        // Находим оригинальную кнопку "Настройки", чтобы вставить пункты строго перед ней
        const tgSettings = Array.from(bubble.querySelectorAll('.MenuItem.compact:not([id])')).find(el => el.querySelector('.icon-settings'));
        const anchor = tgSettings || bubble.lastElementChild;
        
        if(anchor){
            bubble.insertBefore(sep1, anchor);
            bubble.insertBefore(dl, anchor);
            bubble.insertBefore(ad, anchor);
            bubble.insertBefore(st, anchor);
            bubble.insertBefore(cl, anchor);
            bubble.insertBefore(upd, anchor);
            bubble.insertBefore(sep2, anchor);
        }
    });
}
// ────────────────────────────────────────────────────────────────────────

// ── ИНЖЕКТ В НАТИВНЫЙ СПИСОК НАСТРОЕК (#5): клонируем живую нативную строку ──
// Главное меню Настроек TG (Уведомления / Данные и память / Конфиденциальность…)
// — встраиваем «Настройки приложения» (сразу под «Общие») и «Загрузки».
// Классы ListItem* семантические (не хэш), контейнер-список хэширован (RE8jeQLf),
// поэтому находим список через якорь-строку (icon-unmute = «Уведомления») и клонируем
// её узел → меня иконку/текст → вставляем. Так вид 1-в-1 как родной и переживёт сборку.
function injectSettingsRows(){
    // ТОЛЬКО экран Настроек (#Settings). В профиле собеседника (#RightColumn) тоже
    // есть строки «Уведомления»/медиа с теми же иконками — туда вставлять нельзя.
    const settings = document.getElementById('Settings');
    if(!settings) return;
    const notif = settings.querySelector('.ListItem.narrow .ListItem-button .icon-unmute');
    const data  = settings.querySelector('.ListItem.narrow .ListItem-button .icon-data');
    const anchor = notif || data;
    if(!anchor || anchor.closest('#RightColumn, .RightColumn')) return;
    const list  = anchor.closest('.ListItem.narrow').parentElement;
    if(!list) return;
    if(list.querySelector('#_tgst_app_,#_tgst_dl_,#_tgst_ad_')) return;   // уже вставлено

    // Клонируем живую нативную строку → собираем свою по тому же шаблону.
    const tmpl = anchor.closest('.ListItem.narrow');
    function makeRow(id, iconName, label){
        const row = tmpl.cloneNode(true);
        row.removeAttribute('id'); row.id = id;
        const btn = row.querySelector('.ListItem-button');
        // выкидываем текст/значение, оставляем только иконку
        Array.from(btn.childNodes).forEach(n=>{
            if(n.nodeType===3 || (n.nodeType===1 && /settings-item__current-value/.test(n.className||''))) btn.removeChild(n);
        });
        const ico = btn.querySelector('i.icon');
        if(ico){
            ico.className = 'icon icon-'+iconName+' ListItem-main-icon';
            ico.setAttribute('aria-hidden','true');
        }
        btn.appendChild(document.createTextNode(label));
        return row;
    }

    // 1) «Настройки приложения» — сразу под «Общие настройки» (если она есть вверху)
    const appRow = makeRow('_tgst_app_', 'settings', 'Настройки приложения');
    appRow.querySelector('.ListItem-button').addEventListener('click', () => openAppSettingsNative());
    // «Общие настройки» (icon-chat/General) идёт первой; вставим после неё, иначе — в начало списка.
    const chatRow = list.querySelector('.ListItem.narrow .icon-chat, .ListItem.narrow .ListItem-main-icon');
    const generalAnchor = chatRow && chatRow.closest('.ListItem.narrow');
    if(generalAnchor && generalAnchor !== tmpl){
        generalAnchor.after(appRow);
    } else {
        list.insertBefore(appRow, list.firstChild);
    }

    // 1b) «Дополнения» — сразу под «Настройки приложения».
    const adRow = makeRow('_tgst_ad_', 'bots', 'Дополнения');
    adRow.querySelector('.ListItem-button').addEventListener('click', () => openAddonsNative());
    appRow.after(adRow);

    // 2) «Загрузки» — после «Данные и память» (если есть), иначе после «Уведомления».
    const dlRow = makeRow('_tgst_dl_', 'download', 'Загрузки');
    dlRow.querySelector('.ListItem-button').addEventListener('click', () => openDownloadsNative());
    const dataRow = data && data.closest('.ListItem.narrow');
    if(dataRow){
        dataRow.after(dlRow);
    } else if(notif){
        notif.closest('.ListItem.narrow').after(dlRow);
    } else {
        appRow.after(dlRow);
    }
}
// ─────────────────────────────────────────────────────────────────────────────
