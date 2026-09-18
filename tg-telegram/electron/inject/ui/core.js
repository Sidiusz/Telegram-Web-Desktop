const INV=(cmd,args)=>window.tgBridge.invoke(cmd,args);
const CSS=`
.Menu.main-menu .bubble.menu-container{max-height:90vh!important;overflow-y:auto!important;}
._empty_{color:#aaa;text-align:center;padding:32px 16px;font-size:13px;}
.Badge{display:inline-flex !important;align-items:center !important;justify-content:center !important;min-width:12px !important;height:12px !important;padding:0 3px !important;border-radius:6px !important;background:#F23C34 !important;color:#fff !important;font-size:9px !important;font-weight:700 !important;line-height:1 !important;box-sizing:border-box !important;letter-spacing:-.3px !important;}
/* Toasts and popup cards use Telegram's own .Notification/.Notification-container classes. */
/* Modal shell aligned with current Telegram Web A. */
._mo_{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.25);opacity:1;transition:opacity .2s;}
._mo_.closing{opacity:0;}
._mo_ .modal-dialog{border-radius:var(--border-radius-modal,2rem);background-color:var(--color-background,#212121);width:100%;min-width:17.5rem;max-width:24rem;max-height:min(92vh,50rem);box-shadow:0 .25rem .5rem .125rem var(--color-default-shadow,rgba(16,16,16,.61));flex-direction:column;margin:2rem;display:inline-flex;position:relative;overflow:hidden;opacity:0;transform:translateY(-1rem);transition:transform .2s,opacity .2s;}
._mo_.open .modal-dialog{opacity:1;transform:translateY(0);}
._mo_.closing .modal-dialog{opacity:0;transform:translateY(1rem);}
._mo_ .modal-header{flex-shrink:0;align-items:center;padding:1.3125rem 1.375rem 0;display:flex;}
._mo_ .modal-title{font-size:1.25rem;font-weight:var(--font-weight-medium,500);color:var(--color-text,#fff);text-overflow:ellipsis;flex:auto;overflow:hidden;unicode-bidi:plaintext;}
._mo_ .modal-content{flex-grow:1;width:100%;max-height:min(92vh,50rem);padding:1rem 1.5rem 1.1875rem;overflow-y:auto;display:flex;flex-direction:column;gap:1rem;}
._mo_ ._tgpick_grp_{overflow-y:auto;min-height:0;}
._mo_ ._msg_{color:var(--color-text,#fff);font-size:1rem;line-height:1.5;unicode-bidi:plaintext;}
._mo_ ._url_{color:var(--color-primary,#8774e1);font-size:.875rem;word-break:break-all;padding:.625rem .75rem;background:var(--color-code-bg,rgba(112,117,121,.08));border-radius:var(--border-radius-default-small,.625rem);}
._mo_ ._upd_cl_{margin-top:.25rem;color:var(--color-text-secondary,#aaa);font-size:.9375rem;line-height:1.4;white-space:pre-wrap;max-height:13.75rem;overflow-y:auto;}
._mo_ ._wn_intro_{color:var(--color-text-secondary,#aaa);font-size:.9375rem;line-height:1.4;}
._mo_ ._wn_item_{display:flex;gap:.625rem;align-items:flex-start;margin-top:.75rem;font-size:.9375rem;line-height:1.4;}
._mo_ ._wn_bullet_{color:var(--color-primary,#8774e1);font-size:1.125rem;line-height:1.3;flex-shrink:0;}
._mo_ .dialog-buttons{flex-flow:row-reverse wrap;justify-content:flex-start;gap:.5rem 1rem;display:flex;margin-top:.25rem;}
._mo_ .confirm-dialog-button{width:auto;height:auto;font-weight:var(--font-weight-semibold,500);text-align:right;white-space:pre-wrap;flex:none;}
._mo_ .dialog-checkbox{margin:.25rem -1.125rem 0;}
/* «Прочитать всё» из трея: помечаем чаты прочитанными через скрытое контекстное
   меню TG — пока идёт операция, прячем любые контекст-меню (синтетические клики
   через dispatchEvent проходят несмотря на pointer-events:none). */
html._tgreading_ .Menu.context-menu,
html._tgreading_ .bubble.menu-container.shown{opacity:0 !important;pointer-events:none !important;transition:none !important;}
/* Telegram Notification layout: native shell + only our content-specific helpers. */
._cnotif_wrap_{position:fixed;inset:0 0 auto;z-index:2147483645;pointer-events:none;}
._cnotif_wrap_>.Notification-container{pointer-events:none;opacity:0;transform:translateY(-.75rem);transition:opacity .2s,transform .2s;}
._cnotif_wrap_>.Notification-container._in_{opacity:1;transform:none;}
._cnotif_wrap_>.Notification-container._out_{opacity:0;transform:translateY(-.5rem);}
._cnotif_wrap_ .Notification{pointer-events:auto;}
@keyframes _cnIn_{from{opacity:0;transform:translateY(-.75rem)}to{opacity:1;transform:none}}
._twd_notice_avatar_{width:2.5rem;height:2.5rem;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;margin-inline-end:.75rem;background:var(--color-primary);color:#fff;font-size:1.0625rem;font-weight:var(--font-weight-medium);overflow:hidden;}
._twd_notice_avatar_ img{width:100%;height:100%;object-fit:cover;border-radius:50%;}
._twd_notice_iconhost_{display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-inline-end:.75rem;color:var(--color-toast-action,var(--color-primary));}
._twd_notice_text_{opacity:.82;margin-top:.125rem;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
._twd_notice_close_{flex-shrink:0;margin-inline-start:.25rem;color:inherit;}
.Notification-container.dl_card{margin-left:auto;margin-right:.5rem;transition:width .2s,opacity .2s,transform .2s;}
.Notification-container.dl_compact{width:15rem;}
.Notification-container.dl_compact ._twd_notice_avatar_{width:1.75rem;height:1.75rem;font-size:.8125rem;}
.Notification-container.dl_compact ._twd_notice_text_{font-size:.8125rem;}
._upd_bar_{display:flex;gap:6px;align-items:center;margin-top:8px;}
._upd_prog_{flex:1;height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;}
._upd_prog_ span{display:block;height:100%;background:#5288c1;border-radius:2px;transition:width .3s;width:0%;}
/* #5: скачанный файл. Родные ноды НЕ трогаем — прячем стрелку скачивания через CSS
   (обратимо) и кладём свои оверлеи: зелёная галочка (открыть файл) + папка. */
/* стрелку скачивания прячем ТОЛЬКО когда наша галочка реально стоит (класс
   добавляется после вставки бейджа) — иначе на месте иконки была бы пустота. */
.File._tgdl_done_ok_ .action-icon{display:none!important;}
.File._tgdl_done_ok_ .file-icon-container{position:relative;}
/* Центральная иконка «открыть» (на месте стрелки скачивания). Клики ловит сам
   .file-icon-container (см. mousedown), поэтому pointer-events:none. */
._tgdl_open_{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
    width:24px;height:24px;color:#fff;pointer-events:none;z-index:2;
    display:flex;align-items:center;justify-content:center;}
._tgdl_open_ svg{width:100%;height:100%;display:block;}
/* Зелёная галочка в углу — индикатор «скачано» (не кнопка). Теперь слева сверху по просьбе. */
._tgdl_ok_{position:absolute;left:-4px;top:-4px;width:18px;height:18px;border-radius:50%;
    background:#4caf50;display:flex;align-items:center;justify-content:center;
    box-shadow:0 1px 4px rgba(0,0,0,.45);pointer-events:none;z-index:3;}
._tgdl_ok_ svg{width:12px;height:12px;}
.File._tgdl_done_ok_ .file-icon-container{cursor:pointer;}
/* у скачанного файла формат («zip»/«exe») делаем мельче и сдвигаем под иконку
   папки, чтобы не перекрывался центральной иконкой «открыть». */
.File._tgdl_done_ok_ .file-ext{font-size:.8em;transform:translateY(8px);}
.File._tgdl_downloading_ .action-icon{display:none!important;}
.File._tgdl_downloading_ .file-icon-container{position:relative;}
._tgdl_spinner_{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:18px;height:18px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:_tgdlSpin_ .7s linear infinite;pointer-events:none;z-index:2;}
@keyframes _tgdlSpin_{to{transform:translate(-50%,-50%) rotate(360deg)}}
/* Просмотрщик медиа: зелёная галочка «скачано» на кнопке загрузки (как в чатах).
   У кнопки круглая маска (overflow:hidden под ripple) — она резала бейдж; снимаем
   обрезку только у кнопки с нашим бейджем, чтобы галочка была видна целиком. */
.MediaViewerActions button{position:relative;}
.MediaViewerActions button:has(._tgdl_vbtn_ok_){overflow:visible !important;}
._tgdl_vbtn_ok_{position:absolute;right:0;bottom:0;width:15px;height:15px;border-radius:50%;
    background:#4caf50;display:flex;align-items:center;justify-content:center;
    box-shadow:0 1px 3px rgba(0,0,0,.6);border:1.5px solid #232323;pointer-events:none;z-index:3;}
._tgdl_vbtn_ok_ svg{width:10px;height:10px;}
/* Зелёный значок «скачано» в углу медиа — ниже шапки, чтобы не налезал на имя. */
._tgdl_vcorner_{position:absolute;z-index:6;top:64px;left:16px;width:30px;height:30px;border-radius:50%;
    background:#4caf50;display:flex;align-items:center;justify-content:center;
    box-shadow:0 2px 6px rgba(0,0,0,.55);pointer-events:none;animation:_cnIn_ .2s ease;}
._tgdl_vcorner_ svg{width:19px;height:19px;}
/* TG рисует .file-ext только для расширений ≤4 символов (File.tsx) — у длинных
   (.unitypackage) иконка пустая. Свой лейбл: размер шрифта подбираем по длине. */
/* margin съедает 12px padding у .file-icon — иначе на текст остаётся 30px из 54. */
.File .file-icon ._tgdl_ext_{font-size:var(--tgdl-ext-fs,10px);line-height:24px;max-width:52px;
    margin:0 -11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.File._tgdl_done_ok_ .file-icon ._tgdl_ext_{transform:translateY(8px);}
/* ── Фейк-панель «как родной раздел настроек» (#5) ────────────────────────
   Ложится точно поверх колонки #Settings (та же геометрия, что у Transition).
   Шапку и контейнер .settings-content клонируем из живого нативного раздела
   → все хэш-классы и вид 1-в-1 как родной. Своя кнопка «Назад» просто прячет
   панель (React-state не трогаем → кнопка работает железно). */
._tgpanel_{position:absolute;inset:0;z-index:50;display:flex;flex-direction:column;background:var(--color-background,#212121);
    opacity:0;transform:translateX(1.5rem);}
/* Measured from a live Telegram settings category transition (2026-09-19):
   --slide-transition = .3s cubic-bezier(.25,1,.5,1).
   Forward: old page 1→0 opacity + 0→-1.5rem; new page 0→1 + +1.5rem→0.
   Backward is the exact inverse. No scaling is involved. */
@keyframes _twd-settings-in-opacity_{from{opacity:0}to{opacity:1}}
@keyframes _twd-settings-out-opacity_{from{opacity:1}to{opacity:0}}
@keyframes _twd-settings-in-move_{from{transform:translateX(1.5rem)}to{transform:translateX(0)}}
@keyframes _twd-settings-out-move_{from{transform:translateX(0)}to{transform:translateX(-1.5rem)}}
@keyframes _twd-settings-back-out-move_{from{transform:translateX(0)}to{transform:translateX(1.5rem)}}
@keyframes _twd-settings-back-in-move_{from{transform:translateX(-1.5rem)}to{transform:translateX(0)}}
._tgpanel_._in_{
    animation:_twd-settings-in-opacity_ .3s cubic-bezier(.25,1,.5,1) forwards,
              _twd-settings-in-move_ .3s cubic-bezier(.25,1,.5,1) forwards;}
._tgpanel_._out_{
    animation:_twd-settings-out-opacity_ .3s cubic-bezier(.25,1,.5,1) forwards,
              _twd-settings-back-out-move_ .3s cubic-bezier(.25,1,.5,1) forwards;}
#Settings .Transition_slide-active._twd-under_,#Settings .Transition__slide--active._twd-under_{
    animation:_twd-settings-out-opacity_ .3s cubic-bezier(.25,1,.5,1) forwards!important,
              _twd-settings-out-move_ .3s cubic-bezier(.25,1,.5,1) forwards!important;}
#Settings .Transition_slide-active._twd-under-back_,#Settings .Transition__slide--active._twd-under-back_{
    animation:_twd-settings-in-opacity_ .3s cubic-bezier(.25,1,.5,1) forwards!important,
              _twd-settings-back-in-move_ .3s cubic-bezier(.25,1,.5,1) forwards!important;}
._tgpanel_ .left-header{flex:0 0 auto;}
._tgpanel_ .settings-content{flex:1;overflow-y:auto;background:var(--color-background-secondary,#0f0f0f);}
/* Small layout helpers around native Telegram controls. */
._tgpanel_ ._tpempty_{color:var(--color-text-secondary,#aaa);text-align:center;padding:40px 16px;font-size:14px;}
._twd-row-actions_{margin-inline-start:auto;display:flex;align-items:center;gap:.125rem;flex-shrink:0;}
.ListItem-main-icon ._twd-filled-glyph_{width:1.5rem;height:1.5rem;display:block;fill:#fff;}
._twd-filetype_{width:1.875rem!important;height:1.875rem!important;border-radius:.625rem!important;display:flex!important;align-items:center!important;justify-content:center!important;flex-shrink:0;font-size:.625rem!important;font-weight:700;color:#fff!important;text-transform:uppercase;}
._twd-apply-bar_{position:sticky;bottom:0;z-index:2;display:flex;justify-content:flex-end;padding:.75rem 0;background:var(--color-background-secondary,#0f0f0f);}
._twd-apply-bar_[hidden]{display:none!important;}
._twd-panel-card_{margin-top:.5rem;}
._twd-ui-lab-buttons_{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;padding:.75rem 1rem;}
`;

