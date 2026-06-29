function tryInject(){ensureCSS();ensureToast();ensureCornerWrap();ensurePanels();}

// Иконка трея с числом непрочитанных: базовый логотип + небольшой красный бейдж
// в правом-нижнем углу (≈половина размера иконки). SVG→nativeImage в main не
// растеризуется — рисуем PNG на canvas. Базовый логотип берём из main один раз.
var _trayBaseImg=null;
try{ INV('get_tray_base').then(function(d){ if(d){ var im=new Image(); im.onload=function(){_trayBaseImg=im;}; im.src=d; } }).catch(function(){}); }catch(e){}
function makeTrayPng(count){
    try{
        var label=count>99?'99+':String(count);
        var S=64, c=document.createElement('canvas'); c.width=S; c.height=S;
        var x=c.getContext('2d');
        if(_trayBaseImg) x.drawImage(_trayBaseImg,0,0,S,S);     // логотип на всю площадь
        // Бейдж: круг радиусом ~30% иконки, прижат к правому-нижнему углу.
        var r=Math.round(S*0.30), cx=S-r-1, cy=S-r-1;
        x.beginPath(); x.arc(cx,cy,r+2,0,Math.PI*2); x.fillStyle='rgba(0,0,0,.55)'; x.fill();  // тонкая тёмная окантовка
        x.beginPath(); x.arc(cx,cy,r,0,Math.PI*2); x.fillStyle='#6B6B6B'; x.fill();   // серый, как нативный бейдж Electron
        x.fillStyle='#fff'; x.textAlign='center'; x.textBaseline='middle';
        x.font='900 '+(label.length>=3?16:24)+'px "Arial Black",Arial,sans-serif';
        x.fillText(label,cx,cy+1);
        return c.toDataURL('image/png');
    }catch(e){return null;}
}
function waitBody(cb){if(document.body)cb();else{const t=setInterval(()=>{if(document.body){clearInterval(t);cb();}},50);}}

