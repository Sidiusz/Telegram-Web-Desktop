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
    const settings=document.getElementById('Settings');
    if(!settings)return;
    const scroll=settings.querySelector('.settings-main-scroll');
    if(!scroll)return;

    // Current Web A: the root settings category card is the direct child of
    // .settings-main-scroll that contains the native settings-filled row.
    // We intentionally do not depend on Telegram's hashed class names or labels.
    const rootWrap=Array.from(scroll.children).find(function(el){
        return !!el.querySelector('.ListItem .icon-settings-filled') &&
               el.querySelectorAll('.ListItem.narrow').length>=6;
    });
    if(!rootWrap)return;

    const groups=Array.from(rootWrap.children).filter(function(el){
        return !!el.querySelector('.ListItem');
    });
    if(!groups.length)return;
    const mainGroup=groups.find(function(el){return !!el.querySelector('.icon-settings-filled');});
    if(!mainGroup)return;
    const nativeGeneral=mainGroup.querySelector('.icon-settings-filled')?.closest('.ListItem');
    if(!nativeGeneral)return;

    function row(id,icon,title,sub,tone,cb){
        const r=_genDecoratedRow(icon,title,'',cb,tone,sub,false);
        r.id=id;
        return r;
    }

    let twd=mainGroup.querySelector('#_tgst_twd_');
    let dl=mainGroup.querySelector('#_tgst_dl_');
    let ad=mainGroup.querySelector('#_tgst_ad_');

    // Remove the old direct Proxy row from pre-1.3.1 layouts; Proxy now belongs
    // inside Telegram Web Desktop.
    const oldProxy=rootWrap.querySelector('#_tgst_proxy_');
    if(oldProxy)oldProxy.remove();

    if(!twd){
        twd=row('_tgst_twd_','settings','Telegram Web Desktop',T('twd_settings_desc'),'blue',function(){openTwdNative('root');});
        nativeGeneral.after(twd);
    }else{
        if(twd._title)twd._title.textContent='Telegram Web Desktop';
        if(twd._subtitle)twd._subtitle.textContent=T('twd_settings_desc');
    }
    if(!dl){
        dl=row('_tgst_dl_','download',T('downloads'),T('downloads_desc'),'green',function(){openDownloadsNative();});
        twd.after(dl);
    }else if(dl._subtitle)dl._subtitle.textContent=T('downloads_desc');
    if(!ad){
        ad=row('_tgst_ad_','twd-addons',T('addons'),T('addons_desc'),'purple',function(){openAddonsNative();});
        dl.after(ad);
    }else{
        if(ad._title)ad._title.textContent=T('addons');
        if(ad._subtitle)ad._subtitle.textContent=T('addons_desc');
    }

    // Information about the modification is always the last row of the root
    // Settings list, below Telegram's own help/privacy rows.
    const bottomGroup=groups[groups.length-1]||mainGroup;
    let info=rootWrap.querySelector('#_tgst_modinfo_');
    if(!info){
        info=row('_tgst_modinfo_','info','Telegram Web Desktop',T('twd_mod_info'),'blue',function(){openTwdNative('about');});
        bottomGroup.appendChild(info);
        INV('get_app_info').then(function(appInfo){
            if(info.isConnected && info._subtitle && appInfo && appInfo.version){
                info._subtitle.textContent='v'+appInfo.version+' · '+T('twd_mod_info');
            }
        }).catch(function(){});
    }
}
// ─────────────────────────────────────────────────────────────────────────────
