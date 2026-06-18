'use strict';

const NOTIF_PERM_JS = `(function(){
    function normalizeText(value, fallback) {
        var text = String(value == null ? '' : value).trim();
        return text || fallback;
    }

    var nativeNotification = window.Notification;
    if (!nativeNotification && typeof window.Notification !== 'function') return;

    function ensureBackgroundSupport() {
        try {
            if (!window.PushManager) {
                window.PushManager = function PushManager() {};
            }
            if (!window.PushSubscription) {
                window.PushSubscription = function PushSubscription() {};
            }
            if (!window.ServiceWorkerRegistration) {
                window.ServiceWorkerRegistration = function ServiceWorkerRegistration() {};
            }
            if (!navigator.serviceWorker) {
                var fakeSW = {
                    controller: null,
                    ready: Promise.resolve({
                        scope: location.origin + '/',
                        active: null,
                        installing: null,
                        waiting: null,
                        showNotification: function(t, o) { try { notify(t, o); } catch (e) {} return Promise.resolve(); },
                        getNotifications: function() { return Promise.resolve([]); },
                    }),
                    register: function() {
                        return Promise.resolve({
                            scope: location.origin + '/',
                            active: null,
                            installing: null,
                            waiting: null,
                            pushManager: {
                                getSubscription: function() { return Promise.resolve(null); },
                                subscribe: function() { return Promise.reject(new Error('Push is disabled in this build')); },
                            },
                            showNotification: function(t, o) { try { notify(t, o); } catch (e) {} return Promise.resolve(); },
                            getNotifications: function() { return Promise.resolve([]); },
                            addEventListener: function() {},
                            removeEventListener: function() {},
                            unregister: function() { return Promise.resolve(true); },
                        });
                    },
                    getRegistration: function() {
                        return Promise.resolve(null);
                    },
                    getRegistrations: function() {
                        return Promise.resolve([]);
                    },
                    addEventListener: function() {},
                    removeEventListener: function() {},
                    dispatchEvent: function() { return true; },
                };
                try {
                    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: function() { return fakeSW; } });
                } catch (e) {
                    navigator.serviceWorker = fakeSW;
                }
            }
            if (navigator.permissions && navigator.permissions.query) {
                var nativeQuery = navigator.permissions.query.bind(navigator.permissions);
                navigator.permissions.query = function(desc) {
                    if (desc && (desc.name === 'notifications' || desc.name === 'notification' || desc.name === 'push' || desc.name === 'push-notifications')) {
                        return Promise.resolve({
                            state: 'granted',
                            onchange: null,
                            addEventListener: function() {},
                            removeEventListener: function() {},
                            dispatchEvent: function() { return true; },
                        });
                    }
                    return nativeQuery(desc);
                };
            }
        } catch (e) {}
    }

    ensureBackgroundSupport();

    // Telegram-уведомления (Notification / SW) проглатываем без действий: системное
    // уведомление не показываем, звук и попапы делает перехватчик в UI_JS.
    function notify() {}

    function makeInstance(title, opts) {
        var instance = Object.create(NotificationShim.prototype || Object.prototype);
        instance.title = normalizeText(title, '');
        instance.body = normalizeText(opts && opts.body, '');
        instance.tag = normalizeText(opts && opts.tag, '');
        instance.data = opts && opts.data;
        instance.icon = normalizeText(opts && opts.icon, '');
        instance.lang = normalizeText(opts && opts.lang, '');
        instance.dir = normalizeText(opts && opts.dir, '');
        instance.close = function() {};
        return instance;
    }

    function NotificationShim(title, opts) {
        notify(title, opts);
        return makeInstance(title, opts);
    }

    if (nativeNotification && nativeNotification.prototype) {
        NotificationShim.prototype = nativeNotification.prototype;
    }

    function permissionsResponse() {
        return Promise.resolve({
            state: 'granted',
            onchange: null,
            addEventListener: function() {},
            removeEventListener: function() {},
            dispatchEvent: function() { return true; },
        });
    }

    var proxy = new Proxy(NotificationShim, {
        apply: function(target, thisArg, args) {
            notify(args && args[0], args && args[1]);
            return Object.create(target.prototype || Object.prototype);
        },
        construct: function(target, args) {
            notify(args && args[0], args && args[1]);
            return Object.create(target.prototype || Object.prototype);
        },
        get: function(target, prop) {
            if (prop === 'permission') return 'granted';
            if (prop === 'requestPermission') return function(cb) {
                var p = Promise.resolve('granted');
                if (typeof cb === 'function') p.then(cb);
                return p;
            };
            if (prop === 'maxActions') return 2;
            if (prop === 'prototype') return target.prototype || Object.prototype;
            if (prop === 'name') return 'Notification';
            if (nativeNotification && prop in nativeNotification) {
                var v = nativeNotification[prop];
                return typeof v === 'function' ? v.bind(nativeNotification) : v;
            }
            return target[prop];
        },
        set: function(target, prop, value) {
            if (prop === 'permission') return true;
            target[prop] = value;
            return true;
        },
    });

    try {
        Object.defineProperty(window, 'Notification', { configurable: true, get: function() { return proxy; } });
    } catch (e) {
        window.Notification = proxy;
    }

    try {
        if (navigator.permissions && navigator.permissions.query) {
            var nativeQuery2 = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = function(desc) {
                if (desc && (desc.name === 'notifications' || desc.name === 'notification')) {
                    return permissionsResponse();
                }
                return nativeQuery2(desc);
            };
        }
    } catch (e) {}
})();`

const AUDIO_JS = `(function(){
    function keepAudioAlive() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            const ctx = new AC();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.00001;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            setInterval(() => {
                if (ctx.state === 'suspended') ctx.resume();
            }, 1000);
        } catch(e) {}
    }
    if (document.readyState === 'complete') keepAudioAlive();
    else window.addEventListener('load', keepAudioAlive);
})();`;

const EXTERNAL_JS = `(function(){
    const ALLOWED=["telegram.org","web.telegram.org","t.me","telegram.me","core.telegram.org","api.telegram.org","td.telegram.org"];
    for(let i=0;i<12;i++) ALLOWED.push('cdn'+i+'.telegram.org');
    ALLOWED.push("translations.telegram.org");
    function allowed(h){h=h.replace(/^www\\./,"");return ALLOWED.some(a=>h===a||h.endsWith("."+a));}
    document.addEventListener("click",e=>{
        let a=e.target.closest("a");
        if(a&&a.href){try{let u=new URL(a.href);if(!allowed(u.host)){e.preventDefault();e.stopImmediatePropagation();window.tgBridge.invoke("open_url",{url:a.href});}}catch(e){}}
    },{capture:false});
    const o=window.open;
    window.open=function(u){
        if(typeof u==="string"){try{let url=new URL(u);if(!allowed(url.host)){window.tgBridge.invoke("open_url",{url:u});return null;}}catch(e){}}
        return o.apply(this,arguments);
    };
})();`;

