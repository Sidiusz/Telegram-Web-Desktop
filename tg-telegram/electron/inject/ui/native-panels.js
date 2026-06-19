// animate=false — мгновенно (при открытии новой панели поверх). По умолчанию
// проигрываем обратную анимацию (снимаем _in_), затем удаляем — чтобы у «Назад»
// был такой же слайд/фейд, как при открытии.
function closeNativePanel(animate){
    // Глушим live-таймер «Загрузок» — иначе он перерисует downloads в _tgpc_
    // следующей панели (открыл Настройки поверх Загрузок → видел снова Загрузки).
    if(_dlNativeTimer){ clearInterval(_dlNativeTimer); _dlNativeTimer=null; }
    if(window.__tgdlNativeRefresh) delete window.__tgdlNativeRefresh;
    if(!_nativePanel) return;
    var p=_nativePanel; _nativePanel=null;
    var st=document.getElementById('Settings'); if(st) st.classList.remove('_tgpush_');  // вернуть экран
    if(animate===false){ p.remove(); return; }
    p.classList.remove('_in_');
    setTimeout(function(){ if(p&&p.parentNode) p.remove(); }, 280);
}

// Открывает нативный экран Настроек TG (клик по пункту «Настройки» в сайд-меню).
// Используется когда нашу панель зовут из гамбургер-меню при закрытых настройках.
function tgOpenSettings(){
    const item=Array.from(document.querySelectorAll('.MenuItem.compact:not([id])')).find(el=>el.querySelector('.icon-settings'));
    if(item){
        const r=item.getBoundingClientRect();
        const opt={bubbles:true,cancelable:true,view:window,button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2};
        item.dispatchEvent(new MouseEvent('mousedown',opt));
        item.dispatchEvent(new MouseEvent('mouseup',opt));
        item.dispatchEvent(new MouseEvent('click',opt));
    }
}
function openNativePanel(opts){
    opts=opts||{};
    closeNativePanel(false);
    const settings=document.getElementById('Settings');
    if(!settings) return;
    // Снимаем эталон шапки с живого нативного раздела (любой .left-header внутри #Settings).
    const srcHdr=settings.querySelector('.left-header');
    const panel=document.createElement('div');
    panel.className='_tgpanel_';
    // Шапка — клон нативной: оставляем только кнопку «Назад» + h3.
    if(srcHdr){
        const hdr=srcHdr.cloneNode(false);          // только классы, без детей
        const back=document.createElement('button');
        back.type='button';
        back.className='Button smaller translucent round';
        back.setAttribute('aria-label','Назад'); back.title='Назад';
        back.innerHTML='<i class="icon icon-arrow-left" aria-hidden="true"></i>';
        const h3=document.createElement('h3'); h3.textContent=opts.title||'';
        hdr.appendChild(back); hdr.appendChild(h3);
        if(opts.renderHeader) opts.renderHeader(hdr);
        back.addEventListener('click',()=>{ closeNativePanel(); if(opts.onBack)opts.onBack(); });
        panel.appendChild(hdr);
    }
    // Контент: тот же класс, что у нативного раздела (custom-scroll + with-notch),
    // скроллится, имеет отступы. ID даём, чтобы renderContent нашёл.
    const content=document.createElement('div');
    content.className='settings-content custom-scroll with-notch';
    content.id='_tgpc_';
    panel.appendChild(content);
    // Кладём поверх колонки настроек (та же геометрия, что у слайдов).
    settings.style.position=settings.style.position||'relative';
    settings.appendChild(panel);
    _nativePanel=panel;
    if(opts.renderContent) opts.renderContent(content);
    // Push-анимация: текущий экран назад + наша панель наезжает поверх.
    requestAnimationFrame(()=>{ settings.classList.add('_tgpush_'); panel.classList.add('_in_'); });
    return panel;
}

