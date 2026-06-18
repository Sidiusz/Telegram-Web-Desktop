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
\`;

function ensureCSS(){if(!document.getElementById('_tgcss_')){const s=document.createElement('style');s.id='_tgcss_';s.textContent=CSS;(document.head||document.documentElement).appendChild(s);}}
function ensureToast(){if(!document.getElementById('_tgt_')&&document.body){const t=document.createElement('div');t.className='_toast_';t.id='_tgt_';document.body.appendChild(t);}}
function toast(msg){ensureToast();const t=document.getElementById('_tgt_');if(!t)return;t.textContent=msg;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),2000);}

// ── Плавающий значок загрузки ──────────────────────────────────────────────
function ensureDlWrap(){
    if(document.getElementById('_dlbw_')||!document.body)return;
    const w=document.createElement('div');w.id='_dlbw_';w.className='_dlbadge_wrap_';
    document.body.appendChild(w);
}
(function setupDlBadges(){
    if(!window.tgBridge)return;
    const badges={};
    function wrap(){return document.getElementById('_dlbw_');}
    function fmt(recv,total){
        if(!total)return recv?_fmtBytes(recv):'';
        return _fmtBytes(recv)+' / '+_fmtBytes(total);
    }
    function _fmtBytes(b){
        if(b<1024)return b+'B';
        if(b<1048576)return (b/1024).toFixed(1)+'KB';
        return (b/1048576).toFixed(1)+'MB';
    }
    window.tgBridge.onDownloadEvent(function(data){
        ensureDlWrap();
        if(data.type==='start'){
            const el=document.createElement('div');
            el.className='_dlb_';
            el.dataset.dlid=data.id;
            el.innerHTML=(
                '<div class="_dlb_ico_">'+
                    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">'+
                        '<path d="M8 2v8M5 7l3 3 3-3" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>'+
                        '<path d="M3 13h10" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>'+
                    '</svg>'+
                '</div>'+
                '<div class="_dlb_info_">'+
                    '<div class="_dlb_name_">'+data.filename+'</div>'+
                    '<div class="_dlb_status_">Загрузка...</div>'+
                    '<div class="_dlb_prog_"><span style="width:0%"></span></div>'+
                '</div>'
            );
            wrap().appendChild(el);
            badges[data.id]=el;
        } else if(data.type==='progress'){
            const el=badges[data.id];if(!el)return;
            const pct=data.total?Math.round(data.received/data.total*100):0;
            const bar=el.querySelector('._dlb_prog_ span');
            if(bar)bar.style.width=pct+'%';
            const st=el.querySelector('._dlb_status_');
            if(st)st.textContent=fmt(data.received,data.total)+(data.total?' ('+pct+'%)':'');
        } else if(data.type==='done'){
            const el=badges[data.id];if(!el)return;
            if(data.status==='completed'){
                el.classList.add('done');
                el.title='Нажмите чтобы открыть файл';
                const ico=el.querySelector('._dlb_ico_');
                if(ico)ico.innerHTML=(
                    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">'+
                        '<path d="M3 8l4 4 6-6" stroke="#4caf50" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'+
                    '</svg>'
                );
                ico.style.background='#1b3a1f';
                const bar=el.querySelector('._dlb_prog_');if(bar)bar.remove();
                const st=el.querySelector('._dlb_status_');if(st)st.textContent='Готово — нажмите чтобы открыть';
                el.addEventListener('click',()=>{
                    INV('open_download_file',{id:data.id}).catch(()=>{});
                    el.remove();delete badges[data.id];
                });
                setTimeout(()=>{el.remove();delete badges[data.id];},8000);
            } else {
                const st=el.querySelector('._dlb_status_');if(st){st.textContent='Ошибка загрузки';st.style.color='#e53935';}
                const bar=el.querySelector('._dlb_prog_');if(bar)bar.remove();
                setTimeout(()=>{el.remove();delete badges[data.id];},4000);
            }
        }
    });
})();
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

    function scan() {
        var webRow = findSettingRow(/\bВеб-уведомления\b/i);
        var bgRow = findSettingRow(/\bУведомления в фоне\b/i);

        if (webRow) {
            bindRow(webRow, 'web');
        }
        if (bgRow) {
            bindRow(bgRow, 'background');
        }
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

function sLabel(s){return{downloading:'⬇ Загружается',completed:'✓ Завершено',failed:'✕ Ошибка',cancelled:'— Отменено'}[s]||s;}
function sColor(s){return{downloading:'var(--color-primary,#5288c1)',completed:'#4caf50',failed:'#e53935',cancelled:'#aaa'}[s]||'#aaa';}

async function renderDl(){
    const c=document.getElementById('_tgdl_c');if(!c)return;
    try{
        const items=await INV('get_downloads');
        c.innerHTML='';
        if(!items||!items.length){c.innerHTML='<div class="_empty_">Нет загрузок</div>';return;}
        items.slice().reverse().forEach(d=>{
            const div=document.createElement('div');
            const done=d.status==='completed';
            div.className='_dli_'+(done?' done':'');
            if(done)div.title='Нажмите чтобы открыть файл';
            const name=document.createElement('div');name.className='_dln_';name.textContent=d.filename;
            const st=document.createElement('div');st.className='_dls_';st.style.color=sColor(d.status);st.textContent=sLabel(d.status);
            const actions=document.createElement('div');actions.className='_dla_';
            if(done){
                div.addEventListener('click',e=>{if(e.target.closest('button'))return;INV('open_download_file',{id:d.id});});
                const folder=document.createElement('button');folder.className='_folder_';
                folder.innerHTML='<i class="icon icon-folder" aria-hidden="true"></i>Папка';
                folder.addEventListener('click',()=>INV('open_download_folder',{id:d.id}));
                actions.appendChild(folder);
            }
            const del=document.createElement('button');del.className='_del_';
            del.innerHTML='<i class="icon icon-delete" aria-hidden="true"></i>Удалить';
            del.addEventListener('click',()=>{showModal({title:'Удалить загрузку',msg:'Удалить «'+d.filename+'»?<br><small style="color:#aaa">Файл также будет удалён с диска.</small>',okText:'УДАЛИТЬ',okDanger:true,onOk:async()=>{await INV('delete_download',{id:d.id});renderDl();}});});
            actions.appendChild(del);
            div.appendChild(name);div.appendChild(st);div.appendChild(actions);
            c.appendChild(div);
        });
    }catch(e){console.error('renderDl',e);c.innerHTML='<div class="_empty_">Ошибка: '+e+'</div>';}
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

function ensurePanels(){makePanel('_tgdl_','Загрузки');makePanel('_tgst_','Настройки приложения');makePanel('_tgcl_','Список изменений');}

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

        const dl = mi('_tgmi_dl_', 'icon-download', 'Загрузки приложения', () => openPanel('_tgdl_', renderDl));
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

function tryInject(){ensureCSS();ensureToast();ensureDlWrap();ensureCornerWrap();ensurePanels();}
function waitBody(cb){if(document.body)cb();else{const t=setInterval(()=>{if(document.body){clearInterval(t);cb();}},50);}}

waitBody(()=>{
    tryInject();
    new MutationObserver(tryInject).observe(document.body,{childList:true,subtree:false});
    
    // Запускаем инжект с интервалом, ловим меню в момент его появления
    setInterval(injectMenu, 500);

    setInterval(()=>{if(document.getElementById('_tgdl_')&&document.getElementById('_tgdl_').classList.contains('open'))renderDl();},2000);

    setupNotificationSettingsSync();
    setTimeout(showWebNotifHintIfNeeded, 4000);

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
// ── Drag-n-drop: блокируем hover чатов при перетаскивании файлов ────────────
(function(){
    var _cnt=0,_s=null;
    function getStyle(){if(!_s){_s=document.createElement('style');_s.id='_drag_bl_';_s.textContent='.ChatList,.chat-list{pointer-events:none!important}.ChatList *,.chat-list *{pointer-events:none!important}';}return _s;}
    function attach(){if(!_s||!_s.parentNode)(document.head||document.documentElement).appendChild(getStyle());}
    function detach(){if(_s&&_s.parentNode)_s.parentNode.removeChild(_s);_cnt=0;}
    document.addEventListener('dragenter',function(e){if(!e.dataTransfer)return;var t=e.dataTransfer.types;if(!t)return;var h=t.indexOf?t.indexOf('Files')>=0:Array.prototype.indexOf.call(t,'Files')>=0;if(!h)return;_cnt++;if(_cnt===1)attach();},true);
    document.addEventListener('dragleave',function(){_cnt=Math.max(0,_cnt-1);if(_cnt===0)detach();},true);
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

// ── Перехват входящих → фирменный звук уведомления ─────────────────────────
// При включённых «Веб-уведомлениях» Telegram уходит в путь системного
// уведомления и НЕ играет свой in-app звук (системное мы фейкаем) → тишина.
// Чиним: сами играем фирменный /a/notification.mp3 на каждое входящее.
// Следим за ростом счётчика непрочитанных в чат-листе (надёжно, по-сообщенно).
// Если TG звук всё же сыграл сам (галка выключена) — не дублируем.
(function setupIncomingSound(){
    var counts={}, seeded=false, lastTgSound=0;

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
        if(Date.now()-lastTgSound<1500)return;     // TG уже сыграл свой — не дублируем
        try{var a=new Audio(SND);a.play().catch(function(){});}catch(e){}
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