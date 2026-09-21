// Telegram Web Desktop settings rendered as a native Settings slide.
// This file owns only our settings hierarchy; Telegram's own settings pages stay untouched.

function _twdNativeContext(content){
    captureWidgetTpl();
    var cardCls=_genCardCls();
    var headerTpl=_genHeaderTpl();
    var liEl=document.querySelector('#Settings .ListItem.narrow')||document.querySelector('#Settings .ListItem');
    if(!cardCls||!liEl)return null;
    return {
        cardCls:cardCls, headerTpl:headerTpl, liEl:liEl,
        card:function(){return _genCard(cardCls);},
        section:function(title,card){return _appendNativeSection(content,headerTpl,title,card);}
    };
}
function _twdStaticRow(ctx,title,sub,value,onClick,icon,tone){
    return _genDecoratedRow(icon||'settings',title,value||'',onClick||null,tone||'blue',sub||'',false);
}
function _twdPassiveText(text){
    var src=document.querySelector('#Settings .settings-item-description');
    var el=src?src.cloneNode(false):document.createElement('p');
    el.className=(src?src.className:'settings-item-description')+' _twd-clarification_';
    el.textContent=String(text||'');
    return el;
}
function _twdSwitchRow(ctx,title,sub,checked,onChange){
    var r=_genNativeSettingRow(ctx.liEl,title,sub||'','',null);
    if(r._value)r._value.remove();
    var b=r.querySelector('.ListItem-button');
    if(b){
        b.querySelectorAll('.Switcher,.Switch,.Toggle,.icon-next,.icon-arrow-right').forEach(function(x){x.remove();});
        var sw=_genSwitcher(!!checked,onChange,title),inp=sw.querySelector('input[type="checkbox"]');
        b.appendChild(sw);
        b.setAttribute('role','button');
        b.setAttribute('tabindex','0');
        b.addEventListener('click',function(e){
            if(!inp||e.target.closest('.Switcher,.Switch,.Toggle,input,button,a'))return;
            inp.click();
        });
        b.addEventListener('keydown',function(e){
            if(!inp||e.target!==b||(e.key!=='Enter'&&e.key!==' '))return;
            e.preventDefault();
            inp.click();
        });
    }
    return r;
}
function _twdRangeRow(ctx,title,sub,value,min,max,step,format,onChange){
    value=Number(value);min=Number(min);max=Number(max);step=Number(step)||1;
    if(!Number.isFinite(value))value=min;
    value=Math.max(min,Math.min(max,value));
    var r=_genNativeSettingRow(ctx.liEl,title,sub||'','',null);
    if(r._value)r._value.remove();
    var b=r.querySelector('.ListItem-button');
    if(!b)return r;
    b.classList.add('_twd-range-row_');
    b.removeAttribute('role');b.removeAttribute('tabindex');
    b.querySelectorAll('.Switcher,.Switch,.Toggle,.icon-next,.icon-arrow-right').forEach(function(x){x.remove();});
    var wrap=document.createElement('div');wrap.className='_twd-range-control_';
    var input=document.createElement('input');input.type='range';input.className='_twd-range-input_';
    input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(value);
    input.setAttribute('aria-label',title||'');
    var label=document.createElement('span');label.className='_twd-range-value_';
    var paint=function(){var n=Number(input.value);label.textContent=format?format(n):String(n);};
    input.addEventListener('input',paint);
    input.addEventListener('change',function(){var n=Number(input.value);if(onChange)onChange(n);});
    paint();wrap.append(input,label);b.appendChild(wrap);return r;
}
var _twdSaveQueue=Promise.resolve();
function _twdSave(patch){
    _twdSaveQueue=_twdSaveQueue.catch(function(){}).then(function(){
        return INV('get_settings').then(function(s){
            return INV('save_settings',{settings:Object.assign({},s||{},patch)});
        });
    });
    return _twdSaveQueue;
}
function _twdClearMessageHistory(){
    var api=window.__twdMessageHistoryApi;
    if(api&&typeof api.clear==='function'){
        try{api.clear();return Promise.resolve({ok:true});}catch(e){}
    }
    return Promise.resolve({ok:true});
}
function _twdConfigureHistory(patch){
    var map={
        messages_show_deleted:'showDeleted',messages_show_disappearing:'showDisappearing',
        messages_save_deleted:'saveDeleted',messages_save_disappearing:'saveDisappearing',
        messages_edit_history:'editHistory',messages_save_public:'savePublic',messages_history_scope:'scope'
    };
    var next={};
    Object.keys(patch||{}).forEach(function(k){if(map[k])next[map[k]]=patch[k];});
    return _twdSave(patch).then(function(){
        window.__twdMessageHistoryConfig=Object.assign({},window.__twdMessageHistoryConfig||{},next);
        try{var api=window.__twdMessageHistoryApi;if(api&&typeof api.configure==='function')api.configure(next);}catch(_){}
        try{window.dispatchEvent(new CustomEvent('__twd_history_config',{detail:next}));}catch(_){}
    });
}
function _twdSetHideAds(enabled){
    return _twdSave({appearance_hide_ads:enabled}).then(function(){
        try{window.dispatchEvent(new CustomEvent('__twd_hide_ads_config',{detail:{enabled:enabled===true}}));}catch(_){}
    });
}

