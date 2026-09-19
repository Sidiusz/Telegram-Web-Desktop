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
function _largeSvgGlyph(icon){
    var raw=window.__twdLargeSvgIcons&&window.__twdLargeSvgIcons[icon];
    if(!raw)return null;
    try{
        var doc=new DOMParser().parseFromString(raw,'image/svg+xml');
        var src=doc&&doc.documentElement;
        if(!src||String(src.nodeName).toLowerCase()!=='svg'||doc.querySelector('parsererror'))return null;
        var svg=document.importNode(src,true);
        svg.removeAttribute('width');svg.removeAttribute('height');svg.removeAttribute('style');
        svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.setAttribute('fill','currentColor');
        svg.classList.add('_twd-filled-glyph_');
        svg.querySelectorAll('script,foreignObject').forEach(function(x){x.remove();});
        svg.querySelectorAll('*').forEach(function(x){Array.from(x.attributes||[]).forEach(function(a){if(/^on/i.test(a.name))x.removeAttribute(a.name);});});
        return svg;
    }catch(_){return null;}
}
function _setDecoratedGlyph(wrap,icon){
    if(!wrap)return;
    var old=wrap.querySelector('i.icon,svg._twd-filled-glyph_');
    var custom=_largeSvgGlyph(icon);
    if(custom){if(old)old.remove();wrap.appendChild(custom);return;}
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
    icon=String(icon||'info').replace(/^icon-/,'');tone=tone||_toneForIcon(icon,danger);
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

// ── Corner-уведомления ───────────────────────────────────────────────────
