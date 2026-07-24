function ensureCornerWrap(){
    if(document.getElementById('_cnw_')||!document.body)return;
    const w=document.createElement('div');w.id='_cnw_';w.className='_cnotif_wrap_';
    document.body.appendChild(w);
}
function showCornerNotif(data){
    ensureCornerWrap();
    const w=document.getElementById('_cnw_');if(!w)return;
    const titleText=(data&&data.title?String(data.title).trim():'')||'Telegram';
    const bodyText=(data&&data.body?String(data.body).trim():'')||T('new_message');
    const el=document.createElement('div');el.className='_cnotif_';
    const av=document.createElement('div');av.className='_cnotif_av_';
    if(data&&data.icon){const _img=document.createElement('img');_img.src=data.icon;_img.onerror=function(){this.style.display='none';};av.appendChild(_img);}
    else{av.textContent=(titleText||'?')[0].toUpperCase();}
    const body=document.createElement('div');body.className='_cnotif_body_';
    const title=document.createElement('div');title.className='_cnotif_title_';title.textContent=titleText;
    const text=document.createElement('div');text.className='_cnotif_text_';text.textContent=bodyText;
    const prog=document.createElement('div');prog.className='_cnotif_prog_';prog.innerHTML='<span></span>';
    body.appendChild(title);body.appendChild(text);body.appendChild(prog);
    const cls=document.createElement('button');cls.className='_cnotif_close_';cls.textContent='✕';
    el.appendChild(av);el.appendChild(body);el.appendChild(cls);
    w.appendChild(el);
    function dismiss(){el.classList.add('out');setTimeout(()=>el.remove(),220);}
    cls.addEventListener('click',dismiss);
    const t=setTimeout(dismiss,5000);
    cls.addEventListener('click',()=>clearTimeout(t));
}
if(window.tgBridge){
    window.tgBridge.onNotification(function(data){showCornerNotif(data);});
}