waitBody(()=>{
    tryInject();
    new MutationObserver(tryInject).observe(document.body,{childList:true,subtree:false});
    
    // Запускаем инжект с интервалом, ловим меню в момент его появления
    setInterval(injectMenu, 500);
    setInterval(injectSettingsRows, 500);
    // Реактивный инжект: стреляет почти в тот же кадр, как только React смонтировал
    // список настроек/меню (иначе был виден «провал» — до 500мс нативные строки без
    // наших). Глубокий observer (subtree:true), но с дебаунсом 40мс — TG мутирует
    // DOM постоянно (печать/скролл), и inject на каждой мутации сам бы дёргал меню.
    // inject идемпотентен (guard по id), повторные вызовы ничего не пишут в DOM.
    let _injT=null;
    const _stObs=new MutationObserver(()=>{
        if(_injT)return;
        _injT=setTimeout(()=>{_injT=null;injectMenu();injectSettingsRows();},40);
    });
    const _startObs=()=>{ if(document.body) _stObs.observe(document.body,{childList:true,subtree:true}); else setTimeout(_startObs,80); };
    _startObs();

    setupNotificationSettingsSync();

    // «Что нового» — один раз на новую версию (ждём, пока UI прогрузится).
    setTimeout(()=>{ try{ showWhatsNewIfNeeded(); }catch(e){} },2500);

    // Счётчик для трея/таскбара: СУММА непрочитанных сообщений по НЕприглушённым
    // неархивным чатам. ОСНОВНОЙ источник — состояние TG (getGlobal): unreadCount из
    // messages.byChatId[id].threadsById['-1'].readState, архив отсекаем по
    // chats.listIds.active, mute — по notifyExceptionById (иначе notifyDefaults по
    // типу чата). Состояние точное и без «кадров-мерцаний», в отличие от DOM
    // (при blur TG перерисовывает чат-лист → бейдж на кадр пустой → счётчик мигал).
    // Сверено вживую: совпадает 1-в-1 с подсчётом по DOM. Фолбэк — старый DOM-путь
    // с подтверждением снижения (_pendingDrop), если рантайм недоступен.
    function nativeUnreadCount(){
        var g=tgRuntime.getGlobal();
        if(!g||!g.chats||!g.chats.listIds||!g.chats.listIds.active||!g.messages||!g.messages.byChatId)return null;
        var now=Math.floor(Date.now()/1000);
        var active=g.chats.listIds.active, exc=g.chats.notifyExceptionById||{};
        var defs=(g.settings&&g.settings.notifyDefaults)||{}, byId=g.chats.byId||{}, count=0;
        for(var i=0;i<active.length;i++){
            var id=active[i], mc=g.messages.byChatId[id];
            var th=mc&&mc.threadsById&&mc.threadsById['-1'];
            var unread=th&&th.readState?(th.readState.unreadCount||0):0;
            if(unread<=0)continue;
            var e=exc[id], muted;
            if(e&&typeof e.mutedUntil!=='undefined') muted=e.mutedUntil>now;
            else{ var c=byId[id], type=c&&c.type;
                var dkey=(type==='chatTypePrivate')?'users':(type==='chatTypeChannel')?'channels':'groups';
                var d=defs[dkey]; muted=d?(d.mutedUntil>now):false; }
            if(muted)continue;
            count+=unread;                               // сумма непрочитанных сообщений (не чатов)
        }
        return count;
    }
    function domUnreadCount(){
        // Дедуп по peerId: при переключении папок TG держит в DOM несколько .chat-list
        // (Transition-слайды), один чат попадает в строку дважды → бейдж двоился.
        // Считаем каждый peerId один раз (max непрочитанных по его строкам).
        var byPid={}, count=0;
        document.querySelectorAll('.chat-list .ListItem.Chat').forEach(function(it){
            if(it.className.indexOf('chat-item-archive')>=0)return;
            if(it.querySelector('.icon-muted'))return;
            var max=0;
            it.querySelectorAll('.chat-badge-transition').forEach(function(b){
                var n=parseInt((b.textContent||'').replace(/[^0-9]/g,''),10);
                if(!isNaN(n)&&n>max)max=n;
            });
            if(max<=0)return;
            var av=it.querySelector('.Avatar[data-peer-id]');
            var pid=av?av.getAttribute('data-peer-id'):null;
            if(pid){ if(max>(byPid[pid]||0))byPid[pid]=max; }
            else count+=max;                             // без peerId — дедуп невозможен
        });
        for(var k in byPid)count+=byPid[k];              // сумма непрочитанных (раз на чат)
        return count;
    }
    let _lastBadgeCount_=-1, _pendingChange=null;
    setInterval(()=>{
        var nat=nativeUnreadCount(), fromState=(nat!==null);
        var count = fromState ? nat : domUnreadCount();
        if(count===_lastBadgeCount_){ _pendingChange=null; return; }
        // Стейт (getGlobal) точный → применяем сразу. DOM-фолбэк мерцает при
        // перерисовке чат-листа (иконки .icon-muted на кадр пропадают → мьюченные
        // чаты влетают в счёт → всплеск 99+). Любое изменение подтверждаем одним
        // повтором: разовый кадр-выброс не доживает до второго тика и не показывается.
        if(!fromState && _lastBadgeCount_>=0 && _pendingChange!==count){ _pendingChange=count; return; }
        _pendingChange=null;
        _lastBadgeCount_=count;
        INV('set_notifications_count',{count}).catch(()=>{});
        INV('set_tray_image',{dataURL:count>0?makeTrayPng(count):null}).catch(()=>{});
    },2000);
});

// ── Drag-n-drop: блокируем переключение чатов при перетаскивании файла ───────
// TG открывает чат под курсором при dragover по списку. Глушим pointer-events
// у .chat-list пока тащим файл. Не считаем dragenter/dragleave (счётчик
// рассинхронивается на границах детей) — держим по таймстампу dragover:
// dragover сыпется постоянно пока курсор в окне; пропал >200мс → снимаем блок.
// Текущий чат не страдает: дроп ловит средняя колонка/композер, не список.
// Блокируем на ЛЮБОЕ перетаскивание (не проверяем types: при внешнем drag над
// фоновым окном dataTransfer.types может не содержать 'Files'). Держим по
// таймстампу с запасом 700мс — в фоне dragover приходит редко, и узкий порог
// давал мерцание блока (чат «прыгал»). attach на dragenter и dragover.
(function(){
    var _s=null,_last=0,_timer=null;
    function styleEl(){
        if(_s)return _s;
        _s=document.createElement('style');_s.id='_drag_bl_';
        _s.textContent='.chat-list,.chat-list *{pointer-events:none!important}';
        return _s;
    }
    function tick(){if(Date.now()-_last>700)detach();}
    function attach(){
        if(!_s||!_s.parentNode)(document.head||document.documentElement).appendChild(styleEl());
        _last=Date.now();
        if(!_timer)_timer=setInterval(tick,150);
    }
    function detach(){
        if(_s&&_s.parentNode)_s.parentNode.removeChild(_s);
        if(_timer){clearInterval(_timer);_timer=null;}
    }
    document.addEventListener('dragenter',attach,true);
    document.addEventListener('dragover',attach,true);
    document.addEventListener('drop',detach,true);
    document.addEventListener('dragend',detach,true);
})();
// ─────────────────────────────────────────────────────────────────────────────

