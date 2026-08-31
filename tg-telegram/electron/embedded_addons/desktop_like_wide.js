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
            /* --tgdl-rc = width the open right column steals from the middle column (measured in JS). */
            :root { --tgdl-rc: 0px; }
            /* Shrink the list itself so bubbles never slide under the right column overlay. */
            #MiddleColumn .MessageList {
                width: calc(100% - var(--tgdl-rc, 0px)) !important;
                max-width: calc(100% - var(--tgdl-rc, 0px)) !important;
                align-self: flex-start !important; margin-left: 0 !important; margin-right: auto !important;
            }
            /* TG centers the shrunk list and slides it back with a transform; we anchor it left instead. */
            ._tg_right_open #MiddleColumn .MessageList { transform: none !important; }
            /* Widen + left-align in ALL chats, set at load (not live) so virtualization counts it from the start; 7rem gutter clears scrollbar + down-arrow. */
            html #MiddleColumn .MessageList .messages-container,
            body #MiddleColumn .MessageList .messages-container,
            #MiddleColumn .MessageList .messages-container {
                max-width: calc(100% - 7rem) !important; width: calc(100% - 7rem) !important;
                margin-left: 0 !important; margin-right: auto !important;
                box-sizing: border-box !important;
                align-self: flex-start !important;
            }
            html #MiddleColumn .MessageList,
            body #MiddleColumn .MessageList {
                justify-content: flex-start !important;
                align-items: flex-start !important;
            }
            /* Remove top fade that becomes visible under header when right panel opens, keep bottom */
            #MiddleColumn .MessageList {
                -webkit-mask-image: linear-gradient(to bottom, rgb(0,0,0) 0px, rgb(0,0,0) calc(100% - 64px), rgba(0,0,0,0.24) 100%) !important;
                mask-image: linear-gradient(to bottom, rgb(0,0,0) 0px, rgb(0,0,0) calc(100% - 64px), rgba(0,0,0,0.24) 100%) !important;
            }

            /* Footer + Composer: robust flex so send button never wraps on long text */
            #MiddleColumn .middle-column-footer { width: 100% !important; max-width: 100% !important; box-sizing:border-box !important; margin-left: 0 !important; }
            /* Keep TG's own composer spacing (send button sits 4px from the edge); only stop it wrapping. */
            #MiddleColumn .Composer { flex-wrap: nowrap !important; box-sizing:border-box !important; }
            #MiddleColumn .Composer .composer-wrapper { min-width:0 !important; }
            #MiddleColumn .Composer #editable-message-text { min-width:0 !important; }
            /* Footer keeps clear of the right column; TG shifts it by half its width instead, so drop that transform. */
            #MiddleColumn .middle-column-footer {
                width: calc(100% - var(--tgdl-rc, 0px)) !important; max-width: calc(100% - var(--tgdl-rc, 0px)) !important;
            }
            ._tg_right_open #MiddleColumn .middle-column-footer { transform: none !important; }

            /* Widen bubbles to match the input field width. */
            #MiddleColumn .Message:not(.is-album):not(:has(.message-content.media)) { --max-width: 70rem !important; }
            /* Never let a bubble outgrow its row — the list shrinks when the right column opens.
               Rows shrink-wrap, so a % cap is circular; --tgdl-avail is the row width in px, set from JS. */
            #MiddleColumn .Message .message-content { max-width: min(var(--max-width, 30rem), var(--tgdl-avail, 100vw)) !important; }
            #MiddleColumn .Message .message-content-wrapper { max-width: var(--tgdl-avail, none) !important; }


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

            /* Albums round their outer corners themselves, with the square one on TG's tail side (right). */
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .message-content .Album,
            #MiddleColumn .MessageList:not(.no-avatars) .Message.own .message-content .Album {
                border-bottom-right-radius: var(--border-radius-messages) !important;
            }
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own.last-in-group .message-content .Album,
            #MiddleColumn .MessageList:not(.no-avatars) .Message.own.last-in-group .message-content .Album {
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

            /* Stacked audio/docs (document-group) break their content out to the message's
               left edge, ignoring our 44px avatar gutter → the bubble overlapped the avatar.
               Shift it back by the gutter so it lines up with the other own bubbles. */
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own.is-in-document-group .message-content,
            #MiddleColumn .MessageList:not(.no-avatars) .Message.own.is-in-document-group .message-content {
                transform: translateX(45px) !important;
            }

            #MiddleColumn .Message .EmbeddedMessage .message-text .embedded-text-wrapper { white-space: pre-wrap !important; }

            /* Keep header buttons clickable after closing the right-side column. */
            .MiddleHeader .header-tools,
            .MiddleHeader .HeaderActions { position: relative !important; z-index: 200 !important; }
            .MiddleHeader .HeaderActions, .MiddleHeader .HeaderActions .Button { pointer-events: all !important; }

            /* New TG header island — stretch wide with equal side gaps; keep TG's rounding + top gap. */
            #MiddleColumn .MiddleHeader {
                width: calc(100% - 7rem - var(--tgdl-rc, 0px)) !important;
                max-width: calc(100% - 7rem - var(--tgdl-rc, 0px)) !important;
                margin-left: 3.5rem !important; margin-right: auto !important;
                box-sizing:border-box !important;
            }
            ._tg_right_open #MiddleColumn .MiddleHeader { transform: none !important; }
            /* Right column overlay: keep header/composer above it. */
            #Main.right-column-open #MiddleColumn .MiddleHeader,
            #Main.right-column-open #MiddleColumn .Composer,
            ._tg_right_open #MiddleColumn .MiddleHeader,
            ._tg_right_open #MiddleColumn .Composer { position: relative !important; z-index: 10 !important; }

            /* Our injected tail: TG hides .svg-appendix unless .message-content has .has-appendix. */
            #MiddleColumn .Message.own .message-content[data-tgdl-appendix] .svg-appendix { display: block !important; }

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

    // TG's buildContentClassName only adds `has-appendix` for a photo, a captioned
    // bubble or a comment button — a bare GIF/video never gets a tail. Draw TG's own
    // appendix SVG ourselves on own media bubbles; idempotent, re-applied after rerenders.
    var APPENDIX_D = 'M6 17H0V0c.193 2.84.876 5.767 2.05 8.782.904 2.325 2.446 4.485 4.625 6.48A1 1 0 016 17z';
    var APPENDIX_SVG =
        '<svg width="9" height="20" class="svg-appendix"><defs><filter x="-50%" y="-14.7%" width="200%"'
        + ' height="141.2%" filterUnits="objectBoundingBox" id="messageAppendix">'
        + '<feOffset dy="1" in="SourceAlpha" result="shadowOffsetOuter1"/>'
        + '<feGaussianBlur stdDeviation="1" in="shadowOffsetOuter1" result="shadowBlurOuter1"/>'
        + '<feColorMatrix values="0 0 0 0 0.0621962482 0 0 0 0 0.138574144 0 0 0 0 0.185037364 0 0 0 0.15 0"'
        + ' in="shadowBlurOuter1"/></filter></defs><g fill="none" fill-rule="evenodd">'
        + '<path d="' + APPENDIX_D + '" fill="#000" filter="url(#messageAppendix)"/>'
        + '<path d="' + APPENDIX_D + '" fill="#EEFFDE" class="corner"/></g></svg>';
    function ensureOwnMediaAppendix() {
        document.querySelectorAll('#MiddleColumn .Message.own.last-in-group:not(.is-album) .message-content.media').forEach(function (mc) {
            if (mc.classList.contains('has-appendix')) return;   // TG drew its own
            if (mc.querySelector('.svg-appendix')) { mc.setAttribute('data-tgdl-appendix', ''); return; }
            mc.insertAdjacentHTML('beforeend', APPENDIX_SVG);
            mc.setAttribute('data-tgdl-appendix', '');
            mc.__tgdlAppSrc = null;                              // force a recolor pass
        });
    }

    // Real displayed bottom-LEFT corner color of the media (object-fit aware).
    function _blCornerColor(img) {
        try {
            var nw = img.naturalWidth || img.videoWidth, nh = img.naturalHeight || img.videoHeight;
            var r = img.getBoundingClientRect(), dw = r.width, dh = r.height;
            if (!nw || !nh || !dw || !dh) return null;
            var fit = getComputedStyle(img).objectFit;
            var sc = fit === 'contain' ? Math.min(dw / nw, dh / nh) : Math.max(dw / nw, dh / nh);
            var sw = dw / sc, sh = dh / sc, sx = (nw - sw) / 2, sy = (nh - sh) / 2;
            var px = Math.min(nw - 1, Math.max(0, Math.round(sx)));
            var py = Math.min(nh - 1, Math.max(0, Math.round(sy + sh) - 1));
            var c = document.createElement('canvas'); c.width = 1; c.height = 1;
            var x = c.getContext('2d'); x.drawImage(img, px, py, 1, 1, 0, 0, 1, 1);
            var d = x.getImageData(0, 0, 1, 1).data;
            return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
        } catch (e) { return null; }
    }
    // In an album the bottom-left corner belongs to the last item, not the first.
    function _bottomLeftMedia(mc) {
        var list = mc.querySelectorAll('.full-media, .media-inner img, .media-inner video');
        var r = mc.getBoundingClientRect(), best = null, bestBottom = -Infinity;
        for (var i = 0; i < list.length; i++) {
            var b = list[i].getBoundingClientRect();
            if (b.left <= r.left + 4 && b.bottom >= r.bottom - 4) return list[i];
            if (b.bottom > bestBottom) { bestBottom = b.bottom; best = list[i]; }
        }
        return best;
    }
    // Own tail is flipped left, but TG sampled its color from the bubble's bottom-RIGHT
    // pixel. Recolor from the true bottom-LEFT corner (matches black letterbox bars, not
    // the gray photo). Cached per src; reasserted when TG re-renders the appendix.
    function recolorAppendixes() {
        document.querySelectorAll('#MiddleColumn .Message.own .message-content.media[data-has-custom-appendix],'
            + '#MiddleColumn .Message.own .message-content.media[data-tgdl-appendix]').forEach(function (mc) {
            var app = mc.querySelector('.svg-appendix');
            var corner = app && app.querySelector('.corner');
            var img = _bottomLeftMedia(mc);
            var ours = mc.hasAttribute('data-tgdl-appendix');
            if (!corner || !img) return;
            // Ours is always media-colored; TG's own tail only when mirrored to the left.
            if (!ours && !/^matrix\(-1[,\s]/.test(getComputedStyle(app).transform)) return;
            var key = img.currentSrc || img.src;
            if (mc.__tgdlAppSrc !== key) {
                var ready = img.tagName === 'VIDEO' ? (img.readyState >= 2 && img.videoWidth) : (img.complete && img.naturalWidth);
                if (!ready) return;
                var col = _blCornerColor(img);
                if (!col) return;
                corner.style.fill = col;
                mc.__tgdlAppSrc = key;
                mc.__tgdlAppColor = corner.style.fill;
            } else if (mc.__tgdlAppColor && corner.style.fill !== mc.__tgdlAppColor) {
                corner.style.fill = mc.__tgdlAppColor;
            }
        });
    }
    // Right column width varies (25vw / 26.5rem) and it overlays or pushes the middle
    // column depending on window width — measure the real overlap instead of guessing.
    function measureRc(){
        var mid = document.getElementById('MiddleColumn');
        var col = document.getElementById('RightColumn');
        var v = 0;
        if (mid && col) {
            var m = mid.getBoundingClientRect(), r = col.getBoundingClientRect();
            if (r.width) v = Math.max(0, Math.round(m.right - r.left));
            if (v > m.width - 200) v = 0;   // full-screen overlay (narrow layout): leave TG alone
        }
        document.documentElement.style.setProperty('--tgdl-rc', v + 'px');
        measureAvail();
    }
    // Width a bubble may occupy inside the (now possibly narrower) list.
    function measureAvail(){
        var cont = document.querySelector('#MiddleColumn .MessageList .messages-container');
        if (!cont) return;
        var cs = getComputedStyle(cont);
        var av = cont.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) - 44;
        if (av > 40) document.documentElement.style.setProperty('--tgdl-avail', Math.round(av) + 'px');
    }
    var _rcTicks = 0, _rcRaf = 0, _rcOpen = null;
    // Follow the panel while it slides so widths don't snap a frame late.
    function rcFollow(){
        _rcTicks = 40;
        if (_rcRaf) return;
        _rcRaf = requestAnimationFrame(function step(){
            measureRc();
            _rcRaf = (--_rcTicks > 0) ? requestAnimationFrame(step) : 0;
        });
    }
    function syncRightColumn(){
        try{
            const main = document.getElementById('Main');
            const open = (main && main.classList.contains('right-column-open')) || document.body.classList.contains('right-column-open') || document.documentElement.classList.contains('right-column-open');
            document.documentElement.classList.toggle('_tg_right_open', !!open);
            if(main) main.classList.toggle('_tg_right_open', !!open);
            if (open !== _rcOpen) { _rcOpen = open; rcFollow(); } else { measureRc(); }
        }catch(e){}
    }
    window.addEventListener('resize', function(){ try{ rcFollow(); }catch(e){} });
    function tick() { ensureStyles(); applyPrivateClass(); injectAvatars(); ensureOwnMediaAppendix(); recolorAppendixes(); syncRightColumn(); }
    setInterval(tick, 1000);
    tick();

    // After a chat switch, run a short 150ms burst (~2s) so avatars appear before the next 1s tick.
    var _avT = null;
    function avatarBurst() {
        if (_avT) clearInterval(_avT);
        var n = 0;
        _avT = setInterval(function () {
            injectAvatars(); ensureOwnMediaAppendix(); recolorAppendixes();
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
