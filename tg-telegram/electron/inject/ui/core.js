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
/* Копия нативной TG карточки (.modal-dialog): сплошной #212121, тень, без blur. */
._toast_{position:fixed;bottom:32px;top:auto;left:50%;transform:translateX(-50%) translateY(12px);background:var(--color-background,#212121);color:#fff;padding:12px 18px;border-radius:16px;font-size:15px;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;z-index:2147483648;white-space:nowrap;display:flex;align-items:center;gap:10px;border:1px solid rgba(255,255,255,.12);box-shadow:rgba(16,16,16,.61) 0 4px 8px 2px;max-width:calc(100vw - 32px);}
._toast_.on{opacity:1;transform:translateX(-50%) translateY(0);}
._toast_ .notif-icon{color:var(--color-primary,#5288c1);font-size:18px;flex-shrink:0;}
/* Копия нативного TG .modal-dialog (confirm): #212121, r32, тень, заголовок 20/500,
   кнопки-текст 16/500 uppercase primary, без фона. */
._mo_{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);animation:_moBg_ .15s ease;}
@keyframes _moBg_{from{opacity:0}to{opacity:1}}
@keyframes _moIn_{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
._mo_ .modal-dialog{background:var(--color-background,#212121);border-radius:16px;min-width:300px;max-width:420px;overflow:hidden;box-shadow:rgba(16,16,16,.61) 0 4px 8px 2px;display:flex;flex-direction:column;animation:_moIn_ .18s cubic-bezier(.32,.72,0,1);}
._mo_ .modal-header{padding:18px 22px 6px;}
._mo_ .modal-title{font-size:20px;font-weight:500;color:#fff;line-height:1.2;}
._mo_ .modal-content{padding:6px 22px 12px;display:flex;flex-direction:column;gap:14px;}
._mo_ ._msg_{color:rgba(255,255,255,.85);font-size:16px;line-height:1.4;}
._mo_ ._url_{color:var(--color-primary,#8774e1);font-size:13px;word-break:break-all;padding:8px 10px;background:#1a1a1a;border-radius:8px;}
._mo_ .dialog-buttons{display:flex;gap:6px;justify-content:flex-end;padding-top:4px;}
._mo_ .Button{background:none;border:none;color:var(--color-primary,#8774e1);font-size:16px;font-weight:500;padding:10px 16px;border-radius:12px;cursor:pointer;text-transform:uppercase;letter-spacing:.2px;width:auto !important;flex:none !important;transition:background .12s;}
._mo_ .Button:hover{background:var(--color-primary-opacity,rgba(135,116,225,.12));}
._mo_ .Button.danger{color:#e53935;}
._mo_ .Button.danger:hover{background:rgba(229,57,53,.12);}
/* «Прочитать всё» из трея: помечаем чаты прочитанными через скрытое контекстное
   меню TG — пока идёт операция, прячем любые контекст-меню (синтетические клики
   через dispatchEvent проходят несмотря на pointer-events:none). */
html._tgreading_ .Menu.context-menu,
html._tgreading_ .bubble.menu-container.shown{opacity:0 !important;pointer-events:none !important;transition:none !important;}
/* Кнопка-папка поверх поля «Папка для файлов»: белая, при наведении — primary. */
._tgfolderbtn_{color:#fff;transition:color .12s;}
._tgfolderbtn_:hover{color:var(--color-primary,#8774e1);}
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
/* Копия нативного TG .Notification: сверху по центру, тёмный с blur, скруглённый. */
._cnotif_wrap_{position:fixed;top:0;left:50%;transform:translateX(-50%);margin-top:52px;z-index:2147483645;display:flex;flex-direction:column;gap:4px;align-items:center;pointer-events:none;width:22rem;max-width:calc(100vw - 16px);}
._cnotif_{pointer-events:all;width:100%;box-sizing:border-box;background:var(--color-background,#212121);border-radius:16px;padding:12px 15px;box-shadow:rgba(16,16,16,.61) 0 4px 8px 2px;display:flex;gap:12px;align-items:center;color:#fff;animation:_cnIn_ .25s cubic-bezier(.4,0,.2,1);cursor:default;}
@keyframes _cnIn_{from{opacity:0;transform:translateY(-12px);}to{opacity:1;transform:translateY(0);}}
._cnotif_.out{opacity:0;transform:translateY(-8px);transition:opacity .2s,transform .2s;}
._cnotif_av_{width:40px;height:40px;border-radius:50%;background:#2b5278;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600;color:#fff;overflow:hidden;}
._cnotif_av_ img{width:100%;height:100%;object-fit:cover;border-radius:50%;}
._cnotif_body_{flex:1;min-width:0;}
._cnotif_title_{color:#fff;font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.25;}
._cnotif_text_{color:rgba(255,255,255,.8);font-size:14px;margin-top:1px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
._cnotif_close_{background:none;border:none;color:rgba(255,255,255,.5);font-size:16px;cursor:pointer;padding:0 0 0 6px;line-height:1;flex-shrink:0;align-self:flex-start;}
._cnotif_close_:hover{color:#fff;}
._cnotif_prog_{display:none;}
._upd_bar_{display:flex;gap:6px;align-items:center;margin-top:8px;}
._upd_prog_{flex:1;height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;}
._upd_prog_ span{display:block;height:100%;background:#5288c1;border-radius:2px;transition:width .3s;width:0%;}
._cl_content_{padding:14px 16px;color:#ccc;font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word;user-select:text;}
/* ── Блочный «Список изменений» (карточки версий) ───────────────────────── */
._tgpanel_ ._cl_ver_{background:#1a1a1a;border-radius:10px;margin:10px 12px;padding:10px 14px 12px;}
._tgpanel_ ._cl_ver_._cur_{box-shadow:inset 0 0 0 1px var(--color-primary,#5288c1);background:rgba(82,136,193,.08);}
._tgpanel_ ._cl_ver_hdr_{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
._tgpanel_ ._cl_vnum_{font-size:15px;font-weight:600;color:#fff;}
._tgpanel_ ._cl_ver_._cur_ ._cl_vnum_{color:var(--color-primary,#5288c1);}
._tgpanel_ ._cl_cur_badge_{font-size:10px;text-transform:uppercase;letter-spacing:.4px;background:var(--color-primary,#5288c1);color:#fff;padding:2px 7px;border-radius:8px;font-weight:600;}
._tgpanel_ ._cl_item_{position:relative;padding:4px 0 4px 16px;font-size:13px;color:#ccc;line-height:1.5;user-select:text;}
._tgpanel_ ._cl_item_::before{content:'';position:absolute;left:3px;top:11px;width:5px;height:5px;border-radius:50%;background:#5e5e5e;}
._tgpanel_ ._cl_tag_{color:#8bb8e8;font-weight:600;}
._tgpanel_ ._cl_div_{height:1px;background:rgba(255,255,255,.08);margin:8px 0 6px;}
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
/* #4: карточка загрузки из ДРУГОГО чата (фоновая) — компактнее и уже, чтобы не мешать. */
._cnotif_.dl_card{transition:width .2s,max-width .2s,padding .2s;}
._cnotif_.dl_compact{width:auto;max-width:15rem;padding:8px 12px;gap:9px;}
._cnotif_.dl_compact ._cnotif_av_{width:28px;height:28px;font-size:13px;}
._cnotif_.dl_compact ._cnotif_av_ i{font-size:14px!important;}
._cnotif_.dl_compact ._cnotif_title_{font-size:13px;}
._cnotif_.dl_compact ._cnotif_text_{font-size:11px;}
._cnotif_.dl_compact ._upd_bar_{margin-top:5px;}
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
._tgpanel_{position:absolute;inset:0;z-index:50;display:flex;flex-direction:column;background:var(--color-background,#212121);
    box-shadow:-8px 0 28px rgba(0,0,0,.4);transform:translateX(100%);transition:transform .28s cubic-bezier(.32,.72,0,1);}
._tgpanel_._in_{transform:translateX(0);}
/* Push: текущий нативный экран уезжает назад (уменьшается+влево+тускнеет),
   наша панель наезжает поверх — как родная Transition в Настройках. */
#Settings._tgpush_ .Transition__slide--active{transform:scale(.94) translateX(-22%);opacity:.5;
    transition:transform .28s cubic-bezier(.32,.72,0,1),opacity .28s;}
._tgpanel_ .left-header{flex:0 0 auto;}
._tgpanel_ .settings-content{flex:1;overflow-y:auto;background:var(--color-background-secondary,#0f0f0f);}
/* ── App settings panel — native-like widgets ──────────────────────────── */
._tgpanel_ ._ns_lbl_{padding:16px 24px 6px;color:var(--color-text-secondary,#aaa);font-size:13px;}
._tgpanel_ ._ns_card_{background:var(--color-background,#212121);border-radius:12px;margin:0 12px 6px;overflow:hidden;}
._tgpanel_ ._ns_row_{display:flex;align-items:center;gap:16px;min-height:48px;padding:8px 16px;box-sizing:border-box;}
._tgpanel_ ._ns_card_ ._ns_row_+._ns_row_{border-top:1px solid rgba(255,255,255,.06);}
._tgpanel_ ._ns_ico_{font-size:24px;color:var(--color-text-secondary,#aaa);flex-shrink:0;}
._tgpanel_ ._ns_main_{flex:1;min-width:0;}
._tgpanel_ ._ns_title_{font-size:16px;color:#fff;line-height:1.25;}
._tgpanel_ ._ns_sub_{font-size:14px;color:var(--color-text-secondary,#aaa);margin-top:1px;line-height:1.3;}
._tgpanel_ ._ns_val_{font-size:15px;color:var(--color-text-secondary,#aaa);}
._tgpanel_ ._ns_inp_{height:44px;background:var(--color-background,#212121);border:1px solid #5b5b5a;border-radius:12px;color:#fff;font-size:15px;padding:0 14px;box-sizing:border-box;outline:none;}
._tgpanel_ ._ns_inp_:focus{border-color:var(--color-primary,#8774e1);}
._tgpanel_ ._ns_inp_._num_{width:96px;flex:0 0 auto;text-align:right;height:38px;}
._tgpanel_ ._ns_btn_{height:40px;padding:0 16px;border:none;border-radius:10px;background:var(--color-primary,#8774e1);color:#fff;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;}
._tgpanel_ ._ns_btn_:hover{filter:brightness(1.1);}
._tgpanel_ ._ns_btn_.sec{background:rgba(255,255,255,.1);}
._tgpanel_ ._ns_sel_{background:var(--color-background,#212121);border:1px solid #5b5b5a;border-radius:10px;color:#fff;padding:7px 10px;font-size:14px;cursor:pointer;outline:none;}
._tgpanel_ ._ns_swt_{position:relative;width:34px;height:20px;flex-shrink:0;cursor:pointer;}
._tgpanel_ ._ns_swt_ input{display:none;}
._tgpanel_ ._ns_swt_ i{position:absolute;inset:0;background:#5a5a5a;border-radius:10px;transition:.2s;}
._tgpanel_ ._ns_swt_ i::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.2s;}
._tgpanel_ ._ns_swt_ input:checked~i{background:var(--color-primary,#8774e1);}
._tgpanel_ ._ns_swt_ input:checked~i::after{transform:translateX(14px);}
._tgpanel_ ._ns_radio_{position:relative;width:20px;height:20px;border-radius:50%;border:2px solid #5a5a5a;flex-shrink:0;transition:.15s;}
._tgpanel_ ._ns_radio_._on_{border-color:var(--color-primary,#8774e1);}
._tgpanel_ ._ns_radio_._on_::after{content:'';position:absolute;inset:3px;border-radius:50%;background:var(--color-primary,#8774e1);}
._tgpanel_ ._addon_del_{background:none;border:none;color:var(--color-text-secondary,#aaa);cursor:pointer;padding:6px;border-radius:6px;display:flex;flex-shrink:0;}
._tgpanel_ ._addon_del_:hover{background:rgba(229,57,53,.15);color:#e53935;}
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