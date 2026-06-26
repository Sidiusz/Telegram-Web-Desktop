
let _saveTimer=null;
function scheduleSave(){
    clearTimeout(_saveTimer);
    _saveTimer=setTimeout(async()=>{
        const sp=document.getElementById('_sp_'); if(!sp) return;
        const chk=id=>{const e=document.getElementById(id);return !!(e&&e.checked);};
        const settings={
            save_path:sp.value||null,
            minimize_to_tray:chk('_tr_'),
            devtools_enabled:chk('_dv_'),
        };
        try{await INV('save_settings',{settings});toast(T('st_saved'),'icon-check');}catch(e){toast(T('st_save_err'),'icon-close');}
    },600);
}

async function renderSt(target){
    const c=target||document.getElementById('_tgpc_');if(!c)return;
    c.innerHTML='<div class="_empty_">'+T('loading')+'</div>';
    let s={};
    try{s=await INV('get_settings');}catch(e){c.innerHTML='<div class="_empty_">'+T('error')+': '+e+'</div>';return;}
    c.innerHTML='';
    buildSettingsSections(c, s);
}

// Строит секции настроек приложения в переданный контейнер. Используется и
// кастомной панелью (renderSt), и инжектом в нативные «Общие настройки» (#3).
function buildSettingsSections(c, s){
    const ce=cls=>{const d=document.createElement('div');if(cls)d.className=cls;return d;};
    const lbl=t=>{const d=ce('_ns_lbl_');d.textContent=t;c.appendChild(d);};
    const card=()=>{const d=ce('_ns_card_');c.appendChild(d);return d;};
    const row=cd=>{const d=ce('_ns_row_');cd.appendChild(d);return d;};
    const ico=name=>{const i=document.createElement('i');i.className='icon icon-'+name+' _ns_ico_';i.setAttribute('aria-hidden','true');return i;};
    const main=(title,sub)=>{const m=ce('_ns_main_');const t=ce('_ns_title_');t.textContent=title;m.appendChild(t);if(sub){const x=ce('_ns_sub_');x.textContent=sub;m.appendChild(x);}return m;};
    const swt=(id,checked)=>{const l=document.createElement('label');l.className='_ns_swt_';l.innerHTML='<input type="checkbox" id="'+id+'"'+(checked?' checked':'')+'><i></i>';return l;};
    const numInp=(id,val,min)=>{const i=document.createElement('input');i.className='_ns_inp_ _num_';i.id=id;i.type='number';i.value=val;if(min)i.min=min;return i;};
    const toggleRow=(cd,title,sub,id,checked)=>{const r=row(cd);r.appendChild(main(title,sub));r.appendChild(swt(id,checked));return r;};

    // ── Загрузки ──
    lbl(T('sec_downloads'));
    const c1=card();
    const r1=row(c1); r1.appendChild(ico('folder')); r1.appendChild(main(T('st_folder')));
    const r1b=row(c1);
    const sp=document.createElement('input'); sp.className='_ns_inp_'; sp.id='_sp_'; sp.type='text'; sp.value=s.save_path||''; sp.style.flex='1';
    const pick=document.createElement('button'); pick.className='_ns_btn_ sec'; pick.id='_pp_'; pick.textContent=T('choose');
    r1b.appendChild(sp); r1b.appendChild(pick);

    // ── Окно ──
    lbl(T('sec_window'));
    const c3=card();
    toggleRow(c3,T('st_tray'),null,'_tr_',s.minimize_to_tray);
    toggleRow(c3,T('st_devtools'),'Ctrl+Shift+I / F12','_dv_',s.devtools_enabled);

    // ── Обновления ──
    lbl(T('sec_updates'));
    const c4=card();
    const r4=row(c4); r4.appendChild(main(T('st_auto_check')));
    const sel=document.createElement('select'); sel.className='_ns_sel_';
    [['30m','iv_30m'],['1h','iv_1h'],['12h','iv_12h'],['24h','iv_24h'],['3d','iv_3d'],['7d','iv_7d'],['30d','iv_30d'],['never','iv_never']]
        .forEach(([v,k])=>{const o=document.createElement('option');o.value=v;o.textContent=T(k);if((s.update_check_interval||'1h')===v)o.selected=true;sel.appendChild(o);});
    sel.addEventListener('change',async()=>{const ns=await INV('get_settings');await INV('save_settings',{settings:Object.assign({},ns,{update_check_interval:sel.value})});toast(T('st_saved_short'),'icon-check');});
    r4.appendChild(sel);
    const r4b=row(c4);
    const chkBtn=document.createElement('button'); chkBtn.className='_ns_btn_'; chkBtn.style.margin='0 auto 0 0'; chkBtn.innerHTML='<i class="icon icon-reload"></i> '+T('st_check_now');
    chkBtn.addEventListener('click',async()=>{
        chkBtn.disabled=true; const o=chkBtn.innerHTML; chkBtn.textContent=T('st_checking');
        try{const r=await INV('check_update_manual');if(!r||r.upToDate)toast(T('st_uptodate'),'icon-check');else if(r.error)toast(T('error')+': '+r.error,'icon-close');}
        catch(e){toast(T('st_check_err'),'icon-close');}
        finally{chkBtn.disabled=false;chkBtn.innerHTML=o;}
    });
    r4b.appendChild(chkBtn);

    // ── Данные ──
    lbl(T('sec_data'));
    const c5=card();
    const r5=row(c5); r5.style.cursor='pointer'; r5.appendChild(ico('delete'));
    r5.appendChild(main(T('st_clear_cache'),T('st_clear_cache_sub')));
    r5.querySelector('._ns_ico_').style.color='#ff5c5c';
    r5.querySelector('._ns_title_').style.color='#ff5c5c';
    r5.addEventListener('click',()=>INV('clear_cache'));

    // ── О приложении ──
    lbl(T('sec_about'));
    const c6=card();
    const addInfo=(label,val)=>{const r=row(c6);r.appendChild(main(label));const v=ce('_ns_val_');v.textContent=val;v.style.userSelect='text';v.style.cursor='text';r.appendChild(v);return v;};
    const vVer=addInfo(T('st_version'),'—'); const vId=addInfo(T('st_your_id'),'—'); const vUn=addInfo(T('st_username'),'—');
    (async()=>{
        try{const info=await INV('get_app_info');vVer.textContent=info.version||'—';}catch(e){}
        try{
            const pa=document.querySelector('#Settings .ProfileInfo .Avatar[data-peer-id]')||document.querySelector('#Settings .Avatar[data-peer-id]');
            if(pa)vId.textContent=pa.getAttribute('data-peer-id')||'—';
            const mn=document.querySelector('#Settings .icon-mention');
            const li=mn&&mn.closest('.ListItem');
            const t=li&&li.querySelector('.title');
            if(t)vUn.textContent=t.textContent.trim();
        }catch(e){}
    })();

    // wire up
    const pp=document.getElementById('_pp_'); const sp_i=document.getElementById('_sp_');
    if(pp)pp.addEventListener('click',async()=>{const p=await INV('open_folder_dialog');if(p&&sp_i){sp_i.value=p;scheduleSave();}});
    c.querySelectorAll('input[type=checkbox],input[type=number],input[type=text]').forEach(el=>{
        el.addEventListener('change',scheduleSave);
        if(el.type==='number'||el.type==='text')el.addEventListener('input',scheduleSave);
    });
    const dvEl=document.getElementById('_dv_');
    if(dvEl)dvEl.addEventListener('change',async()=>{try{await INV('toggle_devtools',{open:dvEl.checked});}catch(e){}});
}

