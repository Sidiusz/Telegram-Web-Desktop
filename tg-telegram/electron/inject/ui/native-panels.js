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
    var st=document.getElementById('Settings');
    if(animate===false){
        if(p._under)p._under.classList.remove('_twd-under_','_twd-under-back_');
        if(st)st.classList.remove('_tgpush_');
        p.remove(); return;
    }
    p.classList.remove('_in_');
    if(p._under){
        p._under.classList.remove('_twd-under_');
        p._under.classList.add('_twd-under-back_');
    }
    void p.offsetWidth;
    p.classList.add('_out_');
    var finished=false;
    function finishBack(e){
        if(e&&e.target!==p)return;
        if(finished)return;finished=true;
        if(p._under)p._under.classList.remove('_twd-under_','_twd-under-back_');
        if(st)st.classList.remove('_tgpush_');
        if(p&&p.parentNode)p.remove();
    }
    p.addEventListener('animationend',finishBack);
    setTimeout(function(){finishBack();},380);
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
function _withSettingsReady(openFn){
    if(document.getElementById('Settings')) return openFn();
    tgOpenSettings();
    const tries=setInterval(()=>{
        if(!document.getElementById('Settings'))return;
        clearInterval(tries);openFn();
    },80);
    setTimeout(()=>clearInterval(tries),4000);
    return null;
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
        const back=_genIconButton('arrow-left',T('back'),'small',false);
        const h3=document.createElement('h3'); h3.textContent=opts.title||'';
        hdr.appendChild(back); hdr.appendChild(h3);
        if(opts.renderHeader) opts.renderHeader(hdr);
        back.addEventListener('click',()=>{
            if(opts.handleBack && opts.handleBack(panel,content)===true) return;
            closeNativePanel();
            if(opts.onBack)opts.onBack();
        });
        panel._titleEl=h3;
        panel._backButton=back;
        panel.appendChild(hdr);
    }
    // Контент: тот же класс, что у нативного раздела (custom-scroll + with-notch),
    // скроллится, имеет отступы. ID даём, чтобы renderContent нашёл.
    const content=document.createElement('div');
    content.className='settings-content custom-scroll with-notch';
    content.id='_tgpc_';
    panel.appendChild(content);
    panel._content=content;
    // Кладём поверх колонки настроек (та же геометрия, что у слайдов).
    settings.style.position=settings.style.position||'relative';
    settings.querySelectorAll('._twd-under_,._twd-under-back_').forEach(function(x){
        x.classList.remove('_twd-under_','_twd-under-back_');
    });
    panel._under=settings.querySelector('.Transition_slide-active, .Transition__slide--active');
    settings.appendChild(panel);
    _nativePanel=panel;
    if(opts.renderContent) opts.renderContent(content);
    // Commit the native off-screen start state, then attach Telegram's own
    // slide-in-200/push-out animation pair on the same frame.
    void panel.offsetWidth;
    settings.classList.add('_tgpush_');
    if(panel._under)panel._under.classList.add('_twd-under_');
    panel.classList.add('_in_');
    return panel;
}

