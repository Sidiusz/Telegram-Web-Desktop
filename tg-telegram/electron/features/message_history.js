(function () {
    if (window.__twdMessageHistoryStarted) return;
    window.__twdMessageHistoryStarted = true;

    var cfg = window.__twdMessageHistoryConfig || {};
    if (!cfg.showDeleted && !cfg.editHistory) return;
    if (!window.tgBridge || typeof window.tgBridge.invoke !== 'function') return;

    var invoke = function (cmd, args) { return window.tgBridge.invoke(cmd, args || {}); };
    var seen = new Map();
    var records = new Map();
    var currentChat = '';
    var lastFetch = 0;
    var syncing = false;
    var pendingSync = new Map();
    var observer = null;

    function langRu() {
        return String(document.documentElement.lang || navigator.language || '').toLowerCase().indexOf('ru') === 0;
    }
    function currentChatId() {
        var avatar = document.querySelector('#MiddleColumn .MiddleHeader .Avatar[data-peer-id]');
        var peerId = avatar && avatar.getAttribute('data-peer-id');
        if (peerId) return String(peerId);
        // Legacy Web A builds exposed the active peer in location.hash.
        var m = String(location.hash || '').match(/#(-?\d+)/);
        return m ? m[1] : '';
    }
    function normalizeText(v) {
        return String(v == null ? '' : v).replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    function messageText(msg) {
        var selectors = [
            '.message-text',
            '.text-content',
            '.TranslatableMessage',
            '.message-content .content-inner',
            '.message-content .caption'
        ];
        for (var i = 0; i < selectors.length; i++) {
            var el = msg.querySelector(selectors[i]);
            if (el) {
                var t = normalizeText(el.innerText || el.textContent || '');
                if (t) return t;
            }
        }
        var content = msg.querySelector('.message-content');
        if (!content) return '';
        var clone = content.cloneNode(true);
        clone.querySelectorAll('.message-time,.MessageMeta,.Reactions,.ReactionList,.quick-reaction,.message-action-buttons-container,button').forEach(function (x) { x.remove(); });
        return normalizeText(clone.innerText || clone.textContent || '');
    }
    function senderText(msg) {
        var el = msg.querySelector('.sender-title,.message-title,.SenderName,.MessageSender,.peer-title');
        return normalizeText(el && (el.innerText || el.textContent || ''));
    }
    function timeText(msg) {
        var el = msg.querySelector('.message-time,.MessageMeta time,.MessageMeta,.time');
        return normalizeText(el && (el.innerText || el.textContent || '')).slice(0, 128);
    }
    function safeHtml(msg) {
        try {
            var clone = msg.cloneNode(true);
            clone.classList.remove('_twd-deleted-clone_', 'is-deleting', 'is-dissolving');
            clone.querySelectorAll('script,iframe,object,embed,form,input,textarea,select,._twd-edit-history-badge_,._twd-deleted-mark_').forEach(function (x) { x.remove(); });
            clone.querySelectorAll('[id]').forEach(function (x) { x.removeAttribute('id'); });
            clone.querySelectorAll('*').forEach(function (x) {
                Array.from(x.attributes || []).forEach(function (a) {
                    if (/^on/i.test(a.name)) x.removeAttribute(a.name);
                });
            });
            return clone.outerHTML.slice(0, 65536);
        } catch (_) { return ''; }
    }
    function snapshot(msg, chatId) {
        if (!msg || msg.classList.contains('_twd-deleted-clone_')) return null;
        var mid = msg.getAttribute('data-message-id');
        if (!mid || !chatId) return null;
        return {
            chatId: String(chatId),
            messageId: String(mid),
            text: messageText(msg),
            html: safeHtml(msg),
            own: msg.classList.contains('own'),
            sender: senderText(msg),
            timeText: timeText(msg),
            timestamp: Date.now()
        };
    }
    function keyOf(chatId, mid) { return String(chatId) + ':' + String(mid); }

    function queueSnapshot(snap) {
        if (!snap) return;
        var k = keyOf(snap.chatId, snap.messageId);
        var prev = seen.get(k);
        if (prev && prev.text === snap.text && prev.html === snap.html) return;
        seen.set(k, { text: snap.text, html: snap.html });
        pendingSync.set(k, snap);
    }
    function flushSync() {
        if (syncing || !pendingSync.size) return;
        syncing = true;
        var items = Array.from(pendingSync.values()).slice(0, 300);
        items.forEach(function (x) { pendingSync.delete(keyOf(x.chatId, x.messageId)); });
        invoke('history_sync', { items: items, trackEdits: cfg.editHistory === true })
            .catch(function () {})
            .finally(function () { syncing = false; if (pendingSync.size) setTimeout(flushSync, 250); });
    }
    function inspectDeletingMessage(msg, chatId) {
        if (!cfg.showDeleted || !msg || !chatId || !msg.matches('.Message[data-message-id]')) return;
        if (msg.classList.contains('_twd-deleted-clone_')) return;
        if (!msg.classList.contains('is-deleting') && !msg.classList.contains('is-dissolving')) return;
        var snap = snapshot(msg, chatId);
        if (!snap) return;

        var k = keyOf(snap.chatId, snap.messageId);
        seen.set(k, { text: snap.text, html: snap.html });
        pendingSync.delete(k);

        // Persist the final visible snapshot first. Only after that mark it deleted,
        // so a message that was created and deleted between two periodic scans is
        // still recoverable.
        invoke('history_sync', { items: [snap], trackEdits: cfg.editHistory === true })
            .then(function () {
                return invoke('history_mark_deleted', {
                    items: [{ chatId: snap.chatId, messageId: snap.messageId }]
                });
            })
            .then(function () {
                lastFetch = 0;
                fetchRecords(true);
            })
            .catch(function () {});
    }

    function ensureObserver() {
        var list = document.querySelector('#MiddleColumn .MessageList');
        if (!list) return;
        if (observer && observer._target === list) return;
        if (observer) observer.disconnect();
        observer = new MutationObserver(function (mutations) {
            var chatId = currentChatId();
            mutations.forEach(function (m) {
                if (m.type === 'attributes' && m.target instanceof Element) {
                    inspectDeletingMessage(m.target, chatId);
                    return;
                }
                m.addedNodes.forEach(function (n) {
                    if (!(n instanceof Element)) return;
                    if (n.matches && n.matches('.Message[data-message-id]')) inspectDeletingMessage(n, chatId);
                    if (n.querySelectorAll) n.querySelectorAll('.Message[data-message-id].is-deleting,.Message[data-message-id].is-dissolving').forEach(function (msg) {
                        inspectDeletingMessage(msg, chatId);
                    });
                });
            });
        });
        observer._target = list;
        observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }

    function parseDeletedNode(rec) {
        var node = null;
        if (rec.html) {
            try {
                var t = document.createElement('template');
                t.innerHTML = rec.html.trim();
                node = t.content.firstElementChild;
            } catch (_) {}
        }
        if (!node || !node.classList || !node.classList.contains('Message')) {
            node = document.createElement('div');
            node.className = 'Message _twd-deleted-fallback_';
            var box = document.createElement('div');
            box.className = '_twd-deleted-fallback-box_';
            box.textContent = rec.text || (langRu() ? 'Удалённое сообщение' : 'Deleted message');
            node.appendChild(box);
        }
        node.classList.remove('is-deleting', 'is-dissolving');
        node.classList.add('_twd-deleted-clone_');
        node.setAttribute('data-message-id', rec.messageId);
        node.setAttribute('data-twd-history-key', keyOf(rec.chatId, rec.messageId));
        node.querySelectorAll('a,button,[role="button"]').forEach(function (x) {
            x.removeAttribute('href'); x.removeAttribute('role'); x.removeAttribute('tabindex');
            x.style.pointerEvents = 'none';
        });
        var content = node.querySelector('.message-content') || node;
        if (!content.querySelector('._twd-deleted-mark_')) {
            var mark = document.createElement('span');
            mark.className = '_twd-deleted-mark_';
            mark.textContent = langRu() ? 'Удалено' : 'Deleted';
            content.appendChild(mark);
        }
        return node;
    }

    function insertDeleted(rec) {
        var list = document.querySelector('#MiddleColumn .MessageList .messages-container') ||
                   document.querySelector('#MiddleColumn .MessageList');
        if (!list) return;
        var selector = '._twd-deleted-clone_[data-message-id="' + CSS.escape(String(rec.messageId)) + '"]';
        if (list.querySelector(selector)) return;
        if (document.querySelector('#MiddleColumn .Message[data-message-id="' + CSS.escape(String(rec.messageId)) + '"]:not(._twd-deleted-clone_)')) return;

        var node = parseDeletedNode(rec);
        var n = Number(rec.messageId);
        var rows = Array.from(list.querySelectorAll(':scope > .Message[data-message-id], :scope > div > .Message[data-message-id]'));
        var before = null;
        if (Number.isFinite(n)) {
            for (var i = 0; i < rows.length; i++) {
                var x = Number(rows[i].getAttribute('data-message-id'));
                if (Number.isFinite(x) && x > n) { before = rows[i]; break; }
            }
        }
        if (before && before.parentNode) before.parentNode.insertBefore(node, before);
        else list.appendChild(node);
    }

    function showEditHistory(rec) {
        var old = document.getElementById('_twd-history-modal_');
        if (old) old.remove();
        var overlay = document.createElement('div');
        overlay.id = '_twd-history-modal_';
        overlay.className = '_twd-history-modal_';
        var box = document.createElement('div');
        box.className = '_twd-history-modal-box_';
        var head = document.createElement('div');
        head.className = '_twd-history-modal-head_';
        var title = document.createElement('strong');
        title.textContent = langRu() ? 'История редактирования' : 'Edit history';
        var close = document.createElement('button');
        close.type = 'button'; close.textContent = '×'; close.className = '_twd-history-close_';
        close.onclick = function () { overlay.remove(); };
        head.append(title, close);
        box.appendChild(head);

        var versions = (rec.edits || []).slice();
        versions.push({ text: rec.text || '', timestamp: Date.now(), current: true });
        versions.forEach(function (v, i) {
            var item = document.createElement('div');
            item.className = '_twd-history-version_';
            var meta = document.createElement('div');
            meta.className = '_twd-history-version-meta_';
            meta.textContent = (v.current ? (langRu() ? 'Текущая версия' : 'Current version') :
                ((langRu() ? 'Версия ' : 'Version ') + (i + 1))) +
                (v.timestamp ? ' · ' + new Date(v.timestamp).toLocaleString() : '');
            var text = document.createElement('div');
            text.className = '_twd-history-version-text_';
            text.textContent = v.text || (langRu() ? '[без текста]' : '[no text]');
            item.append(meta, text); box.appendChild(item);
        });
        overlay.appendChild(box);
        overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    function decorateEdited(rec) {
        if (!cfg.editHistory || !rec.edits || !rec.edits.length) return;
        var msg = document.querySelector('#MiddleColumn .Message[data-message-id="' + CSS.escape(String(rec.messageId)) + '"]:not(._twd-deleted-clone_)');
        if (!msg || msg.querySelector('._twd-edit-history-badge_')) return;
        var host = msg.querySelector('.message-content') || msg;
        var badge = document.createElement('button');
        badge.type = 'button';
        badge.className = '_twd-edit-history-badge_';
        badge.textContent = (langRu() ? 'История' : 'History') + ' · ' + rec.edits.length;
        badge.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); showEditHistory(rec); });
        host.appendChild(badge);
    }

    function renderRecords() {
        records.forEach(function (rec) {
            if (rec.deleted && cfg.showDeleted) insertDeleted(rec);
            if (rec.edits && rec.edits.length && cfg.editHistory) decorateEdited(rec);
        });
    }

    function fetchRecords(force) {
        var chatId = currentChatId();
        if (!chatId) return;
        var now = Date.now();
        if (!force && chatId === currentChat && now - lastFetch < 1800) return;
        currentChat = chatId;
        lastFetch = now;
        invoke('history_get_chat', { chatId: chatId }).then(function (items) {
            if (chatId !== currentChatId()) return;
            records.clear();
            (items || []).forEach(function (r) { records.set(keyOf(r.chatId, r.messageId), r); });
            renderRecords();
        }).catch(function () {});
    }

    function scan() {
        var chatId = currentChatId();
        if (!chatId) return;
        ensureObserver();
        document.querySelectorAll('#MiddleColumn .Message[data-message-id]:not(._twd-deleted-clone_)').forEach(function (msg) {
            if (msg.classList.contains('is-deleting') || msg.classList.contains('is-dissolving')) return;
            var snap = snapshot(msg, chatId);
            if (snap) queueSnapshot(snap);
        });
        flushSync();

        fetchRecords(false);
        renderRecords();
    }

    function ensureStyle() {
        if (document.getElementById('_twd-message-history-style_')) return;
        var s = document.createElement('style');
        s.id = '_twd-message-history-style_';
        s.textContent = [
            '._twd-deleted-clone_{opacity:.72!important;filter:saturate(.65);pointer-events:none!important;}',
            '._twd-deleted-clone_ .message-content{outline:1px dashed color-mix(in srgb,var(--color-error,#e65b5b) 65%,transparent);position:relative;}',
            '._twd-deleted-mark_{display:inline-block;margin:.25rem .35rem 0;font-size:.72rem;font-weight:600;color:var(--color-error,#e65b5b);}',
            '._twd-deleted-fallback_{display:flex;padding:.25rem 1rem;}',
            '._twd-deleted-fallback-box_{max-width:32rem;border-radius:12px;padding:.55rem .75rem;background:var(--color-background-compact-menu,#242424);color:var(--color-text-secondary,#aaa);}',
            '._twd-edit-history-badge_{display:block;border:0;background:none;padding:.15rem .35rem 0;margin:0;color:var(--color-links,#4ea4f6);font:inherit;font-size:.7rem;cursor:pointer;}',
            '._twd-history-modal_{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:1.5rem;}',
            '._twd-history-modal-box_{width:min(36rem,100%);max-height:min(75vh,48rem);overflow:auto;background:var(--color-background,#212121);color:var(--color-text,#fff);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.45);padding:1rem;}',
            '._twd-history-modal-head_{display:flex;align-items:center;justify-content:space-between;font-size:1.05rem;margin-bottom:.75rem;}',
            '._twd-history-close_{border:0;background:none;color:inherit;font-size:1.6rem;cursor:pointer;}',
            '._twd-history-version_{padding:.7rem .8rem;border-radius:10px;background:var(--color-background-secondary,#181818);margin-top:.5rem;}',
            '._twd-history-version-meta_{font-size:.72rem;color:var(--color-text-secondary,#aaa);margin-bottom:.35rem;}',
            '._twd-history-version-text_{white-space:pre-wrap;overflow-wrap:anywhere;}'
        ].join('');
        (document.head || document.documentElement).appendChild(s);
    }

    ensureStyle();
    setInterval(scan, 900);
    window.addEventListener('hashchange', function () {
        currentChat = '';
        lastFetch = 0;
        records.clear();
        document.querySelectorAll('._twd-deleted-clone_,._twd-edit-history-badge_').forEach(function (x) { x.remove(); });
        setTimeout(scan, 100);
    });
    setTimeout(scan, 250);
})();