// ── #3: общие нативные строители виджетов (клонируем живые виджеты TG) ───────
function _saveOne(patch){ INV('get_settings').then(function(s){ INV('save_settings',{settings:Object.assign({},s||{},patch)}); }).catch(function(){}); }
// Заголовок секции — предыдущий сосед карточки, если он сам не карточка.
function _cardHeader(card){
    var h=card.previousElementSibling;
    if(!h||h.hasAttribute('data-tggen')||h.hasAttribute('data-tgabout')) return null;
    if(h.querySelector&&h.querySelector('.ListItem')) return null;
    return h;
}
// Ищет ЖИВОЙ шаблон секции по СТИЛЮ (фон+радиус, держит .ListItem), а не по
// фикс-хэшу: после Vite-редизайна RE8jeQLf/vcGtwOtR мертвы (прозрачны). Первый
// элемент с фоном — самый внутренний держатель карточек (обёртки прозрачны).
function _findNativeCardTpl(){
    var st=document.getElementById('Settings'); if(!st) return null;
    var els=st.querySelectorAll('div[class]');
    for(var i=0;i<els.length;i++){
        var e=els[i];
        if(e.hasAttribute('data-tggen')||e.hasAttribute('data-tgabout')) continue;
        if(!e.querySelector('.ListItem')) continue;
        var cs=getComputedStyle(e);
        if(cs.backgroundColor==='rgba(0, 0, 0, 0)'||parseFloat(cs.borderTopLeftRadius)<=0) continue;
        return { cardCls:e.className, header:_cardHeader(e) };
    }
    return null;
}
function _genCardCls(){ var t=_findNativeCardTpl(); return (t&&t.cardCls)||_tgWidgetTpl.cardCls||null; }
function _genHeaderTpl(){ var t=_findNativeCardTpl(); return (t&&t.header)||_tgWidgetTpl.header; }
function _genCard(cardCls){ var d=document.createElement('div'); d.className=cardCls; return d; }
// Заголовок секции: клон живого нативного, либо свой div со стилем нативного
// (на главном экране настроек нативных заголовков нет — клонировать нечего).
function _genHeader(headerTpl,text){
    var h=headerTpl?headerTpl.cloneNode(false):document.createElement('div');
    if(!headerTpl) h.style.cssText='font-size:14px;font-weight:500;line-height:20px;color:rgb(170,170,170);padding:0 16px;';
    h.textContent=text; return h;
}
function _genToggle(labelText, checked, onChange){
    var n=_tgWidgetTpl.toggle.cloneNode(true);
    n.classList.remove('withSubLabel');
    var sub=n.querySelector('.subLabel'); if(sub)sub.remove();
    var av=n.querySelector('.user-avatar, .Avatar'); if(av)av.remove();
    var lab=n.querySelector('.label'); if(lab)lab.textContent=labelText;
    var inp=n.querySelector('input[type=checkbox]');
    if(inp){ inp.removeAttribute('id'); inp.checked=!!checked; inp.addEventListener('change',function(){ onChange(inp.checked); }); }
    return n;
}
function _genInput(labelText, value, numeric, onCommit){
    // Нет образца .input-group (не открывали страниц с полями ввода) — строим своё
    // поле в стиле нативного, чтобы секция «Загрузки» не зависела от клона.
    if(!_tgWidgetTpl.input){
        var w=document.createElement('div'); w.className='input-group touched';
        var fi=document.createElement('input'); fi.type=numeric?'number':'text'; fi.value=value==null?'':value;
        fi.className='form-control'; fi.style.cssText='width:100%;background:rgba(0,0,0,.18);border:1px solid var(--color-borders-input,#3a3a3a);border-radius:10px;color:#fff;padding:10px 12px;font-size:15px;outline:none;';
        var lb=document.createElement('label'); lb.textContent=labelText; lb.style.cssText='display:block;font-size:13px;color:rgb(170,170,170);margin:0 0 6px 2px;';
        var c2=function(){ onCommit(fi.value); }; fi.addEventListener('change',c2); fi.addEventListener('blur',c2);
        w.appendChild(lb); w.appendChild(fi);
        return { node:w, input:fi };
    }
    var n=_tgWidgetTpl.input.cloneNode(true);
    var inp=n.querySelector('input');
    if(inp){
        inp.removeAttribute('id'); inp.removeAttribute('readonly'); inp.removeAttribute('disabled');
        inp.type=numeric?'number':'text';
        inp.value=value==null?'':value;
        var commit=function(){ onCommit(inp.value); };
        inp.addEventListener('change',commit); inp.addEventListener('blur',commit);
    }
    var lab=n.querySelector('label'); if(lab)lab.textContent=labelText;
    return { node:n, input:inp };
}
function _genButton(text, onClick){
    var b=_tgWidgetTpl.button.cloneNode(true);
    b.removeAttribute('id'); b.removeAttribute('disabled');
    var rip=b.querySelector('.ripple-container'); if(rip)rip.innerHTML='';
    var txt=b.querySelector('.Button-text'); if(txt){ txt.textContent=text; } else { b.textContent=text; }
    b.addEventListener('click',function(e){ e.stopPropagation(); onClick(); });
    b.style.marginTop='12px';
    return b;
}
// Нативная строка-значение (как «Язык — Русский»): клон .ListItem.narrow.
function _genRow(liEl, icon, title, value, onClick, danger){
    var r=liEl.cloneNode(true); r.removeAttribute('id'); r.removeAttribute('style'); r.className='ListItem narrow';
    var btn=r.querySelector('.ListItem-button'); if(!btn){ btn=document.createElement('div'); btn.className='ListItem-button'; r.appendChild(btn); }
    btn.innerHTML=''; btn.setAttribute('role','button'); btn.setAttribute('tabindex','0');
    if(icon){ var ic=document.createElement('i'); ic.className='icon icon-'+icon+' ListItem-main-icon'; ic.setAttribute('aria-hidden','true'); if(danger)ic.style.color='#ff5c5c'; btn.appendChild(ic); }
    btn.appendChild(document.createTextNode(title));
    var v=document.createElement('span'); v.className='settings-item__current-value'; v.textContent=value==null?'':value; btn.appendChild(v);
    if(danger)btn.style.color='#ff5c5c';
    if(onClick){ btn.addEventListener('click',function(e){ e.stopPropagation(); onClick(v); }); }
    r._v=v;
    return r;
}

