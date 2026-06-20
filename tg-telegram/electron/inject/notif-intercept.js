(function(){
    // Guard: переинъекция в том же документе — no-op (как у UI_JS). Нужен потому,
    // что теперь notif-intercept входит в re-inject набор (watchdog), иначе после
    // self-reload TG (service worker) перехват Notification терялся навсегда.
    if (window.__tgNotifIntercept) return;
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
})();