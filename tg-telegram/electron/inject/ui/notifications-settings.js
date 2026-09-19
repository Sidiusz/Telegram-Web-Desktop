
// ── Кэш нативных виджетов для клонирования (#3) ─────────────────────────────
// Чтобы наши настройки в «Общие настройки» выглядели 1-в-1 как родные, мы НЕ
// рисуем свою вёрстку, а КЛОНИРУЕМ живые нативные виджеты TG (как блок
// «Уведомления»): тумблер (label.Checkbox), поле ввода (.input-group),
// кнопку (.Button). На странице «Общие» их нет — поэтому ловим образцы с любой
// страницы настроек (Уведомления/Изменить профиль/…) и сохраняем в localStorage,
// чтобы при следующих загрузках они были сразу.
var _tgWidgetTpl = { toggle:null, input:null, button:null, radio:null, header:null, cardCls:null };
(function restoreWidgetTpl(){
    try{
        var raw=localStorage.getItem('_tgWidgetTpl3');
        if(!raw)return;
        var o=JSON.parse(raw), box=document.createElement('div');
        ['toggle','input','button','radio','header'].forEach(function(k){
            if(o[k]){ box.innerHTML=o[k]; if(box.firstElementChild) _tgWidgetTpl[k]=box.firstElementChild.cloneNode(true); box.innerHTML=''; }
        });
        if(o.cardCls) _tgWidgetTpl.cardCls=o.cardCls;
    }catch(e){}
})();
function captureWidgetTpl(){
    var st=document.getElementById('Settings'); if(!st) return;
    var changed=false;
    if(!_tgWidgetTpl.toggle){ var t=st.querySelector('label.Checkbox'); if(t){ _tgWidgetTpl.toggle=t.cloneNode(true); changed=true; } }
    if(!_tgWidgetTpl.input){ var inp=Array.from(st.querySelectorAll('.input-group')).find(function(x){return !x.closest('._tgpanel_,[data-tggen],[data-tgabout],#_tgnotif_block_');}); if(inp){ _tgWidgetTpl.input=inp.cloneNode(true); changed=true; } }
    if(!_tgWidgetTpl.button){ var b=st.querySelector('.Button:not(.default):not(.translucent)'); if(b){ _tgWidgetTpl.button=b.cloneNode(true); changed=true; } }
    if(!_tgWidgetTpl.radio){ var rd=st.querySelector('label.Radio'); if(rd){ _tgWidgetTpl.radio=rd.cloneNode(true); changed=true; } }
    // Карточку и заголовок ловим по стилю (хэши меняются между сборками); перезаписываем при расхождении.
    var nt=_findNativeCardTpl();
    if(nt){
        if(nt.cardCls && _tgWidgetTpl.cardCls!==nt.cardCls){ _tgWidgetTpl.cardCls=nt.cardCls; changed=true; }
        if(nt.header && !_tgWidgetTpl.header){ _tgWidgetTpl.header=nt.header.cloneNode(false); changed=true; }
    }
    if(changed){
        try{
            var o={};
            ['toggle','input','button','radio','header'].forEach(function(k){ if(_tgWidgetTpl[k]) o[k]=_tgWidgetTpl[k].outerHTML; });
            if(_tgWidgetTpl.cardCls) o.cardCls=_tgWidgetTpl.cardCls;
            localStorage.setItem('_tgWidgetTpl3', JSON.stringify(o));
        }catch(e){}
    }
}

function setupNativeWidgetCapture(){
    captureWidgetTpl();
    setInterval(function(){ try{ captureWidgetTpl(); }catch(e){} },500);
}