// ── #3a: секции настроек приложения В КОНЦЕ нативных «Общие настройки» ───────
// Заголовки (vcGtwOtR) и карточки (RE8jeQLf) добавляем ПРЯМЫМИ детьми
// settings-content (как блок «Уведомления») — иначе родные стили (заданные по
// прямому потомству) не применятся. Виджеты — клоны живых нативных (_tgWidgetTpl).
function injectGeneralSettings(){
    var sc=null, all=document.querySelectorAll('#Settings .settings-content');
    for(var i=0;i<all.length;i++){ if(/Размер текста|Text size|Формат времени|Time format/i.test(all[i].textContent||'')){ sc=all[i]; break; } }
    if(!sc) return;
    if(sc.querySelector('[data-tggen]')) return;                 // уже вставлено
    var headerTpl=_genHeaderTpl(), cardCls=_genCardCls();
    if(!cardCls) return;
    if(!_tgWidgetTpl.toggle) return;   // тумблер обязателен (клон нативного); поле/кнопка — со своими фолбэками
    var liEl=document.querySelector('#Settings .ListItem.narrow'); if(!liEl) return;

    var marker=document.createElement('div'); marker.setAttribute('data-tggen','1'); marker.style.display='none';
    sc.appendChild(marker);                                      // синхронный «замок» от двойного инжекта
    // Отступы задаём явно (16px над заголовком, 8px над карточкой) — нативные
    // CSS-правила «header+card» на наших узлах не срабатывают, ритм был бы рваный.
    function addSection(title, cardEl){ var h=_genHeader(headerTpl,title); h.setAttribute('data-tggen','1'); h.style.marginTop='16px'; cardEl.setAttribute('data-tggen','1'); cardEl.style.marginTop='8px'; sc.appendChild(h); sc.appendChild(cardEl); }

    INV('get_settings').then(function(s){
        s=s||{};
        // Загрузки: длинное поле пути; иконка-папка ПОВЕРХ поля справа (overlay),
        // клик — выбор папки. Полю даём padding-right, чтобы путь не лез под иконку.
        var c1=_genCard(cardCls); c1.style.position='relative';
        var folder=_genInput(T('st_folder'), s.save_path||'', false, function(val){ _saveOne({save_path:val||null}); });
        folder.node.style.width='100%'; folder.node.style.marginBottom='0';   // убрать «подбородок» + центрировать
        if(folder.input) folder.input.style.paddingRight='46px';
        c1.appendChild(folder.node);
        var pbtn=document.createElement('div'); pbtn.className='_tgfolderbtn_';
        pbtn.style.cssText='position:absolute;right:26px;top:50%;transform:translateY(-50%);cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2;';
        pbtn.innerHTML='<i class="icon icon-folder-tabs-folder" aria-hidden="true" style="font-size:24px"></i>';
        pbtn.addEventListener('click',function(){ INV('open_folder_dialog').then(function(p){ if(p&&folder.input){ folder.input.value=p; _saveOne({save_path:p}); } }).catch(function(){}); });
        c1.appendChild(pbtn);
        addSection(T('sec_downloads'), c1);

        // Окно: тумблеры
        var c2=_genCard(cardCls);
        c2.appendChild(_genToggle(T('st_tray'), !!s.minimize_to_tray, function(v){ _saveOne({minimize_to_tray:v}); }));
        c2.appendChild(_genToggle(T('st_devtools'), !!s.devtools_enabled, function(v){ INV('toggle_devtools',{open:v}).catch(function(){}); _saveOne({devtools_enabled:v}); }));
        addSection(T('sec_window'), c2);

        // Обновления: частота автопроверки — нативный «выпадающий список» (попап-радио)
        var c4=_genCard(cardCls);
        var ivKeys=['30m','1h','12h','24h','3d','7d','30d','never'];
        var ivLbl={'30m':'iv_30m','1h':'iv_1h','12h':'iv_12h','24h':'iv_24h','3d':'iv_3d','7d':'iv_7d','30d':'iv_30d','never':'iv_never'};
        var ivCur=s.update_check_interval||'1h';
        c4.appendChild(_genRow(liEl,'reload',T('st_auto_check'),T(ivLbl[ivCur]||'iv_1h'),function(v){
            pickModal({ title:T('st_auto_check'), current:ivCur,
                options:ivKeys.map(function(k){ return { value:k, label:T(ivLbl[k]) }; }),
                onSave:function(val){ ivCur=val; v.textContent=T(ivLbl[val]); _saveOne({update_check_interval:val}); } });
        }));
        addSection(T('sec_updates'), c4);

        // Данные: очистить и перезагрузить (нативная строка, красная)
        var c5=_genCard(cardCls);
        c5.appendChild(_genRow(liEl,'delete',T('st_clear_cache'),'',function(){ INV('clear_cache').catch(function(){}); },true));
        addSection(T('sec_data'), c5);
    }).catch(function(){});
}