const UI_JS = `(function(){
const INV=(cmd,args)=>window.tgBridge.invoke(cmd,args);
const CSS=\`
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
.File[data-tgdl-done="1"] .action-icon{display:none!important;}
.File[data-tgdl-done="1"] .file-icon-container{position:relative;}
._tgdl_ok_{position:absolute;right:-3px;bottom:-3px;width:20px;height:20px;padding:0;
    border:none;border-radius:50%;background:#4caf50;display:flex;align-items:center;
    justify-content:center;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.45);
    z-index:3;transition:transform .12s;}
._tgdl_ok_:hover{transform:scale(1.12);}
._tgdl_ok_ svg{width:13px;height:13px;}
/* Менеджер загрузок (модалка вместо выезжающей панели) */
._dmdlg_{width:420px;max-width:calc(100vw - 48px);max-height:min(70vh,560px);}
._dmhdr_{display:flex;align-items:center;justify-content:space-between;padding:14px 20px 10px;}
._dmhdr_ .modal-title{font-size:16px;font-weight:600;color:#fff;}
._dmhdr_ .dm-actions{display:flex;gap:6px;}
._dmhdr_ .dm-clr{background:rgba(229,57,53,.15);border:none;color:#e53935;font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;}
._dmhdr_ .dm-clr:hover{background:rgba(229,57,53,.28);}
._dmlist_{overflow-y:auto;padding:0 8px 12px;flex:1;}
._dmlist_::-webkit-scrollbar{width:6px;}
._dmlist_::-webkit-scrollbar-thumb{background:#333;border-radius:3px;}
._dmrow_{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;cursor:default;transition:background .15s;}
._dmrow_.done{cursor:pointer;}
._dmrow_.done:hover{background:rgba(255,255,255,.04);}
._dmrow_.downloading,.dmrow_.failed{cursor:default;}
._dmico_{width:40px;height:40px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;position:relative;overflow:hidden;background:#2b5278;}
._dmico_ .ext{z-index:2;}
._dmico_ .prog-ring{position:absolute;inset:0;border-radius:50%;background:conic-gradient(#5288c1 var(--p,0%),rgba(255,255,255,.12) 0);}
._dmbody_{flex:1;min-width:0;}
._dmname_{color:#fff;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
._dmstat_{color:var(--color-text-secondary,#aaa);font-size:11px;margin-top:2px;}
._dmact_{display:flex;gap:4px;flex-shrink:0;}
._dmact_ button{background:none;border:none;color:var(--color-text-secondary,#aaa);cursor:pointer;padding:6px;border-radius:6px;display:flex;align-items:center;justify-content:center;}
._dmact_ button:hover{background:rgba(255,255,255,.08);color:#fff;}
._dmact_ button.danger:hover{color:#e53935;}
._dmact_ button svg{width:16px;height:16px;}
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
\`;

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
if(!window.tgBridge) {
    // нет моста — ничего не поделаешь
} else {
const DL = window.__tgdl = (function(){
    // pending[filename] = [mid,...]  — кликнули, ждём start от main
    const pending = {};
    // registry[mid] = { id, filename, status, recv, total }
    // registryById[id] = mid
    const registry = {};
    const byId = {};
    // filename→mids, которые уже скачаны (для re-download: повторный клик)
    const doneFn = {};  // doneFn[mid] = filename

    function fmtBytes(b){
        if(b==null)return '';
        if(b<1024)return b+' B';
        if(b<1048576)return (b/1024).toFixed(1)+' KB';
        if(b<1073741824)return (b/1048576).toFixed(1)+' MB';
        return (b/1073741824).toFixed(2)+' GB';
    }
    function fmtProgress(recv,total){
        if(!total)return recv?fmtBytes(recv):'…';
        const pct=Math.round(recv/total*100);
        return fmtBytes(recv)+' / '+fmtBytes(total)+' · '+pct+'%';
    }

    // Renderer-side: запомнить что кликнули файл с mid/filename.
    // Вызывается на capture-клике по .File. Идемпотентен для повторных кликов.
    function expectDownload(mid, filename){
        if(!mid||!filename)return;
        (pending[filename] = pending[filename] || []).push(mid);
        // сразу покажем состояние «ожидание» на сообщении
        registry[mid] = Object.assign(registry[mid]||{}, {mid, filename, status:'pending'});
        applyToMessage(mid);
    }

    // Main шлёт download-event. Связываем filename→mid.
    function onEvent(data){
        if(!data)return;
        if(data.type==='start'){
            // матчится по filename; если несколько одинаковых — берём последний
            const mids = pending[data.filename];
            let mid = mids && mids.length ? mids.pop() : null;
            if(!mid){
                // нет клика в renderer — возможно ПЕРЕКАЧКА уже скачанного файла
                // через родное ПКМ-меню TG (его НЕ трогаем). Ищем mid по имени
                // среди завершённых — туда вернём состояние «качается».
                for(const m in doneFn){ if(doneFn[m]===data.filename){ mid=m; break; } }
            }
            if(!mid){
                // совсем не наше (инициировано не из чата) — покажется только в модалке
                mid = '__noid__'+data.id;
            }
            // перекачка: снимаем оверлей «открыть», пусть снова идёт нативный прогресс TG
            if(registry[mid] && registry[mid].status==='completed') unpaint(mid);
            delete doneFn[mid];
            registry[mid] = { mid, id:data.id, filename:data.filename, status:'downloading', recv:0, total:0 };
            byId[data.id] = mid;
            applyToMessage(mid);
        } else if(data.type==='progress'){
            const mid = byId[data.id]; if(!mid)return;
            const r = registry[mid]; if(!r)return;
            r.recv = data.received||0; r.total = data.total||0;
            applyToMessage(mid);
        } else if(data.type==='done'){
            const mid = byId[data.id]; if(!mid)return;
            const r = registry[mid]; if(!r)return;
            r.status = data.status==='completed' ? 'completed' : 'failed';
            applyToMessage(mid);
            if(r.filename) doneFn[mid] = r.filename;
        }
        // модалка, если открыта — обновим
        if(window.__dlModalOpen) refreshDlModal();
    }

    // ── In-message overlay ───────────────────────────────────────────────
    // .file-icon-container стабилен; кладём туда наш ._tgdl-ov_. Идемпотентно.
    function applyToMessage(mid){
        if(!mid || mid.indexOf('__noid__')===0) return;   // не привязано к сообщению
        const r = registry[mid]; if(!r)return;
        const msg = document.querySelector('.Message[data-message-id="'+mid+'"]');
        if(!msg) return;                                   // виртуализировано — пропустим, интервал доберёт
        paintMessage(msg, r);
    }
    // ВАЖНО: родные ноды TG (.action-icon, .file-icon) НЕ мутируем — иначе ломается
    // кнопка скачивания и hover-анимация «ушка». Только накладываем свои оверлеи
    // и прячем родную стрелку через CSS (обратимо: снимаем data-атрибут).
    function paintMessage(msg, r){
        const file = msg.querySelector('.File'); if(!file)return;
        if(r.status==='completed'){
            file.dataset.tgdlDone='1';
            file.dataset.tgdlId = r.id!=null ? String(r.id) : (file.dataset.tgdlId||'');
            file.dataset.tgdlMid = r.mid;
            ensureBadges(file);
        } else {
            // pending/downloading/failed — никаких оверлеев, нативный прогресс TG сам
            file.removeAttribute('data-tgdl-done');
            clearBadges(file);
        }
    }

    // Зелёная галочка в углу (скачано; клик = открыть файл). «Открыть папку» — в
    // родном ПКМ-меню (см. injectFolderMenuItem). Кладём в .file-icon-container.
    function ensureBadges(file){
        const cont = file.querySelector('.file-icon-container'); if(!cont)return;
        if(cont.querySelector('._tgdl_ok_')) return;          // уже стоит — идемпотентно
        const ok = document.createElement('button');
        ok.className='_tgdl_ok_'; ok.title='Открыть файл';
        ok.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4 10-10" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        ok.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();const id=parseInt(file.dataset.tgdlId,10);if(id)INV('open_download_file',{id}).then(function(r){if(r&&r.error)toast('Файл не найден — возможно, перемещён или удалён');}).catch(function(){});});
        cont.appendChild(ok);
    }
    function clearBadges(file){
        const cont = file.querySelector('.file-icon-container'); if(!cont)return;
        const a=cont.querySelector('._tgdl_ok_'); if(a)a.remove();
    }

    // Перекачка: снимаем оверлей, возвращаем родную стрелку (CSS), не трогаем ПКМ-меню.
    function unpaint(mid){
        const msg = document.querySelector('.Message[data-message-id="'+mid+'"]');
        if(!msg) return;
        const file = msg.querySelector('.File'); if(!file) return;
        file.removeAttribute('data-tgdl-done');
        file.removeAttribute('data-tgdl-id');
        file.removeAttribute('data-tgdl-mid');
        clearBadges(file);
    }

    // Переприменяем состояние ко всем сообщениям из реестра (идемпотентно).
    function scanMessages(){
        for(const mid in registry){ applyToMessage(mid); }
    }
    // Страховочный таймер (виртуализация/редкие случаи).
    setInterval(scanMessages, 600);
    // TG перерисовывает .action-icon после своей загрузки и при повторном входе в
    // диалог — затирая наш оверлей. MutationObserver ловит перерисовку и сразу
    // переприменяет, без задержки таймера. Дебаунс 50мс; paint идемпотентен
    // (повторный проход не мутирует DOM → не зациклится).
    let _moT=null;
    const _mo=new MutationObserver(function(){
        if(_moT)return;
        _moT=setTimeout(function(){_moT=null;scanMessages();injectFolderMenuItem();},50);
    });
    (function startMO(){
        if(document.body) _mo.observe(document.body,{childList:true,subtree:true});
        else setTimeout(startMO,200);
    })();

    // ── Клик-перехват на .File (capture) ─────────────────────────────────
    // Ловим mid+filename до того, как TG начнёт скачивание. Не блокируем клик —
    // пусть TG создаст blob: и отправит его в will-download.
    document.addEventListener('mousedown', function(e){
        if(e.button!==0) return;                  // только ЛКМ; ПКМ → contextmenu
        // клик по нашим оверлей-кнопкам обрабатывает их собственный handler —
        // иначе откроется дважды (кнопка + этот хэндлер по .File)
        if(e.target.closest && e.target.closest('._tgdl_ok_,._tgdl_dir_')) return;
        const file = e.target.closest && e.target.closest('.File');
        if(!file)return;
        const msg = file.closest('[data-message-id]');
        if(!msg)return;
        const mid = msg.getAttribute('data-message-id');
        // filename из .file-title (атрибут title = полное имя)
        const t = file.querySelector('.file-title');
        const filename = t ? (t.getAttribute('title')||t.textContent||'').trim() : '';
        // уже скачано? — откроем файл вместо перекачки (ЛКМ)
        if(file.dataset.tgdlDone==='1'){
            e.preventDefault(); e.stopImmediatePropagation();
            const id = parseInt(file.dataset.tgdlId,10);
            if(id) INV('open_download_file',{id}).then(function(r){if(r&&r.error)toast('Файл не найден — возможно, перемещён или удалён');}).catch(function(){});
            return;
        }
        if(filename) expectDownload(mid, filename);
    }, true);

    // ПКМ по .File: (1) запоминаем кандидата для матчинга, если из РОДНОГО меню
    // выберут «Скачать»; (2) если файл уже скачан — запоминаем его id, чтобы добавить
    // в это меню пункт «Открыть папку». Само меню TG не пересобираем — только
    // дорисовываем один родного вида пункт (injectFolderMenuItem).
    let lastCtx = {id:0, ts:0};
    document.addEventListener('contextmenu', function(e){
        lastCtx = {id:0, ts:0};                    // сброс: вдруг ПКМ не по скачанному
        const file = e.target.closest && e.target.closest('.File');
        if(!file)return;
        const msg = file.closest('[data-message-id]'); if(!msg)return;
        const mid = msg.getAttribute('data-message-id');
        const t = file.querySelector('.file-title');
        const filename = t ? (t.getAttribute('title')||t.textContent||'').trim() : '';
        if(filename) (pending[filename] = pending[filename] || []).push(mid);
        if(file.dataset.tgdlDone==='1' && file.dataset.tgdlId){
            lastCtx = {id:parseInt(file.dataset.tgdlId,10), ts:Date.now()};
        }
    }, true);

    // Дорисовываем «Открыть папку» в родное меню сообщения — только если ПКМ был
    // по скачанному файлу (≤2.5с назад). Стиль/иконку берём как у родных пунктов.
    function injectFolderMenuItem(){
        if(!lastCtx.id || Date.now()-lastCtx.ts>2500) return;
        const items = document.querySelector('.MessageContextMenu_items');
        if(!items || items.querySelector('._tgdl_openfolder_')) return;
        const id = lastCtx.id;
        const it = document.createElement('div');
        it.className='MenuItem compact _tgdl_openfolder_';
        it.setAttribute('role','menuitem'); it.tabIndex=0;
        it.innerHTML='<i class="icon" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" width="1.4rem" height="1.4rem" fill="currentColor" style="display:block"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg></i>Открыть папку';
        it.addEventListener('click',function(e){
            e.preventDefault(); e.stopPropagation();
            INV('open_download_folder',{id:id}).then(function(r){if(r&&r.error)toast('Файл не найден — возможно, перемещён или удалён');}).catch(function(){});
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,which:27,bubbles:true}));
        });
        // после пункта «Скачать» (иконка icon-download), иначе в конец
        let after=null;
        [].forEach.call(items.querySelectorAll('.MenuItem'),function(m){ if(m.querySelector('.icon-download')) after=m; });
        if(after) items.insertBefore(it, after.nextSibling);
        else items.appendChild(it);
    }

    window.tgBridge.onDownloadEvent(onEvent);

    return { registry, byId, fmtBytes, fmtProgress, expectDownload };
})();
} // end if(window.tgBridge) — блок реестра загрузок

// ── Глобальные помощники для модалки/формата ──────────────────────────────
function _fmtBytes_dl(b){ return window.__tgdl ? window.__tgdl.fmtBytes(b) : ''; }
// ──────────────────────────────────────────────────────────────────────────

// ── Синхронизация и разблокировка Telegram-уведомлений ────────────────────
function setupNotificationSettingsSync() {
    function savePatch(patch) {
        return INV('get_settings').then(function(s) {
            return INV('save_settings', { settings: Object.assign({}, s || {}, patch) });
        }).catch(function() {});
    }

    function normalizeText(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    function findSettingRow(pattern) {
        var candidates = Array.from(document.querySelectorAll('label, button, div, span, li, a, .Row, .row, .ListItem, .MenuItem'));
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            var text = normalizeText(el.textContent || '');
            if (!text || !pattern.test(text)) continue;

            var node = el;
            for (var depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
                if (node && typeof node.querySelector === 'function' && node.querySelector('input[type="checkbox"]')) {
                    return node;
                }
            }

            var parent = el.parentElement;
            if (parent && typeof parent.querySelector === 'function' && parent.querySelector('input[type="checkbox"]')) {
                return parent;
            }
        }
        return null;
    }

    function unlockRow(row) {
        if (!row) return null;
        row.style.pointerEvents = 'auto';
        row.style.opacity = '1';
        row.style.cursor = 'pointer';
        row.removeAttribute('aria-disabled');
        row.removeAttribute('disabled');
        row.classList.remove('disabled', 'is-disabled', 'locked');
        row.querySelectorAll('[aria-disabled="true"]').forEach(function(el) { el.removeAttribute('aria-disabled'); });
        row.querySelectorAll('[disabled]').forEach(function(el) { el.disabled = false; el.removeAttribute('disabled'); });
        row.querySelectorAll('input[type="checkbox"]').forEach(function(input) {
            input.disabled = false;
            input.style.pointerEvents = 'auto';
            input.tabIndex = 0;
        });
        Array.from(row.querySelectorAll('div, span')).forEach(function(el) {
            if (/не поддерживается/i.test(normalizeText(el.textContent || ''))) {
                el.textContent = '';
            }
        });
        return row;
    }

    function bindRow(row, key) {
        if (!row || row.dataset.tgNotifBound === '1') return;
        row.dataset.tgNotifBound = '1';
        unlockRow(row);

        var input = row.querySelector('input[type="checkbox"]');
        if (!input) return;

        input.disabled = false;
        input.tabIndex = 0;
        input.style.pointerEvents = 'auto';

        INV('get_settings').then(function(s) {
            if (!s) return;
            if (key === 'web' && typeof s.popup_notifications !== 'undefined') input.checked = !!s.popup_notifications;
            if (key === 'background' && typeof s.background_notifications_enabled !== 'undefined') input.checked = !!s.background_notifications_enabled;
        }).catch(function() {});

        var apply = function(nextValue) {
            input.checked = !!nextValue;
            var patch = {};
            if (key === 'web') patch.popup_notifications = !!input.checked;
            if (key === 'background') patch.background_notifications_enabled = !!input.checked;
            savePatch(patch);
        };

        input.addEventListener('change', function() {
            apply(input.checked);
        }, true);

        row.addEventListener('click', function(e) {
            var interactive = e.target && e.target.closest && e.target.closest('button,a,input,label');
            if (interactive && interactive !== row) return;
            apply(!input.checked);
            e.preventDefault();
            e.stopPropagation();
        }, true);
    }

    // ── Наш блок настроек уведомлений в нативных Настройках→Уведомления ──────
    // Вставляется самым первым ребёнком .settings-content (над блоком ТГ).
    // Идемпотентно (id=_tgnotif_block_). Перестраивается только при первом
    // появлении; состояние тумблеров синхронизируем с настройками на каждом scan.
    // Находит заголовок секции «Веб-уведомления» — прямой ребёнок .settings-content.
    // Классы TG хэшированы и меняются между сборками, поэтому цепляемся к ТЕКСТУ
    // (RU + EN). Возвращает элемент-заголовок или null.
    function findWebNotifHeader(sc) {
        var kids = sc.children;
        for (var i = 0; i < kids.length; i++) {
            var t = (kids[i].textContent || '').trim();
            if (/^(Веб-уведомления|Web notifications)$/i.test(t)) return kids[i];
        }
        return null;
    }

    // Строит нашу секцию КЛОНИРУЯ нативные узлы TG (тумблер .Checkbox, ползунок
    // .RangeSlider, заголовок секции). Это даёт точный нативный вид без своих
    // стилей и переживает смену хэшированных классов между сборками.
    function injectNotifBlock() {
        var sc = document.querySelector('.settings-content');
        if (!sc) return;
        if (sc.querySelector('#_tgnf_hdr_')) return;            // уже вставлено
        var header = findWebNotifHeader(sc);
        if (!header) return;                                    // не раздел «Уведомления»
        var body = header.nextElementSibling;
        if (!body) return;
        var nativeToggle = body.querySelector('label.Checkbox');
        var nativeSlider = body.querySelector('.RangeSlider');
        if (!nativeToggle) return;                              // нет образца — не рискуем

        var card = document.createElement('div');
        card.className = body.className;                        // тот же класс-карточка (хэш живьём)

        var inputs = {};

        function addToggle(key, labelText) {
            var n = nativeToggle.cloneNode(true);
            n.classList.remove('withSubLabel');
            var sub = n.querySelector('.subLabel'); if (sub) sub.remove();
            var av = n.querySelector('.user-avatar'); if (av) av.remove();
            var lab = n.querySelector('.label'); if (lab) lab.textContent = labelText;
            var inp = n.querySelector('input[type=checkbox]');
            inp.checked = false; inp.removeAttribute('id');
            inp.addEventListener('change', function () {
                var p = {}; p[key] = !!inp.checked; savePatch(p);
            });
            card.appendChild(n);
            inputs[key] = inp;
        }

        function addSlider(key, labelText, min, max, def, fmt, toSetting) {
            if (!nativeSlider) return;
            var n = nativeSlider.cloneNode(true);
            var lab = n.querySelector('.slider-top-row .label'); if (lab) lab.textContent = labelText;
            var valEl = n.querySelector('.slider-top-row .value');
            var fill = n.querySelector('.slider-fill-track');
            var inp = n.querySelector('input[type=range]');
            inp.min = min; inp.max = max; inp.step = 1; inp.value = def; inp.removeAttribute('id');
            function refresh() {
                var v = parseInt(inp.value, 10);
                if (fill) fill.style.width = ((v - min) / (max - min) * 100) + '%';
                if (valEl) valEl.textContent = fmt(v);
            }
            refresh();
            inp.addEventListener('input', refresh);
            var t = null;
            inp.addEventListener('change', function () {
                clearTimeout(t);
                t = setTimeout(function () { savePatch(toSetting(parseInt(inp.value, 10))); }, 150);
            });
            card.appendChild(n);
            inputs[key] = { input: inp, refresh: refresh };
        }

        addToggle('popup_notifications', 'Показывать всплывающие карточки');
        addToggle('notif_sound', 'Звук уведомлений');
        // Громкость отдельную не делаем — берём из TG «Громкость звука» (см. syncTgVolume).
        addSlider('notif_duration', 'Время на экране', 3, 20, 6,
            function (v) { return v + ' с'; },
            function (v) { return { notif_duration: v }; });
        addToggle('notif_cat_private', 'Личные чаты');
        addToggle('notif_cat_group', 'Группы');
        addToggle('notif_cat_channel', 'Каналы');

        // Заголовок-категория: клон нативного заголовка с нашим текстом.
        var hdr = header.cloneNode(false);
        hdr.id = '_tgnf_hdr_';
        hdr.textContent = 'Всплывающие уведомления';

        // Вставляем сразу ПОСЛЕ секции «Веб-уведомления»: заголовок, затем карточка.
        var ref = body.nextSibling;
        sc.insertBefore(hdr, ref);
        sc.insertBefore(card, ref);

        // Начальные значения из настроек.
        INV('get_settings').then(function (s) {
            if (!s) return;
            inputs.popup_notifications.checked = s.popup_notifications !== false;
            inputs.notif_sound.checked = s.notif_sound !== false;
            inputs.notif_cat_private.checked = s.notif_cat_private !== false;
            inputs.notif_cat_group.checked = s.notif_cat_group !== false;
            inputs.notif_cat_channel.checked = s.notif_cat_channel !== false;
            if (inputs.notif_duration) {
                var d = parseInt(s.notif_duration, 10); if (isNaN(d)) d = 6;
                inputs.notif_duration.input.value = d; inputs.notif_duration.refresh();
            }
        }).catch(function () {});
    }

    // Подхватываем громкость из нативного слайдера TG «Громкость звука» (0..max)
    // и кладём в notif_volume (0..1) — чтобы у попапа не было своего дубля.
    // Доступно только когда открыты Настройки→Уведомления; иначе используем кэш.
    var _lastTgVol = null;
    function syncTgVolume() {
        var sc = document.querySelector('.settings-content');
        if (!sc) return;
        var sliders = sc.querySelectorAll('.RangeSlider');
        var inp = null;
        for (var i = 0; i < sliders.length; i++) {
            var lab = sliders[i].querySelector('.slider-top-row .label');
            if (lab && /Громкость|Volume/i.test(lab.textContent)) {
                inp = sliders[i].querySelector('input[type=range]');
                if (inp) break;
            }
        }
        if (!inp) return;
        var v = parseInt(inp.value, 10);
        var max = parseInt(inp.max, 10) || 10;
        if (isNaN(v) || !max) return;
        var norm = Math.max(0, Math.min(1, v / max));
        if (_lastTgVol === norm) return;
        _lastTgVol = norm;
        savePatch({ notif_volume: norm });
    }

    function scan() {
        // Наш блок настроек + синхронизация громкости из TG. Галку «Веб-уведомления»
        // не трогаем: звук/попапы работают независимо (см. setupIncomingSound).
        injectNotifBlock();
        syncTgVolume();
    }

    scan();
    setInterval(scan, 500);
}

// ─── Хинт: как включить звуковые уведомления ───────────────────────────────
async function showWebNotifHintIfNeeded() {
    try {
        const s = await INV('get_settings');
        if (s.webnotif_hint_shown) return;
        showModal({
            title: 'Звуковые уведомления',
            msg: 'Чтобы включить всплывающие уведомления и звук, перейдите в<br><b>Настройки → Уведомления → Веб-уведомления</b><br>и включите галочку.',
            checkLabel: 'Не показывать снова',
            okText: 'ЗАКРЫТЬ',
            cancelText: null,
            onOk: async (checked) => {
                if (checked) {
                    try {
                        const ss = await INV('get_settings');
                        await INV('save_settings', { settings: Object.assign({}, ss, { webnotif_hint_shown: true }) });
                    } catch(e) {}
                }
            },
        });
    } catch(e) {}
}
// ───────────────────────────────────────────────────────────────────────────

function showModal({title,msg,url,checkLabel,okText,okDanger,cancelText,onOk,onCancel,extraBtn,onExtra}){
    const mo=document.createElement('div');mo.className='_mo_';
    let cbHtml=checkLabel?'<label class="_cbx_" id="_mo_cb_l_"><input type="checkbox" id="_mo_cb_"><span class="box"></span><span class="label" style="color:#ccc;font-size:13px;">'+checkLabel+'</span></label>':'';
    let urlHtml=url?'<div class="_url_">'+url+'</div>':'';
    const hasCancelBtn = cancelText !== null;
    const cancelHtml = hasCancelBtn ? '<button class="Button" id="_mo_cn_">'+(cancelText||'ОТМЕНА')+'</button>' : '';
    const extraHtml = extraBtn ? '<button class="Button'+(extraBtn.danger?' danger':'')+'" id="_mo_ex_">'+extraBtn.label+'</button>' : '';
    mo.innerHTML='<div class="modal-dialog"><div class="modal-header"><div class="modal-title">'+title+'</div></div><div class="modal-content"><div class="_msg_">'+msg+'</div>'+urlHtml+cbHtml+'<div class="dialog-buttons">'+cancelHtml+extraHtml+'<button class="Button'+(okDanger?' danger':'')+'" id="_mo_ok_">'+(okText||'OK')+'</button></div></div></div>';
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

function sLabel(s){return{pending:'Ожидание…',downloading:'⬇ Загружается',completed:'✓ Завершено',failed:'✕ Ошибка',cancelled:'— Отменено'}[s]||s;}
function sColor(s){return{pending:'#aaa',downloading:'var(--color-primary,#5288c1)',completed:'#4caf50',failed:'#e53935',cancelled:'#aaa'}[s]||'#aaa';}

// Расширение файла → цвет иконки (упрощённая палитра TG)
function _fileExt(name){ var m=(name||'').match(/\.([a-z0-9]+)$/i); return m?m[1].toLowerCase():''; }
function _extColor(ext){
    return ({
        zip:'#c77b41',rar:'#7e57c2','7z':'#5288c1',gz:'#66bb6a',tar:'#8d6e63',
        exe:'#e53935',msi:'#ef6c00',dmg:'#42a5f5',apk:'#8bc34a',deb:'#ef5350',
        pdf:'#e53935',doc:'#2b5278',docx:'#2b5278',xls:'#4caf50',xlsx:'#4caf50',
        ppt:'#ff9800',pptx:'#ff9800',
        mp3:'#ec407a',wav:'#ec407a',flac:'#ec407a',ogg:'#ec407a',
        mp4:'#5c6bc0',mov:'#5c6bc0',avi:'#5c6bc0',mkv:'#5c6bc0',
        jpg:'#ffa726',jpeg:'#ffa726',png:'#ffa726',gif:'#ffa726',webp:'#ffa726',svg:'#ffa726',
        txt:'#90a4ae',js:'#fdd835',ts:'#5288c1',json:'#fdd835',
    })[ext]||'#5288c1';
}

// ── Модалка «Загрузки» (#5): Telegram-style, reusing showModal styling ─────
let _dlModal=null;
function openDownloadsModal(){
    if(_dlModal){ _dlModal.remove(); _dlModal=null; }
    const mo=document.createElement('div');mo.className='_mo_';
    mo.innerHTML=(
        '<div class="modal-dialog _dmdlg_">'+
            '<div class="_dmhdr_">'+
                '<div class="modal-title">Загрузки</div>'+
                '<div class="dm-actions"><button class="dm-clr" id="_dmclr_"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Очистить</button></div>'+
            '</div>'+
            '<div class="_dmlist_" id="_dmlist_"></div>'+
        '</div>'
    );
    document.body.appendChild(mo);
    _dlModal=mo;
    window.__dlModalOpen=true;
    const close=()=>{ window.__dlModalOpen=false; _dlModal=null; mo.remove(); };
    mo.addEventListener('click',e=>{ if(e.target===mo) close(); });
    const clr=mo.querySelector('#_dmclr_');
    if(clr)clr.addEventListener('click',async()=>{
        showModal({
            title:'Очистить загрузки',msg:'Удалить все записи загрузок?<br><small style="color:#aaa">Файлы на диске также будут удалены.</small>',
            okText:'ОЧИСТИТЬ',okDanger:true,
            onOk:async()=>{
                const items=await INV('get_downloads');
                for(const d of (items||[])) await INV('delete_download',{id:d.id});
                refreshDlModal();
            }
        });
    });
    refreshDlModal();
    // live-refresh while open
    _dlModal._timer=setInterval(()=>{ if(_dlModal) refreshDlModal(); else clearInterval(_dlModal&&_dlModal._timer); }, 700);
    const origClose=close;
    // ensure timer cleared on any close path
    const _t=_dlModal._timer;
    const _cleanup=()=>{ clearInterval(_t); };
    mo.addEventListener('remove',_cleanup);
    // intercept removal
    const obs=new MutationObserver(()=>{ if(!document.body.contains(mo)){ _cleanup(); obs.disconnect(); } });
    obs.observe(document.body,{childList:true,subtree:false});
}

// Объединяет активные (registry) + сохранённые (get_downloads), без дублей по id.
async function refreshDlModal(){
    const list=_dlModal?_dlModal.querySelector('#_dmlist_'):null;
    if(!list)return;
    // активные in-flight из registry (по mid)
    const active=[];
    const reg=window.__tgdl?window.__tgdl.registry:{};
    const byId=window.__tgdl?window.__tgdl.byId:{};
    const seenIds={};
    for(const mid in reg){
        const r=reg[mid];
        if(r.status==='completed'||r.status==='failed'){
            // завершённые из registry тоже покажем, но get_downloads может их уже не иметь сразу
        }
        if(r.id!=null){ seenIds[r.id]=true; }
        active.push({ id:r.id, mid:r.mid, filename:r.filename, status:r.status, recv:r.recv, total:r.total, live:true });
    }
    let saved=[];
    try{ saved=await INV('get_downloads'); }catch(e){}
    saved=saved||[];
    // объединяем: сохранённые (кроме активных live-загрузок) + активные
    const merged=[];
    saved.slice().reverse().forEach(d=>{ if(!seenIds[d.id]) merged.push(Object.assign({},d,{live:false})); });
    // активные — сверху
    active.forEach(d=>{ const s=saved.find(x=>x.id===d.id); if(s) d.path=s.path; merged.unshift(d); });
    // дедуп по filename+status для отображения
    list.innerHTML='';
    if(!merged.length){ list.innerHTML='<div class="_empty_">Нет загрузок</div>'; return; }
    merged.forEach(d=>{ list.appendChild(_dmRow(d)); });
}

function _dmRow(d){
    const div=document.createElement('div');
    const done=d.status==='completed';
    const active=d.status==='downloading'||d.status==='pending';
    const failed=d.status==='failed';
    div.className='_dmrow_'+(done?' done':'')+(active?' downloading':'')+(failed?' failed':'');
    div.dataset.id = d.id!=null?String(d.id):'';
    const ext=_fileExt(d.filename);
    const ico=document.createElement('div');ico.className='_dmico_';
    ico.style.background=_extColor(ext);
    if(active){
        const pct=(d.total&&d.recv!=null)?Math.min(100,Math.round(d.recv/d.total*100)):0;
        ico.innerHTML='<div class="prog-ring" style="--p:'+(d.total?pct:25)+'%"></div><span class="ext">'+(ext||'?').slice(0,4)+'</span>';
    } else if(failed){
        ico.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>';
    } else {
        ico.innerHTML='<span class="ext">'+(ext||'?').slice(0,4)+'</span>';
    }
    const body=document.createElement('div');body.className='_dmbody_';
    const name=document.createElement('div');name.className='_dmname_';name.textContent=d.filename||'(без имени)';
    const stat=document.createElement('div');stat.className='_dmstat_';stat.style.color=sColor(d.status);
    if(active){
        const fmt=window.__tgdl&&window.__tgdl.fmtProgress||function(){return '';};
        stat.textContent=d.status==='pending'?'Ожидание…':fmt(d.recv,d.total);
    } else if(done){
        stat.textContent='Завершено'+(d.path?(' · '+d.filename):'');
    } else {
        stat.textContent=sLabel(d.status);
    }
    body.appendChild(name);body.appendChild(stat);
    const act=document.createElement('div');act.className='_dmact_';
    if(done&&d.id!=null){
        const open=document.createElement('button');open.title='Открыть';
        open.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4 10-10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        open.addEventListener('click',()=>INV('open_download_file',{id:d.id}).catch(()=>{}));
        act.appendChild(open);
        const fld=document.createElement('button');fld.title='Показать в папке';
        fld.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
        fld.addEventListener('click',()=>INV('open_download_folder',{id:d.id}).catch(()=>{}));
        act.appendChild(fld);
    }
    if(d.id!=null){
        const del=document.createElement('button');del.className='danger';del.title='Удалить';
        del.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        del.addEventListener('click',()=>{showModal({title:'Удалить загрузку',msg:'Удалить «'+(d.filename||'')+'»?<br><small style="color:#aaa">Файл также будет удалён с диска.</small>',okText:'УДАЛИТЬ',okDanger:true,onOk:async()=>{await INV('delete_download',{id:d.id});refreshDlModal();}});});
        act.appendChild(del);
    }
    div.appendChild(ico);div.appendChild(body);div.appendChild(act);
    if(done&&d.id!=null){
        div.addEventListener('click',e=>{ if(e.target.closest('button'))return; INV('open_download_file',{id:d.id}).catch(()=>{}); });
    }
    return div;
}

let _saveTimer=null;
function scheduleSave(){
    clearTimeout(_saveTimer);
    _saveTimer=setTimeout(async()=>{
        const c=document.getElementById('_tgst_c');if(!c)return;
        const G=id=>c.querySelector('#'+id);
        const sp=G('_sp_');const are=G('_are_');const ari=G('_ari_');const aro=G('_aro_');const it=G('_it_');const tr=G('_tr_');const dv=G('_dv_');
        if(!are)return;
        const settings={save_path:sp&&sp.value||null,auto_reload_enabled:are.checked,auto_reload_interval:parseInt(ari.value)||3600,auto_reload_on_idle:aro.checked,idle_timeout:parseInt(it.value)||300,minimize_to_tray:tr.checked,devtools_enabled:dv&&dv.checked};
        try{await INV('save_settings',{settings});toast('Настройки сохранены','icon-check');}catch(e){toast('Ошибка сохранения','icon-close');}
    },600);
}

async function renderSt(){
    const c=document.getElementById('_tgst_c');if(!c)return;
    c.innerHTML='<div class="_empty_">Загрузка...</div>';
    let s={};
    try{s=await INV('get_settings');}catch(e){c.innerHTML='<div class="_empty_">Ошибка: '+e+'</div>';return;}
    c.innerHTML='';
    function si(t){const d=document.createElement('div');d.className='_si_';d.textContent=t;c.appendChild(d);}
    function sect(){const d=document.createElement('div');d.className='_sect_';c.appendChild(d);return d;}
    function it(sec,html){const d=document.createElement('div');d.className='_it_';d.innerHTML=html;sec.appendChild(d);return d;}
    function cbx(id,label,checked){return '<label class="_cbx_"><input type="checkbox" id="'+id+'" '+(checked?'checked':'')+'><span class="box"></span><span class="label">'+label+'</span></label>';}
    function inp(id,val,type,min,flex){return '<input class="_inp_" id="'+id+'" type="'+(type||'text')+'" value="'+(val||'')+'" '+(min?'min="'+min+'"':'')+' '+(flex?'style="flex:1"':'')+'>'; }

    si('Загрузки');
    const s1=sect();
    const r1=it(s1,'<span class="_it_span_"><i class="icon icon-folder" style="margin-right:6px;vertical-align:middle;"></i>Папка загрузок</span>');
    const r1b=document.createElement('div');r1b.className='_irow_';
    r1b.innerHTML=inp('_sp_',s.save_path||'','text','',true)+'<button class="_ba_" id="_pp_">Выбрать</button>';
    r1.appendChild(r1b);



    si('Автоперезагрузка');
    const s3=sect();
    it(s3,cbx('_are_','Включить таймер',s.auto_reload_enabled));
    const r3b=it(s3,'<span class="_it_span_">Интервал (сек)</span>');
    r3b.appendChild(Object.assign(document.createElement('div'),{innerHTML:inp('_ari_',s.auto_reload_interval,'number','60')}));
    it(s3,cbx('_aro_','При неактивности',s.auto_reload_on_idle));
    const r3d=it(s3,'<span class="_it_span_">Таймаут неактивности (сек)</span>');
    r3d.appendChild(Object.assign(document.createElement('div'),{innerHTML:inp('_it_',s.idle_timeout,'number','30')}));

    si('Окно');const s4=sect();it(s4,cbx('_tr_','Сворачивать в трей',s.minimize_to_tray));it(s4,cbx('_dv_','Консоль разработчика (DevTools) — Ctrl+Shift+I / F12',s.devtools_enabled));

    si('Дополнения');
    let _addonsDirty = false;
    let applyBtn = null;
    try{
        const addons=await INV('get_addons');
        const embedded=addons.filter(a=>a.embedded);
        const user=addons.filter(a=>!a.embedded);

        function renderAddonRow(sec,a){
            const label=a.display_name||a.name;
            const ver=a.version?'<span style="color:#aaa;font-size:11px;margin-left:4px;">v'+a.version+'</span>':'';
            const typeTag='<span class="_badge_">'+a.addon_type+'</span>';
            const row=it(sec,'');
            const toggle=document.createElement('label');toggle.className='_cbx_';toggle.style.flex='1';
            toggle.innerHTML='<input type="checkbox" '+(a.enabled?'checked':'')+'><span class="box"></span><span class="label" style="display:flex;align-items:center;gap:6px;">'+label+typeTag+ver+'</span>';
            const chk=toggle.querySelector('input');
            chk.addEventListener('change',async()=>{
                if(chk.checked && a.group){
                    const conflict = addons.find(o => o.key !== a.key && o.group === a.group && o.enabled);
                    if(conflict){
                        chk.checked = false;
                        showModal({
                            title: 'Конфликт дополнений',
                            msg: 'Нельзя включить <b>'+(a.display_name||a.name)+'</b>.<br>Сначала выключите <b>'+(conflict.display_name||conflict.name)+'</b>.',
                            okText: 'ОК',
                            cancelText: null,
                        });
                        return;
                    }
                }
                a.enabled = chk.checked;
                await INV('toggle_addon',{key:a.key,enabled:chk.checked});
                _addonsDirty = true;
                if(applyBtn) applyBtn.style.display = 'inline-flex';
            });
            row.appendChild(toggle);
            if(!a.embedded){
                const db=document.createElement('button');db.className='_del_';db.innerHTML='<i class="icon icon-delete"></i>';
                db.addEventListener('click',async()=>{await INV('delete_addon',{name:a.name});renderSt();});
                row.appendChild(db);
            }
        }

        if(embedded.length){
            const se=sect();
            const he=it(se,'<span class="_it_span_" style="font-size:11px;color:#aaa;">ВСТРОЕННЫЕ</span>');he.style.minHeight='0';
            embedded.forEach(a=>renderAddonRow(se,a));
        }

        const su=sect();
        const hu=it(su,'<span class="_it_span_" style="font-size:11px;color:#aaa;">ПОЛЬЗОВАТЕЛЬСКИЕ (.js / .crx)</span>');hu.style.minHeight='0';
        const raf=it(su,'');
        const ob=document.createElement('button');ob.className='_ba_';ob.style.marginLeft='auto';ob.innerHTML='<i class="icon icon-folder"></i> Открыть папку';ob.addEventListener('click',()=>INV('open_addons_folder'));raf.appendChild(ob);
        if(user.length)user.forEach(a=>renderAddonRow(su,a));
        else{const em=document.createElement('div');em.className='_empty_';em.style.padding='10px 16px';em.textContent='Нет пользовательских дополнений';su.appendChild(em);}

        const applyRow=it(su,'');applyRow.style.justifyContent='flex-end';
        applyBtn=document.createElement('button');
        applyBtn.className='_ba_';
        applyBtn.style.cssText='display:none;background:#2e7d32;';
        applyBtn.innerHTML='<i class="icon icon-reload"></i> Применить (перезагрузить)';
        applyBtn.addEventListener('click',()=>INV('apply_addons'));
        applyRow.appendChild(applyBtn);
    }catch(e){console.error('addons',e);}

    si('Данные');
    const s6=sect();const s6r=it(s6,'');
    const clr=document.createElement('div');clr.className='ListItem-button';clr.style.cssText='cursor:pointer;display:flex;align-items:center;gap:10px;padding:2px 0;width:100%;';
    clr.innerHTML='<i class="icon icon-delete" style="color:#e53935" aria-hidden="true"></i><div><div style="color:#e53935;font-size:14px;">Очистить кэш и перезагрузить</div><div style="color:#aaa;font-size:12px;">Удаляет локальные данные и перезапускает страницу</div></div>';
    clr.addEventListener('click',()=>INV('clear_cache'));s6r.appendChild(clr);

    si('Обновления');
    const s_upd=sect();
    const r_upd=it(s_upd,'<span class="_it_span_">Проверять автоматически</span>');
    const sel=document.createElement('select');
    sel.style.cssText='background:#1a1a1a;border:1px solid #444;border-radius:6px;color:#fff;padding:4px 8px;font-size:13px;cursor:pointer;';[{v:'30m',l:'Каждые 30 мин'},{v:'1h',l:'Каждый час'},{v:'12h',l:'Каждые 12 ч'},{v:'24h',l:'Раз в сутки'},{v:'3d',l:'Раз в 3 дня'},{v:'7d',l:'Раз в неделю'},{v:'30d',l:'Раз в месяц'},{v:'never',l:'Никогда'}].forEach(opt=>{const o=document.createElement('option');o.value=opt.v;o.textContent=opt.l;if((s.update_check_interval||'1h')===opt.v)o.selected=true;sel.appendChild(o);});
    sel.addEventListener('change',async()=>{const ns=await INV('get_settings');await INV('save_settings',{settings:Object.assign({},ns,{update_check_interval:sel.value})});toast('Сохранено','icon-check');});
    r_upd.appendChild(sel);
    const r_upd2=it(s_upd,'');
    const btnChk=document.createElement('button');btnChk.className='_ba_';btnChk.innerHTML='<i class="icon icon-reload"></i> Проверить сейчас';
    btnChk.addEventListener('click',async()=>{
        btnChk.disabled=true;btnChk.textContent='Проверка...';
        try{const r=await INV('check_update_manual');if(!r||r.upToDate)toast('Установлена последняя версия','icon-check');else if(r.error)toast('Ошибка: '+r.error,'icon-close');}
        catch(e){toast('Ошибка проверки','icon-close');}
        finally{btnChk.disabled=false;btnChk.innerHTML='<i class="icon icon-reload"></i> Проверить сейчас';}
    });
    r_upd2.appendChild(btnChk);

    si('О приложении');
    const s7=sect();
    (async()=>{
        let ver='—';let uid='—';let uname='—';
        try{const info=await INV('get_app_info');ver=info.version||'—';}catch(e){}
        try{
            const pa=document.querySelector('.settings-content .ProfileInfo .Avatar[data-peer-id]');
            if(pa)uid=pa.getAttribute('data-peer-id')||'—';
            const un=document.querySelector('.settings-content .ChatExtra .icon-mention');
            if(un&&un.nextElementSibling)uname=un.closest('.multiline-item')?.querySelector('.title')?.textContent||'—';
        }catch(e){}
        const rows=[['Версия',ver],['Ваш ID',uid],['Username',uname]];
        rows.forEach(([label,val])=>{
            const row=it(s7,'<span class="_it_span_" style="color:#aaa;font-size:13px;">'+label+'</span>');
            const v=document.createElement('span');
            v.style.cssText='color:#fff;font-size:13px;font-family:monospace;user-select:text;cursor:text;';
            v.textContent=val;
            row.appendChild(v);
        });
    })();

    const G=id=>c.querySelector('#'+id);
    const pp=G('_pp_');const sp_i=G('_sp_');
    if(pp)pp.addEventListener('click',async()=>{const p=await INV('open_folder_dialog');if(p&&sp_i)sp_i.value=p;});
    if(sp_i)sp_i.addEventListener('click',()=>pp&&pp.click());
    c.querySelectorAll('input[type=checkbox],input[type=number],input[type=text]').forEach(el=>{
        el.addEventListener('change',scheduleSave);
        if(el.type==='number'||el.type==='text')el.addEventListener('input',scheduleSave);
    });
    const dvEl=G('_dv_');
    if(dvEl)dvEl.addEventListener('change',async()=>{try{await INV('toggle_devtools',{open:dvEl.checked});}catch(e){}});
}

// ── Corner-уведомления ───────────────────────────────────────────────────
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
    const clBox='<div id="_upd_cl_" style="margin-top:10px;background:#1a1a1a;border-radius:6px;padding:10px 12px;font-size:13px;color:#ccc;line-height:1.6;white-space:pre-wrap;max-height:200px;overflow-y:auto;">Загрузка...</div>';
    showModal({
        title:'Доступно обновление',
        msg:verLine+'<br>'+clBox,
        okText:'СКАЧАТЬ',
        cancelText:'ПОЗЖЕ',
        extraBtn:{label:'ПРОПУСТИТЬ',danger:false},
        onOk:async()=>{showUpdateProgress(data.url,'Telegram Web Desktop Setup '+data.version+'.exe',data.version);},
        onExtra:async()=>{await INV('skip_version',{version:data.version});},
    });
    try{
        const r=await INV('fetch_changelog');
        const el=document.getElementById('_upd_cl_');
        if(el)el.textContent=r.error?('Ошибка: '+r.error):(r.text||'Список изменений пуст.');
    }catch(e){const el=document.getElementById('_upd_cl_');if(el)el.textContent='Ошибка загрузки.';}
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

async function renderCl(){
    const c=document.getElementById('_tgcl_c');if(!c)return;
    c.innerHTML='<div class="_empty_">Загрузка...</div>';
    try{
        const r=await INV('fetch_changelog');
        if(r.error){c.innerHTML='<div class="_empty_">Ошибка: '+r.error+'</div>';return;}
        const pre=document.createElement('div');pre.className='_cl_content_';pre.textContent=r.text||'Список изменений пуст.';
        c.innerHTML='';c.appendChild(pre);
    }catch(e){c.innerHTML='<div class="_empty_">Ошибка загрузки</div>';}
}

function ensurePanels(){makePanel('_tgst_','Настройки приложения');makePanel('_tgcl_','Список изменений');}

// ── ИНЖЕКТ МЕНЮ: Строго по структуре DOM без догадок ────────────────────
function injectMenu(){
    // Ищем иконку "Избранное" — она всегда есть в главном меню
    const savedIcons = document.querySelectorAll('.icon-saved-messages');
    savedIcons.forEach(icon => {
        // Находим родительский bubble-контейнер
        const bubble = icon.closest('.bubble.menu-container');
        if(!bubble) return;
        
        // Если наши пункты уже добавлены в этот bubble — пропускаем
        if(bubble.querySelector('#_tgmi_dl_')) return;

        function mi(id, ico, label, cb){
            const el = document.createElement('div');
            el.id = id;
            el.setAttribute('role', 'menuitem');
            el.setAttribute('tabindex', '0');
            el.className = 'MenuItem compact';
            el.innerHTML = '<i class="icon ' + ico + '" aria-hidden="true"></i><span>' + label + '</span>';
            el.addEventListener('click', () => {
                bubble.classList.remove('open', 'shown'); // закрываем меню
                setTimeout(cb, 60);
            });
            return el;
        }

        // Динамически берем классы разделителя из DOM, чтобы не сломалось при обновлениях ТГ (заменяет h039vb1K NGKaFgra)
        let sepClass = 'h039vb1K NGKaFgra'; // дефолт на крайний случай
        const existingSep = Array.from(bubble.children).find(el => el.tagName === 'DIV' && !el.hasAttribute('role') && !el.className.includes('MenuItem') && el.innerHTML.trim() === '');
        if(existingSep) sepClass = existingSep.className;

        const sep1 = document.createElement('div'); sep1.className = sepClass;
        const sep2 = document.createElement('div'); sep2.className = sepClass;

        const dl = mi('_tgmi_dl_', 'icon-download', 'Загрузки приложения', () => openDownloadsModal());
        const st = mi('_tgmi_st_', 'icon-settings', 'Настройки приложения', () => openPanel('_tgst_', renderSt));
        const cl = mi('_tgmi_cl_', 'icon-info', 'Список изменений', () => openPanel('_tgcl_', renderCl));
        const upd = mi('_tgmi_upd_', 'icon-reload', 'Проверить обновления', async () => {
            toast('Проверка обновлений...', 'icon-reload');
            try {
                const r = await INV('check_update_manual');
                if (!r || r.upToDate) toast('Установлена последняя версия', 'icon-check');
                else if (r.error) toast('Ошибка: ' + r.error, 'icon-close');
            } catch(e) { toast('Ошибка проверки', 'icon-close'); }
        });

        // Находим оригинальную кнопку "Настройки", чтобы вставить пункты строго перед ней
        const tgSettings = Array.from(bubble.querySelectorAll('.MenuItem.compact:not([id])')).find(el => el.querySelector('.icon-settings'));
        const anchor = tgSettings || bubble.lastElementChild;
        
        if(anchor){
            bubble.insertBefore(sep1, anchor);
            bubble.insertBefore(dl, anchor);
            bubble.insertBefore(st, anchor);
            bubble.insertBefore(cl, anchor);
            bubble.insertBefore(upd, anchor);
            bubble.insertBefore(sep2, anchor);
        }
    });
}
// ────────────────────────────────────────────────────────────────────────

function tryInject(){ensureCSS();ensureToast();ensureCornerWrap();ensurePanels();}
function waitBody(cb){if(document.body)cb();else{const t=setInterval(()=>{if(document.body){clearInterval(t);cb();}},50);}}

waitBody(()=>{
    tryInject();
    new MutationObserver(tryInject).observe(document.body,{childList:true,subtree:false});
    
    // Запускаем инжект с интервалом, ловим меню в момент его появления
    setInterval(injectMenu, 500);

    setupNotificationSettingsSync();

    let _lastBadgeCount_=-1;
    setInterval(()=>{
        let count=0;
        const m=document.title.match(/\\((\\d+)\\)/);
        if(m)count=parseInt(m[1])||0;
        if(!count){
            document.querySelectorAll('.ChatList .Badge:not(.muted)').forEach(b=>{
                const n=parseInt(b.textContent)||0;
                count+=n;
            });
        }
        if(count!==_lastBadgeCount_){
            _lastBadgeCount_=count;
            INV('set_notifications_count',{count}).catch(()=>{});
        }
    },2000);
});

['mousemove','keydown','click','scroll','touchstart'].forEach(ev=>{
    document.addEventListener(ev,()=>INV('report_user_active').catch(()=>{}),{passive:true,capture:true});
});
// ── Drag-n-drop: блокируем переключение чатов при перетаскивании файла ───────
// TG открывает чат под курсором при dragover по списку. Глушим pointer-events
// у .chat-list пока тащим файл. Не считаем dragenter/dragleave (счётчик
// рассинхронивается на границах детей) — держим по таймстампу dragover:
// dragover сыпется постоянно пока курсор в окне; пропал >200мс → снимаем блок.
// Текущий чат не страдает: дроп ловит средняя колонка/композер, не список.
// Блокируем на ЛЮБОЕ перетаскивание (не проверяем types: при внешнем drag над
// фоновым окном dataTransfer.types может не содержать 'Files'). Держим по
// таймстампу с запасом 700мс — в фоне dragover приходит редко, и узкий порог
// давал мерцание блока (чат «прыгал»). attach на dragenter и dragover.
(function(){
    var _s=null,_last=0,_timer=null;
    function styleEl(){
        if(_s)return _s;
        _s=document.createElement('style');_s.id='_drag_bl_';
        _s.textContent='.chat-list,.chat-list *{pointer-events:none!important}';
        return _s;
    }
    function tick(){if(Date.now()-_last>700)detach();}
    function attach(){
        if(!_s||!_s.parentNode)(document.head||document.documentElement).appendChild(styleEl());
        _last=Date.now();
        if(!_timer)_timer=setInterval(tick,150);
    }
    function detach(){
        if(_s&&_s.parentNode)_s.parentNode.removeChild(_s);
        if(_timer){clearInterval(_timer);_timer=null;}
    }
    document.addEventListener('dragenter',attach,true);
    document.addEventListener('dragover',attach,true);
    document.addEventListener('drop',detach,true);
    document.addEventListener('dragend',detach,true);
})();
// ─────────────────────────────────────────────────────────────────────────────

// ── ПКМ на изображении в MediaViewer ──────────────────────────────────────
document.addEventListener('contextmenu', function(e) {
    const viewer = document.getElementById('MediaViewer');
    if (!viewer || !viewer.contains(e.target)) return;

    const activeSlide = viewer.querySelector('.MediaViewerSlide--active');
    if (!activeSlide) return;

    const img = activeSlide.querySelector(
        'img:not([class*="sticker"]):not(.Avatar__media):not(.a8dMNkh3)'
    );
    if (!img || !img.src) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    INV('show_image_context_menu', {
        srcURL: img.src,
        x: e.clientX,
        y: e.clientY,
    }).catch(() => {});
}, true);
// ──────────────────────────────────────────────────────────────────────────

// ── Навигация из уведомлений: открыть чат / пометить прочитанным ───────────
// Hash-навигация (location.hash='#peerId') в уже загруженной SPA Telegram Web A
// НЕ работает — роутер игнорирует изменение hash после инициализации (проверено
// на живой странице: и hash=, и location.assign сбрасываются в ''). Единственный
// надёжный путь без перезагрузки — кликнуть по строке чат-листа.
window.__tgNotif=(function(){
    function findRow(pid){
        var rows=document.querySelectorAll('.chat-list .ListItem.Chat');
        for(var i=0;i<rows.length;i++){
            var a=rows[i].querySelector('.Avatar[data-peer-id]');
            if(a&&a.getAttribute('data-peer-id')===String(pid))return rows[i];
        }
        return null;
    }
    // Полный путь: при загрузке с нуля hash работает (как в браузере), в живой
    // странице — нет. Поэтому пробуем клик; если строки нет в DOM (виртуализация),
    // фолбэк на полную перезагрузку с hash — медленно, но рабочий.
    function clickRow(row){
        var btn=row.querySelector('.ListItem-button')||row;
        try{
            var r=btn.getBoundingClientRect();
            var opt={bubbles:true,cancelable:true,view:window,button:0,
                clientX:r.left+r.width/2,clientY:r.top+r.height/2};
            btn.dispatchEvent(new MouseEvent('mousedown',opt));
            btn.dispatchEvent(new MouseEvent('mouseup',opt));
            btn.dispatchEvent(new MouseEvent('click',opt));
        }catch(e){ try{btn.click();}catch(e2){} }
    }
    function focusComposer(){
        setTimeout(function(){
            var i=document.getElementById('editable-message-text');
            if(i)i.focus();
        },450);
    }
    function openChat(pid){
        try{
            pid=String(pid);
            var row=findRow(pid);
            if(row){ clickRow(row); focusComposer(); return; }
        }catch(e){}
        // Фолбэк: строка вне видимой области (виртуализация) → перезагрузка с hash.
        try{ location.assign(location.origin+location.pathname+'#'+pid); }catch(e){}
    }
    // ПКМ по строке → нативное меню TG → «Отметить как прочитанное».
    // Чат НЕ открывается, текущий активный чат не меняется.
    function markRead(pid){
        try{ pid=String(pid); }catch(e){ return; }
        var row=findRow(pid);
        if(!row)return;
        // Запоминаем открытый чат, чтобы убедиться, что навигации не произошло.
        var headerPeerEl=document.querySelector('.MiddleHeader .ChatInfo .Avatar[data-peer-id]');
        var wasOpen=headerPeerEl?headerPeerEl.getAttribute('data-peer-id'):null;
        var btn=row.querySelector('.ListItem-button')||row;
        var r=btn.getBoundingClientRect();
        var opt={bubbles:true,cancelable:true,view:window,button:2,
            clientX:r.left+r.width/2,clientY:r.top+r.height/2};
        btn.dispatchEvent(new MouseEvent('contextmenu',opt));
        // Ждём появления видимого меню TG (только .shown.open — в DOM висят
        // скрытые устаревшие меню, их не трогаем), ищем пункт, кликаем.
        var tries=0,maxTries=30;   // ~1.5с при 50мс
        (function poll(){
            var menu=document.querySelector('.bubble.menu-container.shown.open, .Menu.context-menu .bubble.shown.open');
            if(menu){
                var items=menu.querySelectorAll('.MenuItem, [role="menuitem"], button');
                for(var i=0;i<items.length;i++){
                    var t=(items[i].textContent||'').trim();
                    // Матчим по ИКОНКЕ (icon-readchats) — она не зависит от языка.
                    // Текст как фолбэк, если разметка иконок изменится.
                    var byIcon=!!items[i].querySelector('i.icon-readchats, .icon-readchats');
                    if(byIcon || /пометить прочитанн|отметить как прочитанн|mark as read/i.test(t)){
                        try{
                            var er=items[i].getBoundingClientRect();
                            items[i].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window,clientX:er.left+1,clientY:er.top+1}));
                            items[i].dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,view:window,clientX:er.left+1,clientY:er.top+1}));
                            items[i].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window,clientX:er.left+1,clientY:er.top+1}));
                        }catch(e){ try{items[i].click();}catch(e2){} }
                        return;
                    }
                }
                // Меню всплыло, но пункта нет (возможно уже прочитано) — закрываем.
                dismissMenu();
                return;
            }
            if(++tries<maxTries)setTimeout(poll,50);
        })();
        function dismissMenu(){
            try{ document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,which:27,bubbles:true})); }catch(e){}
            try{ document.body.click(); }catch(e){}
        }
    }
    return {openChat:openChat, markRead:markRead};
})();
// ──────────────────────────────────────────────────────────────────────────

// ── Перехват входящих → фирменный звук уведомления ─────────────────────────
// При включённых «Веб-уведомлениях» Telegram уходит в путь системного
// уведомления и НЕ играет свой in-app звук (системное мы фейкаем) → тишина.
// Чиним: сами играем фирменный /a/notification.mp3 на каждое входящее.
// Следим за ростом счётчика непрочитанных в чат-листе (надёжно, по-сообщенно).
// Если TG звук всё же сыграл сам (галка выключена) — не дублируем.
(function setupIncomingSound(){
    var counts={}, seeded=false, lastTgSound=0;
    // Кэш настроек (звук/громкость/категории). Обновляем периодически — это
    // дешёвый INV('get_settings'), и уведомления реагируют на переключатели
    // без перезагрузки.
    var cfg={notif_sound:true,notif_volume:0.8,notif_cat_private:true,notif_cat_group:true,notif_cat_channel:true};
    function refreshCfg(){
        try{ INV('get_settings').then(function(s){ if(s)cfg=s; }).catch(function(){}); }catch(e){}
    }
    refreshCfg();
    setInterval(refreshCfg,2000);

    // Ловим момент, когда сам Telegram играет notification.mp3 — для де-дупа.
    try{
        var _play=HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play=function(){
            try{ if((((this.src||this.currentSrc)||'')+'').indexOf('notification')>=0) lastTgSound=Date.now(); }catch(e){}
            return _play.apply(this,arguments);
        };
    }catch(e){}

    var SND=location.origin+'/a/notification.mp3';
    function playSound(){
        if(!cfg.notif_sound)return;                  // звук выключен в настройках
        if(Date.now()-lastTgSound<1500)return;       // TG уже сыграл свой — не дублируем
        try{
            var a=new Audio(SND);
            var v=parseFloat(cfg.notif_volume);
            if(!isNaN(v))a.volume=Math.max(0,Math.min(1,v));
            a.play().catch(function(){});
        }catch(e){}
    }

    // Тип чата по данным строки чат-листа.
    // Тип чата для категорий: private | group | channel.
    // private — peerId > 0 (надёжно). Группа и канал в чат-листе НЕразличимы
    // (оба className "group", id отрицательный), поэтому канал учим при открытии
    // чата: у канала (не-админ) нет поля ввода #editable-message-text.
    // Кэш peerId→тип; неизвестные отрицательные считаем группой (ничего не глушим зря).
    var typeCache = {};
    function learnType(){
        var pid = currentPeer();
        if(!pid || pid.charAt(0)!=='-') return;          // открыт не отрицательный чат
        // форум-супергруппа сначала показывает список тем без композера — не канал
        var headerForum = document.querySelector('.MiddleHeader .Avatar.forum, .MiddleHeader [class*="forum"]');
        if(headerForum){ typeCache[pid]='group'; return; }
        var hasComposer = !!document.getElementById('editable-message-text');
        typeCache[pid] = hasComposer ? 'group' : 'channel';
    }
    function chatType(item,pid){
        if(parseInt(pid,10)>0) return 'private';
        if(item && item.className.indexOf('forum')>=0) return 'group';   // форум = супергруппа
        return typeCache[pid] || 'group';
    }

    function badgeOf(it){
        var max=0;
        it.querySelectorAll('.chat-badge-transition').forEach(function(b){
            var n=parseInt((b.textContent||'').replace(/[^0-9]/g,''),10);
            if(!isNaN(n)&&n>max)max=n;
        });
        return max;
    }
    function peerOf(it){var a=it.querySelector('.Avatar[data-peer-id]');return a?a.getAttribute('data-peer-id'):null;}
    function mutedOf(it){return !!it.querySelector('.icon-muted');}
    function titleOf(it){var t=it.querySelector('h3.fullName, .title h3, .fullName');return t?t.textContent.trim().replace(/\\s+/g,' '):'';}
    function textOf(it){var p=it.querySelector('.last-message');return p?p.textContent.trim().replace(/\\s+/g,' '):'';}
    function avatarOf(it){var img=it.querySelector('.Avatar img.Avatar__media, .Avatar img');return img&&img.src?img.src:'';}
    function currentPeer(){var el=document.querySelector('.MiddleHeader .ChatInfo .Avatar[data-peer-id]');return el?el.getAttribute('data-peer-id'):'';}
    function toDataUrl(src){
        return new Promise(function(res){
            if(!src||src.indexOf('blob:')!==0)return res(src||'');
            fetch(src).then(function(r){return r.blob();}).then(function(b){
                var fr=new FileReader();fr.onload=function(){res(fr.result);};fr.onerror=function(){res('');};fr.readAsDataURL(b);
            }).catch(function(){res('');});
        });
    }
    // Текстовое уведомление на экран (звук отдельно — playSound:false).
    function popup(item,pid){
        var title=titleOf(item)||'Telegram';
        var text=textOf(item)||'Новое сообщение';
        toDataUrl(avatarOf(item)).then(function(icon){
            INV('show_notification',{title:title,body:text,icon:icon,sender:title,peerId:pid,playSound:false}).catch(function(){});
        });
    }

    function scan(){
        learnType();                                        // учим тип открытого чата (канал/группа)
        var items=document.querySelectorAll('.chat-list .ListItem.Chat');
        if(!items.length)return;
        var openPeer=currentPeer();
        var focused=document.hasFocus();
        var fire=false;
        items.forEach(function(item){
            if(item.className.indexOf('chat-item-archive')>=0)return;
            var pid=peerOf(item);
            if(!pid)return;
            var cnt=badgeOf(item);
            var prev=counts[pid];
            counts[pid]=cnt;
            if(cnt<=0)return;
            if(mutedOf(item))return;                        // приглушённые — без звука и попапа
            var ctype=chatType(item,pid);
            if(cfg['notif_cat_'+ctype]===false)return;      // категория выключена в настройках
            if(!seeded)return;                              // первый проход — только seed
            if(prev===undefined)return;                     // впервые видим чат (виртуализация) — не новое
            if(cnt<=prev)return;                            // счётчик не вырос — не новое
            if(pid===openPeer&&focused)return;              // активный чат в фокусе — пропускаем
            fire=true;
            popup(item,pid);                                // текстовый попап на экран
        });
        seeded=true;
        if(fire)playSound();                                // один звук за тик, без наложений
    }
    scan();
    setInterval(scan,500);
})();
// ──────────────────────────────────────────────────────────────────────────
})();`;

const NOTIF_INTERCEPT_JS = NOTIF_PERM_JS;

module.exports = { NOTIF_INTERCEPT_JS, AUDIO_JS, EXTERNAL_JS, UI_JS };