// ── Обновления ────────────────────────────────────────────────────────────
async function showUpdateModal(data){
    const verLine=T('upd_avail')+' <b>v'+data.version+'</b>'+(data.current?' ('+T('upd_now')+': v'+data.current+')':'');
    const clBox='<div id="_upd_cl_" style="margin-top:12px;background:#1a1a1a;border-radius:12px;padding:12px 14px;font-size:14px;color:#ccc;line-height:1.6;white-space:pre-wrap;max-height:220px;overflow-y:auto;">'+T('loading')+'</div>';
    const fname=data.filename||('Telegram Web Desktop Setup '+data.version+'.exe');
    showModal({
        title:T('upd_title'),
        msg:verLine+'<br>'+clBox,
        okText:T('upd_download'),
        cancelText:T('upd_later'),
        extraBtn:{label:T('upd_skip'),danger:false},
        onOk:async()=>{showUpdateProgress(data.url,fname,data.version);},
        onExtra:async()=>{await INV('skip_version',{version:data.version});},
    });
    // notes из релиза приходят в событии — показываем сразу; иначе дёргаем fetch_changelog.
    if(data.notes&&data.notes.trim()){
        const el=document.getElementById('_upd_cl_');if(el)el.textContent=data.notes.trim();
    }else{
        try{
            const r=await INV('fetch_changelog');
            const el=document.getElementById('_upd_cl_');
            if(el)el.textContent=r.error?(T('error')+': '+r.error):(r.text||T('cl_empty'));
        }catch(e){const el=document.getElementById('_upd_cl_');if(el)el.textContent=T('load_error');}
    }
}
function showUpdateProgress(url,filename,version){
    ensureCornerWrap();
    const w=document.getElementById('_cnw_');if(!w)return;
    const el=document.createElement('div');el.className='_cnotif_';el.style.minWidth='280px';
    const av=document.createElement('div');av.className='_cnotif_av_';av.innerHTML='<i class="icon icon-download" style="font-size:18px;color:#5288c1"></i>';
    const body=document.createElement('div');body.className='_cnotif_body_';
    const title=document.createElement('div');title.className='_cnotif_title_';title.textContent=T('upd_dl')+' v'+version;
    const text=document.createElement('div');text.className='_cnotif_text_';text.textContent=T('upd_preparing');
    const bar=document.createElement('div');bar.className='_upd_bar_';
    const barInner=document.createElement('div');barInner.className='_upd_prog_';barInner.innerHTML='<span></span>';
    bar.appendChild(barInner);
    body.appendChild(title);body.appendChild(text);body.appendChild(bar);
    el.appendChild(av);el.appendChild(body);w.appendChild(el);
    function fmtBytes(b){if(b<1048576)return (b/1024).toFixed(0)+'KB';return (b/1048576).toFixed(1)+'MB';}
    el._setProgress=function(r,t){text.textContent=fmtBytes(r)+(t?' / '+fmtBytes(t):'');const sp=barInner.querySelector('span');if(sp&&t)sp.style.width=Math.round(r/t*100)+'%';};
    el._setDone=function(err){if(err){title.textContent=T('error');text.textContent=err;av.innerHTML='<i class="icon icon-close" style="color:#e53935"></i>';}else{title.textContent=T('upd_downloaded');text.textContent=T('upd_installing');av.innerHTML='<i class="icon icon-check" style="color:#4caf50"></i>';}setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),220);},3000);};
    window._updEl=el;
    INV('download_update',{url,filename}).catch(()=>{});
}
function setupUpdateListeners(){
    if(!window.tgBridge)return;
    if(window.tgBridge.onUpdateAvailable)window.tgBridge.onUpdateAvailable(function(data){showUpdateModal(data);});
    if(window.tgBridge.onUpdateProgress)window.tgBridge.onUpdateProgress(function(data){if(window._updEl&&window._updEl._setProgress)window._updEl._setProgress(data.received,data.total);});
    if(window.tgBridge.onUpdateDone)window.tgBridge.onUpdateDone(function(data){if(window._updEl&&window._updEl._setDone)window._updEl._setDone(data.error||null);});
}
setupUpdateListeners();

// ── Индикатор загрузки (любой) ──────────────────────────────────────────────
// Угловая карточка на КАЖДУЮ загрузку: имя файла + прогресс-бар + статус. Питается
// download-event (start/progress/done) из downloads-registry.onEvent — туда же
// попадают и blob-сохранения из медиа-просмотрщика (save_blob шлёт start+done).
// Для blob это «мгновенно»: карточка вспыхивает и сразу показывает «Сохранено».
var _dlCards = {};
// #4: карточки, созданные капча-кликом по кнопке скачивания ДО того, как main
// пришлёт will-download (у видео TG сначала тянет по MTProto, will-download
// приходит поздно). Такой pending-карточкой «усыновляет» следующий start.
var _dlClaimable = [];
var _tmpDlId = 0;
function _dlRemoveCard(id){
    var c=_dlCards[id]; if(!c)return;
    delete _dlCards[id];
    _dlClaimable=_dlClaimable.filter(function(x){return x.id!==id;});
    c.el.classList.add('out'); setTimeout(function(){ if(c.el.parentNode)c.el.remove(); },220);
}
// Текущий открытый чат (peerId) — для выбора визуала карточки (в чате / фоновая).
function _dlCurrentPeer(){
    var el=document.querySelector('#MiddleColumn .ChatInfo .Avatar[data-peer-id], .MiddleHeader .ChatInfo .Avatar[data-peer-id]');
    return el?el.getAttribute('data-peer-id'):'';
}
// Компакт-режим карточки, если её загрузка из другого чата (или чат неизвестен-фоновый).
function _dlApplyStyle(c){
    if(!c||!c.el)return;
    var bg = c.peerId && String(c.peerId)!==String(_dlCurrentPeer());
    c.el.classList.toggle('dl_compact', !!bg);
}
// Пересчитать визуал всех карточек при смене чата.
function _dlReflow(){ for(var id in _dlCards) _dlApplyStyle(_dlCards[id]); }
window.__tgdlReflowCards=_dlReflow;