// ── «Настройки приложения» как нативный раздел (#5) ────────────────────────
// Контент — renderSt (настройки приложения), шапка без доп.кнопок.
function openAppSettingsNative(){
    // Нативная панель рисуется внутри #Settings (его колонки). Если экран настроек
    // закрыт (вызвали из гамбургер-меню) — сначала откроем его, затем покажем панель.
    if(!document.getElementById('Settings')){
        tgOpenSettings();
        // ждём появления #Settings (React монтирует асинхронно), потом открываем
        const tries=setInterval(()=>{
            if(document.getElementById('Settings')){ clearInterval(tries); openAppSettingsNative(); }
        },80);
        setTimeout(()=>clearInterval(tries),4000);  // страховка от вечного поллинга
        return;
    }
    openNativePanel({
        title:T('app_settings'),
        renderHeader(hdr){
            // ничего лишнего в шапку не кладём (нативный раздел обычно без доп.кнопок)
        },
        renderContent(content){
            renderSt(content);
        },
    });
}

// ── «Загрузки» как нативный раздел (#5) ────────────────────────────────────
// Строки — клоны нативного .ListItem multiline (title=имя, subtitle=статус/путь),
// иконка по расширению, справа — действия Открыть/Папа/Удалить. Свой Назад.
let _dlNativeTimer=null;
function openDownloadsNative(){
    // Нативная панель рисуется внутри #Settings (его колонки). Если экран настроек
    // закрыт (вызвали из гамбургер-меню) — сначала откроем его, затем покажем панель.
    if(!document.getElementById('Settings')){
        tgOpenSettings();
        // ждём появления #Settings (React монтирует асинхронно), потом открываем
        const tries=setInterval(()=>{
            if(document.getElementById('Settings')){ clearInterval(tries); openDownloadsNative(); }
        },80);
        setTimeout(()=>clearInterval(tries),4000);  // страховка от вечного поллинга
        return;
    }
    const refresh=()=>{ const c=document.getElementById('_tgpc_'); if(c) renderDownloadsNative(c); };
    const panel=openNativePanel({
        title:T('downloads'),
        renderHeader(hdr){
            const clr=document.createElement('button');
            clr.className='_tpclr_';
            clr.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Очистить';
            clr.addEventListener('click',()=>{
                showModal({
                    title:'Очистить загрузки',msg:'Удалить все записи загрузок?<br><small style="color:#aaa">Файлы на диске также будут удалены.</small>',
                    okText:'ОЧИСТИТЬ',okDanger:true,
                    onOk:async()=>{
                        const items=await INV('get_downloads');
                        for(const d of (items||[])) await INV('delete_download',{id:d.id});
                        refresh();
                    }
                });
            });
            // кнопка «Назад» уже есть в шапке; «Очистить» кладём рядом с h3.
            hdr.appendChild(clr);
        },
        renderContent(content){
            renderDownloadsNative(content);
        },
        onBack(){ closeNativeDlPanel(); }
    });
    // live-refresh + хук для DL-registry (обновит список при событиях загрузки)
    window.__tgdlNativeRefresh=refresh;
    if(_dlNativeTimer)clearInterval(_dlNativeTimer);
    _dlNativeTimer=setInterval(()=>{
        if(document.getElementById('_tgpc_')) refresh();
        else closeNativeDlPanel();
    },700);
    return panel;
}
function closeNativeDlPanel(){
    if(_dlNativeTimer){clearInterval(_dlNativeTimer);_dlNativeTimer=null;}
    delete window.__tgdlNativeRefresh;
    closeNativePanel();
}

