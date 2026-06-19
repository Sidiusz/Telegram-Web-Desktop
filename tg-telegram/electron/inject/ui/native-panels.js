function closeNativePanel(){ if(_nativePanel){ _nativePanel.remove(); _nativePanel=null; } }

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
    closeNativePanel();
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
    // Анимация появления (как нативный slide-in).
    requestAnimationFrame(()=>panel.classList.add('_in_'));
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
        title:'Настройки приложения',
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
        title:'Загрузки',
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
        title:'Дополнения',
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

async function renderAddonsNative(content){
    if(!content)return;
    content.innerHTML='<div class="_tpempty_">Загрузка…</div>';
    let addons=[];
    try{ addons=await INV('get_addons'); }
    catch(e){ content.innerHTML='<div class="_tpempty_">Ошибка загрузки</div>'; return; }
    content.innerHTML='';

    let applyBar=null;
    function markDirty(){ if(applyBar) applyBar.style.display='flex'; }

    function grpHdr(text){ const h=document.createElement('div'); h.className='_addongrp_'; h.textContent=text; content.appendChild(h); }

    function row(a){
        const r=document.createElement('div'); r.className='_addonrow_';
        const ico=document.createElement('div'); ico.className='_ai_';
        ico.innerHTML='<i class="icon icon-bots" aria-hidden="true"></i>';
        const meta=document.createElement('div'); meta.className='_am_';
        const nm=document.createElement('div'); nm.className='_an_';
        nm.textContent=a.display_name||a.name;
        const badge=document.createElement('span'); badge.className='_badge_'; badge.textContent=a.addon_type;
        nm.appendChild(badge);
        const sub=document.createElement('div'); sub.className='_as_';
        sub.textContent=(a.version?('v'+a.version):'')+(a.embedded?' · встроенное':' · пользовательское');
        meta.appendChild(nm); meta.appendChild(sub);

        const sw=document.createElement('label'); sw.className='_tgsw_';
        const chk=document.createElement('input'); chk.type='checkbox'; chk.checked=!!a.enabled;
        const tr=document.createElement('span'); tr.className='_tr_';
        sw.appendChild(chk); sw.appendChild(tr);
        a._chk=chk;
        chk.addEventListener('change',async()=>{
            if(chk.checked && a.group){
                for(const o of addons){
                    if(o.key!==a.key && o.group===a.group && o.enabled){
                        o.enabled=false;
                        if(o._chk) o._chk.checked=false;
                        await INV('toggle_addon',{key:o.key,enabled:false});
                    }
                }
            }
            a.enabled=chk.checked;
            await INV('toggle_addon',{key:a.key,enabled:chk.checked});
            markDirty();
        });

        r.appendChild(ico); r.appendChild(meta);
        if(!a.embedded){
            const del=document.createElement('button'); del.className='_addon_del_'; del.title='Удалить';
            del.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            del.addEventListener('click',()=>{
                showModal({title:'Удалить дополнение',msg:'Удалить «'+(a.display_name||a.name)+'»?',okText:'УДАЛИТЬ',okDanger:true,onOk:async()=>{await INV('delete_addon',{name:a.name});renderAddonsNative(content);}});
            });
            r.appendChild(del);
        }
        r.appendChild(sw);
        content.appendChild(r);
    }

    const embedded=addons.filter(a=>a.embedded);
    const user=addons.filter(a=>!a.embedded);
    if(embedded.length){ grpHdr('Встроенные'); embedded.forEach(row); }
    grpHdr('Пользовательские (.js / .crx)');
    if(user.length) user.forEach(row);
    else{ const em=document.createElement('div'); em.className='_tpempty_'; em.style.padding='24px 16px'; em.textContent='Нет пользовательских дополнений'; content.appendChild(em); }

    applyBar=document.createElement('div'); applyBar.className='_addons_apply_'; applyBar.style.display='none';
    const ab=document.createElement('button');
    ab.innerHTML='<i class="icon icon-reload"></i> Применить (перезагрузить)';
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
        title:'Список изменений',
        renderContent(content){ renderChangelogNative(content); },
    });
}
async function renderChangelogNative(content){
    if(!content)return;
    content.innerHTML='<div class="_tpempty_">Загрузка…</div>';
    try{
        const r=await INV('fetch_changelog');
        content.innerHTML='';
        if(r&&r.error){ content.innerHTML='<div class="_tpempty_">Ошибка: '+r.error+'</div>'; return; }
        const pre=document.createElement('div'); pre.className='_cl_content_';
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
        empty.textContent='Нет загрузок';
        content.appendChild(empty);
        return;
    }
    merged.forEach(d=>content.appendChild(_nativeDlRow(d, ()=>renderDownloadsNative(content))));
}

