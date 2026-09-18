
async function renderSt(target){
    const c=target||document.getElementById('_tgpc_');if(!c)return;
    c.innerHTML='<div class="_empty_">'+T('loading')+'</div>';
    let s={};
    try{s=await INV('get_settings');}catch(e){
        c.innerHTML='';const err=document.createElement('div');err.className='_empty_';err.textContent=T('error')+': '+String(e);c.appendChild(err);return;
    }
    c.innerHTML='';
    buildSettingsSections(c, s);
}

// Строит секции настроек приложения в переданный контейнер. Используется и
// кастомной панелью (renderSt), и инжектом в нативные «Общие настройки» (#3).
function buildSettingsSections(c, s){
    captureWidgetTpl();
    const cardCls=_genCardCls(), headerTpl=_genHeaderTpl();
    const liEl=document.querySelector('#Settings .ListItem.narrow')||document.querySelector('#Settings .ListItem');
    if(!cardCls||!liEl){
        c.innerHTML='<div class="_tpempty_">'+T('loading')+'</div>';
        setTimeout(()=>{if(c.isConnected)buildSettingsSections(c,s);},120);
        return;
    }
    c.innerHTML='';
    const card=()=>_genCard(cardCls);
    const addSection=(title,cd)=>_appendNativeSection(c,headerTpl,title,cd);
    const nativeRow=(title,sub,value,onClick)=>{
        const r=_genNativeSettingRow(liEl,title,sub,value,onClick);
        const b=r.querySelector('.ListItem-button');
        if(b)b.querySelectorAll('.Switcher,.Switch,.Toggle,.icon-next,.icon-arrow-right').forEach(x=>x.remove());
        return r;
    };
        const switchRow=(title,sub,checked,onChange)=>{
        const r=nativeRow(title,sub,'',null),b=r.querySelector('.ListItem-button');
        if(r._value)r._value.remove();if(b)b.appendChild(_genSwitcher(checked,onChange,title));return r;
    };
    const actionRow=(title,sub,onClick,danger)=>{
        const r=nativeRow(title,sub,'',onClick),b=r.querySelector('.ListItem-button');
        if(r._value)r._value.remove();
        if(danger&&b){r.classList.add('destructive');b.style.color='var(--color-error,#e53935)';}
        return r;
    };

    const c1=card();c1.style.position='relative';
    const folder=_genInput(T('st_folder'),s.save_path||'',false,()=>{});
    folder.node.style.width='100%';folder.node.style.marginBottom='0';folder.node.classList.toggle('touched',!!folder.input.value);
    folder.input.readOnly=true;folder.input.style.paddingRight='3.25rem';folder.input.style.cursor='default';
    c1.appendChild(folder.node);
    const pick=_genIconButton('folder',T('choose'),'small',false);
    pick.style.cssText='position:absolute;right:1.25rem;top:50%;transform:translateY(-50%);z-index:2;';
    pick.addEventListener('click',async()=>{const p=await INV('open_folder_dialog');if(p){folder.input.value=p;folder.node.classList.add('touched');_saveOne({save_path:p});}});
    c1.appendChild(pick);addSection(T('sec_downloads'),c1);

    const c2=card();
    c2.appendChild(switchRow(T('st_tray'),T('st_tray_sub'),!!s.minimize_to_tray,v=>_saveOne({minimize_to_tray:v})));
    c2.appendChild(switchRow(T('st_devtools'),'Ctrl+Shift+I / F12',!!s.devtools_enabled,v=>_setDevtoolsEnabled(v)));
    addSection(T('sec_window'),c2);

    const c3=card();
    c3.appendChild(nativeRow(T('st_tg_links'),T('st_tg_links_sub'),T('st_open_defaults'),()=>INV('open_default_apps').catch(()=>{})));
    addSection(T('sec_integration'),c3);

    const ivKeys=['30m','1h','12h','24h','3d','7d','30d','never'];
    const ivLbl={'30m':'iv_30m','1h':'iv_1h','12h':'iv_12h','24h':'iv_24h','3d':'iv_3d','7d':'iv_7d','30d':'iv_30d','never':'iv_never'};
    let ivCur=s.update_check_interval||'1h';
    const c4=card();
    const ivRow=nativeRow(T('st_auto_check'),' ',T(ivLbl[ivCur]||'iv_1h'),()=>{
        pickModal({title:T('st_auto_check'),current:ivCur,options:ivKeys.map(k=>({value:k,label:T(ivLbl[k])})),onSave:v=>{ivCur=v;ivRow._value.textContent=T(ivLbl[v]);_saveOne({update_check_interval:v});}});
    });
    c4.appendChild(ivRow);
    const checkWrap=document.createElement('div');checkWrap.style.padding='.5rem 1rem 1rem';
    const chkBtn=_genButton(T('st_check_now'),'reload','primary');
    chkBtn.addEventListener('click',async()=>{
        if(chkBtn.disabled)return;chkBtn.disabled=true;const old=chkBtn.innerHTML;chkBtn.textContent=T('st_checking');
        try{const r=await INV('check_update_manual');if(!r||r.upToDate)toast(T('st_uptodate'),'icon-check');else if(r.error)toast(T('error')+': '+r.error,'icon-close');}
        catch(e){toast(T('st_check_err'),'icon-close');}finally{chkBtn.disabled=false;chkBtn.innerHTML=old;}
    });
    checkWrap.appendChild(chkBtn);c4.appendChild(checkWrap);addSection(T('sec_updates'),c4);

    const c5=card();
    const clearRow=actionRow(T('st_clear_cache'),T('st_clear_cache_sub'),()=>INV('clear_cache').catch(()=>{}),true);
    const clearBtn=clearRow.querySelector('.ListItem-button');
    if(clearBtn){const ic=document.createElement('i');ic.className='icon icon-delete ListItem-main-icon';ic.style.color='inherit';ic.setAttribute('aria-hidden','true');clearBtn.prepend(ic);}
    c5.appendChild(clearRow);addSection(T('sec_data'),c5);
    const c6=card();
    const addInfo=(label,val)=>{const r=nativeRow(label,'',val,null);c6.appendChild(r);return r._value;};
    const vVer=addInfo(T('st_version'),'—'),vId=addInfo(T('st_your_id'),'—'),vUn=addInfo(T('st_username'),'—');
    _wireUiLabUnlock(vUn.closest('.ListItem'));
    addSection(T('sec_about'),c6);
    (async()=>{
        try{const info=await INV('get_app_info');vVer.textContent=(info&&info.version)||'—';}catch(e){}
        try{
            const pa=document.querySelector('#Settings .ProfileInfo .Avatar[data-peer-id]')||document.querySelector('#Settings .Avatar[data-peer-id]');
            if(pa)vId.textContent=pa.getAttribute('data-peer-id')||'—';
            const mn=document.querySelector('#Settings .icon-mention'),li=mn&&mn.closest('.ListItem'),t=li&&li.querySelector('.title');
            if(t)vUn.textContent=t.textContent.trim();
        }catch(e){}
    })();
}

