
let _saveTimer=null;
function scheduleSave(){
    clearTimeout(_saveTimer);
    _saveTimer=setTimeout(async()=>{
        const c=document.getElementById('_tgst_c');if(!c)return;
        const G=id=>c.querySelector('#'+id);
        const sp=G('_sp_');const are=G('_are_');const ari=G('_ari_');const aro=G('_aro_');const it=G('_it_');const tr=G('_tr_');const dv=G('_dv_');
        if(!are)return;
        const settings={save_path:sp&&sp.value||null,auto_reload_enabled:are.checked,auto_reload_interval:parseInt(ari.value)||3600,auto_reload_on_idle:aro.checked,idle_timeout:parseInt(it.value)||300,minimize_to_tray:tr.checked,devtools_enabled:dv&&dv.checked};
        try{await INV('save_settings',{settings});toast('Настройки сохранены','icon-check');}catch(e){toast('Ошибка сохранения','icon-close');}
    },600);
}

async function renderSt(target){
    const c=target||document.getElementById('_tgst_c');if(!c)return;
    c.innerHTML='<div class="_empty_">Загрузка...</div>';
    let s={};
    try{s=await INV('get_settings');}catch(e){c.innerHTML='<div class="_empty_">Ошибка: '+e+'</div>';return;}
    c.innerHTML='';
    function si(t){const d=document.createElement('div');d.className='_si_';d.textContent=t;c.appendChild(d);}
    function sect(){const d=document.createElement('div');d.className='_sect_';c.appendChild(d);return d;}
    function it(sec,html){const d=document.createElement('div');d.className='_it_';d.innerHTML=html;sec.appendChild(d);return d;}
    function cbx(id,label,checked){return '<label class="_cbx_"><input type="checkbox" id="'+id+'" '+(checked?'checked':'')+'><span class="box"></span><span class="label">'+label+'</span></label>';}
    function inp(id,val,type,min,flex){return '<input class="_inp_" id="'+id+'" type="'+(type||'text')+'" value="'+(val||'')+'" '+(min?'min="'+min+'"':'')+' '+(flex?'style="flex:1"':'')+'>'; }

    si('Загрузки');
    const s1=sect();
    const r1=it(s1,'<span class="_it_span_"><i class="icon icon-folder" style="margin-right:6px;vertical-align:middle;"></i>Папка загрузок</span>');
    const r1b=document.createElement('div');r1b.className='_irow_';
    r1b.innerHTML=inp('_sp_',s.save_path||'','text','',true)+'<button class="_ba_" id="_pp_">Выбрать</button>';
    r1.appendChild(r1b);



    si('Автоперезагрузка');
    const s3=sect();
    it(s3,cbx('_are_','Включить таймер',s.auto_reload_enabled));
    const r3b=it(s3,'<span class="_it_span_">Интервал (сек)</span>');
    r3b.appendChild(Object.assign(document.createElement('div'),{innerHTML:inp('_ari_',s.auto_reload_interval,'number','60')}));
    it(s3,cbx('_aro_','При неактивности',s.auto_reload_on_idle));
    const r3d=it(s3,'<span class="_it_span_">Таймаут неактивности (сек)</span>');
    r3d.appendChild(Object.assign(document.createElement('div'),{innerHTML:inp('_it_',s.idle_timeout,'number','30')}));

    si('Окно');const s4=sect();it(s4,cbx('_tr_','Сворачивать в трей',s.minimize_to_tray));it(s4,cbx('_dv_','Консоль разработчика (DevTools) — Ctrl+Shift+I / F12',s.devtools_enabled));

    // «Дополнения» вынесены в отдельную нативную панель (бургер-меню + строка
    // в основных Настройках TG). Здесь, в «Настройках приложения», их больше нет.

    si('Данные');
    const s6=sect();const s6r=it(s6,'');
    const clr=document.createElement('div');clr.className='ListItem-button';clr.style.cssText='cursor:pointer;display:flex;align-items:center;gap:10px;padding:2px 0;width:100%;';
    clr.innerHTML='<i class="icon icon-delete" style="color:#e53935" aria-hidden="true"></i><div><div style="color:#e53935;font-size:14px;">Очистить кэш и перезагрузить</div><div style="color:#aaa;font-size:12px;">Удаляет локальные данные и перезапускает страницу</div></div>';
    clr.addEventListener('click',()=>INV('clear_cache'));s6r.appendChild(clr);

    si('Обновления');
    const s_upd=sect();
    const r_upd=it(s_upd,'<span class="_it_span_">Проверять автоматически</span>');
    const sel=document.createElement('select');
    sel.style.cssText='background:#1a1a1a;border:1px solid #444;border-radius:6px;color:#fff;padding:4px 8px;font-size:13px;cursor:pointer;';[{v:'30m',l:'Каждые 30 мин'},{v:'1h',l:'Каждый час'},{v:'12h',l:'Каждые 12 ч'},{v:'24h',l:'Раз в сутки'},{v:'3d',l:'Раз в 3 дня'},{v:'7d',l:'Раз в неделю'},{v:'30d',l:'Раз в месяц'},{v:'never',l:'Никогда'}].forEach(opt=>{const o=document.createElement('option');o.value=opt.v;o.textContent=opt.l;if((s.update_check_interval||'1h')===opt.v)o.selected=true;sel.appendChild(o);});
    sel.addEventListener('change',async()=>{const ns=await INV('get_settings');await INV('save_settings',{settings:Object.assign({},ns,{update_check_interval:sel.value})});toast('Сохранено','icon-check');});
    r_upd.appendChild(sel);
    const r_upd2=it(s_upd,'');
    const btnChk=document.createElement('button');btnChk.className='_ba_';btnChk.innerHTML='<i class="icon icon-reload"></i> Проверить сейчас';
    btnChk.addEventListener('click',async()=>{
        btnChk.disabled=true;btnChk.textContent='Проверка...';
        try{const r=await INV('check_update_manual');if(!r||r.upToDate)toast('Установлена последняя версия','icon-check');else if(r.error)toast('Ошибка: '+r.error,'icon-close');}
        catch(e){toast('Ошибка проверки','icon-close');}
        finally{btnChk.disabled=false;btnChk.innerHTML='<i class="icon icon-reload"></i> Проверить сейчас';}
    });
    r_upd2.appendChild(btnChk);

    si('О приложении');
    const s7=sect();
    (async()=>{
        let ver='—';let uid='—';let uname='—';
        try{const info=await INV('get_app_info');ver=info.version||'—';}catch(e){}
        try{
            const pa=document.querySelector('.settings-content .ProfileInfo .Avatar[data-peer-id]');
            if(pa)uid=pa.getAttribute('data-peer-id')||'—';
            const un=document.querySelector('.settings-content .ChatExtra .icon-mention');
            if(un&&un.nextElementSibling)uname=un.closest('.multiline-item')?.querySelector('.title')?.textContent||'—';
        }catch(e){}
        const rows=[['Версия',ver],['Ваш ID',uid],['Username',uname]];
        rows.forEach(([label,val])=>{
            const row=it(s7,'<span class="_it_span_" style="color:#aaa;font-size:13px;">'+label+'</span>');
            const v=document.createElement('span');
            v.style.cssText='color:#fff;font-size:13px;font-family:monospace;user-select:text;cursor:text;';
            v.textContent=val;
            row.appendChild(v);
        });
    })();

    const G=id=>c.querySelector('#'+id);
    const pp=G('_pp_');const sp_i=G('_sp_');
    if(pp)pp.addEventListener('click',async()=>{const p=await INV('open_folder_dialog');if(p&&sp_i)sp_i.value=p;});
    if(sp_i)sp_i.addEventListener('click',()=>pp&&pp.click());
    c.querySelectorAll('input[type=checkbox],input[type=number],input[type=text]').forEach(el=>{
        el.addEventListener('change',scheduleSave);
        if(el.type==='number'||el.type==='text')el.addEventListener('input',scheduleSave);
    });
    const dvEl=G('_dv_');
    if(dvEl)dvEl.addEventListener('change',async()=>{try{await INV('toggle_devtools',{open:dvEl.checked});}catch(e){}});
}

// ── Corner-уведомления ───────────────────────────────────────────────────