// ── «Дополнения» как нативный раздел ────────────────────────────────────────
// Отдельная панель (своя кнопка в гамбургер-меню), а не закопанный раздел настроек.
// Тумблеры мгновенно сохраняют состояние; группа взаимоисключающая → включение
// одного автоматически гасит остальные той же группы. Кнопка «Применить» —
// перезагрузка страницы (аддоны инжектятся на загрузке).
function openAddonsNative(){
    if(!document.getElementById('Settings')){
        tgOpenSettings();
        const tries=setInterval(()=>{
            if(document.getElementById('Settings')){ clearInterval(tries); openAddonsNative(); }
        },80);
        setTimeout(()=>clearInterval(tries),4000);
        return;
    }
    openNativePanel({
        title:T('addons'),
        renderHeader(hdr){
            const fb=document.createElement('button');
            fb.className='_tpclr_'; fb.style.background='rgba(255,255,255,.08)'; fb.style.color='#fff';
            fb.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>Папка';
            fb.addEventListener('click',()=>INV('open_addons_folder'));
            hdr.appendChild(fb);
        },
        renderContent(content){ renderAddonsNative(content); },
    });
}

var GROUP_NAMES={ desktop_like_chat:{ru:'Оформление сообщений',en:'Message layout'} };
function groupName(g){ var e=GROUP_NAMES[g]; return e?(e[curLang()]||e.en):g; }

async function renderAddonsNative(content){
    if(!content)return;
    content.innerHTML='<div class="_tpempty_">'+T('loading')+'</div>';
    let addons=[];
    try{ addons=await INV('get_addons'); }
    catch(e){ content.innerHTML='<div class="_tpempty_">'+T('load_error')+'</div>'; return; }
    content.innerHTML='';

    let applyBar=null;
    const markDirty=()=>{ if(applyBar) applyBar.style.display='flex'; };
    const ce=cls=>{const d=document.createElement('div');if(cls)d.className=cls;return d;};
    const lbl=t=>{const d=ce('_ns_lbl_');d.textContent=t;content.appendChild(d);};
    const card=()=>{const d=ce('_ns_card_');content.appendChild(d);return d;};
    const main=(title,sub)=>{const m=ce('_ns_main_');const t=ce('_ns_title_');t.textContent=title;m.appendChild(t);if(sub){const x=ce('_ns_sub_');x.textContent=sub;m.appendChild(x);}return m;};

    // ungrouped add-on → toggle row (+delete for custom)
    function toggleRow(cd,a){
        const r=ce('_ns_row_'); cd.appendChild(r);
        r.appendChild(main(a.display_name||a.name, a.version?('v'+a.version):null));
        if(!a.embedded){
            const del=document.createElement('button'); del.className='_addon_del_'; del.title=T('dl_delete');
            del.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            del.addEventListener('click',()=>showModal({title:T('ad_del_t'),msg:'«'+(a.display_name||a.name)+'»?',okText:T('del_upper'),okDanger:true,onOk:async()=>{await INV('delete_addon',{name:a.name});renderAddonsNative(content);}}));
            r.appendChild(del);
        }
        const sw=document.createElement('label'); sw.className='_ns_swt_';
        const chk=document.createElement('input'); chk.type='checkbox'; chk.checked=!!a.enabled;
        sw.appendChild(chk); sw.appendChild(document.createElement('i'));
        chk.addEventListener('change',async()=>{ a.enabled=chk.checked; await INV('toggle_addon',{key:a.key,enabled:chk.checked}); markDirty(); });
        r.appendChild(sw);
    }

    // same-group add-ons are mutually exclusive → radio (incl. "Off")
    function radioGroup(g,list){
        lbl(groupName(g));
        const cd=card(); const radios=[];
        const refresh=()=>{ const anyOn=list.some(a=>a.enabled); radios.forEach(rd=>rd.el.classList.toggle('_on_', rd.a?rd.a.enabled:!anyOn)); };
        const pick=(addon)=>{ list.forEach(a=>{ const want=(a===addon); if(a.enabled!==want){ a.enabled=want; INV('toggle_addon',{key:a.key,enabled:want}); } }); refresh(); markDirty(); };
        const addRadio=(label,addon)=>{
            const r=ce('_ns_row_'); r.style.cursor='pointer'; cd.appendChild(r);
            r.appendChild(main(label, addon?('v'+(addon.version||'')):null));
            const rad=ce('_ns_radio_'); r.appendChild(rad);
            radios.push({el:rad,a:addon});
            r.addEventListener('click',()=>pick(addon));
        };
        addRadio(T('addon_off'),null);
        list.forEach(a=>addRadio(a.display_name||a.name,a));
        refresh();
    }

    const groups={};
    addons.forEach(a=>{ if(a.group)(groups[a.group]=groups[a.group]||[]).push(a); });
    const embSingle=addons.filter(a=>a.embedded && !a.group);
    const userSingle=addons.filter(a=>!a.embedded && !a.group);

    Object.keys(groups).forEach(g=>radioGroup(g,groups[g]));
    if(embSingle.length){ lbl(T('ad_builtin')); const cd=card(); embSingle.forEach(a=>toggleRow(cd,a)); }
    lbl(T('ad_user'));
    if(userSingle.length){ const cd=card(); userSingle.forEach(a=>toggleRow(cd,a)); }
    else { const em=ce('_tpempty_'); em.style.padding='16px'; em.textContent=T('ad_none'); content.appendChild(em); }

    applyBar=ce('_addons_apply_'); applyBar.style.display='none';
    const ab=document.createElement('button');
    ab.innerHTML='<i class="icon icon-reload"></i> '+T('ad_apply');
    ab.addEventListener('click',()=>INV('apply_addons'));
    applyBar.appendChild(ab);
    content.appendChild(applyBar);
}