function ensureCSS(){if(!document.getElementById('_tgcss_')){const s=document.createElement('style');s.id='_tgcss_';s.textContent=CSS;(document.head||document.documentElement).appendChild(s);}}
function ensureToast(){}
function toast(msg,icon){try{if(typeof showNativeToast==='function')return showNativeToast(msg,icon);}catch(e){}}

// ── Рантайм Telegram webZ: getGlobal() / getActions() ───────────────────────
// Прямой доступ к состоянию и экшенам TG вместо эмуляции через DOM. Минифициро-
// ванные id модулей и имена экспортов меняются между сборками, поэтому ищем по
// признакам, а не по именам:
//  • getActions — тривиальная 0-арг функция `function(){return X}`, результат имеет
//    markChatMessagesRead. Тривиальность важна: такую функцию безопасно вызвать.
//  • getGlobal — СОСЕД getActions в том же модуле, но его тело НЕ тривиально
//    (есть side-effect), поэтому ищем по РЕЗУЛЬТАТУ (chats/users/messages/byTabId)
//    среди 0-арг функций ТОЛЬКО этого модуля (он — модуль глобал-стейта, вызовы ок).
// Стейт иммутабелен — кэшируем функции, зовём заново каждый раз. Повторяем поиск,
// пока оба не найдены (стейт может ещё грузиться), но с лимитом. Сбой → null,
// вызывающий откатывается на DOM-путь.
var tgRuntime=(function(){
    var _getG=null,_getA=null,_mod=null,_req=null,_tries=0;
    function getReq(){
        if(_req)return _req;
        try{ (window.webpackChunktelegram_t=window.webpackChunktelegram_t||[]).push([[Math.random()],{},function(r){_req=r;}]); }catch(e){}
        return _req;
    }
    var TRIV=/^function \w*\(\)\{return [\w$.]+\}$/;
    function scanModule(e){
        if(!e||typeof e!=='object')return;
        for(var k in e){                                  // getActions — только тривиальные (pure)
            if(_getA)break;
            try{ var f=e[k];
                if(typeof f==='function'&&f.length===0&&TRIV.test(f.toString())){
                    var a=f(); if(a&&typeof a==='object'&&typeof a.markChatMessagesRead==='function') _getA=f;
                }
            }catch(_){}
        }
        for(var k2 in e){                                 // getGlobal — по результату
            if(_getG)break;
            try{ var f2=e[k2];
                if(typeof f2!=='function'||f2.length!==0)continue;
                var v=f2();
                if(v&&typeof v==='object'&&v.chats&&v.users&&v.messages&&v.byTabId) _getG=f2;
            }catch(_){}
        }
    }
    function discover(){
        var req=getReq(); if(!req||!req.m)return;
        if(_mod!=null){ try{ scanModule(req(_mod)); }catch(e){} return; }
        var ids=Object.keys(req.m);
        for(var i=0;i<ids.length;i++){
            var e; try{ e=req(ids[i]); }catch(_){ continue; }
            if(!e||typeof e!=='object')continue;
            var hit=false;                                // модуль глобал-стейта = есть тривиальная getActions
            for(var k in e){ try{ var f=e[k];
                if(typeof f==='function'&&f.length===0&&TRIV.test(f.toString())){
                    var a=f(); if(a&&typeof a==='object'&&typeof a.markChatMessagesRead==='function'){ hit=true; break; }
                } }catch(_){}
            }
            if(hit){ _mod=ids[i]; scanModule(e); break; }
        }
    }
    function ensure(){ if((_getA&&_getG)||_tries>25)return; _tries++; discover(); }
    return {
        getActions:function(){ ensure(); try{ return _getA?_getA():null; }catch(e){ return null; } },
        getGlobal: function(){ ensure(); try{ return _getG?_getG():null; }catch(e){ return null; } },
    };
})();
try { window.__tgRuntime = tgRuntime; } catch(e) {}

// ── Плавающий значок загрузки удалён (#5): прогресс теперь in-message + модалка
// ── Реестр загрузок #5 ─────────────────────────────────────────────────────
// Связывает download id (main) ↔ message id (renderer) через имя файла:
// на клике по .File ловим mid+filename ДО старта скачивания и кладём в очередь
// pending. Когда main шлёт start{id,filename} — матчим filename→mid и фиксируем
// в registry. Дальше progress/done применяется к in-message оверлею.
// .Message виртуализированы (вне DOM при скролле), поэтому in-message состояние
// наносим интервалом по registry — идемпотентно через data-маркер.