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
        x.beginPath(); x.arc(cx,cy,r,0,Math.PI*2); x.fillStyle='#F23C34'; x.fill();
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

    // Счётчик для трея/таскбара: число НЕприглушённых неархивных чатов с непрочи-
    // танными. ОСНОВНОЙ источник — состояние TG (getGlobal): unreadCount берём из
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
            count++;
        }
        return count;
    }
    function domUnreadCount(){
        var count=0;
        document.querySelectorAll('.chat-list .ListItem.Chat').forEach(function(it){
            if(it.className.indexOf('chat-item-archive')>=0)return;
            if(it.querySelector('.icon-muted'))return;
            var unread=false;
            it.querySelectorAll('.chat-badge-transition').forEach(function(b){
                var n=parseInt((b.textContent||'').replace(/[^0-9]/g,''),10);
                if(!isNaN(n)&&n>0)unread=true;
            });
            if(unread)count++;
        });
        return count;
    }
    let _lastBadgeCount_=-1, _pendingDrop=null;
    setInterval(()=>{
        var nat=nativeUnreadCount(), fromState=(nat!==null);
        var count = fromState ? nat : domUnreadCount();
        if(count===_lastBadgeCount_){ _pendingDrop=null; return; }
        // Стейт точный → применяем сразу. DOM-снижение подтверждаем один тик.
        if(!fromState && _lastBadgeCount_>=0 && count<_lastBadgeCount_ && _pendingDrop!==count){ _pendingDrop=count; return; }
        _pendingDrop=null;
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

// ── Перехват входящих → фирменный звук уведомления ─────────────────────────
// При включённых «Веб-уведомлениях» Telegram уходит в путь системного
// уведомления и НЕ играет свой in-app звук (системное мы фейкаем) → тишина.
// Чиним: сами играем фирменный /a/notification.mp3 на каждое входящее.
// Следим за ростом счётчика непрочитанных в чат-листе (надёжно, по-сообщенно).
// Если TG звук всё же сыграл сам (галка выключена) — не дублируем.
(function setupIncomingSound(){
    var counts={}, seeded=false, lastTgSound=0, seedTs=0;
    // Холодная загрузка: строки чат-листа появляются РАНЬШE своих бейджей
    // непрочитанных. seed ловит count=0, затем доезжают реальные числа → каждый
    // чат выглядит «выросшим» и сыпет попап. Поэтому первые STARTUP_GRACE мс
    // только обновляем счётчики, без попапов (бейджи успевают досинхрониться).
    var STARTUP_GRACE=5000;
    // Кэш настроек (звук/громкость/категории). Обновляем периодически — это
    // дешёвый INV('get_settings'), и уведомления реагируют на переключатели
    // без перезагрузки.
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

    // Тип чата по данным строки чат-листа.
    // Тип чата для категорий: private | group | channel.
    // private — peerId > 0 (надёжно). Группа и канал в чат-листе НЕразличимы
    // (оба className "group", id отрицательный), поэтому канал учим при открытии
    // чата: у канала (не-админ) нет поля ввода #editable-message-text.
    // Кэш peerId→тип; неизвестные отрицательные считаем группой (ничего не глушим зря).
    var typeCache = {};
    function learnType(){
        var pid = currentPeer();
        if(!pid || pid.charAt(0)!=='-') return;          // открыт не отрицательный чат
        // форум-супергруппа сначала показывает список тем без композера — не канал
        var headerForum = document.querySelector('.MiddleHeader .Avatar.forum, .MiddleHeader [class*="forum"]');
        if(headerForum){ typeCache[pid]='group'; return; }
        var hasComposer = !!document.getElementById('editable-message-text');
        typeCache[pid] = hasComposer ? 'group' : 'channel';
    }
    function chatType(item,pid){
        if(parseInt(pid,10)>0) return 'private';
        if(item && item.className.indexOf('forum')>=0) return 'group';   // форум = супергруппа
        return typeCache[pid] || 'group';
    }

    function badgeOf(it){
        var max=0;
        it.querySelectorAll('.chat-badge-transition').forEach(function(b){
            var n=parseInt((b.textContent||'').replace(/[^0-9]/g,''),10);
            if(!isNaN(n)&&n>max)max=n;
        });
        return max;
    }
    function peerOf(it){var a=it.querySelector('.Avatar[data-peer-id]');return a?a.getAttribute('data-peer-id'):null;}
    function mutedOf(it){return !!it.querySelector('.icon-muted');}
    function titleOf(it){var t=it.querySelector('h3.fullName, .title h3, .fullName');return t?t.textContent.trim().replace(/\s+/g,' '):'';}
    function textOf(it){
        var p=it.querySelector('.last-message');
        if(!p)return '';
        // Черновик (моё неотправленное) — в превью имеет приоритет над входящим;
        // не утекаем его в уведомление, лучше фолбэк «Новое сообщение».
        if(p.querySelector('[class*="draft" i]'))return '';
        var s=(p.textContent||'').trim().replace(/\s+/g,' ');
        if(/^(Черновик|Draft)\s*:/i.test(s))return '';
        return s;
    }
    function avatarOf(it){var img=it.querySelector('.Avatar img.Avatar__media, .Avatar img');return img&&img.src?img.src:'';}
    function currentPeer(){var el=document.querySelector('.MiddleHeader .ChatInfo .Avatar[data-peer-id]');return el?el.getAttribute('data-peer-id'):'';}
    // Текст последнего ВХОДЯЩЕГО сообщения из ОТКРЫТОГО чата (DOM пузыря). Нужно,
    // когда в превью чат-листа висит черновик (ответ) и текста входящего там нет —
    // но сам чат открыт (мы как раз отвечали), значит сообщение отрисовано.
    function openChatLastIncomingText(){
        var ml=document.querySelector('#MiddleColumn .MessageList');
        if(!ml)return '';
        var msgs=ml.querySelectorAll('.Message:not(.own)');
        if(!msgs.length)return '';
        var tc=msgs[msgs.length-1].querySelector('.text-content');
        if(!tc)return '';
        var clone=tc.cloneNode(true);
        clone.querySelectorAll('.MessageMeta, .message-time, time, .reactions, .Reactions').forEach(function(e){e.remove();});
        return (clone.textContent||'').trim().replace(/\s+/g,' ');
    }
    function toDataUrl(src){
        return new Promise(function(res){
            if(!src||src.indexOf('blob:')!==0)return res(src||'');
            fetch(src).then(function(r){return r.blob();}).then(function(b){
                var fr=new FileReader();fr.onload=function(){res(fr.result);};fr.onerror=function(){res('');};fr.readAsDataURL(b);
            }).catch(function(){res('');});
        });
    }
    function findItem(pid){
        var found=null;
        document.querySelectorAll('.chat-list .ListItem.Chat').forEach(function(x){
            var a=x.querySelector('.Avatar[data-peer-id]');
            if(a&&a.getAttribute('data-peer-id')===String(pid))found=x;
        });
        return found;
    }
    function sendPopup(item,pid){
        var title=titleOf(item)||'Telegram';
        var text=textOf(item);
        // Превью пустое из-за черновика → читаем входящее из открытого чата.
        if(!text && String(pid)===String(currentPeer())) text=openChatLastIncomingText();
        text=text||T('new_message');
        toDataUrl(avatarOf(item)).then(function(icon){
            INV('show_notification',{title:title,body:text,icon:icon,sender:title,peerId:pid,playSound:false}).catch(function(){});
        });
    }
    // Текстовое уведомление на экран (звук отдельно — playSound:false).
    // Превью .last-message обновляется на КАДР позже бейджа: на первое сообщение оно
    // ещё пустое, а иногда показывает МОЁ предыдущее/черновик. Поэтому всегда читаем
    // с паузой (~320мс) и перечитываем строку по pid (могла перевиртуализироваться).
    function popup(item,pid){
        setTimeout(function(){ sendPopup(findItem(pid)||item, pid); }, 320);
    }

    function scan(){
        learnType();                                        // учим тип открытого чата (канал/группа)
        var items=document.querySelectorAll('.chat-list .ListItem.Chat');
        if(!items.length)return;
        var openPeer=currentPeer();
        var focused=document.hasFocus();
        var fire=false;
        items.forEach(function(item){
            if(item.className.indexOf('chat-item-archive')>=0)return;
            var pid=peerOf(item);
            if(!pid)return;
            var cnt=badgeOf(item);
            var prev=counts[pid];
            counts[pid]=cnt;
            if(cnt<=0)return;
            if(mutedOf(item))return;                        // приглушённые — без звука и попапа
            var ctype=chatType(item,pid);
            if(cfg['notif_cat_'+ctype]===false)return;      // категория выключена в настройках
            if(!seeded)return;                              // первый проход — только seed
            if(Date.now()-seedTs<STARTUP_GRACE)return;      // холодная загрузка: бейджи ещё доезжают
            if(prev===undefined)return;                     // впервые видим чат (виртуализация) — не новое
            if(cnt<=prev)return;                            // счётчик не вырос — не новое
            if(pid===openPeer&&focused)return;              // активный чат в фокусе — пропускаем
            fire=true;
            popup(item,pid);                                // текстовый попап на экран
        });
        if(!seeded){ seeded=true; seedTs=Date.now(); }
        if(fire)playSound();                                // один звук за тик, без наложений
    }
    scan();
    setInterval(scan,500);
})();
// ──────────────────────────────────────────────────────────────────────────