// ── ПКМ на изображении в MediaViewer ──────────────────────────────────────
document.addEventListener('contextmenu', function(e) {
    const viewer = document.getElementById('MediaViewer');
    if (!viewer || !viewer.contains(e.target)) return;

    const activeSlide = viewer.querySelector('.MediaViewerSlide--active');
    if (!activeSlide) return;

    const img = activeSlide.querySelector(
        'img:not([class*="sticker"]):not(.Avatar__media):not(.a8dMNkh3)'
    );
    if (!img || !img.src) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    INV('show_image_context_menu', {
        srcURL: img.src,
        x: e.clientX,
        y: e.clientY,
    }).catch(() => {});
}, true);
// ──────────────────────────────────────────────────────────────────────────

// ── Скачивание медиа из просмотрщика (blob:) ───────────────────────────────
// Кнопка «Загрузка» в просмотрщике — это <a download href="blob:...">. В Electron
// клик по нему НЕ скачивает: webContents.downloadURL(blob:) не работает (blob живёт
// в рендерере и недоступен из main) — раньше клик «пытался открыть blob». Чиним в
// рендерере: сами fetch'им blob → dataURL и отдаём байты в main (save_blob).
document.addEventListener('click', function(e){
    var a = (e.target && e.target.closest) ? e.target.closest('a[download]') : null;
    if(!a) return;
    var href = a.href || a.getAttribute('href') || '';
    if(href.indexOf('blob:')!==0) return;            // только blob; обычные ссылки не трогаем
    e.preventDefault();                              // отменяем сломанное нативное скачивание
    e.stopImmediatePropagation();                    // и глушим обработчик external.js — иначе он
                                                     // зовёт open_url(blob:) → диалог Windows «открыть blob»
    var name = a.getAttribute('download') || a.download || 'file';
    fetch(href).then(function(r){ return r.blob(); }).then(function(b){
        var fr = new FileReader();
        fr.onload = function(){ INV('save_blob', { dataUrl: fr.result, filename: name }).catch(function(){}); };
        fr.readAsDataURL(b);
    }).catch(function(){});
}, true);
// ──────────────────────────────────────────────────────────────────────────