// ── #3: общие нативные строители виджетов (клонируем живые виджеты TG) ───────
function _saveOne(patch){
    return INV('get_settings').then(function(s){
        return INV('save_settings',{settings:Object.assign({},s||{},patch)});
    });
}
function _setDevtoolsEnabled(v){
    _saveOne({devtools_enabled:!!v})
        .then(function(){ return INV('toggle_devtools',{open:!!v}); })
        .catch(function(){});
}
function _wireUiLabUnlock(row){
    if(!row||row.__twdUiLabUnlock)return;
    row.__twdUiLabUnlock=true;
    var btn=row.querySelector('.ListItem-button')||row;
    var count=0;
    btn.addEventListener('click',function(){
        count++;
        if(count>=7&&count<10) toast(T('ui_lab_unlock_left')+(10-count),'icon-info-filled');
        if(count>=10){
            count=0;
            try{ openUiLabNative(); }catch(e){}
        }
    });
}
// Заголовок секции — предыдущий сосед карточки, если он сам не карточка.
function _cardHeader(card){
    var h=card.previousElementSibling;
    if(!h||h.hasAttribute('data-tggen')||h.hasAttribute('data-tgabout')) return null;
    if(h.querySelector&&h.querySelector('.ListItem')) return null;
    // Native category headers are simple text-only 14/20px labels with 16px side
    // padding. Reject profile headers, descriptions and other structural siblings.
    if(h.children&&h.children.length)return null;
    var cs=getComputedStyle(h);
    if(parseFloat(cs.fontSize)!==14||parseFloat(cs.lineHeight)!==20||parseFloat(cs.paddingLeft)<15)return null;
    return h;
}
// Ищет ЖИВОЙ шаблон секции по СТИЛЮ (фон+радиус, держит .ListItem), а не по
// фикс-хэшу: после Vite-редизайна RE8jeQLf/vcGtwOtR мертвы (прозрачны). Первый
// элемент с фоном — самый внутренний держатель карточек (обёртки прозрачны).
function _findNativeCardTpl(){
    var st=document.getElementById('Settings'); if(!st) return null;
    var els=st.querySelectorAll('div[class]'), fallback=null;
    for(var i=0;i<els.length;i++){
        var e=els[i];
        if(e.hasAttribute('data-tggen')||e.hasAttribute('data-tgabout')||e.closest('._tgpanel_')) continue;
        if(!e.querySelector('.ListItem')) continue;
        var cs=getComputedStyle(e);
        if(cs.backgroundColor==='rgba(0, 0, 0, 0)'||parseFloat(cs.borderTopLeftRadius)<=0) continue;
        var found={cardCls:e.className,header:_cardHeader(e)};
        if(!fallback)fallback=found;
        // Prefer a card that has Telegram's real category header before it. The main
        // settings page has cards without headers, while native sub-pages do have them.
        if(found.header)return found;
    }
    return fallback;
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
function _appendNativeSection(host,headerTpl,title,card){
    var h=_genHeader(headerTpl,title);
    // Exact measured Telegram rhythm. Hidden sentinels/locks do not count as content:
    // the first visible category is 0px from the top, all following ones are 16px.
    var hasVisibleBefore=Array.prototype.some.call(host.children,function(n){
        return !n.hidden && (!n.style || n.style.display!=='none');
    });
    h.style.marginTop=hasVisibleBefore?'16px':'0px';
    card.style.marginTop='8px';
    host.append(h,card);
    return {header:h,card:card};
}
function _genToggle(labelText, checked, onChange, subText){
    var base=_tgWidgetTpl.toggle||document.querySelector('#Settings label.Checkbox');
    var n=base?base.cloneNode(true):document.createElement('label');
    if(!base){ n.className='Checkbox'; n.innerHTML='<input type="checkbox"><div class="Checkbox-main"><span class="label"></span></div>'; }
    var av=n.querySelector('.user-avatar, .Avatar'); if(av)av.remove();
    var lab=n.querySelector('.label'); if(lab)lab.textContent=labelText;
    var sub=n.querySelector('.subLabel');
    if(subText){
        n.classList.add('withSubLabel');
        if(!sub){ sub=document.createElement('span'); sub.className='subLabel'; n.querySelector('.Checkbox-main').appendChild(sub); }
        sub.textContent=subText;
    }else{
        n.classList.remove('withSubLabel');
        if(sub)sub.remove();
    }
    var inp=n.querySelector('input[type=checkbox]');
    if(inp){ inp.removeAttribute('id'); inp.disabled=false; inp.checked=!!checked; inp.addEventListener('change',function(){ onChange(inp.checked); }); }
    return n;
}
function _genRadioGroup(name, options, current, onChange){
    var live=document.querySelector('#Settings .radio-group');
    var liveRadio=(live&&live.querySelector('label.Radio'))||document.querySelector('#Settings label.Radio')||_tgWidgetTpl.radio;
    var group=live?live.cloneNode(false):document.createElement('div');
    group.className=live?live.className:'radio-group';
    options.forEach(function(opt){
        var label=liveRadio?liveRadio.cloneNode(true):document.createElement('label');
        if(!liveRadio){ label.className='Radio'; label.innerHTML='<input type="radio"><div class="Radio-main"><span class="label"></span></div>'; }
        var inp=label.querySelector('input[type=radio]'), text=label.querySelector('.label');
        if(!inp||!text)return;
        inp.name=name; inp.value=opt.value; inp.checked=opt.value===current; inp.removeAttribute('id'); inp.disabled=false;
        text.textContent=opt.label; label.classList.toggle('checked',inp.checked);
        inp.addEventListener('change',function(){ if(!inp.checked)return; group.querySelectorAll('label.Radio').forEach(function(x){x.classList.toggle('checked',x.contains(inp));}); onChange(opt.value); });
        group.appendChild(label);
    });
    return group;
}
function _genInput(labelText, value, numeric, onCommit){
    var tpl=_tgWidgetTpl.input, n=tpl?tpl.cloneNode(false):document.createElement('div');
    n.className=(tpl&&tpl.className)||'input-group touched'; n.removeAttribute('style');
    var src=tpl&&tpl.querySelector('input'), inp=src?src.cloneNode(false):document.createElement('input');
    inp.className=(src&&src.className)||'form-control'; inp.removeAttribute('style'); inp.removeAttribute('id');
    inp.removeAttribute('readonly'); inp.removeAttribute('disabled'); inp.type='text';
    if(numeric){inp.inputMode='numeric';inp.pattern='[0-9]*';}else{inp.removeAttribute('inputmode');inp.removeAttribute('pattern');}
    inp.value=value==null?'':value;
    var srcLab=tpl&&tpl.querySelector('label'), lab=srcLab?srcLab.cloneNode(false):document.createElement('label');
    lab.removeAttribute('style'); lab.textContent=labelText; n.append(inp,lab);
    var commit=function(){onCommit(inp.value);};inp.addEventListener('change',commit);inp.addEventListener('blur',commit);
    return {node:n,input:inp};
}
function _genTextarea(labelText,value,onCommit){
    var base=_genInput(labelText,value,false,function(){}), old=base.input;
    var ta=document.createElement('textarea'); ta.className=old.className||'form-control';
    ta.value=value==null?'':value; ta.rows=1; ta.spellcheck=false;
    old.replaceWith(ta);
    var resize=function(){ ta.style.height='0px'; ta.style.height=ta.scrollHeight+'px'; };
    ta.style.overflow='hidden'; ta.style.resize='none';
    ta.addEventListener('input',resize); ta.addEventListener('change',function(){onCommit(ta.value);});
    ta.addEventListener('blur',function(){onCommit(ta.value);}); queueMicrotask(resize);
    return {node:base.node,input:ta,resize:resize};
}
function _genNativeSettingRow(liEl,title,sub,value,onClick){
    var r=liEl.cloneNode(true); r.removeAttribute('id'); r.removeAttribute('style');
    var btn=r.querySelector('.ListItem-button');
    if(!btn){btn=document.createElement('div');btn.className='ListItem-button';r.appendChild(btn);}
    btn.querySelectorAll('.ListItem-main-icon,.Avatar,.user-avatar').forEach(function(x){x.remove();});
    var multi=btn.querySelector('.multiline-item');
    if(!multi){multi=document.createElement('div');multi.className='multiline-item';btn.prepend(multi);}
    var te=multi.querySelector('.title'); if(!te){te=document.createElement('span');te.className='title';multi.appendChild(te);} te.textContent=title||'';
    var se=multi.querySelector('.subtitle'); if(!se){se=document.createElement('span');se.className='subtitle';multi.appendChild(se);} se.textContent=sub||''; se.hidden=!sub;
    btn.querySelectorAll('.settings-item__current-value').forEach(function(x){x.remove();});
    var ve=document.createElement('span');ve.className='settings-item__current-value';ve.textContent=value==null?'':value;btn.appendChild(ve);
    if(onClick){btn.setAttribute('role','button');btn.setAttribute('tabindex','0');btn.addEventListener('click',function(e){e.stopPropagation();onClick(ve);});}
    r._title=te;r._subtitle=se;r._value=ve;return r;
}
function _genNativeActionRow(liEl){
    var r=liEl.cloneNode(true); r.removeAttribute('id'); r.removeAttribute('style');
    var btn=r.querySelector('.ListItem-button');
    if(!btn){btn=document.createElement('div');btn.className='ListItem-button';r.appendChild(btn);}
    btn.innerHTML=''; r._content=btn; return r;
}
function _genSwitcher(checked,onChange,label){
    var sw=document.createElement('label'); sw.className='Switcher'; sw.title=label||'';
    var inp=document.createElement('input'); inp.type='checkbox'; inp.checked=!!checked;
    var widget=document.createElement('span'); widget.className='widget'; sw.append(inp,widget);
    inp.addEventListener('change',function(){if(onChange)onChange(inp.checked);}); return sw;
}
function _genButton(text,icon,variant,size){
    variant=variant||'primary';
    var sel='.Button.'+variant, live=document.querySelector('#Settings '+sel)||document.querySelector(sel);
    var b=live?live.cloneNode(true):document.createElement('button');
    b.type='button';b.removeAttribute('id');b.removeAttribute('disabled');
    b.className='Button '+variant+(size?' '+size:'')+(live&&live.classList.contains('has-ripple')?' has-ripple':'');
    var ripple=b.querySelector('.ripple-container');
    Array.from(b.childNodes).forEach(function(n){if(n!==ripple)n.remove();});
    if(icon){
        var wrap=document.createElement('span');wrap.className='with-icon-start';
        var i=document.createElement('i');i.className='icon icon-'+icon;i.setAttribute('aria-hidden','true');
        var t=document.createElement('span');t.textContent=text||'';wrap.append(i,t);b.insertBefore(wrap,ripple||null);
    }else b.insertBefore(document.createTextNode(text||''),ripple||null);
    return b;
}
function _genIconButton(icon,title,size,danger){
    var sel=size==='tiny'?'.Button.tiny.round':'.Button.smaller.translucent.round';
    var live=document.querySelector('#Settings '+sel)||document.querySelector(sel);
    var b=live?live.cloneNode(true):document.createElement('button');
    b.type='button';b.removeAttribute('id');b.removeAttribute('disabled');
    b.className='Button '+(size==='tiny'?'tiny':'smaller')+' translucent round'+(live&&live.classList.contains('has-ripple')?' has-ripple':'');
    b.title=title||'';if(title)b.setAttribute('aria-label',title);else b.removeAttribute('aria-label');
    var i=b.querySelector('i.icon');
    if(!i){i=document.createElement('i');i.className='icon';var rp=b.querySelector('.ripple-container');b.insertBefore(i,rp||b.firstChild);}
    Array.from(i.classList).filter(function(c){return /^icon-/.test(c);}).forEach(function(c){i.classList.remove(c);});
    i.classList.add('icon-'+icon);i.setAttribute('aria-hidden','true');i.removeAttribute('style');
    if(danger)i.style.color='var(--color-error,#e53935)';
    return b;
}
function _nativeDecoratedTemplate(tone,multiline){
    var st=document.getElementById('Settings');if(!st)return null;
    var single={red:'support-filled',blue:'help-filled',green:'privacy-policy-filled',orange:'gift-filled',purple:'premium-filled',gray:'lock-filled'};
    var multi={red:'notifications-filled',blue:'account-filled',green:'piechart-filled',orange:'settings-filled',purple:'animations-filled',gray:'lock-filled'};
    var name=(multiline?multi:single)[tone]||(multiline?'account-filled':'help-filled');
    var hit=st.querySelector('.ListItem.narrow .icon-'+name),row=hit&&hit.closest('.ListItem.narrow');
    if(row&&!row.closest('[data-tgabout],[data-tggen],._tgpanel_')&&!/^_tg/.test(row.id||''))return row;
    return Array.from(st.querySelectorAll('.ListItem.narrow')).find(function(r){
        if(r.closest('[data-tgabout],[data-tggen],._tgpanel_')||/^_tg/.test(r.id||''))return false;
        var w=r.querySelector('.ListItem-main-icon'),i=w&&w.querySelector('i.icon');if(!w||!i)return false;
        return multiline?!!r.querySelector('.multiline-item'):!r.querySelector('.multiline-item');
    })||null;
}
function _filledIconName(icon){var map={info:'info-filled',user:'account-filled',mention:'mention-filled',delete:'delete-filled',folder:'folder-filled'};return map[icon]||icon;}
// Filled Material Icons (round, Apache-2.0) used only where Telegram has no semantic glyph.
// extension = add-ons; device_hub = proxy/network route. The native colored tile is still cloned from Telegram.
var _TWD_FILLED_GLYPHS={
    'twd-addons':'M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z',
    'twd-proxy':'M17 16l-4-4V8.82c1.35-.49 2.26-1.89 1.93-3.46a3.013 3.013 0 0 0-2.42-2.32A3.001 3.001 0 0 0 9 6c0 1.3.84 2.4 2 2.82V12l-4 4H4c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1h3c.55 0 1-.45 1-1v-2.05l4-4.2 4 4.2V20c0 .55.45 1 1 1h3c.55 0 1-.45 1-1v-3c0-.55-.45-1-1-1h-3z',
    'twd-link':'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4a5 5 0 0 0 0-10z',
    'twd-update':'M12.35 15.65l2.79-2.79a.5.5 0 0 0-.35-.85H13V4c0-.55-.45-1-1-1s-1 .45-1 1v8H9.21c-.45 0-.67.54-.35.85l2.79 2.79c.19.2.51.2.7.01zM21 3h-5.01c-.54 0-.99.45-.99.99c0 .55.45.99.99.99H20c.55 0 1 .45 1 1v12.03c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V5.99c0-.55.45-1 1-1h4.01c.54 0 .99-.45.99-.99a1 1 0 0 0-.99-1H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z'
};
function _setDecoratedGlyph(wrap,icon){
    if(!wrap)return;
    var old=wrap.querySelector('i.icon,svg._twd-filled-glyph_');
    var path=_TWD_FILLED_GLYPHS[icon];
    if(path){
        if(old)old.remove();
        var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('_twd-filled-glyph_');
        var p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',path);svg.appendChild(p);wrap.appendChild(svg);return;
    }
    // Keep Telegram's extra hashed glyph class (currently v0eXS-8f): it supplies
    // the white filled-glyph styling inside colored settings tiles.
    var i=old&&old.tagName==='I'?old:document.createElement('i');
    Array.from(i.classList).filter(function(c){return /^icon-/.test(c);}).forEach(function(c){i.classList.remove(c);});
    i.classList.add('icon','icon-'+_filledIconName(icon));i.removeAttribute('style');i.setAttribute('aria-hidden','true');
    if(!i.parentNode)wrap.appendChild(i);
}
function _toneForIcon(icon,danger){if(danger||/delete|close/.test(icon))return'red';if(/reload|folder|download|check|update/.test(icon))return'green';if(/mention|addons/.test(icon))return'purple';if(/user|account/.test(icon))return'orange';return'blue';}
function _genDecoratedRow(icon,title,value,onClick,tone,sub,danger){
    icon=_filledIconName(String(icon||'info').replace(/^icon-/,''));tone=tone||_toneForIcon(icon,danger);
    var tpl=_nativeDecoratedTemplate(tone,!!sub);
    if(!tpl){var li=document.querySelector('#Settings .ListItem.narrow')||document.querySelector('#Settings .ListItem');var plain=_genNativeSettingRow(li,title,sub||'',value||'',onClick);plain._v=plain._value;return plain;}
    var r=tpl.cloneNode(true);r.removeAttribute('id');r.removeAttribute('style');var btn=r.querySelector('.ListItem-button');
    var wrap=btn&&btn.querySelector('.ListItem-main-icon'),ripple=btn&&btn.querySelector('.ripple-container');
    _setDecoratedGlyph(wrap,icon);
    var multiTpl=btn&&btn.querySelector('.multiline-item');multiTpl=multiTpl&&multiTpl.cloneNode(false);
    while(btn.firstChild)btn.removeChild(btn.firstChild);if(wrap)btn.appendChild(wrap);
    var titleEl=null,subEl=null;
    if(sub){var multi=multiTpl||document.createElement('div');multi.classList.add('multiline-item');titleEl=document.createElement('span');titleEl.className='title';titleEl.textContent=title||'';multi.appendChild(titleEl);subEl=document.createElement('span');subEl.className='subtitle';subEl.textContent=sub;multi.appendChild(subEl);btn.appendChild(multi);}
    else{titleEl=document.createTextNode(title||'');btn.appendChild(titleEl);}
    var v=document.createElement('span');v.className='settings-item__current-value';v.textContent=value==null?'':value;btn.appendChild(v);
    r.classList.toggle('is-static',!onClick);if(danger)r.classList.add('destructive');
    if(onClick){if(ripple)btn.appendChild(ripple);btn.setAttribute('role','button');btn.setAttribute('tabindex','0');btn.addEventListener('click',function(e){e.stopPropagation();onClick(v);});}else{btn.removeAttribute('role');btn.removeAttribute('tabindex');}
    r._v=v;r._value=v;r._title=titleEl;r._subtitle=subEl;return r;
}
function _genRow(liEl,icon,title,value,onClick,danger){return _genDecoratedRow(icon,title,value,onClick,_toneForIcon(icon,danger),'',danger);}

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
    // Секции используют нативный Telegram header/card rhythm. Для первой категории
    // верхнего отступа нет; последующие получают его от родных CSS-правил.
    function addSection(title, cardEl){ var pair=_appendNativeSection(sc,headerTpl,title,cardEl),h=pair.header; h.setAttribute('data-tggen','1'); cardEl.setAttribute('data-tggen','1'); }

    INV('get_settings').then(function(s){
        s=s||{};
        // Загрузки: длинное поле пути; иконка-папка ПОВЕРХ поля справа (overlay),
        // клик — выбор папки. Полю даём padding-right, чтобы путь не лез под иконку.
        var c1=_genCard(cardCls); c1.style.position='relative';
        var folder=_genInput(T('st_folder'), s.save_path||'', false, function(val){ _saveOne({save_path:val||null}); });
        folder.node.style.width='100%'; folder.node.style.marginBottom='0';   // убрать «подбородок» + центрировать
        if(folder.input) folder.input.style.paddingRight='46px';
        c1.appendChild(folder.node);
        var pbtn=_genIconButton('folder',T('choose'),'small',false);
        pbtn.style.cssText='position:absolute;right:1.25rem;top:50%;transform:translateY(-50%);z-index:2;';
        pbtn.addEventListener('click',function(){ INV('open_folder_dialog').then(function(p){ if(p&&folder.input){ folder.input.value=p; _saveOne({save_path:p}); } }).catch(function(){}); });
        c1.appendChild(pbtn);
        addSection(T('sec_downloads'), c1);

        // Окно: тумблеры
        var c2=_genCard(cardCls);
        c2.appendChild(_genToggle(T('st_tray'), !!s.minimize_to_tray, function(v){ _saveOne({minimize_to_tray:v}); }, T('st_tray_sub')));
        c2.appendChild(_genToggle(T('st_devtools'), !!s.devtools_enabled, function(v){ _setDevtoolsEnabled(v); }));
        addSection(T('sec_window'), c2);

        // Интеграция с Windows: выбор обработчика tg:// остаётся пользовательским решением.
        var c3=_genCard(cardCls);
        c3.appendChild(_genDecoratedRow('twd-link',T('st_tg_links'),T('st_open_defaults'),function(){
            INV('open_default_apps').catch(function(){});
        },'blue',T('st_tg_links_sub')));
        addSection(T('sec_integration'), c3);

        // Обновления: частота автопроверки — нативный «выпадающий список» (попап-радио)
        var c4=_genCard(cardCls);
        var ivKeys=['30m','1h','12h','24h','3d','7d','30d','never'];
        var ivLbl={'30m':'iv_30m','1h':'iv_1h','12h':'iv_12h','24h':'iv_24h','3d':'iv_3d','7d':'iv_7d','30d':'iv_30d','never':'iv_never'};
        var ivCur=s.update_check_interval||'1h';
        c4.appendChild(_genRow(liEl,'twd-update',T('st_auto_check'),T(ivLbl[ivCur]||'iv_1h'),function(v){
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
    _wireUiLabUnlock(unRow);
    var updRow=_genRow(liEl,'twd-update',T('check_updates'),'',async function(){
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