// ── «Список изменений» как нативный раздел ──────────────────────────────────
function openChangelogNative(){
    if(!document.getElementById('Settings')){
        tgOpenSettings();
        const tries=setInterval(()=>{
            if(document.getElementById('Settings')){ clearInterval(tries); openChangelogNative(); }
        },80);
        setTimeout(()=>clearInterval(tries),4000);
        return;
    }
    openNativePanel({
        title:T('changelog'),
        renderContent(content){ renderChangelogNative(content); },
    });
}
// Сравнение версий "a.b.c" → -1/0/1.
function _clCmpVer(a,b){
    var pa=String(a).split('.').map(Number), pb=String(b).split('.').map(Number);
    for(var i=0;i<Math.max(pa.length,pb.length);i++){ var x=pa[i]||0,y=pb[i]||0; if(x>y)return 1; if(x<y)return -1; }
    return 0;
}
// Строит карточку версии: заголовок с номером (текущая — цветом) + пункты.
function _clVerBlock(v, isCur){
    var card=document.createElement('div'); card.className='_cl_ver_'+(isCur?' _cur_':'');
    var hdr=document.createElement('div'); hdr.className='_cl_ver_hdr_';
    var num=document.createElement('span'); num.className='_cl_vnum_'; num.textContent=(/^\d/.test(v.version)?'v':'')+v.version;
    hdr.appendChild(num);
    if(isCur){ var b=document.createElement('span'); b.className='_cl_cur_badge_'; b.textContent='текущая'; hdr.appendChild(b); }
    card.appendChild(hdr);
    var lines=String(v.notes||'').split(/\r?\n/).map(function(l){return l.trim();}).filter(Boolean);
    if(!lines.length){ var em=document.createElement('div'); em.className='_cl_item_'; em.textContent='Без описания'; card.appendChild(em); return card; }
    lines.forEach(function(line){
        if(/^[_\-—]{3,}$/.test(line)){ var d=document.createElement('div'); d.className='_cl_div_'; card.appendChild(d); return; }
        var item=document.createElement('div'); item.className='_cl_item_';
        var txt=line.replace(/^[-•*]\s*/,'');
        var m=txt.match(/^([^:]{2,24}):\s*(.+)$/);
        if(m){ var t=document.createElement('span'); t.className='_cl_tag_'; t.textContent=m[1]+':'; var sp=document.createTextNode(' '+m[2]); item.appendChild(t); item.appendChild(sp); }
        else { item.textContent=txt; }
        card.appendChild(item);
    });
    return card;
}
async function renderChangelogNative(content){
    if(!content)return;
    content.innerHTML='<div class="_tpempty_">Загрузка…</div>';
    var data=null;
    try{ data=await INV('fetch_changelog_structured'); }catch(e){ data={error:String(e)}; }
    // Есть структура по версиям — рисуем блоками.
    if(data && !data.error && data.versions && data.versions.length){
        content.innerHTML='';
        var cur=data.current;
        var versions=data.versions.slice().sort(function(a,b){ return _clCmpVer(b.version,a.version); });
        var ci=versions.findIndex(function(v){ return v.version===cur; });
        if(ci>0){ versions.unshift(versions.splice(ci,1)[0]); }  // текущую — в самый верх
        versions.forEach(function(v){ content.appendChild(_clVerBlock(v, v.version===cur)); });
        return;
    }
    // Fallback (API недоступен — напр. из РФ): плоский changelog.txt.
    try{
        var r=await INV('fetch_changelog');
        content.innerHTML='';
        if(r&&r.error){ content.innerHTML='<div class="_tpempty_">Ошибка: '+r.error+'</div>'; return; }
        var pre=document.createElement('div'); pre.className='_cl_content_';
        pre.textContent=(r&&r.text)||'Список изменений пуст.';
        content.appendChild(pre);
    }catch(e){ content.innerHTML='<div class="_tpempty_">Ошибка загрузки</div>'; }
}