// Строка-загрузка в нативном стиле (клон .ListItem multiline). cb — перерисовка.
function _nativeDlRow(d, cb){
    const done=d.status==='completed';
    const active=d.status==='downloading'||d.status==='pending';
    const failed=d.status==='failed';
    const row=document.createElement('div');
    row.className='ListItem multiline'+(done?'':'');
    const btn=document.createElement('div');
    btn.className='ListItem-button'; btn.setAttribute('role','button'); btn.tabIndex=0;
    // иконка по расширению
    const ext=_fileExt(d.filename);
    const ico=document.createElement('i');
    ico.className='icon ListItem-main-icon';
    ico.setAttribute('aria-hidden','true');
    ico.style.cssText='display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;border-radius:50%;width:30px;height:30px;background:'+_extColor(ext)+';font-style:normal;';
    ico.textContent=(ext||'?').slice(0,4).toUpperCase();
    btn.appendChild(ico);
    const item=document.createElement('div');
    item.className='multiline-item';
    const title=document.createElement('span');
    title.className='title';
    title.textContent=d.filename||'(без имени)';
    title.style.overflow='hidden'; title.style.textOverflow='ellipsis'; title.style.whiteSpace='nowrap';
    const sub=document.createElement('span');
    sub.className='subtitle';
    sub.style.color=sColor(d.status);
    if(active){
        const fmt=window.__tgdl&&window.__tgdl.fmtProgress||function(){return '';};
        sub.textContent=d.status==='pending'?'Ожидание…':fmt(d.recv,d.total);
    } else if(done){
        const fb=window.__tgdl?window.__tgdl.fmtBytes:function(){return '';};
        sub.textContent='Завершено'+(d.total?(' · '+fb(d.total)):'');
    } else {
        sub.textContent=sLabel(d.status);
    }
    item.appendChild(title); item.appendChild(sub);
    btn.appendChild(item);
    // действия справа: только «Папка» и «Удалить». «Открыть» убрано — клик по
    // самой строке (ListItem-button) уже открывает файл (см. ниже btn.click).
    const right=document.createElement('div');
    right.className='_tpright_';
    if(done&&d.id!=null){
        const fld=document.createElement('button'); fld.title='Показать в папке';
        fld.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
        fld.addEventListener('click',e=>{e.stopPropagation();INV('open_download_folder',{id:d.id}).then(r=>{if(r&&r.error)toast('Файл не найден');}).catch(()=>{});});
        right.appendChild(fld);
    }
    if(d.id!=null){
        const del=document.createElement('button'); del.className='danger'; del.title='Удалить';
        del.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        del.addEventListener('click',e=>{
            e.stopPropagation();
            showModal({title:'Удалить загрузку',msg:'Удалить «'+(d.filename||'')+'»?<br><small style="color:#aaa">Файл также будет удалён с диска.</small>',okText:'УДАЛИТЬ',okDanger:true,onOk:async()=>{await INV('delete_download',{id:d.id});cb();}});
        });
        right.appendChild(del);
    }
    btn.appendChild(right);
    if(done&&d.id!=null){
        btn.addEventListener('click',()=>INV('open_download_file',{id:d.id}).then(r=>{if(r&&r.error){toast('Файл не найден');cb();}}).catch(()=>{}));
    }
    row.appendChild(btn);
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