// #4: мгновенная карточка по клику на кнопку скачивания. Возвращает temp-id.
// origName/peerId — best-effort из кликнутого сообщения; peerId пуст → фоновая.
function startImmediateDownloadCard(origName, peerId){
    var id='__tmp'+(--_tmpDlId);
    _makeDlCard(id, origName, peerId, true);
    return id;
}
function _makeDlCard(id, origName, peerId, claimable){
    ensureCornerWrap();
    var w=document.getElementById('_cnw_'); if(!w) return null;
    if(_dlCards[id]) return _dlCards[id];
    var el=document.createElement('div'); el.className='_cnotif_ dl_card'; el.style.minWidth='280px';
    var av=document.createElement('div'); av.className='_cnotif_av_';
    av.innerHTML='<i class="icon icon-download" style="font-size:18px;color:#5288c1"></i>';
    var body=document.createElement('div'); body.className='_cnotif_body_';
    var title=document.createElement('div'); title.className='_cnotif_title_';
    title.textContent=origName||T('dl_card_file');
    var text=document.createElement('div'); text.className='_cnotif_text_'; text.textContent=T('dl_card_downloading');
    var bar=document.createElement('div'); bar.className='_upd_bar_';
    var barInner=document.createElement('div'); barInner.className='_upd_prog_'; barInner.innerHTML='<span></span>';
    bar.appendChild(barInner);
    body.appendChild(title); body.appendChild(text); body.appendChild(bar);
    var cls=document.createElement('button'); cls.className='_cnotif_close_'; cls.textContent='✕';
    el.appendChild(av); el.appendChild(body); el.appendChild(cls);
    w.appendChild(el);
    var c={el:el, av:av, title:title, text:text, span:barInner.querySelector('span'), timer:null, peerId:peerId||'', origName:origName||''};
    // ✕ на живой загрузке отменяет её в main (для temp-id отменять нечего — просто скрыть).
    cls.addEventListener('click',function(e){
        e.stopPropagation();
        if(String(id).indexOf('__tmp')!==0) INV('cancel_download',{id:id}).catch(function(){});
        _dlRemoveCard(id);
    });
    _dlCards[id]=c;
    _dlApplyStyle(c);
    // Страховка: осиротевшую temp-карточку (will-download так и не пришёл — клик был
    // не по загрузке, либо файл уже скачан) убираем через 60с. Большой запас, чтобы
    // «Скачивание…» жило пока TG тянет крупное видео по MTProto до will-download.
    if(claimable){ _dlClaimable.push({id:id, ts:Date.now(), origName:origName||''});
        c.timer=setTimeout(function(){ _dlRemoveCard(id); }, 60000); }
    return c;
}
// start пришёл из main — усыновляем самую свежую temp-карточку (по имени, иначе старейшую).
function _claimCard(realId, data){
    var idx=-1, now=Date.now();
    for(var i=0;i<_dlClaimable.length;i++){
        var e=_dlClaimable[i];
        if(now-e.ts>60000) continue;
        if((data.origName||data.filename) && e.origName && e.origName===(data.origName||data.filename)){ idx=i; break; }
        if(idx<0) idx=i;   // fallback: старейшая живая
    }
    if(idx<0) return null;
    var claim=_dlClaimable.splice(idx,1)[0];
    var c=_dlCards[claim.id]; if(!c) return null;
    delete _dlCards[claim.id];
    if(c.timer){ clearTimeout(c.timer); c.timer=null; }
    _dlCards[realId]=c;
    if(data.origName||data.filename) c.title.textContent=data.origName||data.filename;
    return c;
}
function showDownloadIndicator(data){
    if(!data||!data.id||!window.tgBridge) return;
    ensureCornerWrap();
    var w=document.getElementById('_cnw_'); if(!w) return;
    var id=data.id;
    if(data.type==='start'){
        if(_dlCards[id]) return;
        if(_claimCard(id, data)) return;   // усыновили мгновенную карточку — новую не плодим
        _makeDlCard(id, data.origName||data.filename, '', false);
    } else if(data.type==='progress'){
        var c=_dlCards[id]; if(!c) return;
        var r=data.received||0, t=data.total||0;
        c.text.textContent=_fmtBytes_dl(r)+(t?' / '+_fmtBytes_dl(t):'');
        if(c.span&&t) c.span.style.width=Math.round(r/t*100)+'%';
    } else if(data.type==='done'){
        if(!_dlCards[id]) _makeDlCard(id, data.origName||data.filename, '', false);
        var c2=_dlCards[id]; if(!c2) return;
        var ok=data.status==='completed';
        var cancelled=data.status==='cancelled';
        if(c2.timer) clearTimeout(c2.timer);
        if(ok){
            c2.text.textContent=T('dl_card_saved')+' · '+T('dl_card_open');
            if(c2.span) c2.span.style.width='100%';
            c2.av.innerHTML='<i class="icon icon-check" style="color:#4caf50;font-size:18px"></i>';
            c2.el.style.cursor='pointer'; c2.el.title=T('dl_card_open');
            c2.el.addEventListener('click',function(){ INV('open_download_file',{id:id}).catch(function(){}); });
        } else if(cancelled){
            c2.text.textContent=T('dl_st_cancelled');
            c2.av.innerHTML='<i class="icon icon-close" style="color:#7e8794;font-size:18px"></i>';
        } else {
            c2.text.textContent=T('dl_card_failed');
            c2.av.innerHTML='<i class="icon icon-close" style="color:#e53935;font-size:18px"></i>';
        }
        c2.timer=setTimeout(function(){ _dlRemoveCard(id); }, ok?4500:6000);
    }
}

