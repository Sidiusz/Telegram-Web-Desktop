(function(){
    // Re-injection guard: Telegram's own self-reload (service worker) creates a fresh
    // document, but the watchdog also re-injects this script periodically. We must
    // re-hook the *new* serviceWorker controller each time, even if Notification
    // was already proxied in this document's lifetime (HMR / watchdog).
    const _alreadyProxied = !!window.__tgNotifIntercept;
    window.__tgNotifIntercept = true;

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

    // ── Мост в наш попап ────────────────────────────────────────────────────
    // Состояние TG больше НЕ достать через webpack (TG webZ переехал на Vite —
    // глобальный __webpack_require__ исчез), поэтому старый опрос getGlobal мёртв.
    // Источник уведомлений теперь — сам Telegram: на новое сообщение он зовёт
    // notify-пайплайн, который мы перехватываем (см. ниже) и отдаём в UI_JS, где
    // показывается наш угловой попап и играется звук.
    window.__tgNotifQueue = window.__tgNotifQueue || [];
    // Дедуп: одно сообщение TG нередко приходит ОБОИМИ путями (window.Notification
    // в фокусе + postMessage в service worker) → был дубль попапа и звука. Гасим
    // повтор с тем же ключом (messageId+заголовок+текст) в окне 4с. Разные сообщения
    // имеют разный messageId → разный ключ, их не глушим.
    window.__tgNotifSeen = window.__tgNotifSeen || {};
    function pushTgNotif(p) {
        try {
            if (!p) return;
            var now = Date.now(), seen = window.__tgNotifSeen;
            var key = (p.messageId || '') + '|' + (p.title || '') + '|' + (p.body || '');
            if (seen[key] && now - seen[key] < 4000) return;
            seen[key] = now;
            for (var k in seen) { if (now - seen[k] > 8000) delete seen[k]; }
            if (typeof window.__tgOnNotif === 'function') window.__tgOnNotif(p);
            else window.__tgNotifQueue.push(p);
        } catch (e) {}
    }
    // peerId для попапа (для кнопок «Открыть»/«Прочитано»). В опциях window.Notification
    // chatId нет (только tag=messageId) — ищем строку чат-листа по совпадению заголовка.
    function lookupPeerByTitle(title) {
        try {
            var t = String(title == null ? '' : title).trim();
            if (!t) return '';
            var rows = document.querySelectorAll('.chat-list .ListItem.Chat');
            for (var i = 0; i < rows.length; i++) {
                var h = rows[i].querySelector('.info .title h3, .title h3');
                if (h && (h.textContent || '').trim() === t) {
                    var av = rows[i].querySelector('.Avatar[data-peer-id]');
                    if (av) return av.getAttribute('data-peer-id') || '';
                }
            }
        } catch (e) {}
        return '';
    }

    // Telegram-уведомления (window.Notification) больше не «проглатываем молча» —
    // маршрутизируем в наш попап. Срабатывает, когда окно В фокусе (TG в этом случае
    // идёт по пути new Notification, а не через service worker, см. перехват SW ниже).
    function notify(title, opts) {
        opts = opts || {};
        pushTgNotif({
            title: String(title == null ? '' : title).trim(),
            body: opts.body || '',
            icon: opts.icon || '',
            chatId: lookupPeerByTitle(title),
            messageId: opts.tag || '',
            isSilent: !!opts.silent,
        });
    }

    // Перехват service worker: в фоне (окно не в фокусе) TG не зовёт new Notification,
    // а постит контроллеру SW {type:'showMessageNotification', payload:{title,body,icon,
    // chatId,messageId,isSilent}} — и нативное уведомление рисует сам SW. Перехватываем
    // этот postMessage: payload (с chatId!) уходит в наш попап, форвард в SW глушим,
    // чтобы не было дубля-нативки.
    function hookServiceWorker() {
        try {
            var sw = navigator.serviceWorker;
            if (!sw || typeof sw.addEventListener !== 'function') return;
            function wrap(ctrl) {
                if (!ctrl || ctrl.__tgNotifHooked) return;
                try {
                    var orig = ctrl.postMessage;
                    ctrl.postMessage = function(msg) {
                        try {
                            if (msg && msg.type === 'showMessageNotification' && msg.payload) {
                                var p = msg.payload;
                                pushTgNotif({
                                    title: p.title || '',
                                    body: p.body || '',
                                    icon: p.icon || '',
                                    chatId: p.chatId != null ? String(p.chatId) : '',
                                    messageId: p.messageId != null ? String(p.messageId) : '',
                                    isSilent: !!p.isSilent,
                                });
                                return;   // не форвардим в SW → нет дубля нативного уведомления
                            }
                        } catch (e) {}
                        return orig.apply(ctrl, arguments);
                    };
                    ctrl.__tgNotifHooked = true;
                } catch (e) {}
            }
            wrap(sw.controller);
            sw.addEventListener('controllerchange', function() { wrap(sw.controller); });
            // Pure event-driven — no polling. Cover SW updates via updatefound/statechange.
            function hookReg(reg){
                if(!reg) return;
                if(reg.active) wrap(reg.active);
                if(reg.waiting) wrap(reg.waiting);
                if(reg.installing) wrap(reg.installing);
                try{
                    reg.addEventListener('updatefound', function(){
                        var nw = reg.installing || reg.waiting;
                        if(nw){
                            wrap(nw);
                            nw.addEventListener('statechange', function(){
                                if(nw.state==='activated' || nw.state==='installed'){
                                    wrap(nw);
                                    if(reg.active) wrap(reg.active);
                                    if(reg.waiting) wrap(reg.waiting);
                                }
                            });
                        }
                    });
                }catch(e){}
            }
            try {
                sw.ready.then(function(reg) { hookReg(reg); }).catch(function() {});
            } catch (e) {}
            try{
                if(sw.getRegistrations) sw.getRegistrations().then(function(regs){
                    regs.forEach(function(r){ hookReg(r); });
                }).catch(function(){});
            }catch(e){}
        } catch (e) {}
    }
    hookServiceWorker();

    if (_alreadyProxied) return;

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
})();