// ── Навигация из уведомлений: открыть чат / пометить прочитанным ───────────
// Hash-навигация (location.hash='#peerId') в уже загруженной SPA Telegram Web A
// НЕ работает — роутер игнорирует изменение hash после инициализации (проверено
// на живой странице: и hash=, и location.assign сбрасываются в ''). Единственный
// надёжный путь без перезагрузки — кликнуть по строке чат-листа.
window.__tgNotif=(function(){
    // Нативный вызов экшена Telegram через общий tgRuntime (core.js): берём actions
    // и зовём actions[name](payload). false → откат на DOM-эмуляцию.
    function _callAction(name,payload){
        try{
            var acts=tgRuntime.getActions();
            if(!acts||typeof acts[name]!=='function')return false;
            acts[name](payload); return true;
        }catch(e){ return false; }
    }
    // Скрытие контекст-меню на время «прочитать всё» (ref-counted: вызовы markRead
    // идут со сдвигом и перекрываются, снимаем класс только когда все завершились).
    var _menuHide=0;
    function hideMenus(){ _menuHide++; try{ document.documentElement.classList.add('_tgreading_'); }catch(e){} }
    function showMenus(){ _menuHide=Math.max(0,_menuHide-1); if(_menuHide===0){ try{ document.documentElement.classList.remove('_tgreading_'); }catch(e){} } }
    function findRow(pid){
        var rows=document.querySelectorAll('.chat-list .ListItem.Chat');
        for(var i=0;i<rows.length;i++){
            var a=rows[i].querySelector('.Avatar[data-peer-id]');
            if(a&&a.getAttribute('data-peer-id')===String(pid))return rows[i];
        }
        return null;
    }
    // Полный путь: при загрузке с нуля hash работает (как в браузере), в живой
    // странице — нет. Поэтому пробуем клик; если строки нет в DOM (виртуализация),
    // фолбэк на полную перезагрузку с hash — медленно, но рабочий.
    function clickRow(row){
        var btn=row.querySelector('.ListItem-button')||row;
        try{
            var r=btn.getBoundingClientRect();
            var opt={bubbles:true,cancelable:true,view:window,button:0,
                clientX:r.left+r.width/2,clientY:r.top+r.height/2};
            btn.dispatchEvent(new MouseEvent('mousedown',opt));
            btn.dispatchEvent(new MouseEvent('mouseup',opt));
            btn.dispatchEvent(new MouseEvent('click',opt));
        }catch(e){ try{btn.click();}catch(e2){} }
    }
    function focusComposer(){
        setTimeout(function(){
            var i=document.getElementById('editable-message-text');
            if(i)i.focus();
        },450);
    }
    function openChat(pid){
        try{ pid=String(pid); }catch(e){ return; }
        // ОСНОВНОЙ путь — нативный экшен TG openChat({id}) (проверено по исходнику
        // обработчика: payload {id,...} → processOpenChatOrThread). Надёжнее клика
        // по строке: не зависит от виртуализации чат-листа.
        if(_callAction('openChat', { id: pid })){ focusComposer(); return; }
        // Фолбэк 1: клик по строке чат-листа (если рантайм недоступен).
        try{
            var row=findRow(pid);
            if(row){ clickRow(row); focusComposer(); return; }
        }catch(e){}
        // Фолбэк 2: строка вне видимой области (виртуализация) → перезагрузка с hash.
        try{ location.assign(location.origin+location.pathname+'#'+pid); }catch(e){}
    }
    // Прочитать чат. ОСНОВНОЙ путь — прямой вызов экшена TG: не зависит ни от меню,
    // ни от кликов пользователя (клик в пустоту больше не отменяет «прочитать»).
    // Фолбэк — эмуляция через контекст-меню, если рантайм TG недоступен.
    function markRead(pid){
        try{ pid=String(pid); }catch(e){ return; }
        if(_callAction('markChatMessagesRead', { id: pid })) return;
        markReadViaMenu(pid);
    }
    // Фолбэк: ПКМ по строке → нативное меню TG → «Отметить как прочитанное».
    // Чат НЕ открывается, текущий активный чат не меняется.
    function markReadViaMenu(pid){
        try{ pid=String(pid); }catch(e){ return; }
        var row=findRow(pid);
        if(!row)return;
        var btn=row.querySelector('.ListItem-button')||row;
        var r=btn.getBoundingClientRect();
        // Прячем контекст-меню ДО его появления, чтобы юзер не видел вспышку.
        hideMenus();
        var settled=false;
        function finish(){ if(settled)return; settled=true; setTimeout(showMenus,180); }   // даём меню закрыться невидимо
        var opt={bubbles:true,cancelable:true,view:window,button:2,
            clientX:r.left+r.width/2,clientY:r.top+r.height/2};
        btn.dispatchEvent(new MouseEvent('contextmenu',opt));
        // Ждём появления видимого меню TG (только .shown.open — в DOM висят
        // скрытые устаревшие меню, их не трогаем), ищем пункт, кликаем.
        var tries=0,maxTries=30;   // ~1.5с при 50мс
        (function poll(){
            var menu=document.querySelector('.bubble.menu-container.shown.open, .Menu.context-menu .bubble.shown.open');
            if(menu){
                var items=menu.querySelectorAll('.MenuItem, [role="menuitem"], button');
                for(var i=0;i<items.length;i++){
                    var t=(items[i].textContent||'').trim();
                    // Матчим по ИКОНКЕ (icon-readchats) — она не зависит от языка.
                    // Текст как фолбэк, если разметка иконок изменится.
                    var byIcon=!!items[i].querySelector('i.icon-readchats, .icon-readchats');
                    if(byIcon || /пометить прочитанн|отметить как прочитанн|mark as read/i.test(t)){
                        try{
                            var er=items[i].getBoundingClientRect();
                            items[i].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window,clientX:er.left+1,clientY:er.top+1}));
                            items[i].dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,view:window,clientX:er.left+1,clientY:er.top+1}));
                            items[i].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window,clientX:er.left+1,clientY:er.top+1}));
                        }catch(e){ try{items[i].click();}catch(e2){} }
                        dismissMenu(); finish();
                        return;
                    }
                }
                // Меню всплыло, но пункта нет (возможно уже прочитано) — закрываем.
                dismissMenu(); finish();
                return;
            }
            if(++tries<maxTries)setTimeout(poll,50); else finish();
        })();
        function dismissMenu(){
            try{ document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,which:27,bubbles:true})); }catch(e){}
        }
    }
    return {openChat:openChat, markRead:markRead};
})();
// ──────────────────────────────────────────────────────────────────────────

