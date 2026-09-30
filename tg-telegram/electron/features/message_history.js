(function () {
    if (window.__twdMessageHistoryStarted) return;
    window.__twdMessageHistoryStarted = true;

    var cfg = window.__twdMessageHistoryConfig || {};
    cfg.scope = cfg.scope === 'chat' || cfg.scope === 'always' ? cfg.scope : 'client';
    function historyEnabled() {
        return cfg.showDeleted === true || cfg.showDisappearing === true ||
            cfg.saveDeleted === true || cfg.saveDisappearing === true || cfg.editHistory === true;
    }

    var records = new Map();
    var recordsByChat = new Map();
    var domTextSnapshots = new Map();
    var deletedDomSnapshots = new Map();
    var deletedDomSnapshotsByChat = new Map();
    var lastContext = null;
    var restoreDeletedQueued = false;
    var persistTimer = null;
    var PERSIST_KEY = '__twd_message_history_v2';
    var MAX_EDITS = 20;
    var MAX_RECORDS = 5000;

    function langRu() {
        return String(document.documentElement.lang || navigator.language || '').toLowerCase().indexOf('ru') === 0;
    }
    function currentChatId() {
        var m = String(location.hash || '').match(/#(-?\d+)/);
        if (m) return m[1];
        var avatar = document.querySelector('#MiddleColumn .MiddleHeader .Avatar[data-peer-id]');
        var peerId = avatar && avatar.getAttribute('data-peer-id');
        return peerId ? String(peerId) : '';
    }
    function keyOf(chatId, messageId) {
        return String(chatId) + ':' + String(messageId);
    }
    function isServerMessageId(messageId) {
        return Number.isInteger(Number(messageId));
    }
    function isValidChatId(chatId) {
        try { return BigInt(String(chatId)) !== 0n; } catch (_) { return false; }
    }
    function isPrivateChatId(chatId) {
        try { return BigInt(String(chatId)) > 0n; } catch (_) { return false; }
    }
    function historyChatAllowed(chatId) {
        if (isPrivateChatId(chatId)) return true;
        try { return BigInt(String(chatId)) < 0n && cfg.savePublic === true; } catch (_) { return false; }
    }
    function chatRecordMap(chatId, create) {
        var key=String(chatId), map=recordsByChat.get(key);
        if(!map&&create){map=new Map();recordsByChat.set(key,map);}
        return map||null;
    }
    function trimRecords() {
        while (records.size > MAX_RECORDS) {
            var key=records.keys().next().value;
            var rec=records.get(key);
            records.delete(key);
            domTextSnapshots.delete(key);
            if(rec){var map=chatRecordMap(rec.chatId,false);if(map){map.delete(String(rec.messageId));if(!map.size)recordsByChat.delete(String(rec.chatId));}}
        }
    }
    function getRecord(chatId, messageId) {
        var map=chatRecordMap(chatId,false);
        return map&&map.get(String(messageId))||null;
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
                ephemeral: false,
                outgoing: false,
                saved: false,
                savedEdits: [],
                persistText: '',
                persistUpdatedAt: 0,
                updatedAt: Number(timestamp) || Date.now()
            };
            records.set(key, rec);
            chatRecordMap(rec.chatId,true).set(rec.messageId,rec);
            trimRecords();
        }
        return rec;
    }
    function recordShouldShow(rec) {
        if (!rec || !rec.deleted) return false;
        return rec.ephemeral ? cfg.showDisappearing === true : cfg.showDeleted === true;
    }
    function saveEnabledFor(rec) {
        if (!rec) return false;
        return rec.ephemeral ? cfg.saveDisappearing === true : cfg.saveDeleted === true;
    }
    function shouldPersistEvent(chatId) {
        if (cfg.scope === 'always') return Promise.resolve(true);
        if (cfg.scope === 'chat') return Promise.resolve(currentChatId() === String(chatId));
        try {
            if (window.tgBridge && typeof window.tgBridge.invoke === 'function') {
                return window.tgBridge.invoke('get_window_state').then(function (state) {
                    // Visible or taskbar-minimized counts as an active process.
                    // Hidden-to-tray is the only normal state where both are false.
                    return !!(state && (state.visible === true || state.minimized === true));
                }).catch(function () { return false; });
            }
        } catch (_) {}
        return Promise.resolve(false);
    }
    function persistNow() {
        try {
            var out = [];
            records.forEach(function (rec) {
                if (!rec || !isValidChatId(rec.chatId) || !isServerMessageId(rec.messageId)) return;
                var savedEdits = Array.isArray(rec.savedEdits) ? rec.savedEdits : [];
                if (!rec.saved && !savedEdits.length) return;
                var persistedText = rec.persistUpdatedAt > 0 ? rec.persistText : rec.text;
                out.push({
                    chatId:String(rec.chatId),messageId:String(rec.messageId),text:String(persistedText||''),
                    edits:savedEdits.slice(-MAX_EDITS).map(function(x){return{text:String(x.text||''),timestamp:Number(x.timestamp)||0};}),
                    deleted:rec.saved===true && rec.deleted===true,ephemeral:rec.ephemeral===true,outgoing:rec.outgoing===true,saved:rec.saved===true,
                    updatedAt:Number(rec.persistUpdatedAt)||0,deletedAt:rec.saved===true?(Number(rec.deletedAt)||0):0
                });
            });
            if (out.length > MAX_RECORDS) out = out.slice(out.length - MAX_RECORDS);
            if (out.length) localStorage.setItem(PERSIST_KEY, JSON.stringify({version:3,records:out}));
            else localStorage.removeItem(PERSIST_KEY);
        } catch (_) {}
    }
    function schedulePersist() {
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(function(){persistTimer=null;persistNow();},80);
    }
    function loadPersisted() {
        try {
            var raw=localStorage.getItem(PERSIST_KEY);if(!raw)return;
            var parsed=JSON.parse(raw),arr=parsed&&Array.isArray(parsed.records)?parsed.records:[],discardedLocal=false;
            arr.slice(-MAX_RECORDS).forEach(function(x){
                if(x&&x.messageId&&!isServerMessageId(x.messageId)){discardedLocal=true;return;}
                if(!x||!isValidChatId(x.chatId)||!x.messageId)return;
                var rec=ensureRecord(x.chatId,x.messageId,x.text,x.updatedAt);
                var persistedEdits=Array.isArray(x.edits)?x.edits.slice(-MAX_EDITS).map(function(e){return{text:String(e&&e.text||''),timestamp:Number(e&&e.timestamp)||0};}):[];
                rec.edits=persistedEdits.slice();
                rec.savedEdits=persistedEdits.slice();
                rec.deleted=x.deleted===true;rec.ephemeral=x.ephemeral===true;rec.outgoing=x.outgoing===true;rec.saved=x.saved===true;
                rec.persistText=String(x.text||'');rec.persistUpdatedAt=Number(x.updatedAt)||0;
                rec.updatedAt=Number(x.updatedAt)||rec.updatedAt;rec.deletedAt=Number(x.deletedAt)||0;
            });
            if(discardedLocal)schedulePersist();
        } catch (_) {}
    }
    function clearSessionRecords() {
        records.clear();recordsByChat.clear();domTextSnapshots.clear();deletedDomSnapshots.clear();deletedDomSnapshotsByChat.clear();lastContext=null;
    }
    function pushEdit(rec, text, timestamp) {
        if (!rec) return false;
        text = String(text == null ? '' : text);
        var last = rec.edits[rec.edits.length - 1];
        if (last && last.text === text) return false;
        rec.edits.push({ text: text, timestamp: Number(timestamp) || Date.now() });
        if (rec.edits.length > MAX_EDITS) rec.edits.splice(0, rec.edits.length - MAX_EDITS);
        return true;
    }
    function persistEditIfAllowed(rec, previousText, currentText, timestamp) {
        if (!rec || cfg.editHistory !== true) return;
        shouldPersistEvent(rec.chatId).then(function (allowed) {
            if (!allowed) return;
            var item={text:String(previousText==null?'':previousText),timestamp:Number(timestamp)||Date.now()};
            var last=rec.savedEdits[rec.savedEdits.length-1];
            if (!last || last.text!==item.text) rec.savedEdits.push(item);
            if (rec.savedEdits.length>MAX_EDITS) rec.savedEdits.splice(0,rec.savedEdits.length-MAX_EDITS);
            rec.persistText=String(currentText==null?'':currentText);
            rec.persistUpdatedAt=Number(timestamp)||Date.now();
            schedulePersist();
        });
    }
    function persistDeletionIfAllowed(rec, timestamp) {
        if (!rec || !saveEnabledFor(rec)) return;
        var text=String(rec.text||'');
        shouldPersistEvent(rec.chatId).then(function (allowed) {
            if (!allowed) return;
            rec.saved=true;
            rec.persistText=text;
            rec.persistUpdatedAt=Number(timestamp)||Date.now();
            schedulePersist();
        });
    }
    function applyHistoryEvent(ev) {
        if (!historyEnabled() || !ev || typeof ev !== 'object') return;
        if (ev.kind === 'new' || ev.kind === 'edit') {
            if (!historyChatAllowed(ev.chatId) || !isServerMessageId(ev.messageId)) return;
            var rec = getRecord(ev.chatId, ev.messageId);
            if (!rec && ev.kind === 'edit' && ev.oldText != null) {
                rec = ensureRecord(ev.chatId, ev.messageId, ev.oldText, ev.timestamp);
            }
            if (!rec) rec = ensureRecord(ev.chatId, ev.messageId, ev.text, ev.timestamp);
            rec.ephemeral = ev.ephemeral === true;
            rec.outgoing = ev.outgoing === true;
            var currentText = String(ev.text == null ? '' : ev.text);
            if (ev.kind === 'edit') {
                var previous = ev.oldText != null ? String(ev.oldText) : String(rec.text || '');
                if (previous !== currentText && pushEdit(rec, previous, ev.timestamp)) {
                    persistEditIfAllowed(rec, previous, currentText, ev.timestamp);
                }
            }
            rec.text = currentText;
            rec.updatedAt = Number(ev.timestamp) || Date.now();
            return;
        }
        if (ev.kind === 'delete' && Array.isArray(ev.items)) {
            ev.items.forEach(function (item) {
                if (!historyChatAllowed(item.chatId) || !isServerMessageId(item.messageId)) return;
                var rec = ensureRecord(item.chatId, item.messageId, item.text, item.timestamp || ev.timestamp);
                if (item.text != null && !rec.text) rec.text = String(item.text);
                rec.ephemeral = item.ephemeral === true;
                rec.outgoing = item.outgoing === true;
                rec.deleted = true;
                rec.deletedAt = Number(item.timestamp || ev.timestamp) || Date.now();
                if (recordShouldShow(rec)) markVisibleDeleted(rec);
                persistDeletionIfAllowed(rec, item.timestamp || ev.timestamp);
            });
        }
    }
    function messageNode(chatId, messageId) {
        if (!historyChatAllowed(chatId) || currentChatId() !== String(chatId)) return null;
        try {
            return document.querySelector('#MiddleColumn .Message[data-message-id="' + CSS.escape(String(messageId)) + '"]');
        } catch (_) { return null; }
    }
    function markNodeDeleted(node, rec) {
        if (!node || !rec || !recordShouldShow(rec)) return;
        node.classList.add('_twd-deleted-message_');
        var host = node.querySelector('.message-content') || node;
        host.querySelectorAll('.quick-reaction').forEach(function (x) { x.remove(); });
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
    function unmarkNodeDeleted(node) {
        if (!node) return;
        node.classList.remove('_twd-deleted-message_');
        node.querySelectorAll('._twd-deleted-trash_').forEach(function (x) { x.remove(); });
    }
    function reconcileDeletedVisibility() {
        var chatId=currentChatId();
        if(!chatId||!historyChatAllowed(chatId))return;
        document.querySelectorAll('#MiddleColumn .Message[data-message-id]').forEach(function(node){
            var rec=getRecord(chatId,String(node.getAttribute('data-message-id')||''));
            if(!rec||!rec.deleted){if(node.querySelector('._twd-deleted-trash_'))unmarkNodeDeleted(node);return;}
            if(recordShouldShow(rec))markNodeDeleted(node,rec);
            else node.remove();
        });
        queueRestoreDeleted();
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
            if (rec && rec.deleted) {
                if (recordShouldShow(rec)) markNodeDeleted(msg, rec);
                else { msg.remove(); return; }
            }
            trackDomMessage(msg);
        });
    }
    function visibleMessageText(msg) {
        if (!msg) return '';
        var selectors = ['.message-text','.text-content','.TranslatableMessage','.message-content .content-inner','.message-content .caption'];
        for (var i = 0; i < selectors.length; i++) {
            var el = msg.querySelector(selectors[i]);
            if (!el) continue;
            var clone = el.cloneNode(true);
            clone.querySelectorAll('.MessageMeta,.message-time,.Reactions,.ReactionList,.quick-reaction,.message-action-buttons-container,button').forEach(function (x) { x.remove(); });
            var text = String(clone.innerText || clone.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
            if (text) return text;
        }
        return '';
    }
    function trackDomMessage(msg) {
        if (!msg || !msg.matches || !msg.matches('.Message[data-message-id]')) return;
        if (msg.classList.contains('_twd-deleted-clone_') || msg.classList.contains('is-deleting') || msg.classList.contains('is-dissolving')) return;
        var chatId = currentChatId();
        var messageId = String(msg.getAttribute('data-message-id') || '');
        if (!chatId || !messageId || !historyChatAllowed(chatId) || !isServerMessageId(messageId)) return;
        var text = visibleMessageText(msg);
        var key = keyOf(chatId, messageId);
        if (!domTextSnapshots.has(key)) {
            domTextSnapshots.set(key, text);
            var initial = getRecord(chatId, messageId);
            if (!initial) initial=ensureRecord(chatId, messageId, text, Date.now());
            initial.outgoing = msg.classList.contains('own');
            return;
        }
        var previous = String(domTextSnapshots.get(key) || '');
        if (previous === text) return;
        domTextSnapshots.set(key, text);
        var rec = ensureRecord(chatId, messageId, previous, Date.now());
        rec.outgoing = msg.classList.contains('own');
        var ts=Date.now();
        if (pushEdit(rec, previous, ts)) persistEditIfAllowed(rec, previous, text, ts);
        rec.text = text;
        rec.updatedAt = ts;
    }
    function trackMutationMessage(node) {
        var el = node instanceof Element ? node : node && node.parentElement;
        var msg = el && el.closest && el.closest('#MiddleColumn .Message[data-message-id]');
        if (msg) trackDomMessage(msg);
    }
    function prepareDeletedClone(node, rec) {
        if (!node || !node.classList) return node;
        node.classList.remove('is-deleting', 'is-dissolving', 'is-selected', 'is-in-selection-mode');
        node.classList.add('_twd-deleted-clone_');
        markNodeDeleted(node, rec);
        return node;
    }
    function deletedSnapshotMap(chatId, create) {
        var key=String(chatId), map=deletedDomSnapshotsByChat.get(key);
        if(!map&&create){map=new Map();deletedDomSnapshotsByChat.set(key,map);}
        return map||null;
    }
    function setDeletedSnapshot(snapshot) {
        var chatId=String(snapshot.chatId), messageId=String(snapshot.messageId), key=keyOf(chatId,messageId);
        deletedDomSnapshots.set(key,snapshot);
        deletedSnapshotMap(chatId,true).set(messageId,snapshot);
        while(deletedDomSnapshots.size>MAX_RECORDS){
            var oldestKey=deletedDomSnapshots.keys().next().value;
            var oldest=deletedDomSnapshots.get(oldestKey);
            deletedDomSnapshots.delete(oldestKey);
            if(oldest){var map=deletedSnapshotMap(oldest.chatId,false);if(map){map.delete(String(oldest.messageId));if(!map.size)deletedDomSnapshotsByChat.delete(String(oldest.chatId));}}
        }
    }
    function captureDeletingMessage(msg) {
        if (!msg || !msg.matches || !msg.matches('.Message[data-message-id]')) return;
        if (msg.classList.contains('_twd-deleted-clone_')) return;
        if (!msg.classList.contains('is-deleting') && !msg.classList.contains('is-dissolving')) return;
        var chatId = currentChatId();
        var messageId = String(msg.getAttribute('data-message-id') || '');
        if (!chatId || !messageId || !historyChatAllowed(chatId) || !isServerMessageId(messageId)) return;
        var rec = getRecord(chatId,messageId) || ensureRecord(chatId, messageId, visibleMessageText(msg), Date.now());
        var show = rec.ephemeral ? cfg.showDisappearing === true : cfg.showDeleted === true;
        rec.text = rec.text || visibleMessageText(msg);
        rec.outgoing = msg.classList.contains('own');
        rec.deleted = true;
        rec.deletedAt = Date.now();
        if (show) {
            var clone = msg.cloneNode(true);
            prepareDeletedClone(clone, rec);
            // Keep the visual snapshot without retaining an entire detached live DOM tree.
            // cloneNode does not preserve event listeners anyway; serialized markup restores
            // the same static message/media structure while allowing Blink to reclaim nodes.
            setDeletedSnapshot({ chatId: String(chatId), messageId: messageId, html: clone.outerHTML });
        }
        persistDeletionIfAllowed(rec, rec.deletedAt);
    }
    function createDeletedNode(rec) {
        var node=document.createElement('div');
        node.id='message-'+String(rec.messageId);
        node.className='shown open Message message-list-item allow-selection first-in-group last-in-group'+(rec.outgoing?' own':'');
        node.setAttribute('data-message-id',String(rec.messageId));
        var wrap=document.createElement('div');wrap.className='message-content-wrapper can-select-text';
        var content=document.createElement('div');content.className='message-content text has-shadow has-solid-background has-footer';
        var inner=document.createElement('div');inner.className='content-inner';
        var text=document.createElement('div');text.className='text-content clearfix';text.textContent=rec.text||(langRu()?'[без текста]':'[no text]');
        inner.appendChild(text);content.appendChild(inner);wrap.appendChild(content);node.appendChild(wrap);
        return node;
    }
    function insertDeletedSnapshot(snapshot) {
        if (!snapshot || !historyChatAllowed(snapshot.chatId) || currentChatId() !== String(snapshot.chatId)) return;
        var messageId = String(snapshot.messageId || '');
        if (!messageId || !isServerMessageId(messageId)) return;
        var selector = '#MiddleColumn .Message[data-message-id="' + CSS.escape(messageId) + '"]';
        var existing = document.querySelector(selector);
        var rec = getRecord(snapshot.chatId, messageId);
        if (!rec || !recordShouldShow(rec)) return;
        if (existing) { markNodeDeleted(existing, rec); return; }
        var list = document.querySelector('#MiddleColumn .MessageList .messages-container') || document.querySelector('#MiddleColumn .MessageList');
        if (!list) return;
        var node=null;
        if(snapshot.html){
            try{
                var tpl=document.createElement('template');tpl.innerHTML=String(snapshot.html).trim();
                node=tpl.content.firstElementChild;
            }catch(_){}
        }
        if(!node)node=createDeletedNode(rec);
        prepareDeletedClone(node, rec);
        var numericId = Number(messageId);
        var rows = Array.from(list.querySelectorAll('.Message[data-message-id]'));
        var before = null;
        if (Number.isFinite(numericId)) {
            for (var i = 0; i < rows.length; i++) {
                var rowId = Number(rows[i].getAttribute('data-message-id'));
                if (Number.isFinite(rowId) && rowId > numericId) { before = rows[i]; break; }
            }
        }
        if (before && before.parentNode) before.parentNode.insertBefore(node, before);
        else list.appendChild(node);
    }
    function restoreDeletedForCurrentChat() {
        if (!cfg.showDeleted && !cfg.showDisappearing) return;
        var chatId = currentChatId();
        if (!chatId || !historyChatAllowed(chatId)) return;
        var snapshots=deletedSnapshotMap(chatId,false);
        if(snapshots)snapshots.forEach(insertDeletedSnapshot);
        var chatRecords=chatRecordMap(chatId,false);
        if(!chatRecords)return;
        chatRecords.forEach(function(rec){
            if(!recordShouldShow(rec))return;
            if(!snapshots||!snapshots.has(String(rec.messageId)))insertDeletedSnapshot({chatId:rec.chatId,messageId:rec.messageId,html:''});
        });
    }
    function queueRestoreDeleted() {
        if (restoreDeletedQueued) return;
        restoreDeletedQueued = true;
        requestAnimationFrame(function () {
            restoreDeletedQueued = false;
            restoreDeletedForCurrentChat();
        });
    }
    function inspectRemoved(node) {
        if (!(node instanceof Element)) return;
        if (node.matches && node.matches('.Message[data-message-id]')) captureDeletingMessage(node);
        if (node.querySelectorAll) {
            node.querySelectorAll('.Message[data-message-id]').forEach(captureDeletingMessage);
        }
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
    function stripDeletedReactionMenu() {
        if (!lastContext || !lastContext.deleted || Date.now() - lastContext.ts > 2500) return;
        var menu = document.querySelector('.MessageContextMenu');
        if (!menu) return;
        menu.querySelectorAll('.ReactionSelector').forEach(function (x) { x.remove(); });
        menu.classList.remove('with-reactions');
    }
    function injectHistoryMenuItem() {
        if (!lastContext || Date.now() - lastContext.ts > 2500) return;
        var rec = getRecord(lastContext.chatId, lastContext.messageId);
        if (!rec || !rec.edits || !rec.edits.length) return;
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
        item.appendChild(document.createTextNode(langRu() ? 'Посмотреть изменения' : 'View changes'));
        item.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            closeContextMenu();
            showEditHistory(rec);
        });
        items.appendChild(item);
        if (typeof window.__twdFitMenuViewport === 'function') {
            window.__twdFitMenuViewport(items);
            setTimeout(function () { window.__twdFitMenuViewport(items); }, 120);
        }
    }
    document.addEventListener('contextmenu', function (e) {
        if (!historyEnabled()) { lastContext = null; return; }
        var msg = e.target && e.target.closest && e.target.closest('#MiddleColumn .Message[data-message-id]');
        if (!msg) {
            lastContext = null;
            return;
        }
        var chatId = currentChatId();
        if (!historyChatAllowed(chatId)) {
            lastContext = null;
            return;
        }
        lastContext = {
            chatId: chatId,
            messageId: String(msg.getAttribute('data-message-id') || ''),
            deleted: !!msg.querySelector('._twd-deleted-trash_'),
            ts: Date.now()
        };
        setTimeout(stripDeletedReactionMenu, 0);
        setTimeout(stripDeletedReactionMenu, 60);
        setTimeout(stripDeletedReactionMenu, 140);
        setTimeout(injectHistoryMenuItem, 0);
        setTimeout(injectHistoryMenuItem, 60);
        setTimeout(injectHistoryMenuItem, 140);
    }, true);

    var observedMessageList = null;
    var messageListTimer = null;
    var historyNavHooksInstalled = false;
    var messageListObserver = new MutationObserver(function (mutations) {
        var treeChanged = false;
        mutations.forEach(function (mutation) {
            if (mutation.type === 'attributes') {
                captureDeletingMessage(mutation.target);
                return;
            }
            mutation.addedNodes.forEach(inspectAdded);
            mutation.removedNodes.forEach(inspectRemoved);
            if (mutation.addedNodes.length || mutation.removedNodes.length) treeChanged = true;
        });
        if (treeChanged) queueRestoreDeleted();
    });
    function bindMessageList() {
        if(!historyEnabled()){
            messageListObserver.disconnect();
            observedMessageList=null;
            return;
        }
        var list=document.querySelector('#MiddleColumn .MessageList');
        if(list===observedMessageList)return;
        messageListObserver.disconnect();
        observedMessageList=list||null;
        if(!list)return;
        messageListObserver.observe(list,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
        list.querySelectorAll('.Message[data-message-id]').forEach(trackDomMessage);
        queueRestoreDeleted();
    }
    function queueBindMessageList() {
        if(!historyEnabled())return;
        bindMessageList();
        setTimeout(bindMessageList,60);
        setTimeout(bindMessageList,180);
        setTimeout(bindMessageList,500);
    }
    function startAddedObserver() {
        if(!historyEnabled())return;
        bindMessageList();
        if(!messageListTimer)messageListTimer=setInterval(bindMessageList,1000);
        if(historyNavHooksInstalled)return;
        historyNavHooksInstalled=true;
        window.addEventListener('popstate',queueBindMessageList);
        window.addEventListener('hashchange',queueBindMessageList);
        ['pushState','replaceState'].forEach(function(k){
            var orig=history[k];
            if(typeof orig!=='function'||orig.__twdHistoryWrapped)return;
            function wrapped(){var result=orig.apply(this,arguments);queueBindMessageList();return result;}
            wrapped.__twdHistoryWrapped=true;
            history[k]=wrapped;
        });
    }
    function stopAddedObserver() {
        messageListObserver.disconnect();
        observedMessageList=null;
        if(messageListTimer){clearInterval(messageListTimer);messageListTimer=null;}
    }

    function ensureStyle() {
        if (document.getElementById('_twd-message-history-style_')) return;
        var style = document.createElement('style');
        style.id = '_twd-message-history-style_';
        style.textContent = [
            '._twd-deleted-message_ .message-content,.message-content:has(>._twd-deleted-trash_){outline:2px dashed var(--color-error,#e65b5b);outline-offset:1px;position:relative;overflow:visible;}',
            '._twd-deleted-message_ .quick-reaction,.message-content:has(>._twd-deleted-trash_) .quick-reaction{display:none!important;pointer-events:none!important;}',
            '._twd-deleted-message_ .Reactions,._twd-deleted-message_ .ReactionList,.Message:has(._twd-deleted-trash_) .Reactions,.Message:has(._twd-deleted-trash_) .ReactionList{pointer-events:none!important;}',
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
        configure: function (next) {
            Object.assign(cfg,next||{});
            cfg.scope=cfg.scope==='chat'||cfg.scope==='always'?cfg.scope:'client';
            window.__twdMessageHistoryConfig=Object.assign({},window.__twdMessageHistoryConfig||{},cfg);
            if(historyEnabled())startAddedObserver();else stopAddedObserver();
            reconcileDeletedVisibility();
            return Object.assign({},cfg);
        },
        clear: function () {
            if(persistTimer){clearTimeout(persistTimer);persistTimer=null;}
            clearSessionRecords();
            try{localStorage.removeItem(PERSIST_KEY);}catch(_){}
            var queue = window.__twdHistoryUpdateQueue;
            if (Array.isArray(queue)) queue.splice(0, queue.length);
            document.querySelectorAll('._twd-deleted-trash_').forEach(function (x) { x.remove(); });
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
                deleted: rec.deleted === true,
                ephemeral: rec.ephemeral === true,
                outgoing: rec.outgoing === true,
                saved: rec.saved === true
            } : null;
        }
    };

    ensureStyle();
    loadPersisted();
    drainQueue();
    if(historyEnabled())startAddedObserver();
})();
