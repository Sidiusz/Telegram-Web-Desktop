(function () {
    if (window.__twdMessageHistoryStarted) return;
    window.__twdMessageHistoryStarted = true;

    var cfg = window.__twdMessageHistoryConfig || {};
    if (!cfg.showDeleted && !cfg.editHistory) return;

    var records = new Map();
    var lastContext = null;
    var MAX_EDITS = 20;
    var MAX_RECORDS = 5000;

    function langRu() {
        return String(document.documentElement.lang || navigator.language || '').toLowerCase().indexOf('ru') === 0;
    }
    function currentChatId() {
        var avatar = document.querySelector('#MiddleColumn .MiddleHeader .Avatar[data-peer-id]');
        var peerId = avatar && avatar.getAttribute('data-peer-id');
        if (peerId) return String(peerId);
        var m = String(location.hash || '').match(/#(-?\d+)/);
        return m ? m[1] : '';
    }
    function keyOf(chatId, messageId) {
        return String(chatId) + ':' + String(messageId);
    }
    function trimRecords() {
        while (records.size > MAX_RECORDS) records.delete(records.keys().next().value);
    }
    function getRecord(chatId, messageId) {
        return records.get(keyOf(chatId, messageId)) || null;
    }
    function ensureRecord(chatId, messageId, text, timestamp) {
        var key = keyOf(chatId, messageId);
        var rec = records.get(key);
        if (!rec) {
            rec = {
                chatId: String(chatId),
                messageId: String(messageId),
                text: String(text == null ? '' : text),
                edits: [],
                deleted: false,
                updatedAt: Number(timestamp) || Date.now()
            };
            records.set(key, rec);
            trimRecords();
        }
        return rec;
    }
    function pushEdit(rec, text, timestamp) {
        if (!rec || !cfg.editHistory) return;
        text = String(text == null ? '' : text);
        var last = rec.edits[rec.edits.length - 1];
        if (last && last.text === text) return;
        rec.edits.push({ text: text, timestamp: Number(timestamp) || Date.now() });
        if (rec.edits.length > MAX_EDITS) rec.edits.splice(0, rec.edits.length - MAX_EDITS);
    }
    function applyHistoryEvent(ev) {
        if (!ev || typeof ev !== 'object') return;
        if (ev.kind === 'new' || ev.kind === 'edit') {
            var rec = getRecord(ev.chatId, ev.messageId);
            if (!rec && ev.kind === 'edit' && ev.oldText != null) {
                rec = ensureRecord(ev.chatId, ev.messageId, ev.oldText, ev.timestamp);
            }
            if (!rec) rec = ensureRecord(ev.chatId, ev.messageId, ev.text, ev.timestamp);
            if (ev.kind === 'edit') {
                var previous = ev.oldText != null ? String(ev.oldText) : String(rec.text || '');
                if (previous !== String(ev.text == null ? '' : ev.text)) pushEdit(rec, previous, ev.timestamp);
            }
            rec.text = String(ev.text == null ? '' : ev.text);
            rec.updatedAt = Number(ev.timestamp) || Date.now();
            return;
        }
        if (ev.kind === 'delete' && Array.isArray(ev.items)) {
            ev.items.forEach(function (item) {
                var rec = ensureRecord(item.chatId, item.messageId, item.text, item.timestamp || ev.timestamp);
                if (item.text != null && !rec.text) rec.text = String(item.text);
                rec.deleted = true;
                rec.deletedAt = Number(item.timestamp || ev.timestamp) || Date.now();
                markVisibleDeleted(rec);
            });
        }
    }
    function messageNode(chatId, messageId) {
        if (currentChatId() !== String(chatId)) return null;
        try {
            return document.querySelector('#MiddleColumn .Message[data-message-id="' + CSS.escape(String(messageId)) + '"]');
        } catch (_) { return null; }
    }
    function markNodeDeleted(node, rec) {
        if (!node || !rec || !rec.deleted) return;
        node.classList.add('_twd-deleted-message_');
        var host = node.querySelector('.message-content') || node;
        if (!host.querySelector('._twd-deleted-mark_')) {
            var mark = document.createElement('span');
            mark.className = '_twd-deleted-mark_';
            mark.textContent = langRu() ? 'Удалено' : 'Deleted';
            host.appendChild(mark);
        }
        if (!host.querySelector('._twd-deleted-trash_')) {
            var trash = document.createElement('span');
            trash.className = '_twd-deleted-trash_';
            trash.setAttribute('aria-hidden', 'true');
            var icon = document.createElement('i');
            icon.className = 'icon icon-delete';
            trash.appendChild(icon);
            host.appendChild(trash);
        }
    }
    function markVisibleDeleted(rec) {
        markNodeDeleted(messageNode(rec.chatId, rec.messageId), rec);
    }
    function inspectAdded(node) {
        if (!(node instanceof Element)) return;
        var nodes = [];
        if (node.matches && node.matches('#MiddleColumn .Message[data-message-id]')) nodes.push(node);
        if (node.querySelectorAll) {
            node.querySelectorAll('#MiddleColumn .Message[data-message-id], .Message[data-message-id]').forEach(function (x) { nodes.push(x); });
        }
        nodes.forEach(function (msg) {
            var mid = msg.getAttribute('data-message-id');
            var rec = getRecord(currentChatId(), mid);
            if (rec && rec.deleted) markNodeDeleted(msg, rec);
        });
    }
    function closeContextMenu() {
        try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true }));
        } catch (_) {}
    }
    function closeHistoryModal(mo) {
        if (!mo || mo.dataset.closing === '1') return;
        mo.dataset.closing = '1';
        mo.classList.remove('open');
        mo.classList.add('closing');
        setTimeout(function () { if (mo.parentNode) mo.remove(); }, 200);
    }
    function showEditHistory(rec) {
        var old = document.getElementById('_twd-history-modal_');
        if (old) old.remove();

        var mo = document.createElement('div');
        mo.id = '_twd-history-modal_';
        mo.className = '_mo_ _twd-history-native_';

        var dialog = document.createElement('div');
        dialog.className = 'modal-dialog';
        var header = document.createElement('div');
        header.className = 'modal-header';
        var title = document.createElement('div');
        title.className = 'modal-title';
        title.textContent = langRu() ? 'История редактирования' : 'Edit history';
        header.appendChild(title);

        var content = document.createElement('div');
        content.className = 'modal-content';
        var list = document.createElement('div');
        list.className = '_twd-history-list_ custom-scroll';

        var versions = (rec.edits || []).slice();
        versions.push({ text: rec.text || '', timestamp: rec.updatedAt || Date.now(), current: true });
        versions.forEach(function (version, i) {
            var item = document.createElement('div');
            item.className = '_twd-history-version_';
            var meta = document.createElement('div');
            meta.className = '_twd-history-version-meta_';
            meta.textContent = version.current
                ? (langRu() ? 'Текущая версия' : 'Current version')
                : ((langRu() ? 'Версия ' : 'Version ') + (i + 1));
            if (version.timestamp) meta.textContent += ' · ' + new Date(version.timestamp).toLocaleString();
            var text = document.createElement('div');
            text.className = '_twd-history-version-text_';
            text.textContent = version.text || (langRu() ? '[без текста]' : '[no text]');
            item.append(meta, text);
            list.appendChild(item);
        });

        var buttons = document.createElement('div');
        buttons.className = 'dialog-buttons';
        var ok = document.createElement('button');
        ok.className = 'Button text primary confirm-dialog-button';
        ok.textContent = langRu() ? 'ОК' : 'OK';
        buttons.appendChild(ok);
        content.append(list, buttons);
        dialog.append(header, content);
        mo.appendChild(dialog);
        document.body.appendChild(mo);
        requestAnimationFrame(function () { mo.classList.add('open'); });

        var onKey = function (e) {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', onKey, true);
                closeHistoryModal(mo);
            }
        };
        document.addEventListener('keydown', onKey, true);
        ok.addEventListener('click', function () {
            document.removeEventListener('keydown', onKey, true);
            closeHistoryModal(mo);
        });
        mo.addEventListener('click', function (e) {
            if (e.target === mo) {
                document.removeEventListener('keydown', onKey, true);
                closeHistoryModal(mo);
            }
        });
    }
    function injectHistoryMenuItem() {
        if (!lastContext || Date.now() - lastContext.ts > 2500) return;
        var rec = getRecord(lastContext.chatId, lastContext.messageId);
        if (!rec || !cfg.editHistory || !rec.edits || !rec.edits.length) return;
        var items = document.querySelector('.MessageContextMenu_items');
        if (!items || items.querySelector('._twd-edit-history-menu_')) return;

        var item = document.createElement('div');
        item.className = 'MenuItem compact _twd-edit-history-menu_';
        item.setAttribute('role', 'menuitem');
        item.tabIndex = 0;
        var icon = document.createElement('i');
        icon.className = 'icon icon-info';
        icon.setAttribute('aria-hidden', 'true');
        item.appendChild(icon);
        item.appendChild(document.createTextNode(langRu() ? 'История редактирования' : 'Edit history'));
        item.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            closeContextMenu();
            showEditHistory(rec);
        });
        items.appendChild(item);
        _twdFitMenuViewport(items);
        setTimeout(function () { _twdFitMenuViewport(items); }, 120);
    }
    document.addEventListener('contextmenu', function (e) {
        var msg = e.target && e.target.closest && e.target.closest('#MiddleColumn .Message[data-message-id]');
        if (!msg) {
            lastContext = null;
            return;
        }
        lastContext = {
            chatId: currentChatId(),
            messageId: String(msg.getAttribute('data-message-id') || ''),
            ts: Date.now()
        };
        setTimeout(injectHistoryMenuItem, 0);
        setTimeout(injectHistoryMenuItem, 60);
        setTimeout(injectHistoryMenuItem, 140);
    }, true);

    var addedObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            mutation.addedNodes.forEach(inspectAdded);
        });
    });
    function startAddedObserver() {
        if (!document.body) {
            setTimeout(startAddedObserver, 20);
            return;
        }
        addedObserver.observe(document.body, { childList: true, subtree: true });
    }

    function ensureStyle() {
        if (document.getElementById('_twd-message-history-style_')) return;
        var style = document.createElement('style');
        style.id = '_twd-message-history-style_';
        style.textContent = [
            '._twd-deleted-message_ .message-content{outline:1px dashed color-mix(in srgb,var(--color-error,#e65b5b) 62%,transparent);position:relative;overflow:visible;}',
            '._twd-deleted-mark_{display:inline-block;margin:.2rem .35rem 0;font-size:.72rem;font-weight:600;color:var(--color-error,#e65b5b);}',
            '._twd-deleted-trash_{position:absolute;left:calc(100% + .45rem);top:50%;transform:translateY(-50%);width:1.35rem;height:1.35rem;display:flex;align-items:center;justify-content:center;color:var(--color-error,#e65b5b);pointer-events:none;z-index:2;}',
            '._twd-deleted-trash_ .icon{font-size:1rem;line-height:1;}',
            '._twd-history-list_{max-height:min(60vh,34rem);overflow:auto;margin:-.25rem 0 .5rem;}',
            '._twd-history-version_{padding:.72rem .8rem;border-radius:.75rem;background:var(--color-background-secondary,#181818);margin:.5rem 0;}',
            '._twd-history-version-meta_{font-size:.75rem;color:var(--color-text-secondary,#aaa);margin-bottom:.35rem;}',
            '._twd-history-version-text_{white-space:pre-wrap;overflow-wrap:anywhere;}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);
    }

    function drainQueue() {
        var queue = window.__twdHistoryUpdateQueue;
        if (!Array.isArray(queue) || !queue.length) return;
        var copy = queue.splice(0, queue.length);
        copy.forEach(applyHistoryEvent);
    }
    window.addEventListener('__twd_history_update', function (e) {
        applyHistoryEvent(e.detail);
        var queue = window.__twdHistoryUpdateQueue;
        if (Array.isArray(queue) && queue.length) queue.shift();
    });

    window.__twdMessageHistoryApi = {
        clear: function () {
            records.clear();
            lastContext = null;
            var queue = window.__twdHistoryUpdateQueue;
            if (Array.isArray(queue)) queue.splice(0, queue.length);
            document.querySelectorAll('._twd-deleted-mark_,._twd-deleted-trash_').forEach(function (x) { x.remove(); });
            document.querySelectorAll('._twd-deleted-message_').forEach(function (x) { x.classList.remove('_twd-deleted-message_'); });
            setTimeout(function () { location.reload(); }, 60);
            return true;
        },
        get: function (chatId, messageId) {
            var rec = getRecord(chatId, messageId);
            return rec ? {
                chatId: rec.chatId,
                messageId: rec.messageId,
                text: rec.text,
                edits: rec.edits.slice(),
                deleted: rec.deleted === true
            } : null;
        }
    };

    ensureStyle();
    drainQueue();
    startAddedObserver();
})();