// Hidden service-only UI laboratory. It is unlocked from the About/Username row;
// no normal Telegram menu or settings entry is added.
function openUiLabNative(){
    return _withSettingsReady(()=>openNativePanel({
        title:T('ui_lab'),
        renderContent(content){ renderUiLabNative(content); },
    }));
}
function _uiLabRow(liEl,title,sub,value,onClick){
    const r=_genNativeSettingRow(liEl,title,sub||'',value||'',onClick||null);
    const b=r.querySelector('.ListItem-button');
    if(b)b.querySelectorAll('.Switcher,.Switch,.Toggle,.icon-next,.icon-arrow-right').forEach(x=>x.remove());
    if(!onClick){r.classList.add('is-static');if(b){b.removeAttribute('role');b.removeAttribute('tabindex');}}
    return r;
}
function _uiLabSwitchRow(liEl,title,sub,checked){
    const r=_uiLabRow(liEl,title,sub,'',null),b=r.querySelector('.ListItem-button');
    if(r._value)r._value.remove();
    const sw=_genSwitcher(checked,v=>toast((v?T('on_word'):T('off_word')),'icon-check'),title);
    if(b)b.appendChild(sw);
    return r;
}
function _uiLabButtonStrip(){
    const wrap=document.createElement('div');
    wrap.className='_twd-ui-lab-buttons_';
    const primary=_genButton(T('ui_lab_primary'),'check','primary');
    primary.addEventListener('click',()=>toast(T('ui_lab_demo'),'icon-check'));
    const danger=_genButton(T('ui_lab_danger'),'delete','danger');
    danger.addEventListener('click',()=>showModal({
        title:T('ui_lab_destructive'),msg:T('ui_lab_destructive_sub'),
        okText:T('ok'),cancelText:T('cancel'),onOk:()=>toast(T('ui_lab_demo'),'icon-check'),
    }));
    const folder=_genIconButton('folder',T('choose'),'small',false);
    folder.addEventListener('click',()=>toast(T('ui_lab_hover'),'icon-folder'));
    const del=_genIconButton('delete',T('dl_delete'),'tiny',true);
    del.addEventListener('click',()=>toast(T('ui_lab_hover'),'icon-delete'));
    wrap.append(primary,danger,folder,del);
    return wrap;
}
function _uiLabFeedbackRow(liEl,title,sub,run){
    return _uiLabRow(liEl,title,sub,'',run);
}
function _uiLabFallbackAvatar(){
    try{
        const c=document.createElement('canvas');c.width=c.height=96;
        const x=c.getContext('2d');x.fillStyle='#8774e1';x.fillRect(0,0,96,96);
        x.fillStyle='#fff';x.font='600 34px "Segoe UI",sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText('UI',48,49);
        return c.toDataURL('image/png');
    }catch(e){return '';}
}
async function _uiLabAvatarDataUrl(){
    const img=document.querySelector('#Settings .ProfileInfo .Avatar img, #Settings .Avatar[data-peer-id] img, #LeftColumn .Avatar img');
    const src=img&&img.src||'';
    if(/^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,/i.test(src))return src;
    if(src){
        try{
            const blob=await fetch(src).then(r=>r.blob());
            const data=await new Promise(resolve=>{const fr=new FileReader();fr.onload=()=>resolve(String(fr.result||''));fr.onerror=()=>resolve('');fr.readAsDataURL(blob);});
            if(data)return data;
        }catch(e){}
    }
    return _uiLabFallbackAvatar();
}
function _uiLabPeerId(){
    const av=document.querySelector('#Settings .ProfileInfo .Avatar[data-peer-id], #Settings .Avatar[data-peer-id]');
    return av?av.getAttribute('data-peer-id')||'':'';
}
async function _uiLabPreviewPopup(mode,body){
    const icon=await _uiLabAvatarDataUrl();
    return INV('preview_notification',{mode,icon,peerId:_uiLabPeerId(),title:'UI Lab',body:body||T('ui_lab_popup_text')});
}
async function renderUiLabNative(content){
    if(!content)return;
    captureWidgetTpl();
    const cardCls=_genCardCls(),headerTpl=_genHeaderTpl();
    const liEl=document.querySelector('#Settings .ListItem.narrow')||document.querySelector('#Settings .ListItem');
    if(!cardCls||!liEl){content.textContent=T('loading');setTimeout(()=>{if(content.isConnected)renderUiLabNative(content);},120);return;}
    content.replaceChildren();
    const card=()=>_genCard(cardCls);
    const section=(title,cd)=>_appendNativeSection(content,headerTpl,title,cd);

    const rows=card();
    rows.append(
        _uiLabRow(liEl,T('ui_lab_plain'),T('ui_lab_plain_sub'),'1.3.0',null),
        _uiLabRow(liEl,T('ui_lab_action'),T('ui_lab_action_sub'),T('ok'),()=>toast(T('ui_lab_demo'),'icon-check')),
        _genDecoratedRow('info',T('ui_lab_decorated'),T('ok'),()=>toast(T('ui_lab_demo'),'icon-info-filled'),'blue',T('ui_lab_plain_sub'))
    );
    section(T('ui_lab_rows'),rows);

    const controls=card();
    controls.append(
        _genToggle(T('ui_lab_checkbox'),true,v=>toast(v?T('on_word'):T('off_word'),'icon-check'),T('ui_lab_plain_sub')),
        _uiLabSwitchRow(liEl,T('ui_lab_switch'),T('ui_lab_plain_sub'),true),
        _genRadioGroup('_twd_ui_lab_radio_',
            [{value:'a',label:'A'},{value:'b',label:'B'},{value:'c',label:'C'}],
            'b',v=>toast('Radio: '+v,'icon-check'))
    );
    const inp=_genInput(T('ui_lab_input'),'Telegram Web Desktop',false,v=>toast(v||T('ui_lab_demo'),'icon-check'));
    const ta=_genTextarea(T('ui_lab_textarea'),'Native Telegram UI\nReusable builders',v=>toast(v?T('st_saved_short'):T('ui_lab_demo'),'icon-check'));
    controls.append(inp.node,ta.node);
    controls.appendChild(_uiLabRow(liEl,T('ui_lab_picker'),T('ui_lab_picker_sub'),'B',valueEl=>{
        pickModal({title:T('ui_lab_picker'),current:valueEl.textContent||'B',
            options:['A','B','C'].map(v=>({value:v,label:v})),
            onSave:v=>{valueEl.textContent=v;toast(T('st_saved_short'),'icon-check');}});
    }));
    section(T('ui_lab_controls'),controls);

    const buttons=card();
    buttons.appendChild(_uiLabButtonStrip());
    section(T('ui_lab_buttons'),buttons);

    const notif=card();
    const proto=window.ServiceWorker&&window.ServiceWorker.prototype;
    const hookOk=!!proto&&proto.postMessage===proto.__twdNotifPostMessageHook;
    const shimOk=window.Notification&&window.Notification.name==='NotificationShim'&&window.Notification.permission==='granted';
    notif.append(
        _uiLabRow(liEl,T('ui_lab_notif_interceptor'),' ',window.__tgNotifIntercept?T('ui_lab_ok'):T('ui_lab_bad'),null),
        _uiLabRow(liEl,T('ui_lab_notif_sw'),' ',hookOk?T('ui_lab_ok'):T('ui_lab_bad'),null),
        _uiLabRow(liEl,T('ui_lab_notif_shim'),' ',shimOk?T('ui_lab_ok'):T('ui_lab_bad'),null),
        _uiLabRow(liEl,T('ui_lab_notif_health'),' ',window.__twdNotifHealthTimer?T('ui_lab_running'):T('ui_lab_stopped'),null),
        _uiLabRow(liEl,T('ui_lab_notif_repair'),' ',typeof window.__twdNotifRepair==='function'?T('ui_lab_ready'):T('ui_lab_bad'),null),
        _uiLabFeedbackRow(liEl,T('ui_lab_notif_repair_now'),T('ui_lab_notif_repair_sub'),()=>{
            try{if(typeof window.__twdNotifRepair==='function')window.__twdNotifRepair();}catch(e){}
            setTimeout(()=>{if(content.isConnected)renderUiLabNative(content);},150);
        }),
        _uiLabFeedbackRow(liEl,T('ui_lab_notif_capture'),T('ui_lab_notif_capture_sub'),()=>{
            const p=window.ServiceWorker&&window.ServiceWorker.prototype;
            if(!p)return toast(T('ui_lab_bad'),'icon-close');
            const old=window.__tgOnNotif,got=[];window.__tgOnNotif=x=>got.push(x);
            try{p.postMessage.call({}, {type:'showMessageNotification',payload:{title:'UI Lab',body:T('ui_lab_demo'),messageId:'ui-lab-'+Date.now(),isSilent:true}});}
            finally{window.__tgOnNotif=old;}
            toast(got.length?T('ui_lab_capture_ok'):T('ui_lab_capture_bad'),got.length?'icon-check':'icon-close');
        })
    );
    section(T('ui_lab_notifications'),notif);

    const popupStates=card();
    popupStates.append(
        _uiLabFeedbackRow(liEl,T('ui_lab_popup_avatar_text'),T('ui_lab_popup_avatar_text_sub'),()=>_uiLabPreviewPopup('normal').catch(()=>{})),
        _uiLabFeedbackRow(liEl,T('ui_lab_popup_avatar_hidden'),T('ui_lab_popup_avatar_hidden_sub'),()=>_uiLabPreviewPopup('hidden-text').catch(()=>{})),
        _uiLabFeedbackRow(liEl,T('ui_lab_popup_hidden_sender'),T('ui_lab_popup_hidden_sender_sub'),()=>_uiLabPreviewPopup('hidden-sender').catch(()=>{})),
        _uiLabFeedbackRow(liEl,T('ui_lab_popup_hidden_all'),T('ui_lab_popup_hidden_all_sub'),()=>_uiLabPreviewPopup('hidden-all').catch(()=>{})),
        _uiLabFeedbackRow(liEl,T('ui_lab_popup_no_avatar'),T('ui_lab_popup_no_avatar_sub'),()=>_uiLabPreviewPopup('no-avatar').catch(()=>{})),
        _uiLabFeedbackRow(liEl,T('ui_lab_popup_long'),T('ui_lab_popup_long_sub'),()=>_uiLabPreviewPopup('long-text',T('ui_lab_popup_long_text')).catch(()=>{})),
        _uiLabFeedbackRow(liEl,T('ui_lab_popup_stack'),T('ui_lab_popup_stack_sub'),async()=>{
            try{
                const icon=await _uiLabAvatarDataUrl(),peerId=_uiLabPeerId();
                await INV('preview_notification',{mode:'normal',icon,peerId,title:'UI Lab 1',body:T('ui_lab_popup_text')});
                await INV('preview_notification',{mode:'hidden-text',icon,peerId,title:'UI Lab 2'});
                await INV('preview_notification',{mode:'no-avatar',icon,peerId,title:'UI Lab 3',body:T('ui_lab_popup_text')});
            }catch(e){}
        })
    );
    section(T('ui_lab_popup_states'),popupStates);

    const feedback=card();
    feedback.append(
        _uiLabFeedbackRow(liEl,T('ui_lab_toast'),T('ui_lab_feedback_sub'),()=>toast(T('ui_lab_demo'),'icon-check')),
        _uiLabFeedbackRow(liEl,T('ui_lab_corner'),T('ui_lab_feedback_sub'),()=>showCornerNotif({title:'UI Lab',body:T('ui_lab_demo')})),
        _uiLabFeedbackRow(liEl,T('ui_lab_popup'),T('ui_lab_feedback_sub'),()=>_uiLabPreviewPopup('normal').catch(()=>{})),
        _uiLabFeedbackRow(liEl,T('ui_lab_modal'),T('ui_lab_feedback_sub'),()=>showModal({
            title:T('ui_lab_modal'),msg:T('ui_lab_demo'),okText:T('ok'),cancelText:T('cancel')
        }))
    );
    const loading=_uiLabFeedbackRow(liEl,T('ui_lab_loading'),T('ui_lab_loading_sub'),()=>{
        loading._value.textContent=T('loading');
        setTimeout(()=>{if(loading.isConnected)loading._value.textContent=T('ui_lab_ready');},900);
    });
    feedback.appendChild(loading);
    const destructive=_uiLabFeedbackRow(liEl,T('ui_lab_destructive'),T('ui_lab_destructive_sub'),()=>showModal({
        title:T('ui_lab_destructive'),msg:T('ui_lab_destructive_sub'),
        okText:T('del_upper'),okDanger:true,onOk:()=>toast(T('ui_lab_demo'),'icon-check')
    }));
    const destructiveButton=destructive.querySelector('.ListItem-button');
    if(destructiveButton)destructiveButton.style.color='var(--color-error,#e53935)';
    feedback.appendChild(destructive);
    section(T('ui_lab_feedback'),feedback);

    const downloads=card(),MiB=1024*1024;
    [
        {filename:'waiting.zip',status:'pending',recv:0,total:20*MiB},
        {filename:'video.mp4',status:'downloading',recv:34*MiB,total:100*MiB},
        {filename:'document.pdf',status:'completed',total:4*MiB},
        {filename:'broken.rar',status:'failed',total:2*MiB},
        {filename:'cancelled.mp3',status:'cancelled',total:8*MiB},
    ].forEach(d=>downloads.appendChild(_nativeDlRow(d,()=>{},liEl)));
    section(T('ui_lab_downloads'),downloads);

    const proxy=card();
    try{
        const st=await INV('get_proxy_status');
        proxy.append(
            _uiLabRow(liEl,T('proxy_status'),'',
                st&&st.active?T('proxy_active'):T('proxy_direct'),null),
            _uiLabRow(liEl,T('proxy_route'),'',
                (st&&st.route)||'direct',null),
            _uiLabRow(liEl,T('proxy_domains'),'',
                (st&&st.domain)||'—',null),
            _uiLabRow(liEl,'Web A','',
                st&&st.webFallback?(st.webFallbackLatched?'fallback active':'fallback enabled'):'off',null)
        );
    }catch(e){
        proxy.appendChild(_uiLabRow(liEl,T('proxy_status'),T('load_error'),'—',null));
    }
    proxy.appendChild(_uiLabRow(liEl,T('proxy_refresh'),T('proxy_refresh_desc'),'',()=>renderUiLabNative(content)));
    section(T('ui_lab_proxy'),proxy);
}
window.__twdUiLab={
    open:openUiLabNative,
    close:()=>closeNativePanel(),
    render:()=>{const c=document.getElementById('_tgpc_');if(c)renderUiLabNative(c);},
};