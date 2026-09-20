(function () {
    if (window.__twdDesktopLikeCommon) return;
    window.__twdDesktopLikeCommon = function (ensureStyles) {
    try { ensureStyles(); } catch (_) {}
    if (window.__twdDesktopLikeRuntimeStarted) return;
    window.__twdDesktopLikeRuntimeStarted = true;
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
    };
})();
