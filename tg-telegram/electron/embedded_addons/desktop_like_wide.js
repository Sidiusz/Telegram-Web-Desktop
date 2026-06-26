// @name Desktop-like - Wide Messages
// @version 2.3.0
// @description Left-aligned messages + avatars, plus wide bubbles and footer panel.
// @group desktop_like_chat

(function () {
    // Only for private chats (.MessageList.no-avatars); don't touch .messages-container width/max-width (breaks list virtualization).
    function ensureStyles() {
        if (document.getElementById('addon-desktop-wide') || !document.head) return;
        var s = document.createElement('style');
        s.id = 'addon-desktop-wide';
        s.textContent = `
            /* Widen + left-align in ALL chats, set at load (not live) so virtualization counts it from the start; ~3.5rem gutter clears the scrollbar. */
            #MiddleColumn .MessageList .messages-container {
                max-width: calc(100% - 3.5rem) !important; width: calc(100% - 3.5rem) !important;
                margin-left: 0 !important; margin-right: auto !important;
                box-sizing: border-box !important;
            }

            /* Use width, not just max-width, or the footer shrinks to fit content; not virtualized, safe to resize. */
            #MiddleColumn .middle-column-footer { width: 100% !important; max-width: 100% !important; }
            #MiddleColumn .middle-column-footer .composer-wrapper { width: 100% !important; max-width: 100% !important; margin-left: 0 !important; }

            /* Widen bubbles to match the input field width. */
            #MiddleColumn .Message { --max-width: 70rem !important; }

            /* Flip own messages left only in private 1:1 chats (.tgdl-private); skip channels/groups (broken tail otherwise). */
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message { padding-left: 44px !important; position: relative !important; }
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own { justify-content: flex-start !important; }
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .message-content-wrapper { margin-left: 0 !important; margin-right: auto !important; }
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own > .Avatar { display: none !important; }

            /* Mirror own message's tail to the left; bottom corners match incoming style. */
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .svg-appendix { transform: scaleX(-1) !important; left: -8px !important; right: auto !important; }
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own.last-in-group .message-content {
                border-bottom-left-radius: 0 !important;
                border-bottom-right-radius: var(--border-radius-messages) !important;
            }
            /* Round bubble corners for the left-tail layout; skip media masks on albums (they only round their outer corners natively). */
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .message-content.media,
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message:not(.own) .message-content.media,
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own:not(.is-album) .message-content.media .media-inner,
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own:not(.is-album) .message-content.media .full-media,
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message:not(.own):not(.is-album) .message-content.media .media-inner,
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message:not(.own):not(.is-album) .message-content.media .full-media {
                border-top-left-radius: var(--border-radius-messages) !important;
                border-top-right-radius: var(--border-radius-messages) !important;
                border-bottom-right-radius: var(--border-radius-messages) !important;
                border-bottom-left-radius: var(--border-radius-messages) !important;
            }
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.last-in-group .message-content.media,
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.last-in-group:not(.is-album) .message-content.media .media-inner,
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.last-in-group:not(.is-album) .message-content.media .full-media {
                border-bottom-left-radius: 0 !important;
            }

            /* Groups (avatars shown): flip only OWN messages left with own avatar, like private; others stay native. */
            #MiddleColumn .MessageList:not(.no-avatars) .Message.own { padding-left: 44px !important; position: relative !important; justify-content: flex-start !important; }
            #MiddleColumn .MessageList:not(.no-avatars) .Message.own .message-content-wrapper { margin-left: 0 !important; margin-right: auto !important; }
            #MiddleColumn .MessageList:not(.no-avatars) .Message.own > .Avatar { display: none !important; }
            #MiddleColumn .MessageList:not(.no-avatars) .Message.own .svg-appendix { transform: scaleX(-1) !important; left: -8px !important; right: auto !important; }
            #MiddleColumn .MessageList:not(.no-avatars) .Message.own.last-in-group .message-content {
                border-bottom-left-radius: 0 !important;
                border-bottom-right-radius: var(--border-radius-messages) !important;
            }
            #MiddleColumn .MessageList:not(.no-avatars) .Message.own .message-action-buttons-container { left: auto !important; right: -3rem !important; }

            /* Channels stay native (untouched) — forced alignment broke "Comments" posts on hover. */

            /* Selection mode: shift own bubbles/avatars right so the checkmark lands in its normal slot. */
            #MiddleColumn.tgdl-private .MessageList.no-avatars.select-mode-active .Message.own .message-content-wrapper { transform: translateX(40px) !important; }
            #MiddleColumn.tgdl-private .MessageList.no-avatars.select-mode-active .custom-message-avatar { left: 44px !important; }

            /* Quick-reaction heart: hidden if it'd conflict with the forward/action menu, else placed past the bubble's right edge. */
            #MiddleColumn .MessageList.no-avatars .Message .message-content.has-action-button .quick-reaction,
            #MiddleColumn .MessageList:not(.no-avatars) .Message:not(.own) .message-content.has-action-button .quick-reaction {
                display: none !important;
            }
            #MiddleColumn .MessageList.no-avatars .Message .message-content:not(.has-action-button) .quick-reaction,
            #MiddleColumn .MessageList:not(.no-avatars) .Message:not(.own) .message-content:not(.has-action-button) .quick-reaction {
                left: auto !important; right: -1.9rem !important; bottom: -1px !important; top: auto !important; transform: none !important;
            }
            /* Own messages (flipped left in private chats) get their forward button on the right. */
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .message-action-buttons-container { left: auto !important; right: -3rem !important; }

            #MiddleColumn .Message .EmbeddedMessage .message-text .embedded-text-wrapper { white-space: pre-wrap !important; }

            /* Keep header buttons clickable after closing the right-side column. */
            .MiddleHeader .header-tools,
            .MiddleHeader .HeaderActions { position: relative !important; z-index: 200 !important; }
            .MiddleHeader .HeaderActions, .MiddleHeader .HeaderActions .Button { pointer-events: all !important; }

            /* New TG header island — stretch wide with equal side gaps (centered); keep TG's rounding + top gap. */
            #MiddleColumn .MiddleHeader {
                width: calc(100% - 7rem) !important; max-width: calc(100% - 7rem) !important;
                margin-left: auto !important; margin-right: auto !important;
            }

            @keyframes _tgAvIn_ { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
            .custom-message-avatar {
                position: absolute; left: 4px; bottom: 0; width: 36px; height: 36px;
                border-radius: 50%; overflow: hidden; z-index: 5; pointer-events: none; animation: _tgAvIn_ 0.2s ease;
            }
            .custom-message-avatar img { width: 100% !important; height: 100% !important; object-fit: cover !important; display: block; }
        `;
        document.head.appendChild(s);
    }

    var PARTNER_TTL = 90, MY_TTL = 30;
    var _partnerCache = {};
    var _myAvatar = { src: '', age: 0 };
    var _mySrcMenu = '';
    var _lastPeerId = '';
    var _myPeerId = '';
    var _switchGrace = 0;

    function isPrivate() {
        var list = document.querySelector('#MiddleColumn .MessageList');
        if (!list || !list.classList.contains('no-avatars')) return false;
        // Channels/groups are also no-avatars, but keep a positive data-peer-id while the hash keeps the minus (#-100...).
        var m = (location.hash || '').match(/#(-?\d+)/);
        return !!m && m[1].charAt(0) !== '-';
    }
    function getCurrentPeerId() {
        var el = document.querySelector('.MiddleHeader .ChatInfo .Avatar[data-peer-id]');
        return el ? el.getAttribute('data-peer-id') : '';
    }
    function findMyPeerId() {
        if (_myPeerId) return _myPeerId;
        var pa = document.querySelector('.settings-content .ProfileInfo .Avatar[data-peer-id]');
        if (pa) { _myPeerId = pa.getAttribute('data-peer-id'); return _myPeerId; }
        return '';
    }
    function findMySrc() {
        _myAvatar.age++;
        if (_myAvatar.age >= MY_TTL) { _myAvatar.src = ''; _myAvatar.age = 0; _mySrcMenu = ''; }
        if (_myAvatar.src) return _myAvatar.src;
        var profileImg = document.querySelector('.settings-content .ProfileInfo .Avatar[data-peer-id] img.Avatar__media');
        if (profileImg && profileImg.src && profileImg.src.startsWith('blob:')) { _myAvatar.src = profileImg.src; return _myAvatar.src; }
        var pid = findMyPeerId();
        if (pid) {
            var any = document.querySelector('.Avatar[data-peer-id="' + pid + '"] img.Avatar__media');
            if (any && any.src && any.src.startsWith('blob:')) { _myAvatar.src = any.src; return _myAvatar.src; }
        }
        if (!_mySrcMenu) {
            var menuImg = document.querySelector('.MenuItem.account-menu-item .Avatar img');
            if (menuImg && menuImg.src && (menuImg.src.startsWith('data:') || menuImg.src.startsWith('blob:'))) _mySrcMenu = menuImg.src;
        }
        return _mySrcMenu;
    }
    function findPartnerSrc(peerId) {
        if (!peerId) return '';
        var entry = _partnerCache[peerId];
        if (entry) { entry.age++; if (entry.age < PARTNER_TTL) return entry.src; delete _partnerCache[peerId]; }
        var img = document.querySelector('.MiddleHeader .ChatInfo .Avatar[data-peer-id="' + peerId + '"] img.Avatar__media');
        if (img && img.src && (img.src.startsWith('blob:') || img.src.startsWith('data:'))) {
            _partnerCache[peerId] = { src: img.src, age: 0 };
            return img.src;
        }
        return '';
    }
    function _inject(msg, src) {
        var div = msg.querySelector('.custom-message-avatar');
        if (!div) {
            div = document.createElement('div');
            div.className = 'custom-message-avatar';
            var img = document.createElement('img');
            img.src = src;
            div.appendChild(img);
            msg.appendChild(div);
        } else {
            var img = div.querySelector('img');
            if (img && img.src !== src) img.src = src;
        }
    }
    // Group = negative peer with avatars shown (channels are no-avatars → skip).
    function isGroupChat() {
        if (hashIsPrivate() || !/#-\d/.test(location.hash || '')) return false;
        var list = document.querySelector('#MiddleColumn .MessageList');
        return !!list && !list.classList.contains('no-avatars');
    }
    function injectAvatars() {
        var list = document.querySelector('#MiddleColumn .MessageList');
        if (!list) return;
        // Hash-gated, not .no-avatars — that class flickers on re-renders and wiped avatars mid-frame.
        var priv = hashIsPrivate();
        if (!priv && !isGroupChat()) {
            list.querySelectorAll('.custom-message-avatar').forEach(function (el) { el.remove(); });
            return;
        }
        var mySrc = findMySrc();
        if (mySrc) {
            list.querySelectorAll('.Message.own:not(.last-in-group) .custom-message-avatar').forEach(function (el) { el.remove(); });
            list.querySelectorAll('.Message.own.last-in-group').forEach(function (msg) { _inject(msg, mySrc); });
        }
        if (!priv) return;   // groups: only own avatar; others render native
        // Only set the partner avatar once header and hash agree on the peer; otherwise wait for the next pass to avoid flicker.
        var peerId = getCurrentPeerId();
        var hashPeer = (location.hash || '').match(/#(-?\d+)/);
        hashPeer = hashPeer ? hashPeer[1] : '';
        if (peerId && peerId === hashPeer) {
            var partnerSrc = findPartnerSrc(peerId);
            list.querySelectorAll('.Message:not(.own):not(.last-in-group) .custom-message-avatar').forEach(function (el) { el.remove(); });
            if (partnerSrc) list.querySelectorAll('.Message:not(.own).last-in-group').forEach(function (msg) { _inject(msg, partnerSrc); });
        }
    }
    // Synchronous hash check — waiting on .no-avatars in the DOM lags and makes bubbles jump.
    function hashIsPrivate() {
        var m = (location.hash || '').match(/#(-?\d+)/);
        return !!m && m[1].charAt(0) !== '-';
    }
    function applyPrivateClass() {
        var mc = document.getElementById('MiddleColumn');
        if (mc) mc.classList.toggle('tgdl-private', hashIsPrivate());
    }
    function tick() { ensureStyles(); applyPrivateClass(); injectAvatars(); }
    setInterval(tick, 1000);
    tick();

    // After a chat switch, run a short 150ms burst (~2s) so avatars appear before the next 1s tick.
    var _avT = null;
    function avatarBurst() {
        if (_avT) clearInterval(_avT);
        var n = 0;
        _avT = setInterval(function () {
            injectAvatars();
            if (++n >= 14) { clearInterval(_avT); _avT = null; }
        }, 150);
    }
    function onNav() { applyPrivateClass(); injectAvatars(); avatarBurst(); }

    // TG switches chats via pushState (no hashchange) — patch it to apply .tgdl-private synchronously and avoid a flash of own bubbles.
    ['pushState', 'replaceState'].forEach(function (k) {
        var orig = history[k];
        if (typeof orig !== 'function') return;
        history[k] = function () {
            var r = orig.apply(this, arguments);
            try { onNav(); } catch (e) {}
            return r;
        };
    });
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);
})();
