function ensureCornerWrap(){
    if(document.getElementById('_cnw_')||!document.body)return;
    const w=document.createElement('div');w.id='_cnw_';w.className='_cnotif_wrap_';
    document.body.appendChild(w);
}
function showCornerNotif(data){
    ensureCornerWrap();
    const w=document.getElementById('_cnw_');if(!w)return;
    const titleText=(data&&data.title?String(data.title).trim():'')||'Telegram';
    const bodyText=(data&&data.body?String(data.body).trim():'')||'вам новое сообщение в Телеграм!';
    const el=document.createElement('div');el.className='_cnotif_';
    const av=document.createElement('div');av.className='_cnotif_av_';
    if(data&&data.icon){const _img=document.createElement('img');_img.src=data.icon;_img.onerror=function(){this.style.display='none';};av.appendChild(_img);}
    else{av.textContent=(titleText||'?')[0].toUpperCase();}
    const body=document.createElement('div');body.className='_cnotif_body_';
    const title=document.createElement('div');title.className='_cnotif_title_';title.textContent=titleText;
    const text=document.createElement('div');text.className='_cnotif_text_';text.textContent=bodyText;
    const prog=document.createElement('div');prog.className='_cnotif_prog_';prog.innerHTML='<span></span>';
    body.appendChild(title);body.appendChild(text);body.appendChild(prog);
    const cls=document.createElement('button');cls.className='_cnotif_close_';cls.textContent='✕';
    el.appendChild(av);el.appendChild(body);el.appendChild(cls);
    w.appendChild(el);
    function dismiss(){el.classList.add('out');setTimeout(()=>el.remove(),220);}
    cls.addEventListener('click',dismiss);
    const t=setTimeout(dismiss,5000);
    cls.addEventListener('click',()=>clearTimeout(t));
}
if(window.tgBridge){
    window.tgBridge.onNotification(function(data){showCornerNotif(data);});
}

// ── Обновления ────────────────────────────────────────────────────────────
async function showUpdateModal(data){
    const verLine='Доступна версия <b>v'+data.version+'</b>'+(data.current?' (сейчас: v'+data.current+')':'');
    const clBox='<div id="_upd_cl_" style="margin-top:12px;background:#1a1a1a;border-radius:12px;padding:12px 14px;font-size:14px;color:#ccc;line-height:1.6;white-space:pre-wrap;max-height:220px;overflow-y:auto;">Загрузка...</div>';
    const fname=data.filename||('Telegram Web Desktop Setup '+data.version+'.exe');
    showModal({
        title:'Доступно обновление',
        msg:verLine+'<br>'+clBox,
        okText:'СКАЧАТЬ',
        cancelText:'ПОЗЖЕ',
        extraBtn:{label:'ПРОПУСТИТЬ',danger:false},
        onOk:async()=>{showUpdateProgress(data.url,fname,data.version);},
        onExtra:async()=>{await INV('skip_version',{version:data.version});},
    });
    // notes из релиза приходят в событии — показываем сразу; иначе дёргаем fetch_changelog.
    if(data.notes&&data.notes.trim()){
        const el=document.getElementById('_upd_cl_');if(el)el.textContent=data.notes.trim();
    }else{
        try{
            const r=await INV('fetch_changelog');
            const el=document.getElementById('_upd_cl_');
            if(el)el.textContent=r.error?('Ошибка: '+r.error):(r.text||'Список изменений пуст.');
        }catch(e){const el=document.getElementById('_upd_cl_');if(el)el.textContent='Ошибка загрузки.';}
    }
}
function showUpdateProgress(url,filename,version){
    ensureCornerWrap();
    const w=document.getElementById('_cnw_');if(!w)return;
    const el=document.createElement('div');el.className='_cnotif_';el.style.minWidth='280px';
    const av=document.createElement('div');av.className='_cnotif_av_';av.innerHTML='<i class="icon icon-download" style="font-size:18px;color:#5288c1"></i>';
    const body=document.createElement('div');body.className='_cnotif_body_';
    const title=document.createElement('div');title.className='_cnotif_title_';title.textContent='Скачивание v'+version;
    const text=document.createElement('div');text.className='_cnotif_text_';text.textContent='Подготовка...';
    const bar=document.createElement('div');bar.className='_upd_bar_';
    const barInner=document.createElement('div');barInner.className='_upd_prog_';barInner.innerHTML='<span></span>';
    bar.appendChild(barInner);
    body.appendChild(title);body.appendChild(text);body.appendChild(bar);
    el.appendChild(av);el.appendChild(body);w.appendChild(el);
    function fmtBytes(b){if(b<1048576)return (b/1024).toFixed(0)+'KB';return (b/1048576).toFixed(1)+'MB';}
    el._setProgress=function(r,t){text.textContent=fmtBytes(r)+(t?' / '+fmtBytes(t):'');const sp=barInner.querySelector('span');if(sp&&t)sp.style.width=Math.round(r/t*100)+'%';};
    el._setDone=function(err){if(err){title.textContent='Ошибка';text.textContent=err;av.innerHTML='<i class="icon icon-close" style="color:#e53935"></i>';}else{title.textContent='Скачано';text.textContent='Запуск установщика...';av.innerHTML='<i class="icon icon-check" style="color:#4caf50"></i>';}setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),220);},3000);};
    window._updEl=el;
    INV('download_update',{url,filename}).catch(()=>{});
}
function setupUpdateListeners(){
    if(!window.tgBridge)return;
    if(window.tgBridge.onUpdateAvailable)window.tgBridge.onUpdateAvailable(function(data){showUpdateModal(data);});
    if(window.tgBridge.onUpdateProgress)window.tgBridge.onUpdateProgress(function(data){if(window._updEl&&window._updEl._setProgress)window._updEl._setProgress(data.received,data.total);});
    if(window.tgBridge.onUpdateDone)window.tgBridge.onUpdateDone(function(data){if(window._updEl&&window._updEl._setDone)window._updEl._setDone(data.error||null);});
}
setupUpdateListeners();

// «Список изменений» теперь рисуется нативной панелью (renderChangelogNative
// в native-panels.js). Старый renderCl удалён.