// Рисует список загрузок в переданный контент-контейнер (нативная панель).
// Эталон строки: <div class="ListItem multiline"><div class="ListItem-button">…</div></div>.
async function renderDownloadsNative(content){
    if(!content)return;
    const merged=await collectDownloads();
    content.innerHTML='';
    if(!merged.length){
        const empty=document.createElement('div');
        empty.className='_tpempty_';
        empty.textContent=T('dl_empty');
        content.appendChild(empty);
        return;
    }
    const card=document.createElement('div'); card.className='_ns_card_'; card.style.marginTop='10px';
    merged.forEach(d=>card.appendChild(_nativeDlRow(d, ()=>renderDownloadsNative(content))));
    content.appendChild(card);
}

// Строка-загрузка в стиле _ns_ (как настройки/дополнения). cb — перерисовка.
function _nativeDlRow(d, cb){
    const done=d.status==='completed';
    const active=d.status==='downloading'||d.status==='pending';
    const row=document.createElement('div'); row.className='_ns_row_';
    const ext=_fileExt(d.filename);
    const ico=document.createElement('div');
    ico.style.cssText='display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;border-radius:8px;width:34px;height:34px;flex-shrink:0;background:'+_extColor(ext)+';';
    ico.textContent=(ext||'?').slice(0,4).toUpperCase();
    row.appendChild(ico);
    const m=document.createElement('div'); m.className='_ns_main_';
    const title=document.createElement('div'); title.className='_ns_title_';
    title.textContent=d.filename||'—';
    title.style.cssText+='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const sub=document.createElement('div'); sub.className='_ns_sub_'; sub.style.color=sColor(d.status);
    if(active){
        const fmt=window.__tgdl&&window.__tgdl.fmtProgress||function(){return '';};
        sub.textContent=d.status==='pending'?T('dl_waiting'):fmt(d.recv,d.total);
    } else if(done){
        const fb=window.__tgdl?window.__tgdl.fmtBytes:function(){return '';};
        sub.textContent=T('dl_done')+(d.total?(' · '+fb(d.total)):'');
    } else {
        sub.textContent=sLabel(d.status);
    }
    m.appendChild(title); m.appendChild(sub); row.appendChild(m);
    const right=document.createElement('div'); right.className='_tpright_';
    if(done&&d.id!=null){
        const fld=document.createElement('button'); fld.title=T('dl_show_folder');
        fld.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
        fld.addEventListener('click',e=>{e.stopPropagation();INV('open_download_folder',{id:d.id}).then(r=>{if(r&&r.error)toast(T('dl_not_found'));}).catch(()=>{});});
        right.appendChild(fld);
    }
    if(d.id!=null){
        const del=document.createElement('button'); del.className='danger'; del.title=T('dl_delete');
        del.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        del.addEventListener('click',e=>{
            e.stopPropagation();
            showModal({title:T('dl_del_t'),msg:'«'+(d.filename||'')+'»?',okText:T('del_upper'),okDanger:true,onOk:async()=>{await INV('delete_download',{id:d.id});cb();}});
        });
        right.appendChild(del);
    }
    row.appendChild(right);
    if(done&&d.id!=null){
        row.style.cursor='pointer';
        row.addEventListener('click',()=>INV('open_download_file',{id:d.id}).then(r=>{if(r&&r.error){toast(T('dl_not_found'));cb();}}).catch(()=>{}));
    }
    return row;
}

