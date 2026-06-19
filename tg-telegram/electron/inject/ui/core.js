const INV=(cmd,args)=>window.tgBridge.invoke(cmd,args);
const CSS=`
._p_{position:fixed;top:0;right:0;bottom:0;width:360px;background:#212121;z-index:2147483647;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .28s cubic-bezier(.4,0,.2,1);}
._p_.open{transform:translateX(0);box-shadow:-3px 0 8px #191919;}
.Menu.main-menu .bubble.menu-container{max-height:90vh!important;overflow-y:auto!important;}
._ph_{padding:14px 16px;background:#1a1a1a;font-size:15px;font-weight:600;color:#fff;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;border-bottom:1px solid #191919;}
._pc_{flex:1;overflow-y:auto;}
._pc_::-webkit-scrollbar{width:4px;}
._pc_::-webkit-scrollbar-thumb{background:#333;border-radius:2px;}
._cls_{background:none;border:none;color:#aaa;cursor:pointer;font-size:20px;line-height:1;padding:0;}
._cls_:hover{color:#fff;}
._cbx_{display:flex;align-items:center;gap:12px;cursor:pointer;margin:0;width:100%;}
._cbx_ input{display:none;}
._cbx_ .box{width:18px;height:18px;border:2px solid #777;border-radius:4px;flex-shrink:0;transition:.15s;display:flex;align-items:center;justify-content:center;box-sizing:border-box;}
._cbx_ input:checked~.box{background:var(--color-primary,#5288c1);border-color:var(--color-primary,#5288c1);}
._cbx_ input:checked~.box::after{content:'✓';color:#fff;font-size:12px;font-weight:bold;}
._cbx_ .label{color:#fff;font-size:14px;flex:1;text-align:left;line-height:1.2;}
._inp_{background:#1a1a1a;border:1px solid #444;border-radius:6px;color:#fff;padding:6px 10px;width:100%;box-sizing:border-box;font-size:13px;outline:none;}
._inp_:focus{border-color:var(--color-primary,#5288c1);}
._ba_{background:var(--color-primary,#2b5278);border:none;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;}
._ba_:hover{filter:brightness(1.15);}
._dli_{padding:10px 16px;border-bottom:1px solid #191919;cursor:default;transition:background .15s;}
._dli_.done{cursor:pointer;}
._dli_.done:hover{background:#2a2a2a;}
._dln_{color:#fff;font-size:13px;word-break:break-all;margin-bottom:2px;}
._dls_{font-size:11px;margin-bottom:5px;}
._dla_{display:flex;gap:8px;align-items:center;}
._empty_{color:#aaa;text-align:center;padding:32px 16px;font-size:13px;}
._badge_{display:inline-block;background:rgba(82,136,193,.2);color:#8bb8e8;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:4px;}
.Badge{display:inline-flex !important;align-items:center !important;justify-content:center !important;min-width:12px !important;height:12px !important;padding:0 3px !important;border-radius:6px !important;background:#F23C34 !important;color:#fff !important;font-size:9px !important;font-weight:700 !important;line-height:1 !important;box-sizing:border-box !important;letter-spacing:-.3px !important;}
._toast_{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#212121;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:2147483648;white-space:nowrap;display:flex;align-items:center;gap:10px;box-shadow:0 4px 16px rgba(0,0,0,.5);max-width:calc(100vw - 40px);}
._toast_.on{opacity:1;}
._toast_ .notif-icon{color:var(--color-primary,#5288c1);font-size:18px;flex-shrink:0;}
._mo_{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);}
._mo_ .modal-dialog{background:#212121;border-radius:12px;min-width:320px;max-width:420px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.7);display:flex;flex-direction:column;}
._mo_ .modal-header{padding:16px 20px 12px;}
._mo_ .modal-title{font-size:16px;font-weight:600;color:#fff;}
._mo_ .modal-content{padding:0 20px 20px;display:flex;flex-direction:column;gap:16px;}
._mo_ ._msg_{color:#ccc;font-size:14px;line-height:1.5;}
._mo_ ._url_{color:var(--color-links,#7b72c6);font-size:12px;word-break:break-all;padding:8px 10px;background:#1a1a1a;border-radius:6px;}
._mo_ .dialog-buttons{display:flex;gap:12px;justify-content:flex-end;padding-top:8px;}
._mo_ .Button{background:none;border:none;color:var(--color-links,#7b72c6);font-size:14px;font-weight:500;padding:8px 16px;border-radius:6px;cursor:pointer;text-transform:uppercase;letter-spacing:0.5px;width:auto !important;flex:none !important;}
._mo_ .Button:hover{background:rgba(255,255,255,.06);}
._mo_ .Button.danger{color:#e53935;}
._si_{padding:8px 0 16px 8px;color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.5px;}
._si_:first-child{padding-top:16px;}
._it_{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #191919;min-height:24px;}
._it_:last-child{border-bottom:none;}
._it_span{color:#fff;font-size:14px;}
._sect_{background:#1a1a1a;margin:0 8px 8px;border-radius:8px;overflow:hidden;}
._irow_{display:flex;gap:6px;width:100%;margin-top:4px;}
._irow_ ._inp_{flex:1;}
._del_{background:none;border:none;color:#e53935;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:3px;padding:0;}
._del_:hover{opacity:.8;}
._folder_{background:none;border:none;color:var(--color-text-secondary,#aaa);cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:3px;padding:0;}
._folder_:hover{color:#fff;}
._dlbadge_wrap_{position:fixed;bottom:16px;right:16px;z-index:2147483646;display:flex;flex-direction:column;gap:8px;align-items:flex-end;pointer-events:none;}
._cnotif_wrap_{position:fixed;bottom:16px;right:16px;z-index:2147483645;display:flex;flex-direction:column-reverse;gap:8px;align-items:flex-end;pointer-events:none;max-width:340px;}
._cnotif_{pointer-events:all;background:#1e2733;border-radius:12px;padding:12px 14px;box-shadow:0 4px 20px rgba(0,0,0,.6);display:flex;gap:12px;align-items:flex-start;animation:_cnIn_ .25s cubic-bezier(.4,0,.2,1);min-width:260px;max-width:340px;cursor:default;}
@keyframes _cnIn_{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
._cnotif_.out{opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;}
._cnotif_av_{width:40px;height:40px;border-radius:50%;background:#2b5278;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600;color:#fff;overflow:hidden;}
._cnotif_av_ img{width:100%;height:100%;object-fit:cover;border-radius:50%;}
._cnotif_body_{flex:1;min-width:0;}
._cnotif_title_{color:#fff;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
._cnotif_text_{color:#aaa;font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
._cnotif_close_{background:none;border:none;color:#666;font-size:16px;cursor:pointer;padding:0 0 0 6px;line-height:1;flex-shrink:0;align-self:flex-start;}
._cnotif_close_:hover{color:#fff;}
._cnotif_prog_{height:2px;background:rgba(255,255,255,.08);border-radius:2px;margin-top:8px;overflow:hidden;}
._cnotif_prog_ span{display:block;height:100%;background:#5288c1;border-radius:2px;animation:_cnProg_ 5s linear forwards;}
@keyframes _cnProg_{from{width:100%;}to{width:0%;}}
._upd_bar_{display:flex;gap:6px;align-items:center;margin-top:8px;}
._upd_prog_{flex:1;height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;}
._upd_prog_ span{display:block;height:100%;background:#5288c1;border-radius:2px;transition:width .3s;width:0%;}
._cl_content_{padding:14px 16px;color:#ccc;font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word;user-select:text;}
._dlb_{pointer-events:all;display:flex;align-items:center;gap:10px;background:#1e2733;border-radius:12px;padding:10px 14px;box-shadow:0 4px 16px rgba(0,0,0,.5);min-width:220px;max-width:320px;cursor:default;animation:_dlbIn_ .2s ease;}
@keyframes _dlbIn_{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
._dlb_.done{cursor:pointer;}
._dlb_.done:hover{background:#243040;}
._dlb_ico_{width:32px;height:32px;border-radius:50%;background:#2b5278;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:15px;position:relative;}
._dlb_ico_ svg{position:absolute;}
._dlb_info_{flex:1;min-width:0;}
._dlb_name_{color:#fff;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
._dlb_status_{color:#aaa;font-size:11px;margin-top:2px;}
._dlb_prog_{height:2px;background:rgba(255,255,255,.1);border-radius:2px;margin-top:6px;overflow:hidden;}
._dlb_prog_ span{display:block;height:100%;background:#5288c1;border-radius:2px;transition:width .3s;}
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
/* Зелёная галочка в углу — индикатор «скачано» (не кнопка). */
._tgdl_ok_{position:absolute;right:-3px;bottom:-3px;width:18px;height:18px;border-radius:50%;
    background:#4caf50;display:flex;align-items:center;justify-content:center;
    box-shadow:0 1px 4px rgba(0,0,0,.45);pointer-events:none;z-index:3;}
._tgdl_ok_ svg{width:12px;height:12px;}
.File._tgdl_done_ok_ .file-icon-container{cursor:pointer;}
/* у скачанного файла формат («zip»/«exe») делаем мельче и сдвигаем под иконку
   папки, чтобы не перекрывался центральной иконкой «открыть». */
.File._tgdl_done_ok_ .file-ext{font-size:.8em;transform:translateY(8px);}
// ── Наш блок настроек уведомлений (вшит в нативные Настройки→Уведомления) ────
._tgnf_{margin:0 0 8px;padding:0 16px;}
._tgnf_ ._hdr_{font-size:13px;font-weight:600;color:#fff;margin:12px 0 4px;display:flex;align-items:center;gap:6px;}
._tgnf_ ._sub_{font-size:12px;color:var(--color-text-secondary,#aaa);margin:0 0 12px;line-height:1.4;}
._tgnf_ ._volrow_{display:flex;align-items:center;gap:10px;padding:6px 0;}
._tgnf_ ._volrow_ ._lbl_{flex:0 0 auto;font-size:13px;color:var(--color-text-secondary,#aaa);}
._tgnf_ ._volrow_ ._pct_{flex:0 0 auto;font-size:12px;color:#fff;min-width:34px;text-align:right;font-variant-numeric:tabular-nums;}
._tgnf_ input[type=range]{flex:1;-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;background:var(--color-background-toggle-active,var(--color-primary,#5288c1));outline:none;cursor:pointer;}
._tgnf_ input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;border:none;box-shadow:0 1px 3px rgba(0,0,0,.4);}
._tgnf_ input[type=range]:disabled{opacity:.4;cursor:default;}
._tgnf_ ._hint_{font-size:11px;color:var(--color-text-secondary,#888);margin-top:10px;line-height:1.4;}
/* ── Фейк-панель «как родной раздел настроек» (#5) ────────────────────────
   Ложится точно поверх колонки #Settings (та же геометрия, что у Transition).
   Шапку и контейнер .settings-content клонируем из живого нативного раздела
   → все хэш-классы и вид 1-в-1 как родной. Своя кнопка «Назад» просто прячет
   панель (React-state не трогаем → кнопка работает железно). */
._tgpanel_{position:absolute;inset:0;z-index:50;display:flex;flex-direction:column;background:var(--color-background,#212121);}
._tgpanel_ .left-header{flex:0 0 auto;}
._tgpanel_ ._tpc_{flex:1;overflow-y:auto;}
._tgpanel_._in_ .left-header h3,
._tgpanel_._in_ ._tpc_{animation:_tpIn_ .22s cubic-bezier(.4,0,.2,1);}
@keyframes _tpIn_{from{opacity:0;transform:translateX(24px);}to{opacity:1;transform:translateX(0);}}
/* строка-загрузка: действие справа (Открыть/Папку/Удалить) — подменяем шеврон */
._tgpanel_ ._tpright_{margin-left:auto;display:flex;gap:2px;flex-shrink:0;}
._tgpanel_ ._tpright_ button{background:none;border:none;color:var(--color-text-secondary,#aaa);cursor:pointer;padding:6px;border-radius:6px;display:flex;align-items:center;justify-content:center;}
._tgpanel_ ._tpright_ button:hover{background:rgba(255,255,255,.08);color:#fff;}
._tgpanel_ ._tpright_ button.danger:hover{color:#e53935;}
._tgpanel_ ._tpright_ button svg{width:18px;height:18px;}
._tgpanel_ ._tpempty_{color:var(--color-text-secondary,#aaa);text-align:center;padding:40px 16px;font-size:14px;}
._tgpanel_ ._tphead_{display:flex;align-items:center;justify-content:space-between;padding:0 16px;}
._tgpanel_ ._tpclr_{background:rgba(229,57,53,.15);border:none;color:#e53935;font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;}
._tgpanel_ ._tpclr_:hover{background:rgba(229,57,53,.28);}
/* ── Панель «Дополнения» ──────────────────────────────────────────────── */
._tgpanel_ ._addongrp_{padding:14px 16px 6px;color:var(--color-text-secondary,#aaa);font-size:11px;text-transform:uppercase;letter-spacing:.5px;}
._tgpanel_ ._addonrow_{display:flex;align-items:center;gap:12px;padding:11px 16px;border-bottom:1px solid rgba(255,255,255,.06);}
._tgpanel_ ._addonrow_ ._ai_{width:34px;height:34px;border-radius:8px;background:#2b5278;display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;}
._tgpanel_ ._addonrow_ ._am_{flex:1;min-width:0;}
._tgpanel_ ._addonrow_ ._an_{color:#fff;font-size:14px;display:flex;align-items:center;gap:6px;}
._tgpanel_ ._addonrow_ ._as_{color:var(--color-text-secondary,#aaa);font-size:12px;margin-top:2px;}
._tgpanel_ ._addon_del_{background:none;border:none;color:var(--color-text-secondary,#aaa);cursor:pointer;padding:6px;border-radius:6px;display:flex;flex-shrink:0;}
._tgpanel_ ._addon_del_:hover{background:rgba(229,57,53,.15);color:#e53935;}
._tgsw_{position:relative;width:38px;height:22px;flex-shrink:0;cursor:pointer;}
._tgsw_ input{display:none;}
._tgsw_ ._tr_{position:absolute;inset:0;background:#555;border-radius:11px;transition:.2s;}
._tgsw_ ._tr_::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s;}
._tgsw_ input:checked~._tr_{background:var(--color-primary,#5288c1);}
._tgsw_ input:checked~._tr_::after{transform:translateX(16px);}
._tgpanel_ ._addons_apply_{position:sticky;bottom:0;background:#1a1a1a;padding:10px 16px;display:none;justify-content:flex-end;border-top:1px solid #191919;}
._tgpanel_ ._addons_apply_ button{background:#2e7d32;border:none;color:#fff;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;display:inline-flex;align-items:center;gap:6px;}
._tgpanel_ ._addons_apply_ button:hover{filter:brightness(1.12);}
`;

function ensureCSS(){if(!document.getElementById('_tgcss_')){const s=document.createElement('style');s.id='_tgcss_';s.textContent=CSS;(document.head||document.documentElement).appendChild(s);}}
function ensureToast(){if(!document.getElementById('_tgt_')&&document.body){const t=document.createElement('div');t.className='_toast_';t.id='_tgt_';document.body.appendChild(t);}}
function toast(msg){ensureToast();const t=document.getElementById('_tgt_');if(!t)return;t.textContent=msg;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),2000);}

// ── Плавающий значок загрузки удалён (#5): прогресс теперь in-message + модалка
// ── Реестр загрузок #5 ─────────────────────────────────────────────────────
// Связывает download id (main) ↔ message id (renderer) через имя файла:
// на клике по .File ловим mid+filename ДО старта скачивания и кладём в очередь
// pending. Когда main шлёт start{id,filename} — матчим filename→mid и фиксируем
// в registry. Дальше progress/done применяется к in-message оверлею.
// .Message виртуализированы (вне DOM при скролле), поэтому in-message состояние
// наносим интервалом по registry — идемпотентно через data-маркер.