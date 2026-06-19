
let _saveTimer=null;
function scheduleSave(){
    clearTimeout(_saveTimer);
    _saveTimer=setTimeout(async()=>{
        const are=document.getElementById('_are_'); if(!are) return;
        const num=(id,def)=>{const e=document.getElementById(id);return e?(parseInt(e.value)||def):def;};
        const chk=id=>{const e=document.getElementById(id);return !!(e&&e.checked);};
        const sp=document.getElementById('_sp_');
        const settings={
            save_path:(sp&&sp.value)||null,
            auto_reload_enabled:are.checked,
            auto_reload_interval:num('_ari_',3600),
            auto_reload_on_idle:chk('_aro_'),
            idle_timeout:num('_it_',300),
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

    // ── Автоперезагрузка ──
    lbl(T('sec_autoreload'));
    const c2=card();
    toggleRow(c2,T('st_timer'),null,'_are_',s.auto_reload_enabled);
    const r2b=row(c2); r2b.appendChild(main(T('st_interval'))); r2b.appendChild(numInp('_ari_',s.auto_reload_interval||3600,60));
    toggleRow(c2,T('st_onidle'),null,'_aro_',s.auto_reload_on_idle);
    const r2d=row(c2); r2d.appendChild(main(T('st_idle_timeout'))); r2d.appendChild(numInp('_it_',s.idle_timeout||300,30));

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

// ── Corner-уведомления ───────────────────────────────────────────────────