// Версия, которую описывает текст ниже (wn_1..wn_3). Показываем «Что нового»
// ТОЛЬКО для неё — иначе при апдейте на новую версию всплывал бы старый текст.
// При новом релизе: обновить wn_* в lang.js + поднять эту строку.
const WHATSNEW_VERSION='1.2.0';
// ── «Что нового» — один раз при первом запуске новой версии ─────────────────
async function showWhatsNewIfNeeded(){
    try{
        const info=await INV('get_app_info');
        const ver=info&&info.version;
        if(!ver)return;
        if(ver!==WHATSNEW_VERSION)return;                     // текст не про эту версию
        const s=await INV('get_settings');
        if(s&&s.whatsnew_shown_version===ver)return;          // уже показывали для этой версии
        const item=t=>'<div style="display:flex;gap:10px;align-items:flex-start;margin-top:12px;">'
            +'<span style="color:var(--color-primary,#8774e1);font-size:18px;line-height:1.3;flex-shrink:0;">•</span>'
            +'<span style="line-height:1.4;">'+t+'</span></div>';
        const body='<div style="color:rgba(255,255,255,.55);font-size:13px;margin-bottom:2px;">'+T('wn_intro')+'</div>'
            +item(T('wn_1'))+item(T('wn_2'))+item(T('wn_3'));
        showModal({
            title:T('wn_title'),
            msg:body,
            okText:T('wn_ok'),
            cancelText:null,
            onOk:async()=>{
                try{const ss=await INV('get_settings');await INV('save_settings',{settings:Object.assign({},ss,{whatsnew_shown_version:ver})});}catch(e){}
            },
        });
    }catch(e){}
}

// «Список изменений» теперь рисуется нативной панелью (renderChangelogNative
// в native-panels.js). Старый renderCl удалён.