var _twdNativePanel=null;
var _twdNativePage='root';
var _twdNativeTransitioning=false;

function _twdWrapNativePage(panel){
    if(!panel||panel._twdPage)return panel&&panel._twdPage;
    var hdr=panel.querySelector(':scope > .left-header');
    var content=panel._content||panel.querySelector(':scope > .settings-content');
    if(!hdr||!content)return null;
    var page=document.createElement('div');
    page.className='_twd-native-page_';
    panel.insertBefore(page,hdr);
    page.append(hdr,content);
    panel.classList.add('_twd-menu-panel_');
    panel._twdPage=page;
    return page;
}
function _twdWireInnerBack(header,page){
    var back=header&&header.querySelector('button');
    if(!back)return;
    back.addEventListener('click',function(e){
        e.preventDefault();e.stopPropagation();
        if(_twdNativeTransitioning)return;
        if(page==='root')closeNativePanel();
        else _twdNavigateNative('root',true);
    });
}
function _twdCloneInnerPage(panel,page){
    var current=panel&&panel._twdPage;
    if(!current)return null;
    var oldHeader=current.querySelector('.left-header');
    var oldContent=panel._content||current.querySelector('.settings-content');
    if(!oldHeader||!oldContent)return null;
    var next=document.createElement('div');
    next.className='_twd-native-page_';
    next.style.visibility='hidden';
    var header=oldHeader.cloneNode(true);
    var title=header.querySelector('h3');
    if(title)title.textContent=_twdNativeTitle(page);
    _twdWireInnerBack(header,page);
    var content=oldContent.cloneNode(false);
    oldContent.id='_tgpc_old_';
    content.id='_tgpc_';
    content.innerHTML='';
    next.append(header,content);
    panel.appendChild(next);
    return {page:next,header:header,title:title,content:content};
}