function sLabel(s){return{pending:'Ожидание…',downloading:'⬇ Загружается',completed:'✓ Завершено',failed:'✕ Ошибка',cancelled:'— Отменено'}[s]||s;}
function sColor(s){return{pending:'#aaa',downloading:'var(--color-primary,#5288c1)',completed:'#4caf50',failed:'#e53935',cancelled:'#aaa'}[s]||'#aaa';}

// Расширение файла → цвет иконки (упрощённая палитра TG)
function _fileExt(name){ var m=(name||'').match(/.([a-z0-9]+)$/i); return m?m[1].toLowerCase():''; }
function _extColor(ext){
    return ({
        zip:'#c77b41',rar:'#7e57c2','7z':'#5288c1',gz:'#66bb6a',tar:'#8d6e63',
        exe:'#e53935',msi:'#ef6c00',dmg:'#42a5f5',apk:'#8bc34a',deb:'#ef5350',
        pdf:'#e53935',doc:'#2b5278',docx:'#2b5278',xls:'#4caf50',xlsx:'#4caf50',
        ppt:'#ff9800',pptx:'#ff9800',
        mp3:'#ec407a',wav:'#ec407a',flac:'#ec407a',ogg:'#ec407a',
        mp4:'#5c6bc0',mov:'#5c6bc0',avi:'#5c6bc0',mkv:'#5c6bc0',
        jpg:'#ffa726',jpeg:'#ffa726',png:'#ffa726',gif:'#ffa726',webp:'#ffa726',svg:'#ffa726',
        txt:'#90a4ae',js:'#fdd835',ts:'#5288c1',json:'#fdd835',
    })[ext]||'#5288c1';
}

// Объединяет активные (registry) + сохранённые (get_downloads), без дублей по id.
// Общая для модалки загрузок и нативной панели «Загрузки» (#5).
async function collectDownloads(){
    const active=[];
    const reg=window.__tgdl?window.__tgdl.registry:{};
    const byId=window.__tgdl?window.__tgdl.byId:{};
    const seenIds={};
    for(const mid in reg){
        const r=reg[mid];
        if(r.id!=null){ seenIds[r.id]=true; }
        active.push({ id:r.id, mid:r.mid, filename:r.filename, status:r.status, recv:r.recv, total:r.total, live:true });
    }
    let saved=[];
    try{ saved=await INV('get_downloads'); }catch(e){}
    saved=saved||[];
    const merged=[];
    saved.slice().reverse().forEach(d=>{ if(!seenIds[d.id]) merged.push(Object.assign({},d,{live:false})); });
    active.forEach(d=>{ const s=saved.find(x=>x.id===d.id); if(s) d.path=s.path; merged.unshift(d); });
    return merged;
}