// ── «Загрузки» как нативный раздел (#5) ────────────────────────────────────
// Строки — клоны нативного .ListItem multiline (title=имя, subtitle=статус/путь),
// иконка по расширению, справа — действия Открыть/Папа/Удалить. Свой Назад.
let _dlNativeTimer=null;
function openDownloadsNative(){
    if(!document.getElementById('Settings')) return _withSettingsReady(openDownloadsNative);
    const refresh=()=>{ const c=document.getElementById('_tgpc_'); if(c) renderDownloadsNative(c); };
    const panel=openNativePanel({
        title:T('downloads'),
        renderHeader(hdr){
            const clr=_genIconButton('delete',T('dl_clear'),'small',true);
            clr.addEventListener('click',()=>{
                showModal({
                    title:T('dl_clear_t'),msg:T('dl_clear_m'),
                    okText:T('dl_clear_upper'),okDanger:true,
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

// ── «Прокси» ────────────────────────────────────────────────────────────────
function openProxyNative(){
    return _withSettingsReady(()=>openNativePanel({
        title:T('proxy'),
        renderContent(content){ renderProxyNative(content); },
    }));
}

async function renderProxyNative(content){
    if(!content)return;
    content.innerHTML='<div class="_tpempty_">'+T('loading')+'</div>';
    let st; try{st=await INV('get_proxy_status');}catch(e){content.innerHTML='<div class="_tpempty_">'+T('load_error')+'</div>';return;}
    captureWidgetTpl();
    const cardCls=_genCardCls(), headerTpl=_genHeaderTpl();
    const liEl=document.querySelector('#Settings .ListItem.narrow')||document.querySelector('#Settings .ListItem');
    if(!cardCls||!liEl){setTimeout(()=>renderProxyNative(content),120);return;}
    content.innerHTML='';
    const addSection=(title,card)=>content.append(_genHeader(headerTpl,title),card);
    const card=()=>_genCard(cardCls);
    const nativeRow=(title,sub,value,onClick)=>_genNativeSettingRow(liEl,title,sub,value,onClick);
    const passive=(text)=>{
        const src=document.querySelector('#Settings .settings-item-description');
        const el=src?src.cloneNode(false):document.createElement('p');
        el.className=src?src.className:'settings-item-description';
        el.textContent=text;
        return el;
    };
    let draft={
        mode:st.mode,domainSource:st.domainSource||'flowseal',customDomains:(st.customDomains||[]).join(', '),
        pinnedDomain:st.pinnedDomain||'',workerEnabled:!!st.workerEnabled,workerDomains:(st.workerDomains||[]).join(', '),
        autoFailures:st.autoFailures||1,autoWindowSec:st.autoWindowSec||12,webFallback:st.webFallback!==false,
        dcIps:Object.entries(st.dcIps||{}).map(([k,v])=>k+':'+v).join('\n')
    };
    let statusText=null,diagBox=null,testLines=[];
    const statusLabel=()=>st.active?T('proxy_active'):T('proxy_direct');
    const connectionDetails=()=>[statusLabel(),st.domain||'',st.lastDc?('DC'+st.lastDc):''].filter(Boolean).join(' \u00b7 ');
    const statusDetails=()=>T('proxy_status')+': '+connectionDetails();
    const diagLines=()=>[
        T('proxy_diag_current')+': '+connectionDetails(),
        'route: '+(st.route||'direct'),
        'error: '+(st.lastError||'\u2014'),
        'Web A: '+(st.webFallback?(st.webFallbackLatched?'fallback active':'fallback enabled'):'off'),
        'commit: '+((st.fallback&&st.fallback.ref)||'\u2014')
    ].concat(testLines);
    function paintStatus(){if(statusText)statusText.textContent=statusDetails();}
    function paintDiag(){if(!diagBox)return;diagBox.replaceChildren(...diagLines().map(x=>passive(x)));}
    async function saveOptions(patch){st=await INV('save_proxy_options',patch);paintStatus();paintDiag();return st;}

    const modeCard=card();
    modeCard.appendChild(_genRadioGroup('_tg_proxy_mode_',[{value:'auto',label:T('proxy_auto')},{value:'always',label:T('proxy_always')},{value:'off',label:T('proxy_off')}],draft.mode,async v=>{
        draft.mode=v;st=await INV('set_proxy_mode',{mode:v});paintStatus();paintDiag();
    }));
    statusText=passive(statusDetails());
    modeCard.appendChild(statusText);
    addSection(T('proxy_mode'),modeCard);

    const domainCard=card();
    domainCard.appendChild(_genRadioGroup('_tg_proxy_route_',[{value:'flowseal',label:T('proxy_flowseal')},{value:'custom',label:T('proxy_custom')}],draft.domainSource,async v=>{
        draft.domainSource=v;
        const list=(v==='custom'?draft.customDomains.split(/[\s,;]+/):(st.flowsealDomains||[])).filter(Boolean);
        if(draft.pinnedDomain&&!list.includes(draft.pinnedDomain))draft.pinnedDomain='';
        customWrap.node.hidden=v!=='custom';refreshPin();
        await saveOptions({domainSource:v,pinnedDomain:draft.pinnedDomain});
    }));
    const customWrap=_genInput(T('proxy_custom_hint'),draft.customDomains,false,async v=>{
        draft.customDomains=v;refreshPin();await saveOptions({customDomains:v,pinnedDomain:draft.pinnedDomain});
    });
    customWrap.node.hidden=draft.domainSource!=='custom';domainCard.appendChild(customWrap.node);
    const pinRow=nativeRow(T('proxy_pin'),' ',draft.pinnedDomain||T('proxy_rotate'),()=>{
        const list=(draft.domainSource==='custom'?draft.customDomains.split(/[\s,;]+/):(st.flowsealDomains||[])).filter(Boolean);
        pickModal({title:T('proxy_pin'),current:draft.pinnedDomain,options:[{value:'',label:T('proxy_rotate')}].concat(list.map(v=>({value:v,label:v}))),onSave:async v=>{
            draft.pinnedDomain=v;refreshPin();await saveOptions({pinnedDomain:v});
        }});
    });
    domainCard.appendChild(pinRow);
    function refreshPin(){
        const list=(draft.domainSource==='custom'?draft.customDomains.split(/[\s,;]+/):(st.flowsealDomains||[])).filter(Boolean);
        if(draft.pinnedDomain&&!list.includes(draft.pinnedDomain))draft.pinnedDomain='';
        pinRow._value.textContent=draft.pinnedDomain||T('proxy_rotate');
    }
    let refreshing=false;
    const refreshRow=nativeRow(T('proxy_refresh'),T('proxy_refresh_desc'),'',async()=>{
        if(refreshing)return;
        refreshing=true; refreshRow._title.textContent=T('proxy_testing');
        try{const r=await INV('refresh_proxy_domains');if(r&&r.status)st=r.status;refreshPin();paintStatus();paintDiag();}
        finally{refreshing=false;refreshRow._title.textContent=T('proxy_refresh');}
    });
    domainCard.appendChild(refreshRow);
    addSection(T('proxy_domains'),domainCard);

    const workerCard=card();
    const workerDomains=_genInput(T('proxy_worker_domains'),draft.workerDomains,false,async v=>{draft.workerDomains=v;await saveOptions({workerDomains:v});});
    const dcWrap=_genTextarea(T('proxy_dc_ips'),draft.dcIps,async v=>{draft.dcIps=v;await saveOptions({dcIps:v});});
    const workerToggle=_genToggle(T('proxy_worker_toggle'),draft.workerEnabled,async v=>{
        draft.workerEnabled=v;workerDomains.node.hidden=!v;dcWrap.node.hidden=!v;if(v)dcWrap.resize();await saveOptions({workerEnabled:v});
    },T('proxy_worker_desc'));
    workerCard.appendChild(workerToggle);
    workerDomains.node.hidden=!draft.workerEnabled;dcWrap.node.hidden=!draft.workerEnabled;
    workerCard.append(workerDomains.node,dcWrap.node);
    addSection(T('proxy_worker'),workerCard);

    const autoCard=card();
    const failWrap=_genInput(T('proxy_failures'),String(draft.autoFailures),true,async v=>{draft.autoFailures=Number(v)||1;await saveOptions({autoFailures:draft.autoFailures});});
    const winWrap=_genInput(T('proxy_window'),String(draft.autoWindowSec),true,async v=>{draft.autoWindowSec=Number(v)||12;await saveOptions({autoWindowSec:draft.autoWindowSec});});
    autoCard.append(failWrap.node,winWrap.node);
    autoCard.appendChild(_genToggle(T('proxy_web_fallback'),draft.webFallback,async v=>{
        draft.webFallback=v;await saveOptions({webFallback:v});
    },T('proxy_web_fallback_desc')));
    addSection(T('proxy_auto_opts'),autoCard);
    const diagCard=card();
    diagBox=document.createElement('div');
    diagBox.append(...diagLines().map(x=>passive(x)));
    diagCard.appendChild(diagBox);
    let testing=false;
    const testRow=nativeRow(T('proxy_test'),T('proxy_test_desc'),'',async()=>{
        if(testing)return;
        testing=true; testRow._title.textContent=T('proxy_testing');
        try{
            const rs=await INV('test_proxy_connectivity');
            testLines=(rs||[]).map(x=>'DC'+x.dc+': '+(x.ok?'\u2713 '+(x.domain||''):'\u2715 '+(x.error||'')));
            paintDiag();toast((rs||[]).every(x=>x.ok)?T('proxy_test_ok'):T('proxy_test_bad'));
        }finally{testing=false;testRow._title.textContent=T('proxy_test');}
    });
    const copyRow=nativeRow(T('proxy_copy'),T('proxy_copy_desc'),'',()=>navigator.clipboard.writeText(diagLines().join('\n')).then(()=>toast(T('st_saved_short'))).catch(()=>{}));
    diagCard.append(testRow,copyRow);
    addSection(T('proxy_diag'),diagCard);

    const liveTimer=setInterval(async()=>{
        if(!content.isConnected){clearInterval(liveTimer);return;}
        try{const next=await INV('get_proxy_status');st=Object.assign(st||{},next||{});paintStatus();paintDiag();}catch(e){}
    },1000);
}

function openAddonsNative(){
    if(!document.getElementById('Settings')) return _withSettingsReady(openAddonsNative);
    openNativePanel({
        title:T('addons'),
        renderHeader(hdr){
            const fb=_genIconButton('folder',T('ad_folder'),'small',false);
            fb.addEventListener('click',()=>INV('open_addons_folder'));
            hdr.appendChild(fb);
        },
        renderContent(content){ renderAddonsNative(content); },
    });
}


async function renderAddonsNative(content){
    if(!content)return;
    content.innerHTML='<div class="_tpempty_">'+T('loading')+'</div>';
    let addons=[];
    try{addons=await INV('get_addons');}catch(e){content.innerHTML='<div class="_tpempty_">'+T('load_error')+'</div>';return;}
    captureWidgetTpl();
    const cardCls=_genCardCls(),headerTpl=_genHeaderTpl();
    const liEl=document.querySelector('#Settings .ListItem.narrow')||document.querySelector('#Settings .ListItem');
    if(!cardCls||!liEl){setTimeout(()=>{if(content.isConnected)renderAddonsNative(content);},120);return;}
    content.innerHTML='';
    let applyBar=null;
    const addSection=(title,cd)=>_appendNativeSection(content,headerTpl,title,cd);
    const card=()=>_genCard(cardCls);
    const baseRow=(title,sub)=>{const r=_genNativeSettingRow(liEl,title,sub||'','',null);if(r._value)r._value.remove();const b=r.querySelector('.ListItem-button');if(b)b.querySelectorAll('.Switcher,.Switch,.Toggle,.icon-next,.icon-arrow-right').forEach(x=>x.remove());return r;};
    const markDirty=()=>{if(applyBar)applyBar.hidden=false;};
    const groupMembers={};addons.forEach(a=>{if(a.group)(groupMembers[a.group]=groupMembers[a.group]||[]).push(a);});
    function toggleRow(cd,a){
        const r=baseRow(a.display_name||a.name,a.version?('v'+a.version):''),b=r.querySelector('.ListItem-button');
        if(!a.embedded){
            const del=_genIconButton('delete',T('dl_delete'),'tiny',true);
            del.addEventListener('click',e=>{e.stopPropagation();showModal({title:T('ad_del_t'),msg:'«'+(a.display_name||a.name)+'»?',okText:T('del_upper'),okDanger:true,onOk:async()=>{await INV('delete_addon',{name:a.name});renderAddonsNative(content);}});});
            b.appendChild(del);
        }
        const sw=_genSwitcher(!!a.enabled,async v=>{
            if(v&&a.group){
                for(const other of (groupMembers[a.group]||[])){
                    if(other===a||!other.enabled)continue;
                    other.enabled=false;
                    if(other._uiSwitch)other._uiSwitch.checked=false;
                    await INV('toggle_addon',{key:other.key,enabled:false});
                }
            }
            a.enabled=v;
            await INV('toggle_addon',{key:a.key,enabled:v});
            markDirty();
        },a.display_name||a.name);
        a._uiSwitch=sw.querySelector('input[type=checkbox]');
        b.appendChild(sw);cd.appendChild(r);
    }
    const embedded=addons.filter(a=>a.embedded),user=addons.filter(a=>!a.embedded);
    if(embedded.length){const cd=card();embedded.forEach(a=>toggleRow(cd,a));addSection(T('ad_builtin'),cd);}
    if(user.length){const cd=card();user.forEach(a=>toggleRow(cd,a));addSection(T('ad_user'),cd);}
    else{const cd=card();const note=document.createElement('p');note.className='settings-item-description';note.textContent=T('ad_none');cd.appendChild(note);addSection(T('ad_user'),cd);}
    applyBar=document.createElement('div');applyBar.className='_twd-apply-bar_';applyBar.hidden=true;
    const ab=_genButton(T('ad_apply'),'reload','primary');
    ab.addEventListener('click',async()=>{ab.disabled=true;try{await INV('apply_addons');applyBar.hidden=true;}finally{ab.disabled=false;}});
    applyBar.appendChild(ab);content.appendChild(applyBar);
}

// ── «Список изменений» как нативный раздел ──────────────────────────────────
function openChangelogNative(){
    if(!document.getElementById('Settings')) return _withSettingsReady(openChangelogNative);
    openNativePanel({
        title:T('changelog'),
        renderContent(content){ renderChangelogNative(content); },
    });
}
// Сравнение версий "a.b.c" → -1/0/1.
function _clCmpVer(a,b){var pa=String(a).split('.').map(Number),pb=String(b).split('.').map(Number);for(var i=0;i<Math.max(pa.length,pb.length);i++){var x=pa[i]||0,y=pb[i]||0;if(x>y)return 1;if(x<y)return -1;}return 0;}
function _clPlainMarkdown(s){
    return String(s||'').replace(/\[([^\]]+)\]\([^\)]+\)/g,'$1').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/__([^_]+)__/g,'$1').replace(/\*([^*]+)\*/g,'$1').replace(/_([^_]+)_/g,'$1').replace(/~~([^~]+)~~/g,'$1').replace(/`([^`]+)`/g,'$1');
}
function _clNativeRow(liEl,line){
    var raw=String(line||'').trim().replace(/^[-•]\s*/,'');
    var strong=raw.match(/^\*\*(.+?)\*\*\s*(.*)$/),title='',sub='';
    if(strong){title=_clPlainMarkdown(strong[1]);sub=_clPlainMarkdown(strong[2]);}
    else{var txt=_clPlainMarkdown(raw),m=txt.match(/^([^:]{2,24}):\s*(.+)$/);title=m?m[1]+':':txt;sub=m?m[2]:'';}
    var r=_genNativeSettingRow(liEl,title,sub,'',null);if(r._value)r._value.remove();r.classList.add('is-static');
    if(strong&&r._title)r._title.style.fontWeight='var(--font-weight-medium,500)';
    var b=r.querySelector('.ListItem-button');if(b){b.removeAttribute('role');b.removeAttribute('tabindex');}return r;
}
function _clAppendVersion(content,v,isCur,cardCls,headerTpl,liEl){
    var title=(/^\d/.test(v.version)?'v':'')+v.version+(isCur?' · '+T('cl_current'):'');
    var card=_genCard(cardCls);
    var lines=String(v.notes||'').split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!/^[_\-—]{3,}$/.test(x));if(!lines.length)lines=[T('cl_nodesc')];
    lines.forEach(line=>card.appendChild(_clNativeRow(liEl,line)));_appendNativeSection(content,headerTpl,title,card);
}
async function renderChangelogNative(content){
    if(!content)return;content.innerHTML='<div class="_tpempty_">'+T('loading')+'</div>';captureWidgetTpl();
    var cardCls=_genCardCls(),headerTpl=_genHeaderTpl(),liEl=document.querySelector('#Settings .ListItem.narrow')||document.querySelector('#Settings .ListItem');
    if(!cardCls||!liEl){setTimeout(()=>{if(content.isConnected)renderChangelogNative(content);},120);return;}
    var data=null;try{data=await INV('fetch_changelog_structured');}catch(e){data={error:String(e)};}content.innerHTML='';
    if(data&&!data.error&&data.versions&&data.versions.length){var cur=data.current,versions=data.versions.slice().sort((a,b)=>_clCmpVer(b.version,a.version));var ci=versions.findIndex(v=>v.version===cur);if(ci>0)versions.unshift(versions.splice(ci,1)[0]);versions.forEach(v=>_clAppendVersion(content,v,v.version===cur,cardCls,headerTpl,liEl));return;}
    try{
        var r=await INV('fetch_changelog');
        if(r&&r.error){var err=document.createElement('div');err.className='_tpempty_';err.textContent=T('error')+': '+String(r.error);content.appendChild(err);return;}
        var card=_genCard(cardCls);card.classList.add('_twd-panel-card_');String((r&&r.text)||T('cl_empty')).split(/\r?\n/).map(x=>x.trim()).filter(Boolean).forEach(line=>card.appendChild(_clNativeRow(liEl,line)));content.appendChild(card);
    }catch(e){var err2=document.createElement('div');err2.className='_tpempty_';err2.textContent=T('load_error');content.appendChild(err2);}
}

// Рисует список загрузок в переданный контент-контейнер (нативная панель).
// Эталон строки: <div class="ListItem multiline"><div class="ListItem-button">…</div></div>.
async function renderDownloadsNative(content){
    if(!content)return;captureWidgetTpl();
    const cardCls=_genCardCls(),headerTpl=_genHeaderTpl(),liEl=document.querySelector('#Settings .ListItem.narrow')||document.querySelector('#Settings .ListItem');
    if(!cardCls||!liEl){setTimeout(()=>{if(content.isConnected)renderDownloadsNative(content);},120);return;}
    let settings={};try{settings=await INV('get_settings')||{};}catch(e){}
    const merged=await collectDownloads();content.innerHTML='';
    const addSection=(title,card)=>content.append(_genHeader(headerTpl,title),card);

    const cfg=_genCard(cardCls);cfg.classList.add('_twd-panel-card_');
    const folderRow=_genNativeSettingRow(
        liEl,
        T('st_folder'),
        settings.save_path||T('twd_download_default_folder'),
        '',
        async()=>{
            const p=await INV('open_folder_dialog');
            if(!p)return;
            const current=await INV('get_settings')||{};
            await INV('save_settings',{settings:Object.assign({},current,{save_path:p})});
            if(content.isConnected)renderDownloadsNative(content);
        }
    );
    cfg.appendChild(folderRow);
    addSection(T('sec_downloads'),cfg);

    const history=_genCard(cardCls);history.classList.add('_twd-panel-card_');
    if(!merged.length){
        const empty=document.createElement('div');empty.className='_tpempty_';empty.textContent=T('dl_empty');history.appendChild(empty);
    }else{
        merged.forEach(d=>history.appendChild(_nativeDlRow(d,()=>renderDownloadsNative(content),liEl)));
    }
    addSection(T('twd_download_history'),history);
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
    active.forEach(d=>{ merged.unshift(d); });
    return merged;
}