function openTwdNative(initialPage){
    if(!document.getElementById('Settings')) return _withSettingsReady(function(){return openTwdNative(initialPage);});
    _twdNativePage=initialPage||'root';
    _twdNativeTransitioning=false;
    var panel=openNativePanel({
        title:'Telegram Web Desktop',
        handleBack:function(){
            if(_twdNativePage!=='root'){
                _twdNavigateNative('root',true);
                return true;
            }
            return false;
        },
        renderContent:function(content){
            _twdNativePanel=panel;
            _twdRenderNativePage(content,_twdNativePage);
        }
    });
    _twdNativePanel=panel;
    if(panel){
        _twdWrapNativePage(panel);
        if(panel._titleEl)panel._titleEl.textContent=_twdNativeTitle(_twdNativePage);
    }
    return panel;
}
function _twdNativeTitle(page){
    var map={
        root:'Telegram Web Desktop',
        general:T('twd_general'),
        appearance:T('twd_appearance'),
        messages:T('twd_messages'),
        notifications:T('twd_notifications'),
        proxy:T('proxy'),
        data:T('sec_data'),
        about:T('sec_about')
    };
    return map[page]||'Telegram Web Desktop';
}
async function _twdNavigateNative(page,backwards){
    if(!_twdNativePanel||!_twdNativePanel.isConnected||_twdNativeTransitioning)return;
    page=page||'root';
    if(page===_twdNativePage)return;
    var panel=_twdNativePanel;
    var oldPage=panel._twdPage||_twdWrapNativePage(panel);
    var next=_twdCloneInnerPage(panel,page);
    if(!oldPage||!next)return;
    _twdNativeTransitioning=true;
    _twdNativePage=page;
    panel._titleEl=next.title;
    panel._content=next.content;
    try{
        await _twdRenderNativePage(next.content,page);
    }catch(_){}
    if(!panel.isConnected||!next.page.isConnected){
        _twdNativeTransitioning=false;
        return;
    }
    var isBack=backwards===true;
    oldPage.classList.add(isBack?'_twd-page-back-from_':'_twd-page-forward-from_');
    next.page.classList.add(isBack?'_twd-page-back-to_':'_twd-page-forward-to_');
    void next.page.offsetWidth;
    next.page.style.visibility='';
    var done=false;
    function finish(e){
        if(e&&e.target!==next.page)return;
        if(done)return;done=true;
        oldPage.remove();
        next.page.classList.remove('_twd-page-forward-to_','_twd-page-back-to_');
        next.page.classList.add('_twd-native-page-active_');
        panel._twdPage=next.page;
        panel._titleEl=next.title;
        panel._content=next.content;
        _twdNativeTransitioning=false;
    }
    next.page.addEventListener('animationend',finish,{once:true});
    setTimeout(function(){finish();},380);
}
async function _twdRenderNativePage(content,page){
    if(!content)return;
    content.innerHTML='<div class="_tpempty_">'+T('loading')+'</div>';
    if(page==='proxy'){
        if(_twdNativePanel&&_twdNativePanel._titleEl)_twdNativePanel._titleEl.textContent=T('proxy');
        return renderProxyNative(content);
    }
    var s={};
    try{s=await INV('get_settings')||{};}catch(e){
        content.innerHTML='<div class="_tpempty_">'+T('load_error')+'</div>';
        return;
    }
    if(!content.isConnected)return;
    content.innerHTML='';
    var ctx=_twdNativeContext(content);
    if(!ctx){setTimeout(function(){if(content.isConnected)_twdRenderNativePage(content,page);},120);return;}
    if(page==='root')return _twdRenderRoot(content,ctx);
    if(page==='general')return _twdRenderGeneral(content,ctx,s);
    if(page==='appearance')return _twdRenderAppearance(content,ctx,s);
    if(page==='messages')return _twdRenderMessages(content,ctx,s);
    if(page==='notifications')return _twdRenderNotifications(content,ctx,s);
    if(page==='data')return _twdRenderData(content,ctx,s);
    if(page==='about')return _twdRenderAbout(content,ctx,s);
    return _twdRenderRoot(content,ctx);
}
function _twdRenderRoot(content,ctx){
    var card=ctx.card();
    [
        ['general','settings',T('twd_general'),T('twd_general_desc'),'blue'],
        ['appearance','visual_interface',T('twd_appearance'),T('twd_appearance_desc'),'purple'],
        ['messages','messages',T('twd_messages'),T('twd_messages_desc'),'green'],
        ['notifications','notifications',T('twd_notifications'),T('twd_notifications_desc'),'red'],
        ['proxy','proxy',T('proxy'),T('proxy_desc'),'blue'],
        ['data','data',T('sec_data'),T('twd_data_desc'),'orange'],
        ['about','info',T('sec_about'),T('twd_about_desc'),'purple']
    ].forEach(function(x){
        card.appendChild(_twdStaticRow(ctx,x[2],x[3],'',function(){_twdNavigateNative(x[0]);},x[1],x[4]));
    });
    ctx.section('Telegram Web Desktop',card);
}
function _twdRenderGeneral(content,ctx,s){
    var win=ctx.card();
    win.appendChild(_twdSwitchRow(ctx,T('st_tray'),T('st_tray_sub'),!!s.minimize_to_tray,function(v){_twdSave({minimize_to_tray:v});}));
    win.appendChild(_twdSwitchRow(ctx,T('st_devtools'),'Ctrl+Shift+I / F12',!!s.devtools_enabled,function(v){
        _twdSave({devtools_enabled:v}).then(function(){return INV('toggle_devtools',{open:v});}).catch(function(){});
    }));
    ctx.section(T('sec_window'),win);

    var integ=ctx.card();
    integ.appendChild(_twdStaticRow(ctx,T('st_tg_links'),T('st_tg_links_sub'),T('st_open_defaults'),function(){
        INV('open_default_apps').catch(function(){});
    },'link','blue'));
    ctx.section(T('sec_integration'),integ);
}
function _twdRenderAppearance(content,ctx,s){
    var card=ctx.card();
    var layout=s.appearance_message_layout||'left';
    var labels={native:T('twd_layout_native'),left:T('twd_layout_left'),wide:T('twd_layout_wide')};
    var row=_genNativeSettingRow(ctx.liEl,T('twd_layout'),T('twd_layout_desc'),labels[layout]||labels.left,function(v){
        pickModal({
            title:T('twd_layout'),
            current:layout,
            options:[
                {value:'native',label:labels.native},
                {value:'left',label:labels.left},
                {value:'wide',label:labels.wide}
            ],
            footerNote:T('twd_reload_notice'),
            onSave:function(next){
                if(next===layout)return;
                layout=next;
                v.textContent=labels[next]||labels.left;
                _twdSave({appearance_message_layout:next}).then(function(){return INV('apply_features');}).catch(function(){});
            }
        });
    });
    card.appendChild(row);
    card.appendChild(_twdSwitchRow(ctx,T('twd_hide_ads'),T('twd_hide_ads_desc'),s.appearance_hide_ads!==false,function(v){
        _twdSetHideAds(v);
    }));
    ctx.section(T('twd_appearance'),card);
}
function _twdRenderMessages(content,ctx,s){
    var privacy=ctx.card();
    privacy.appendChild(_twdSwitchRow(ctx,T('twd_no_read'),T('twd_no_read_desc'),s.privacy_no_read_receipts===true,function(v){
        _twdSave({privacy_no_read_receipts:v});
    }));
    privacy.appendChild(_twdSwitchRow(ctx,T('twd_no_typing'),T('twd_no_typing_desc'),s.privacy_no_typing===true,function(v){
        _twdSave({privacy_no_typing:v});
    }));
    ctx.section(T('twd_privacy'),privacy);

    var card=ctx.card();
    card.appendChild(_twdSwitchRow(ctx,T('twd_show_deleted'),T('twd_show_deleted_desc'),!!s.messages_show_deleted,function(v){
        _twdConfigureHistory({messages_show_deleted:v});
    }));
    card.appendChild(_twdSwitchRow(ctx,T('twd_show_disappearing'),T('twd_show_disappearing_desc'),!!s.messages_show_disappearing,function(v){
        _twdConfigureHistory({messages_show_disappearing:v});
    }));
    ctx.section(T('twd_messages'),card);

    var saved=ctx.card();
    saved.appendChild(_twdSwitchRow(ctx,T('twd_save_deleted'),T('twd_save_deleted_desc'),!!s.messages_save_deleted,function(v){
        _twdConfigureHistory({messages_save_deleted:v});
    }));
    saved.appendChild(_twdSwitchRow(ctx,T('twd_save_disappearing'),T('twd_save_disappearing_desc'),!!s.messages_save_disappearing,function(v){
        _twdConfigureHistory({messages_save_disappearing:v});
    }));
    saved.appendChild(_twdSwitchRow(ctx,T('twd_edit_history'),T('twd_edit_history_desc'),!!s.messages_edit_history,function(v){
        _twdConfigureHistory({messages_edit_history:v});
    }));
    saved.appendChild(_twdSwitchRow(ctx,T('twd_save_public'),T('twd_save_public_desc'),s.messages_save_public===true,function(v){
        _twdConfigureHistory({messages_save_public:v});
    }));
    var scopes={chat:T('twd_history_scope_chat'),client:T('twd_history_scope_client'),always:T('twd_history_scope_always')};
    var scope=s.messages_history_scope||'client';
    var scopeRow=_genNativeSettingRow(ctx.liEl,T('twd_history_scope'),'',scopes[scope]||scopes.client,function(v){
        pickModal({
            title:T('twd_history_scope'),current:scope,
            options:[{value:'chat',label:scopes.chat},{value:'client',label:scopes.client},{value:'always',label:scopes.always}],
            onSave:function(next){scope=next;v.textContent=scopes[next]||scopes.client;_twdConfigureHistory({messages_history_scope:next});}
        });
    });
    saved.appendChild(scopeRow);
    saved.appendChild(_twdPassiveText(T('twd_history_limits')));
    ctx.section(T('twd_message_storage'),saved);

    var data=ctx.card();
    var clear=_twdStaticRow(ctx,T('twd_clear_history'),T('twd_clear_history_desc'),'',function(){
        showModal({
            title:T('twd_clear_history'),
            msg:T('twd_clear_history_confirm'),
            okText:T('del_upper'),
            okDanger:true,
            footerNote:T('twd_reload_notice'),
            onOk:function(){toast(T('twd_history_cleared'),'icon-check');return _twdClearMessageHistory();}
        });
    },'trash_bin','red');
    clear.classList.add('destructive');
    data.appendChild(clear);
    ctx.section(T('twd_local_data'),data);
}
function _twdNotificationPreviewIcon(){
    try{
        var c=document.createElement('canvas');c.width=c.height=96;
        var x=c.getContext('2d');if(!x)return'';
        var g=x.createLinearGradient(0,0,96,96);g.addColorStop(0,'#6d5ce7');g.addColorStop(1,'#4aa3df');
        x.fillStyle=g;x.fillRect(0,0,96,96);
        x.fillStyle='rgba(255,255,255,.92)';x.beginPath();x.arc(48,34,16,0,Math.PI*2);x.fill();
        x.beginPath();x.arc(48,88,30,Math.PI,Math.PI*2);x.fill();
        return c.toDataURL('image/png');
    }catch(_){return'';}
}
async function _twdPreviewCurrentNotification(){
    try{
        await _twdSaveQueue.catch(function(){});
        var request=INV('preview_notification',{
            mode:'settings',icon:_twdNotificationPreviewIcon(),peerId:'',
            title:T('twd_notif_check_sender'),body:T('twd_notif_check_body')
        });
        try{window.dispatchEvent(new CustomEvent('__twd_preview_notification_sound'));}catch(_){}
        await request;
    }catch(e){toast(T('twd_notif_check_error'),'icon-close');}
}
function _twdRenderNotifications(content,ctx,s){
    var basic=ctx.card();
    basic.appendChild(_twdSwitchRow(ctx,T('ns_popup'),' ',s.popup_notifications!==false,function(v){_twdSave({popup_notifications:v});}));
    basic.appendChild(_twdSwitchRow(ctx,T('ns_sound'),' ',s.notif_sound!==false,function(v){_twdSave({notif_sound:v});}));
    var duration=Number(s.notif_duration)||6;
    basic.appendChild(_twdRangeRow(
        ctx,T('ns_duration'),' ',duration,2,30,1,
        function(v){return String(Math.round(v))+T('unit_sec');},
        function(v){_twdSave({notif_duration:Math.round(v)});}
    ));
    var rawVolume=Number(s.notif_volume);
    var volume=Math.round((Number.isFinite(rawVolume)?rawVolume:0.8)*100);
    basic.appendChild(_twdRangeRow(
        ctx,T('twd_notif_volume'),' ',volume,0,100,5,
        function(v){return String(Math.round(v))+'%';},
        function(v){_twdSave({notif_volume:Math.max(0,Math.min(100,v))/100});}
    ));
    basic.appendChild(_twdStaticRow(ctx,T('twd_notif_check'),T('twd_notif_check_desc'),'',function(){
        _twdPreviewCurrentNotification();
    },'notifications','blue'));
    ctx.section(T('ns_section'),basic);

    var cats=ctx.card();
    cats.appendChild(_twdSwitchRow(ctx,T('ns_sec_private'),' ',s.notif_cat_private!==false,function(v){_twdSave({notif_cat_private:v});}));
    cats.appendChild(_twdSwitchRow(ctx,T('ns_sec_group'),' ',s.notif_cat_group!==false,function(v){_twdSave({notif_cat_group:v});}));
    cats.appendChild(_twdSwitchRow(ctx,T('ns_sec_channel'),' ',s.notif_cat_channel!==false,function(v){_twdSave({notif_cat_channel:v});}));
    ctx.section(T('twd_categories'),cats);

    var privacy=ctx.card();
    privacy.appendChild(_twdSwitchRow(ctx,T('ns_hide_text'),' ',s.notif_hide_text===true,function(v){_twdSave({notif_hide_text:v});}));
    privacy.appendChild(_twdSwitchRow(ctx,T('ns_hide_sender'),' ',s.notif_hide_sender===true,function(v){_twdSave({notif_hide_sender:v});}));
    privacy.appendChild(_twdSwitchRow(ctx,T('ns_hide_avatar'),' ',s.notif_hide_avatar===true,function(v){_twdSave({notif_hide_avatar:v});}));
    ctx.section(T('twd_privacy'),privacy);
}
function _twdAppendUpdates(content,ctx,s){
    var card=ctx.card();
    var keys=['30m','1h','12h','24h','3d','7d','30d','never'];
    var lbl={'30m':'iv_30m','1h':'iv_1h','12h':'iv_12h','24h':'iv_24h','3d':'iv_3d','7d':'iv_7d','30d':'iv_30d','never':'iv_never'};
    var cur=s.update_check_interval||'24h';
    card.appendChild(_twdStaticRow(ctx,T('st_auto_check'),' ',T(lbl[cur]||'iv_24h'),function(v){
        pickModal({title:T('st_auto_check'),current:cur,options:keys.map(function(k){return{value:k,label:T(lbl[k])};}),onSave:function(x){cur=x;v.textContent=T(lbl[x]);_twdSave({update_check_interval:x});}});
    },'reload','green'));
    card.appendChild(_twdStaticRow(ctx,T('st_check_now'),' ','',async function(){
        toast(T('upd_checking'),'icon-reload');
        try{var r=await INV('check_update_manual');if(!r||r.upToDate)toast(T('st_uptodate'),'icon-check');else if(r.error)toast(T('error')+': '+r.error,'icon-close');}
        catch(e){toast(T('st_check_err'),'icon-close');}
    },'reload','green'));
    card.appendChild(_twdStaticRow(ctx,T('changelog'),T('twd_changelog_desc'),' ',function(){openChangelogNative('about');},'info','blue'));
    ctx.section(T('sec_updates'),card);
}
function _twdRenderData(content,ctx,s){
    var card=ctx.card();
    var clear=_twdStaticRow(ctx,T('st_clear_cache'),T('st_clear_cache_sub'),' ',function(){INV('clear_cache').catch(function(){});},'trash_bin','red');
    clear.classList.add('destructive');
    card.appendChild(clear);
    var hist=_twdStaticRow(ctx,T('twd_clear_history'),T('twd_clear_history_desc'),' ',function(){
        showModal({title:T('twd_clear_history'),msg:T('twd_clear_history_confirm'),okText:T('del_upper'),okDanger:true,footerNote:T('twd_reload_notice'),onOk:function(){toast(T('twd_history_cleared'),'icon-check');return _twdClearMessageHistory();}});
    },'trash_bin','red');
    hist.classList.add('destructive');
    card.appendChild(hist);
    ctx.section(T('sec_data'),card);
}
function _twdRenderAbout(content,ctx,s){
    var card=ctx.card();
    var ver=_twdStaticRow(ctx,T('st_version'),' ','—',null,'info','blue');
    card.appendChild(ver);
    var lab=_twdStaticRow(ctx,'UI Lab',T('twd_ui_lab_desc'),' ',null,'info','purple');
    _wireUiLabUnlock(lab);
    card.appendChild(lab);
    ctx.section('Telegram Web Desktop',card);
    INV('get_app_info').then(function(info){if(info&&info.version&&ver._value)ver._value.textContent=info.version;}).catch(function(){});
    _twdAppendUpdates(content,ctx,s);
}
