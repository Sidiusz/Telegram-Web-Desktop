// @name Desktop-like - Wide Messages
// @version 2.0.0
// @description Сообщения в стиле настольного Telegram + широкие пузыри. Аватарки слева в личных чатах.
// @group desktop_like_chat

(function () {
    // Все правки применяются ТОЛЬКО в личных чатах: у списка там класс
    // `.MessageList.no-avatars` (в группах TG сам рисует аватарки слева — их не трогаем).
    // Важно: НИКАКИХ глобальных --right-column-width/--messages-container-width — именно
    // этот приём в прошлой версии ломал правую колонку (медиа/файлы/ссылки уезжали).
    function ensureStyles() {
        if (document.getElementById('addon-desktop-wide') || !document.head) return;
        var s = document.createElement('style');
        s.id = 'addon-desktop-wide';
        s.textContent = `
            /* 1) Свои сообщения — на левую сторону, как входящие (цвет пузыря остаётся свой). */
            #MiddleColumn .MessageList.no-avatars .Message { padding-left: 44px !important; position: relative !important; }
            #MiddleColumn .MessageList.no-avatars .Message.own { justify-content: flex-start !important; }
            #MiddleColumn .MessageList.no-avatars .Message.own .message-content-wrapper { margin-left: 0 !important; margin-right: auto !important; }
            #MiddleColumn .MessageList.no-avatars .Message.own > .Avatar { display: none !important; }

            /* Хвостик своих — слева (зеркалим), углы как у входящего. */
            #MiddleColumn .MessageList.no-avatars .Message.own .svg-appendix { transform: scaleX(-1) !important; left: -8px !important; right: auto !important; }
            #MiddleColumn .MessageList.no-avatars .Message.own.last-in-group .message-content {
                border-bottom-left-radius: 0 !important;
                border-bottom-right-radius: var(--border-radius-messages) !important;
            }

            /* 2) Широкие пузыри — только через --max-width, без трогания колонок. */
            #MiddleColumn .Message { --max-width: 48rem !important; }

            /* 3) Чекбокс выделения — поверх аватарки и кликабелен (раньше прятался под ней). */
            .custom-message-avatar { pointer-events: none !important; }
            #MiddleColumn .Message .message-select-control { z-index: 20 !important; }

            /* 4) Быстрые реакции и кнопки действий своих сообщений — справа от пузыря,
                  чтобы не наезжали на текст (раньше оказывались поверх сообщения). */
            #MiddleColumn .MessageList.no-avatars .Message.own .message-action-buttons-container { left: auto !important; right: -3rem !important; }
            #MiddleColumn .MessageList.no-avatars .Message.own .quick-reaction { left: auto !important; right: -2.2rem !important; transform: none !important; }

            /* Длинные цитаты (reply) не уезжают за экран. */
            #MiddleColumn .Message .EmbeddedMessage .message-text .embedded-text-wrapper { white-space: pre-wrap !important; }

            /* Кнопки шапки не блокируются после закрытия правой колонки. */
            .MiddleHeader .header-tools,
            .MiddleHeader .HeaderActions { position: relative !important; z-index: 200 !important; }
            .MiddleHeader .HeaderActions, .MiddleHeader .HeaderActions .Button { pointer-events: all !important; }

            @keyframes _tgAvIn_ { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
            .custom-message-avatar {
                position: absolute; left: 4px; bottom: 0; width: 36px; height: 36px;
                border-radius: 50%; overflow: hidden; z-index: 5; animation: _tgAvIn_ 0.2s ease;
            }
            .custom-message-avatar img { width: 100% !important; height: 100% !important; object-fit: cover !important; display: block; }
        `;
        document.head.appendChild(s);
    }

    // ── Аватарки: кэш по peerId с TTL (проверенная логика прошлой версии) ──────
    var PARTNER_TTL = 90, MY_TTL = 30;
    var _partnerCache = {};
    var _myAvatar = { src: '', age: 0 };
    var _mySrcMenu = '';
    var _lastPeerId = '';
    var _myPeerId = '';
    var _switchGrace = 0;

    // Личный чат ⇔ у списка сообщений класс no-avatars (в группах его нет).
    function isPrivate() {
        var list = document.querySelector('#MiddleColumn .MessageList');
        return !!(list && list.classList.contains('no-avatars'));
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

    function injectAvatars() {
        var list = document.querySelector('#MiddleColumn .MessageList');
        if (!list) return;

        // Не личный чат → убираем свои аватарки и выходим (группы рисует TG сам).
        if (!isPrivate()) {
            list.querySelectorAll('.custom-message-avatar').forEach(function (el) { el.remove(); });
            return;
        }

        var peerId = getCurrentPeerId();
        if (peerId !== _lastPeerId) { _lastPeerId = peerId; _switchGrace = 2; }

        var mySrc = findMySrc();
        if (mySrc) {
            list.querySelectorAll('.Message.own:not(.last-in-group) .custom-message-avatar').forEach(function (el) { el.remove(); });
            list.querySelectorAll('.Message.own.last-in-group').forEach(function (msg) { _inject(msg, mySrc); });
        }

        // Аватарки партнёра — после grace-периода (ждём, пока шапка обновится при смене чата).
        if (_switchGrace > 0) {
            _switchGrace--;
            list.querySelectorAll('.Message:not(.own) .custom-message-avatar').forEach(function (el) { el.remove(); });
            return;
        }
        var partnerSrc = findPartnerSrc(peerId);
        list.querySelectorAll('.Message:not(.own):not(.last-in-group) .custom-message-avatar').forEach(function (el) { el.remove(); });
        list.querySelectorAll('.Message:not(.own).last-in-group').forEach(function (msg) {
            if (partnerSrc) _inject(msg, partnerSrc);
        });
    }

    function tick() { ensureStyles(); injectAvatars(); }
    setInterval(tick, 1000);
    tick();
})();