// Сообщаем main язык интерфейса TG (для локализации меню трея). Шлём при смене.
(function(){var last='';function send(){try{var l=curLang();if(l!==last){last=l;INV('report_lang',{lang:l}).catch(function(){});}}catch(e){}}send();setInterval(send,5000);})();

// ── Хуки для меню трея ──────────────────────────────────────────────────────
// «Настройки» из трея — открыть нашу панель настроек приложения.
window.__tgOpenAppSettings=function(){ try{ openAppSettingsNative(); }catch(e){} };
// «Прочитать всё» — по очереди (со сдвигом, чтобы меню TG не наслаивались)
// помечаем прочитанными все непрочитанные чаты вне архива.
window.__tgMarkAllRead=function(){
    try{
        var pids=[];
        document.querySelectorAll('.chat-list .ListItem.Chat').forEach(function(it){
            if(it.className.indexOf('chat-item-archive')>=0)return;
            if(it.querySelector('.icon-muted'))return;
            var b=it.querySelector('.chat-badge-transition, .Badge');
            var n=b?parseInt((b.textContent||'').replace(/[^0-9]/g,''),10):0;
            if(!n)return;
            var a=it.querySelector('.Avatar[data-peer-id]');
            if(a)pids.push(a.getAttribute('data-peer-id'));
        });
        pids.forEach(function(pid,i){
            setTimeout(function(){ if(window.__tgNotif&&window.__tgNotif.markRead)window.__tgNotif.markRead(pid); }, i*450);
        });
    }catch(e){}
};
// ──────────────────────────────────────────────────────────────────────────

