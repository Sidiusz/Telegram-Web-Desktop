function showModal({title,msg,url,checkLabel,okText,okDanger,cancelText,onOk,onCancel,extraBtn,onExtra}){
    const mo=document.createElement('div');mo.className='_mo_';
    let cbHtml=checkLabel?'<label class="_cbx_" id="_mo_cb_l_"><input type="checkbox" id="_mo_cb_"><span class="box"></span><span class="label" style="color:#ccc;font-size:13px;">'+checkLabel+'</span></label>':'';
    let urlHtml=url?'<div class="_url_">'+url+'</div>':'';
    const hasCancelBtn = cancelText !== null;
    const cancelHtml = hasCancelBtn ? '<button class="Button" id="_mo_cn_">'+(cancelText||T('cancel'))+'</button>' : '';
    const extraHtml = extraBtn ? '<button class="Button'+(extraBtn.danger?' danger':'')+'" id="_mo_ex_">'+extraBtn.label+'</button>' : '';
    mo.innerHTML='<div class="modal-dialog"><div class="modal-header"><div class="modal-title">'+title+'</div></div><div class="modal-content"><div class="_msg_">'+msg+'</div>'+urlHtml+cbHtml+'<div class="dialog-buttons">'+cancelHtml+extraHtml+'<button class="Button'+(okDanger?' danger':'')+'" id="_mo_ok_">'+(okText||T('ok'))+'</button></div></div></div>';
    document.body.appendChild(mo);
    const close=()=>mo.remove();
    const btnOk=mo.querySelector('#_mo_ok_');
    const btnCancel=mo.querySelector('#_mo_cn_');
    const btnExtra=mo.querySelector('#_mo_ex_');
    if(btnOk)btnOk.addEventListener('click',()=>{const cb=mo.querySelector('#_mo_cb_');const checked=checkLabel&&cb&&cb.checked;close();if(onOk)onOk(checked);});
    if(btnCancel)btnCancel.addEventListener('click',()=>{close();if(onCancel)onCancel();});
    if(btnExtra)btnExtra.addEventListener('click',()=>{close();if(onExtra)onExtra();});
    mo.addEventListener('click',e=>{if(e.target===mo){close();if(onCancel)onCancel();}});
}

// Нативный «выпадающий список» как попап (как «Автоудаление аккаунта»): радио-
// список вариантов + ОТМЕНА/СОХРАНИТЬ. Использует те же классы, что и TG
// (.modal-dialog/.Radio), поэтому выглядит 1-в-1 родным.
function pickModal(opts){
    var title=opts.title||'', options=opts.options||[], current=opts.current, onSave=opts.onSave;
    var sel=current;
    var mo=document.createElement('div'); mo.className='_mo_';
    var radios=options.map(function(o){
        return '<label class="Radio'+(o.value===current?' checked':'')+'"><input type="radio" name="_tgpick_" value="'+o.value+'"'+(o.value===current?' checked':'')+'><div class="Radio-main"><span class="label">'+o.label+'</span></div></label>';
    }).join('');
    mo.innerHTML='<div class="modal-dialog"><div class="modal-header"><div class="modal-title">'+title+'</div></div>'
        +'<div class="modal-content"><div class="radio-group _tgpick_grp_">'+radios+'</div>'
        +'<div class="dialog-buttons"><button class="Button danger" id="_pk_cn_">'+T('cancel')+'</button>'
        +'<button class="Button" id="_pk_ok_">'+T('save_upper')+'</button></div></div></div>';
    document.body.appendChild(mo);
    var labels=mo.querySelectorAll('label.Radio');
    mo.querySelectorAll('input[name=_tgpick_]').forEach(function(inp){
        inp.addEventListener('change',function(){ if(inp.checked){ sel=inp.value; labels.forEach(function(l){ l.classList.toggle('checked', l.contains(inp)); }); } });
    });
    var close=function(){ mo.remove(); };
    mo.querySelector('#_pk_cn_').addEventListener('click',close);
    mo.querySelector('#_pk_ok_').addEventListener('click',function(){ close(); if(onSave)onSave(sel); });
    mo.addEventListener('click',function(e){ if(e.target===mo)close(); });
}

window._tgLink=async function(url){
    try{await INV('open_url',{url});}catch(e){}
};

function makePanel(id,title){
    if(document.getElementById(id)||!document.body)return;
    const p=document.createElement('div');p.id=id;p.className='_p_';
    const h=document.createElement('div');h.className='_ph_';
    h.innerHTML='<span>'+title+'</span><button class="_cls_" id="'+id+'x">✕</button>';
    const c=document.createElement('div');c.className='_pc_';c.id=id+'c';
    p.appendChild(h);p.appendChild(c);document.body.appendChild(p);
    document.getElementById(id+'x').addEventListener('click',()=>{p.classList.remove('open');});
}

function openPanel(id,renderFn){
    const p=document.getElementById(id);if(!p)return;
    document.querySelectorAll('._p_.open').forEach(x=>{if(x!==p)x.classList.remove('open');});
    p.classList.add('open');renderFn();
}

// ── Фейк-панель «как родной раздел настроек» (#5) ───────────────────────────
// Ложится поверх колонки #Settings (position:absolute;inset:0), шапку клонируем
// из живого нативного раздела (хэш-классы + вид 1-в-1). Своя кнопка «Назад»
// закрывает панель. React-state НЕ трогаем → работает железно, в отличие от
// попытки встроить чужой слайд в Transition (React игнорирует чужие классы).
//   opts: { title, onBack, renderHeader(headerEl), renderContent(contentEl) }
let _nativePanel=null;