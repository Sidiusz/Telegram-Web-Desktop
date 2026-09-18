(function(){
    // Re-injection guard: Telegram's own self-reload (service worker) creates a fresh
    // document, but the watchdog also re-injects this script periodically. We must
    // re-hook the *new* serviceWorker controller each time, even if Notification
    // was already proxied in this document's lifetime (HMR / watchdog).
    const _alreadyProxied = !!window.__tgNotifIntercept;
    window.__tgNotifIntercept = true;
    // A same-document watchdog reinjection should repair the existing interceptor
    // instead of stacking another set of wrappers/timers. Older builds did not expose
    // this repair entry point, so if it is missing we intentionally continue through
    // the full installer below to upgrade the live document in place.
    if (_alreadyProxied && typeof window.__twdNotifRepair === 'function') {
        try { window.__twdNotifRepair(); } catch (_) {}
        return;
    }

    function normalizeText(value, fallback) {
        var text = String(value == null ? '' : value).trim();
        return text || fallback;
    }

    var nativeNotification = window.Notification;
    if (!nativeNotification && typeof window.Notification !== 'function') return;

    function ensureNotificationPermission() {
        try {
            // Do NOT manufacture PushManager/PushSubscription/ServiceWorker APIs.
            // Telegram chooses its notification branch from those capability checks;
            // inventing missing APIs sends Web A down a path the runtime may not
            // actually support and can corrupt its hasWeb/hasPush notification state.
            if (navigator.permissions && navigator.permissions.query) {
                var nativeQuery = navigator.permissions.query.bind(navigator.permissions);
                navigator.permissions.query = function(desc) {
                    if (desc && (desc.name === 'notifications' || desc.name === 'notification')) {
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

    ensureNotificationPermission();

    // The desktop wrapper owns popup/sound enablement. Web A still has to keep its
    // internal web-notification pipeline enabled, otherwise it returns before our
    // bridge can see the message. Repair stale/failed cached flags for every account;
    // browser push itself is deliberately kept disabled because Electron has no usable
    // push subscription here. If Web A already loaded a broken hasWeb=false value,
    // reload once after repairing the cache so the in-memory state is corrected too.
    function repairTelegramNotificationFlags(){
        try{
            if(!window.indexedDB) return;
            var req=indexedDB.open('tt-data');
            req.onsuccess=function(){
                var db=req.result, tx;
                try{ tx=db.transaction('store','readwrite'); }catch(e){ try{db.close();}catch(_){} return; }
                var store=tx.objectStore('store'), cursor=store.openCursor(), needsReload=false;
                cursor.onsuccess=function(){
                    var c=cursor.result;
                    if(!c)return;
                    var key=String(c.key||'');
                    if(/^tt-global-state(?:_\d+)?$/.test(key)){
                        var v=c.value, byKey=v&&v.settings&&v.settings.byKey;
                        if(byKey){
                            if(byKey.hasWebNotifications!==true){ byKey.hasWebNotifications=true; needsReload=true; }
                            if(byKey.hasPushNotifications!==false){ byKey.hasPushNotifications=false; needsReload=true; }
                            try{ c.update(v); }catch(e){}
                        }
                    }
                    c.continue();
                };
                tx.oncomplete=function(){
                    try{db.close();}catch(_){}
                    var repairKey='__twd_notif_repaired_at';
                    if(needsReload){
                        var now=Date.now(), last=Number(sessionStorage.getItem(repairKey)||0);
                        // Prevent a tight reload loop if Web A writes the stale value again
                        // during startup, but do not suppress future repairs for the whole
                        // tab lifetime (the old permanent marker could make notifications
                        // stop again after a later self-update).
                        if(!last || now-last>5000){
                            sessionStorage.setItem(repairKey,String(now));
                            setTimeout(function(){ location.reload(); },0);
                        }
                    }else{
                        sessionStorage.removeItem(repairKey);
                    }
                };
                tx.onerror=function(){ try{db.close();}catch(_){} };
            };
        }catch(e){}
    }
    repairTelegramNotificationFlags();

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

    // Local Notification is Telegram's fallback when browser push APIs are unavailable.
    // Keep it intercepted as a compatibility path; on normal Electron Web A builds the
    // message notification path below goes through ServiceWorker.postMessage.
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

    function consumeServiceWorkerNotification(msg) {
        try {
            if (!msg || msg.type !== 'showMessageNotification' || !msg.payload) return false;
            var p = msg.payload;
            pushTgNotif({
                title: p.title || '',
                body: p.body || '',
                icon: p.icon || '',
                chatId: p.chatId != null ? String(p.chatId) : '',
                messageId: p.messageId != null ? String(p.messageId) : '',
                isSilent: !!p.isSilent,
            });
            return true;
        } catch (e) { return false; }
    }

    // Hook the ServiceWorker PROTOTYPE, not the current controller object. Web A can
    // replace/re-register its controller at any time. Per-instance hooks therefore
    // disappear with the old ServiceWorker wrapper; this is exactly why the old fixes
    // needed polling and why b56a710 regressed after removing it. A prototype hook is
    // inherited by every current and future controller. Web A or another script can
    // still restore the native prototype method later, so the health loop below verifies
    // the exact installed function and repairs it. Keep a controller-level fallback for
    // engines that forbid patching the prototype.
    function hookServiceWorker() {
        try {
            var proto = window.ServiceWorker && window.ServiceWorker.prototype;
            if (proto && typeof proto.postMessage === 'function') {
                var installedHook = proto.__twdNotifPostMessageHook;
                if (!installedHook || proto.postMessage !== installedHook) {
                    var nativePostMessage = proto.postMessage;
                    var wrappedPostMessage = function(msg) {
                        if (consumeServiceWorkerNotification(msg)) return;
                        return nativePostMessage.apply(this, arguments);
                    };
                    Object.defineProperty(proto, 'postMessage', {
                        configurable: true,
                        writable: true,
                        value: wrappedPostMessage,
                    });
                    Object.defineProperty(proto, '__twdNotifPostMessageHook', {
                        configurable: true,
                        writable: true,
                        value: wrappedPostMessage,
                    });
                    Object.defineProperty(proto, '__twdNotifProtoHooked', {
                        configurable: true,
                        value: true,
                    });
                }
                return;
            }

            var sw = navigator.serviceWorker;
            if (!sw || typeof sw.addEventListener !== 'function') return;
            function wrap(ctrl) {
                if (!ctrl || ctrl.__tgNotifHooked) return;
                try {
                    var orig = ctrl.postMessage;
                    ctrl.postMessage = function(msg) {
                        if (consumeServiceWorkerNotification(msg)) return;
                        return orig.apply(this, arguments);
                    };
                    Object.defineProperty(ctrl, '__tgNotifHooked', { configurable: true, value: true });
                } catch (e) {}
            }
            wrap(sw.controller);
            sw.addEventListener('controllerchange', function() { wrap(sw.controller); });
        } catch (e) {}
    }
    hookServiceWorker();

    function NotificationShim(title, opts) {
        if (!(this instanceof NotificationShim)) return new NotificationShim(title, opts);
        opts = opts || {};
        notify(title, opts);
        // Never inherit from Chromium's native Notification.prototype. Objects that
        // do so without the native internal slots throw "Illegal invocation" when
        // Telegram assigns onclick/reads fields/calls close(). That bug was latent
        // while Web A mostly used the SW path, but breaks the local fallback path.
        this.title = normalizeText(title, '');
        this.body = normalizeText(opts.body, '');
        this.tag = normalizeText(opts.tag, '');
        this.data = opts.data;
        this.icon = normalizeText(opts.icon, '');
        this.badge = normalizeText(opts.badge, '');
        this.lang = normalizeText(opts.lang, '');
        this.dir = normalizeText(opts.dir, '');
        this.silent = !!opts.silent;
        this.onclick = null;
        this.onshow = null;
        this.onerror = null;
        this.onclose = null;
        this._listeners = Object.create(null);
    }
    NotificationShim.prototype.close = function() {
        try { if (typeof this.onclose === 'function') this.onclose.call(this, { type: 'close', target: this }); } catch (e) {}
    };
    NotificationShim.prototype.addEventListener = function(type, cb) {
        if (typeof cb !== 'function') return;
        var a = this._listeners[type] || (this._listeners[type] = []); a.push(cb);
    };
    NotificationShim.prototype.removeEventListener = function(type, cb) {
        var a = this._listeners[type]; if (!a) return;
        this._listeners[type] = a.filter(function(x){ return x !== cb; });
    };
    NotificationShim.prototype.dispatchEvent = function(ev) {
        var type = ev && ev.type; if (!type) return true;
        var a = (this._listeners[type] || []).slice();
        for (var i=0;i<a.length;i++) { try { a[i].call(this, ev); } catch (e) {} }
        var h = this['on'+type]; if (typeof h === 'function') { try { h.call(this, ev); } catch (e) {} }
        return true;
    };

    function permissionsResponse() {
        return Promise.resolve({
            state: 'granted',
            onchange: null,
            addEventListener: function() {},
            removeEventListener: function() {},
            dispatchEvent: function() { return true; },
        });
    }

    Object.defineProperty(NotificationShim, 'permission', { configurable: true, get: function(){ return 'granted'; } });
    Object.defineProperty(NotificationShim, 'maxActions', { configurable: true, get: function(){ return 2; } });
    NotificationShim.requestPermission = function(cb) {
        var p = Promise.resolve('granted');
        if (typeof cb === 'function') p.then(cb);
        return p;
    };

    function installNotificationShim() {
        try {
            Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: NotificationShim });
        } catch (e) {
            try { window.Notification = NotificationShim; } catch (_) {}
        }
    }
    installNotificationShim();

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

    // Long-lived desktop sessions are the important case here. Web A may replace its
    // service-worker controller or another script may restore browser globals hours
    // after startup. Keep the hooks self-healing without generating any network traffic.
    // The slower IndexedDB check repairs Telegram's own persisted notification flags
    // if a failed browser-push attempt flips them later in the session.
    function ensureHealthTimers() {
        if (!window.__twdNotifHealthTimer) {
            window.__twdNotifHealthTimer = setInterval(function() {
                try { hookServiceWorker(); } catch (_) {}
                try { if (window.Notification !== NotificationShim) installNotificationShim(); } catch (_) {}
            }, 30000);
        }
        if (!window.__twdNotifStateRepairTimer) {
            window.__twdNotifStateRepairTimer = setInterval(function() {
                try { repairTelegramNotificationFlags(); } catch (_) {}
            }, 5 * 60 * 1000);
        }
    }
    function repairNotificationInterception() {
        try { ensureNotificationPermission(); } catch (_) {}
        try { hookServiceWorker(); } catch (_) {}
        try { if (window.Notification !== NotificationShim) installNotificationShim(); } catch (_) {}
        try { ensureHealthTimers(); } catch (_) {}
    }
    window.__twdNotifRepair = repairNotificationInterception;
    ensureHealthTimers();
})();