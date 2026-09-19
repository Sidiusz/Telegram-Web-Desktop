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
function _twdSwitchRow(ctx,title,sub,checked,onChange){
    var r=_genNativeSettingRow(ctx.liEl,title,sub||'','',null);
    if(r._value)r._value.remove();
    var b=r.querySelector('.ListItem-button');
    if(b){
        b.querySelectorAll('.Switcher,.Switch,.Toggle,.icon-next,.icon-arrow-right').forEach(function(x){x.remove();});
        b.appendChild(_genSwitcher(!!checked,onChange,title));
    }
    return r;
}
function _twdSave(patch){
    return INV('get_settings').then(function(s){
        return INV('save_settings',{settings:Object.assign({},s||{},patch)});
    });
}
function _twdFeatureApplyBar(content){
    var bar=document.createElement('div');
    bar.className='_twd-apply-bar_';
    var btn=_genButton(T('twd_apply'),'reload','primary');
    btn.addEventListener('click',async function(){
        if(btn.disabled)return;
        btn.disabled=true;
        try{await INV('apply_features');}
        finally{btn.disabled=false;}
    });
    bar.appendChild(btn);
    content.appendChild(bar);
    return bar;
}

var _twdNativePanel=null;
var _twdNativePage='root';

function openTwdNative(initialPage){
    if(!document.getElementById('Settings')) return _withSettingsReady(function(){return openTwdNative(initialPage);});
    _twdNativePage=initialPage||'root';
    var panel=openNativePanel({
        title:'Telegram Web Desktop',
        handleBack:function(){
            if(_twdNativePage!=='root'){
                _twdNavigateNative('root');
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
    if(panel&&panel._titleEl)panel._titleEl.textContent=_twdNativeTitle(_twdNativePage);
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
        updates:T('sec_updates'),
        data:T('sec_data'),
        about:T('sec_about')
    };
    return map[page]||'Telegram Web Desktop';
}
function _twdNavigateNative(page){
    if(!_twdNativePanel||!_twdNativePanel.isConnected)return;
    _twdNativePage=page||'root';
    if(_twdNativePanel._titleEl)_twdNativePanel._titleEl.textContent=_twdNativeTitle(_twdNativePage);
    var content=_twdNativePanel._content||document.getElementById('_tgpc_');
    if(content)_twdRenderNativePage(content,_twdNativePage);
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
    if(page==='updates')return _twdRenderUpdates(content,ctx,s);
    if(page==='data')return _twdRenderData(content,ctx,s);
    if(page==='about')return _twdRenderAbout(content,ctx,s);
    return _twdRenderRoot(content,ctx);
}
function _twdRenderRoot(content,ctx){
    var card=ctx.card();
    [
        ['general','settings',T('twd_general'),T('twd_general_desc'),'blue'],
        ['appearance','animations',T('twd_appearance'),T('twd_appearance_desc'),'purple'],
        ['messages','chat',T('twd_messages'),T('twd_messages_desc'),'green'],
        ['notifications','notifications',T('twd_notifications'),T('twd_notifications_desc'),'red'],
        ['proxy','lock',T('proxy'),T('proxy_desc'),'blue'],
        ['updates','reload',T('sec_updates'),T('twd_updates_desc'),'green'],
        ['data','piechart',T('sec_data'),T('twd_data_desc'),'orange'],
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
    var row=_twdStaticRow(ctx,T('twd_layout'),T('twd_layout_desc'),labels[layout]||labels.left,function(v){
        pickModal({
            title:T('twd_layout'),
            current:layout,
            options:[
                {value:'native',label:labels.native},
                {value:'left',label:labels.left},
                {value:'wide',label:labels.wide}
            ],
            onSave:function(next){
                layout=next;
                v.textContent=labels[next]||labels.left;
                _twdSave({appearance_message_layout:next});
            }
        });
    },'animations','purple');
    card.appendChild(row);
    card.appendChild(_twdSwitchRow(ctx,T('twd_hide_ads'),T('twd_hide_ads_desc'),s.appearance_hide_ads!==false,function(v){
        _twdSave({appearance_hide_ads:v});
    }));
    ctx.section(T('twd_appearance'),card);
    _twdFeatureApplyBar(content);
}
function _twdRenderMessages(content,ctx,s){
    var card=ctx.card();
    card.appendChild(_twdSwitchRow(ctx,T('twd_show_deleted'),T('twd_show_deleted_desc'),!!s.messages_show_deleted,function(v){
        _twdSave({messages_show_deleted:v});
    }));
    card.appendChild(_twdSwitchRow(ctx,T('twd_edit_history'),T('twd_edit_history_desc'),!!s.messages_edit_history,function(v){
        _twdSave({messages_edit_history:v});
    }));
    ctx.section(T('twd_messages'),card);

    var data=ctx.card();
    var clear=_twdStaticRow(ctx,T('twd_clear_history'),T('twd_clear_history_desc'),'',function(){
        showModal({
            title:T('twd_clear_history'),
            msg:T('twd_clear_history_confirm'),
            okText:T('del_upper'),
            okDanger:true,
            onOk:function(){return INV('history_clear').then(function(){toast(T('twd_history_cleared'),'icon-check');});}
        });
    },'delete','red');
    clear.classList.add('destructive');
    data.appendChild(clear);
    ctx.section(T('twd_local_data'),data);
    _twdFeatureApplyBar(content);
}
function _twdRenderNotifications(content,ctx,s){
    var basic=ctx.card();
    basic.appendChild(_twdSwitchRow(ctx,T('ns_popup'),' ',s.popup_notifications!==false,function(v){_twdSave({popup_notifications:v});}));
    basic.appendChild(_twdSwitchRow(ctx,T('ns_sound'),' ',s.notif_sound!==false,function(v){_twdSave({notif_sound:v});}));
    var duration=Number(s.notif_duration)||6;
    var drow=_twdStaticRow(ctx,T('ns_duration'),' ',String(duration)+T('unit_sec'),function(v){
        var vals=[3,5,6,8,10,15,20];
        pickModal({
            title:T('ns_duration'),current:String(duration),
            options:vals.map(function(n){return{value:String(n),label:String(n)+T('unit_sec')};}),
            onSave:function(x){duration=Number(x)||6;v.textContent=String(duration)+T('unit_sec');_twdSave({notif_duration:duration});}
        });
    },'notifications','red');
    basic.appendChild(drow);
    var volume=Math.round((Number(s.notif_volume)||0.8)*100);
    var vrow=_twdStaticRow(ctx,T('twd_notif_volume'),' ',volume+'%',function(v){
        var vals=[0,25,50,75,100];
        pickModal({
            title:T('twd_notif_volume'),current:String(volume),
            options:vals.map(function(n){return{value:String(n),label:n+'%'};}),
            onSave:function(x){volume=Number(x)||0;v.textContent=volume+'%';_twdSave({notif_volume:volume/100});}
        });
    },'notifications','red');
    basic.appendChild(vrow);
    ctx.section(T('ns_section'),basic);

    var cats=ctx.card();
    cats.appendChild(_twdSwitchRow(ctx,T('ns_sec_private'),' ',s.notif_cat_private!==false,function(v){_twdSave({notif_cat_private:v});}));
    cats.appendChild(_twdSwitchRow(ctx,T('ns_sec_group'),' ',s.notif_cat_group!==false,function(v){_twdSave({notif_cat_group:v});}));
    cats.appendChild(_twdSwitchRow(ctx,T('ns_sec_channel'),' ',s.notif_cat_channel!==false,function(v){_twdSave({notif_cat_channel:v});}));
    ctx.section(T('twd_categories'),cats);

    var privacy=ctx.card();
    privacy.appendChild(_twdSwitchRow(ctx,T('ns_hide_text'),' ',s.notif_hide_text===true,function(v){_twdSave({notif_hide_text:v});}));
    privacy.appendChild(_twdSwitchRow(ctx,T('ns_hide_sender'),' ',s.notif_hide_sender===true,function(v){_twdSave({notif_hide_sender:v});}));
    ctx.section(T('twd_privacy'),privacy);
}
function _twdRenderUpdates(content,ctx,s){
    var card=ctx.card();
    var keys=['30m','1h','12h','24h','3d','7d','30d','never'];
    var lbl={'30m':'iv_30m','1h':'iv_1h','12h':'iv_12h','24h':'iv_24h','3d':'iv_3d','7d':'iv_7d','30d':'iv_30d','never':'iv_never'};
    var cur=s.update_check_interval||'1h';
    card.appendChild(_twdStaticRow(ctx,T('st_auto_check'),' ',T(lbl[cur]||'iv_1h'),function(v){
        pickModal({title:T('st_auto_check'),current:cur,options:keys.map(function(k){return{value:k,label:T(lbl[k])};}),onSave:function(x){cur=x;v.textContent=T(lbl[x]);_twdSave({update_check_interval:x});}});
    },'reload','green'));
    card.appendChild(_twdStaticRow(ctx,T('st_check_now'),' ','',async function(){
        toast(T('upd_checking'),'icon-reload');
        try{var r=await INV('check_update_manual');if(!r||r.upToDate)toast(T('st_uptodate'),'icon-check');else if(r.error)toast(T('error')+': '+r.error,'icon-close');}
        catch(e){toast(T('st_check_err'),'icon-close');}
    },'reload','green'));
    ctx.section(T('sec_updates'),card);

    var cl=ctx.card();
    cl.appendChild(_twdStaticRow(ctx,T('changelog'),T('twd_changelog_desc'),' ',function(){openChangelogNative();},'info','blue'));
    ctx.section(T('changelog'),cl);
}
function _twdRenderData(content,ctx,s){
    var card=ctx.card();
    var clear=_twdStaticRow(ctx,T('st_clear_cache'),T('st_clear_cache_sub'),' ',function(){INV('clear_cache').catch(function(){});},'delete','red');
    clear.classList.add('destructive');
    card.appendChild(clear);
    var hist=_twdStaticRow(ctx,T('twd_clear_history'),T('twd_clear_history_desc'),' ',function(){
        showModal({title:T('twd_clear_history'),msg:T('twd_clear_history_confirm'),okText:T('del_upper'),okDanger:true,onOk:function(){return INV('history_clear').then(function(){toast(T('twd_history_cleared'),'icon-check');});}});
    },'delete','red');
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
}