// ── Входящие сообщения → попап-уведомление + фирменный звук ─────────────────
// Источник истины — состояние TG (getGlobal), НЕ DOM. Детект нового сообщения:
// рост threadInfo.lastMessageId в треде «-1». Текст/отправитель/тип чата берём
// из состояния (messages.byChatId[id].byId, users/chats.byId). Это убирает все
// прежние костыли DOM-скрапера: гонку превью (320мс), утечку черновика, промахи
// виртуализации чат-листа, эвристику типа чата по композеру. Единственный
// остаточный DOM-контакт — аватар (best-effort: в состоянии лежит лишь photoId,
// без готового URL) и фокус/открытый чат (это свойства окна, не состояния).
// При включённых «Веб-уведомлениях» TG уходит в путь системного уведомления и НЕ
// играет свой in-app звук → мы играем /a/notification.mp3 сами; если TG всё же
// сыграл свой (галка выкл) — не дублируем (lastTgSound).
(function setupIncomingNotifications(){
    var seen={}, seeded=false, lastTgSound=0;
    // Кэш настроек (звук/громкость/категории). Обновляем периодически — дёшево
    // (INV('get_settings')), уведомления реагируют на переключатели без перезагрузки.
    var cfg={notif_sound:true,notif_volume:0.8,notif_cat_private:true,notif_cat_group:true,notif_cat_channel:true};
    function refreshCfg(){
        try{ INV('get_settings').then(function(s){ if(s)cfg=s; }).catch(function(){}); }catch(e){}
    }
    refreshCfg();
    setInterval(refreshCfg,2000);

    // Ловим момент, когда сам Telegram играет notification.mp3 — для де-дупа.
    try{
        var _play=HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play=function(){
            try{ if((((this.src||this.currentSrc)||'')+'').indexOf('notification')>=0) lastTgSound=Date.now(); }catch(e){}
            return _play.apply(this,arguments);
        };
    }catch(e){}

    var SND=location.origin+'/a/notification.mp3';
    function playSound(){
        if(!cfg.notif_sound)return;                  // звук выключен в настройках
        if(Date.now()-lastTgSound<1500)return;       // TG уже сыграл свой — не дублируем
        try{
            var a=new Audio(SND);
            var v=parseFloat(cfg.notif_volume);
            if(!isNaN(v))a.volume=Math.max(0,Math.min(1,v));
            a.play().catch(function(){});
        }catch(e){}
    }

    // Окно: открытый чат и фокус — для пропуска активного чата (нет состояния «фокус»).
    function currentPeer(){var el=document.querySelector('.MiddleHeader .ChatInfo .Avatar[data-peer-id]');return el?el.getAttribute('data-peer-id'):'';}
    // Аватар best-effort: ищем строку чат-листа по peerId и берём уже отрисованный src.
    // Нет строки (виртуализация) → без иконки (main подставит первую букву).
    function domAvatar(pid){
        var rows=document.querySelectorAll('.chat-list .ListItem.Chat .Avatar[data-peer-id]');
        for(var i=0;i<rows.length;i++){
            if(rows[i].getAttribute('data-peer-id')===String(pid)){
                var img=rows[i].querySelector('img.Avatar__media, img');
                return img&&img.src?img.src:'';
            }
        }
        return '';
    }
    function toDataUrl(src){
        return new Promise(function(res){
            if(!src||src.indexOf('blob:')!==0)return res(src||'');
            fetch(src).then(function(r){return r.blob();}).then(function(b){
                var fr=new FileReader();fr.onload=function(){res(fr.result);};fr.onerror=function(){res('');};fr.readAsDataURL(b);
            }).catch(function(){res('');});
        });
    }

    // Категория чата для фильтра настроек: private | group | channel.
    function chatCategory(type){
        if(type==='chatTypePrivate')return 'private';
        if(type==='chatTypeChannel')return 'channel';
        return 'group';                                  // basic/super group
    }
    // Приглушён ли чат: персональное исключение, иначе дефолт по типу (как в бейдже трея).
    function isMuted(g,id,type,now){
        var exc=g.chats.notifyExceptionById||{}, e=exc[id];
        if(e&&typeof e.mutedUntil!=='undefined')return e.mutedUntil>now;
        var defs=(g.settings&&g.settings.notifyDefaults)||{};
        var dkey=(type==='chatTypePrivate')?'users':(type==='chatTypeChannel')?'channels':'groups';
        var d=defs[dkey]; return d?(d.mutedUntil>now):false;
    }
    // Имя отправителя (для префикса в группах): user → имя+фамилия, иначе chat.title.
    function senderName(g,msg){
        var sid=msg&&msg.senderId; if(!sid)return '';
        var u=g.users&&g.users.byId&&g.users.byId[sid];
        if(u)return ((u.firstName||'')+' '+(u.lastName||'')).trim();
        var c=g.chats&&g.chats.byId&&g.chats.byId[sid];
        return c?(c.title||''):'';
    }
    // Текст сообщения. Текст/подпись — в приоритете (покрывает и webPage-превью).
    // Медиа без подписи → локализованная метка типа. Служебное (action) → null (не уведомляем).
    function msgText(g,msg){
        var c=msg&&msg.content; if(!c)return T('new_message');
        if(c.text&&c.text.text)return c.text.text;
        if(c.action)return null;                         // вступил/покинул/закрепил — служебное
        if(c.sticker)return ((c.sticker.emoji||'')+' '+T('mt_sticker')).trim();
        if(c.photo)return T('mt_photo');
        if(c.video)return c.video.isRound?T('mt_round'):(c.video.isGif?T('mt_gif'):T('mt_video'));
        if(c.voice)return T('mt_voice');
        if(c.audio)return T('mt_audio');
        if(c.document)return c.document.fileName||T('mt_file');
        if(c.poll)return T('mt_poll');
        if(c.contact)return T('mt_contact');
        if(c.location||c.geo)return T('mt_location');
        return T('new_message');
    }
    function sendPopup(pid,title,text){
        text=(text||'').replace(/\s+/g,' ').trim();      // превью в одну строку, как в TG
        toDataUrl(domAvatar(pid)).then(function(icon){
            INV('show_notification',{title:title,body:text,icon:icon,sender:title,peerId:String(pid),playSound:false}).catch(function(){});
        });
    }

    // Источник уведомлений — перехват notify-пайплайна Telegram (см. notif-intercept.js):
    // в фокусе TG идёт через window.Notification, в фоне — через postMessage в service
    // worker ('showMessageNotification'). Оба пути кладут сюда {title,body,icon,chatId,
    // messageId,isSilent}. Старый опрос tgRuntime.getGlobal МЁРТВ: webZ переехал на Vite,
    // глобального webpack-require больше нет, состояние из страницы недостижимо.
    function handleTgNotif(p){
        if(!p)return;
        var pid = p.chatId!=null ? String(p.chatId) : '';
        // Категория по знаку peerId: >0 личка, иначе группа/канал. Канал от группы по
        // источнику не отличить — фильтр notif_cat_channel схлопнут в group.
        var cat = (pid.charAt(0)==='-') ? 'group' : 'private';
        if(cfg['notif_cat_'+cat]===false)return;                       // категория выключена
        if(pid && String(pid)===String(currentPeer()) && document.hasFocus())return; // открытый чат в фокусе
        var title=(p.title||'').trim()||'Telegram';
        var text=(p.body||'').replace(/\s+/g,' ').trim();
        // Иконку (blob:/data:) конвертим: main не достанет blob из рендерера. Нет иконки
        // в payload — берём аватар из строки чат-листа по peerId.
        toDataUrl(p.icon||domAvatar(pid)).then(function(icon){
            INV('show_notification',{title:title,body:text,icon:icon,sender:title,peerId:pid,playSound:false}).catch(function(){});
        });
        if(!p.isSilent)playSound();                                    // звук (с дедупом lastTgSound)
    }
    // Регистрируем приёмник и забираем то, что накопилось до старта UI_JS.
    window.__tgOnNotif = handleTgNotif;
    try{ (window.__tgNotifQueue||[]).splice(0).forEach(handleTgNotif); }catch(e){}
})();
// ──────────────────────────────────────────────────────────────────────────

