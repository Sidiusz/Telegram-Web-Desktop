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
        
        // Уже вставлены — только обновляем подписи на текущий язык (TG ставит
        // <html lang> не сразу, меню могло вставиться ещё на en) и выходим.
        if(bubble.querySelector('#_tgmi_dl_')){
            const map={_tgmi_dl_:'downloads',_tgmi_ad_:'addons',_tgmi_cl_:'changelog',_tgmi_upd_:'check_updates'};
            Object.keys(map).forEach(id=>{const sp=bubble.querySelector('#'+id+' span');if(sp)sp.textContent=T(map[id]);});
            return;
        }

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

        const dl = mi('_tgmi_dl_', 'icon-download', T('downloads'), () => openDownloadsNative());
        const ad = mi('_tgmi_ad_', 'icon-bots', T('addons'), () => openAddonsNative());
        // #3: «Настройки приложения» убрали из меню — секции переехали в «Общие настройки».
        const cl = mi('_tgmi_cl_', 'icon-info', T('changelog'), () => openChangelogNative());
        const upd = mi('_tgmi_upd_', 'icon-reload', T('check_updates'), async () => {
            toast(T('upd_checking'), 'icon-reload');
            try {
                const r = await INV('check_update_manual');
                if (!r || r.upToDate) toast(T('st_uptodate'), 'icon-check');
                else if (r.error) toast(T('error') + ': ' + r.error, 'icon-close');
            } catch(e) { toast(T('st_check_err'), 'icon-close'); }
        });

        // Находим оригинальную кнопку "Настройки", чтобы вставить пункты строго перед ней
        const tgSettings = Array.from(bubble.querySelectorAll('.MenuItem.compact:not([id])')).find(el => el.querySelector('.icon-settings'));
        // Открытие нативных Настроек должно закрывать наши кастомные панели.
        if(tgSettings && !tgSettings.dataset.tgHooked){
            tgSettings.dataset.tgHooked='1';
            tgSettings.addEventListener('click',()=>{ try{ closeNativePanel(); }catch(e){} });
        }
        const anchor = tgSettings || bubble.lastElementChild;
        
        if(anchor){
            bubble.insertBefore(sep1, anchor);
            bubble.insertBefore(dl, anchor);
            bubble.insertBefore(ad, anchor);
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
    // Telegram redesign: icons changed (icon-unmute -> icon-notifications-filled, icon-data -> icon-piechart-filled)
    // Find anchor by text content to survive icon renames.
    const allRows = settings.querySelectorAll('.ListItem');
    let notif = null, data = null;
    for(const row of allRows){
        const txt = (row.textContent||'').trim();
        if(!notif && /Уведомления|Notifications/i.test(txt)) notif = row;
        if(!data && /Данные и память|Data and Storage/i.test(txt)) data = row;
        if(notif && data) break;
    }
    // Fallback to old icon selectors
    if(!notif) notif = settings.querySelector('.ListItem.narrow .ListItem-button .icon-unmute')?.closest('.ListItem.narrow');
    else notif = notif.closest ? notif.closest('.ListItem.narrow') : notif;
    if(!data) data = settings.querySelector('.ListItem.narrow .ListItem-button .icon-data')?.closest('.ListItem.narrow');
    else if(data && !data.classList?.contains('ListItem')) data = data.closest('.ListItem.narrow');
    const anchorEl = notif || data;
    if(!anchorEl || anchorEl.closest('#RightColumn, .RightColumn')) return;
    const list  = anchorEl.parentElement;
    if(!list) return;
    if(list.querySelector('#_tgst_ad_')) return;   // уже вставлено

    // Clone live native row — keep exact card styling.
    const tmpl = anchorEl.closest('.ListItem.narrow') || anchorEl;
    function makeRow(id, iconName, label, sub){
        const row = tmpl.cloneNode(true);
        row.removeAttribute('id'); row.id = id;
        const btn = row.querySelector('.ListItem-button');
        // New design: title/subtitle inside .multiline-item, not direct text nodes.
        const multi = btn.querySelector('.multiline-item');
        if(multi){
            const titleEl = multi.querySelector('.title');
            if(titleEl) titleEl.textContent = label;
            let subEl = multi.querySelector('.subtitle');
            if(sub){
                if(subEl) subEl.textContent = sub;
                else {
                    subEl = document.createElement('span');
                    subEl.className = 'subtitle';
                    multi.appendChild(subEl);
                    subEl.textContent = sub;
                }
            } else if(subEl) subEl.remove();
            // remove stray value badges if any
            multi.querySelectorAll('.settings-item__current-value').forEach(el=>el.remove());
            Array.from(btn.childNodes).forEach(n=>{
                if(n.nodeType===3) btn.removeChild(n);
            });
        } else {
            Array.from(btn.childNodes).forEach(n=>{
                if(n.nodeType===3 || (n.nodeType===1 && /settings-item__current-value/.test(n.className||''))) btn.removeChild(n);
            });
            btn.appendChild(document.createTextNode(label));
            if(sub){
                const subEl = document.createElement('span');
                subEl.className = 'subtitle';
                subEl.textContent = sub;
                btn.appendChild(subEl);
            }
        }
        const ico = btn.querySelector('i.icon');
        if(ico){
            // keep hash classes (v0eXS-8f etc), only swap icon name
            ico.className = ico.className.replace(/icon-[^\s]+/, 'icon-'+iconName);
            ico.setAttribute('aria-hidden','true');
            // Color the wrapper to match new design (cloned row was notifications pink)
            const wrap = ico.closest('.ListItem-main-icon');
            if(wrap){
                const bgMap = {bots:'#8774e1', download:'#4caf50', info:'#5288c1', reload:'#4caf50'};
                wrap.style.background = bgMap[iconName] || '#8774e1';
            }
        }
        return row;
    }

    // #3: «Настройки приложения» как отдельный пункт убрали — её секции теперь
    // встраиваются прямо в «Общие настройки» (injectGeneralSettings). В главном
    // списке оставляем «Дополнения», а «Проверить обновления» кладём в самый низ.

    // «Дополнения» — сразу под «Общие настройки» (первая строка списка), иначе в начало.
    const adRow = makeRow('_tgst_ad_', 'bots', T('addons'), T('addons_desc'));
    adRow.querySelector('.ListItem-button').addEventListener('click', () => openAddonsNative());
    let generalAnchor = null;
    for(const r of list.querySelectorAll('.ListItem')){
        if(/Общие настройки|General Settings/i.test(r.textContent||'')){ generalAnchor = r; break; }
    }
    if(!generalAnchor) generalAnchor = list.querySelector('.ListItem');
    if(generalAnchor && generalAnchor !== tmpl){
        generalAnchor.after(adRow);
    } else {
        list.insertBefore(adRow, list.firstChild);
    }

    // «Проверить обновления» и «О приложении» — отдельной категорией-облачком в
    // самом низу главного экрана настроек (injectAboutSection), не строками здесь.
}
// ─────────────────────────────────────────────────────────────────────────────