// ── #3b: категория «О приложении» в самом низу ГЛАВНОГО экрана настроек ──────
// Отдельное облачко (vcGtwOtR-заголовок + RE8jeQLf-карточка) внизу
// .settings-main-scroll: версия / ID / username / проверить обновления.
function injectAboutSection(){
    var scroll=document.querySelector('#Settings .settings-main-scroll');
    if(!scroll) return;
    if(scroll.querySelector('[data-tgabout]')) return;
    var headerTpl=_genHeaderTpl(), cardCls=_genCardCls();
    var liEl=document.querySelector('#Settings .ListItem.narrow');
    if(!cardCls || !liEl) return;
    // Контейнер — обёртка ПОСЛЕДНЕЙ нативной карточки категорий: даёт нашей секции
    // тот же боковой инсет (16px) и ширину, и кладёт её в самый низ экрана.
    var sample=[].slice.call(scroll.querySelectorAll('div')).filter(function(e){
        return !e.closest('[data-tgabout]') && e.querySelector('.ListItem') &&
               getComputedStyle(e).borderTopLeftRadius!=='0px' && e.getBoundingClientRect().width>50;
    });
    var lastNative=sample[sample.length-1];
    var container=lastNative?lastNative.parentElement:scroll;
    if(container.querySelector('[data-tgabout]')) return;

    var h=_genHeader(headerTpl, T('about_app')); h.setAttribute('data-tgabout','1');
    var card=_genCard(cardCls); card.setAttribute('data-tgabout','1');
    h.style.marginTop='16px'; card.style.marginTop='8px'; card.style.marginBottom='16px';
    // Фолбэк (не нашли обёртку с инсетом): задаём боковые поля вручную.
    if(container===scroll){ h.style.marginLeft=h.style.marginRight='16px'; card.style.marginLeft=card.style.marginRight='16px'; }
    var verRow=_genRow(liEl,'info',T('st_version'),'—',null);
    var idRow=_genRow(liEl,'info',T('st_your_id'),'—',null);
    var unRow=_genRow(liEl,'mention',T('st_username'),'—',null);
    var updRow=_genRow(liEl,'reload',T('check_updates'),'',async function(){
        toast(T('upd_checking'),'icon-reload');
        try{ var r=await INV('check_update_manual'); if(!r||r.upToDate)toast(T('st_uptodate'),'icon-check'); else if(r.error)toast(T('error')+': '+r.error,'icon-close'); }
        catch(e){ toast(T('st_check_err'),'icon-close'); }
    });
    card.appendChild(verRow); card.appendChild(idRow); card.appendChild(unRow); card.appendChild(updRow);
    container.appendChild(h); container.appendChild(card);

    INV('get_app_info').then(function(info){ if(info&&info.version)verRow._v.textContent=info.version; }).catch(function(){});
    try{
        var pa=document.querySelector('#Settings .ProfileInfo .Avatar[data-peer-id]')||document.querySelector('#Settings .Avatar[data-peer-id]');
        if(pa)idRow._v.textContent=pa.getAttribute('data-peer-id')||'—';
        var mn=document.querySelector('#Settings .icon-mention'); var li=mn&&mn.closest('.ListItem'); var t=li&&li.querySelector('.title');
        if(t)unRow._v.textContent=t.textContent.trim();
    }catch(e){}
}

// ── Corner-уведомления ───────────────────────────────────────────────────