// ── Фикс прыжка прокрутки при смене монитора ───────────────────────────────
// TG webZ кэширует высоту вьюпорта для «прокрутки к низу» и НЕ обновляет её после
// переноса окна на монитор другой высоты → на новое сообщение целится мимо низа
// ровно на разницу clientHeight (список «улетает» на пару сообщений вверх).
// Сверено по логам: на 877px-вьюпорте докрут к низу верный, на 697px промах ≈180px
// (877−697). Чиним так: если список был У НИЗА и пришло новое сообщение — пиннимся
// к реальному низу несколько кадров, перебивая ошибочный докрут TG. Если юзер
// листал историю (gap большой) — не трогаем.
(function stickBottomOnNewMessage(){
    var BOTTOM_EPS=80, lastGap=0, pinUntil=0, pinning=false;
    function scroller(){ return document.querySelector('#MiddleColumn .MessageList'); }
    // gap до низа держим по событию скролла (capture — scroll не всплывает)
    document.addEventListener('scroll', function(e){
        var sc=e.target; if(!sc||!sc.classList||!sc.classList.contains('MessageList'))return;
        lastGap=sc.scrollHeight - sc.scrollTop - sc.clientHeight;
    }, true);
    function pin(){
        var sc=scroller();
        if(sc){ var max=sc.scrollHeight - sc.clientHeight; if(sc.scrollTop<max) sc.scrollTop=max; }
        if(Date.now()<pinUntil) requestAnimationFrame(pin); else pinning=false;
    }
    var mo=new MutationObserver(function(muts){
        var added=false;
        for(var i=0;i<muts.length && !added;i++){ var ns=muts[i].addedNodes;
            for(var j=0;j<ns.length;j++){ var n=ns[j]; if(n.nodeType===1&&n.classList&&n.classList.contains('Message')){ added=true; break; } } }
        if(!added)return;
        if(lastGap>BOTTOM_EPS)return;                    // юзер листал историю — не дёргаем
        pinUntil=Date.now()+600; if(!pinning){ pinning=true; requestAnimationFrame(pin); }
    });
    function arm(){ var mc=document.getElementById('MiddleColumn')||document.body; if(mc) mo.observe(mc,{childList:true,subtree:true}); else setTimeout(arm,200); }
    arm();
})();
// ──────────────────────────────────────────────────────────────────────────