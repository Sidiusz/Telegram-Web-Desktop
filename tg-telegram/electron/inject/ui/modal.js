function _escHtml(value){
    return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});
}
function showModal({title,msg,msgHtml,url,checkLabel,okText,okDanger,cancelText,onOk,onCancel,extraBtn,onExtra,footerNote}){
    const mo=document.createElement('div');mo.className='_mo_';
    const safeMsg=msgHtml!=null?String(msgHtml):_escHtml(msg);
    let cbHtml=checkLabel?'<label class="Checkbox dialog-checkbox" id="_mo_cb_l_"><input type="checkbox" id="_mo_cb_"><div class="Checkbox-main"><span class="label">'+_escHtml(checkLabel)+'</span></div></label>':'';
    let urlHtml=url?'<div class="_url_">'+_escHtml(url)+'</div>':'';
    const hasCancelBtn=cancelText!==null;
    const cls=danger=>'Button text '+(danger?'danger':'primary')+' confirm-dialog-button';
    const okHtml='<button class="'+cls(!!okDanger)+'" id="_mo_ok_">'+_escHtml(okText||T('ok'))+'</button>';
    const extraHtml=extraBtn?'<button class="'+cls(!!extraBtn.danger)+'" id="_mo_ex_">'+_escHtml(extraBtn.label)+'</button>':'';
    const cancelHtml=hasCancelBtn?'<button class="'+cls(false)+'" id="_mo_cn_">'+_escHtml(cancelText||T('cancel'))+'</button>':'';
    const noteHtml=footerNote?'<div class="dialog-footer-note">'+_escHtml(footerNote)+'</div>':'';
    mo.innerHTML='<div class="modal-dialog"><div class="modal-header"><div class="modal-title">'+_escHtml(title)+'</div></div><div class="modal-content"><div class="_msg_">'+safeMsg+'</div>'+urlHtml+cbHtml+'<div class="dialog-footer">'+noteHtml+'<div class="dialog-buttons">'+okHtml+extraHtml+cancelHtml+'</div></div></div></div>';
    document.body.appendChild(mo);
    requestAnimationFrame(()=>mo.classList.add('open'));
    let closed=false;
    const close=()=>{if(closed)return;closed=true;document.removeEventListener('keydown',onKey,true);mo.classList.remove('open');mo.classList.add('closing');setTimeout(()=>mo.remove(),200);};
    const onKey=e=>{if(e.key==='Escape'){close();if(onCancel)onCancel();}};
    document.addEventListener('keydown',onKey,true);
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
    var title=opts.title||'',options=opts.options||[],current=opts.current,onSave=opts.onSave,footerNote=opts.footerNote||'';
    var sel=current;
    var mo=document.createElement('div');mo.className='_mo_';
    var radios=options.map(function(o){var v=String(o.value==null?'':o.value);return '<label class="Radio'+(v===String(current)?' checked':'')+'"><input type="radio" name="_tgpick_" value="'+_escHtml(v)+'"'+(v===String(current)?' checked':'')+'><div class="Radio-main"><span class="label">'+_escHtml(o.label)+'</span></div></label>';}).join('');
    var noteHtml=footerNote?'<div class="dialog-footer-note">'+_escHtml(footerNote)+'</div>':'';
    mo.innerHTML='<div class="modal-dialog"><div class="modal-header"><div class="modal-title">'+_escHtml(title)+'</div></div>'
        +'<div class="modal-content"><div class="radio-group _tgpick_grp_ custom-scroll">'+radios+'</div>'
        +'<div class="dialog-footer">'+noteHtml+'<div class="dialog-buttons"><button class="Button text primary confirm-dialog-button" id="_pk_ok_">'+_escHtml(T('save_upper'))+'</button>'
        +'<button class="Button text primary confirm-dialog-button" id="_pk_cn_">'+_escHtml(T('cancel'))+'</button></div></div></div></div>';
    document.body.appendChild(mo);requestAnimationFrame(function(){mo.classList.add('open');});
    var labels=mo.querySelectorAll('label.Radio');
    mo.querySelectorAll('input[name=_tgpick_]').forEach(function(inp){inp.addEventListener('change',function(){if(inp.checked){sel=inp.value;labels.forEach(function(l){l.classList.toggle('checked',l.contains(inp));});}});});
    var closed=false;
    var close=function(){if(closed)return;closed=true;document.removeEventListener('keydown',onKey,true);mo.classList.remove('open');mo.classList.add('closing');setTimeout(function(){mo.remove();},200);};
    var onKey=function(e){if(e.key==='Escape')close();};
    document.addEventListener('keydown',onKey,true);
    mo.querySelector('#_pk_cn_').addEventListener('click',close);
    mo.querySelector('#_pk_ok_').addEventListener('click',function(){close();if(onSave)onSave(sel);});
    mo.addEventListener('click',function(e){if(e.target===mo)close();});
}

window._tgLink=async function(url){
    try{await INV('open_url',{url});}catch(e){}
};

// ── Фейк-панель «как родной раздел настроек» (#5) ───────────────────────────
// Ложится поверх колонки #Settings (position:absolute;inset:0), шапку клонируем
// из живого нативного раздела (хэш-классы + вид 1-в-1). Своя кнопка «Назад»
// закрывает панель. React-state НЕ трогаем → работает железно, в отличие от
// попытки встроить чужой слайд в Transition (React игнорирует чужие классы).
//   opts: { title, onBack, renderHeader(headerEl), renderContent(contentEl) }
let _nativePanel=null;