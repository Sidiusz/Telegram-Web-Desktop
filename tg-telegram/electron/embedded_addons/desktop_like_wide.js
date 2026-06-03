// @name Desktop-like - Wide Messages
// @version 1.2.1
// @description Сообщения в чатах в стиле настольной версии + широкие.
// @group desktop_like_chat

(function () {
    function ensureStyles() {
        if (document.getElementById('addon-max-width') || !document.head) return;
        var s = document.createElement('style');
        s.id = 'addon-max-width';
        s.textContent = `
            #MiddleColumn .messages-container { padding-right: 2vw !important; box-sizing: border-box !important; }
            #MiddleColumn .Message { --max-width: 100% !important; margin-right: 0 !important; }
            #MiddleColumn .Message.own { flex-direction: row !important; }
            #MiddleColumn .Message.own .message-action-buttons-container { left: auto !important; right: -3rem !important; }

            .Message.own, body._tg_private_ .Message:not(.own) {
                padding-left: 40px !important;
                position: relative !important;
            }
            .Message.own > .Avatar { display: none !important; }

            /* Исправление углов для своих сообщений */
            #MiddleColumn .Message.own.last-in-group .message-content {
                border-bottom-left-radius: 0 !important;
                border-bottom-right-radius: var(--border-radius-messages) !important;
            }

            /* Отражение хвостика для своих сообщений */
            #MiddleColumn .Message.own .svg-appendix {
                transform: scaleX(-1) !important;
                left: -8px !important;
                right: auto !important;
            }

            /* Баг #3: длинные цитаты (reply) уезжают за экран */
            #MiddleColumn .Message .EmbeddedMessage .message-text .embedded-text-wrapper {
                white-space: pre-wrap !important;
            }

            /* Фикс: кнопки шапки (поиск, три точки) не блокируются после закрытия правой колонки */
            .MiddleHeader .header-tools {
                position: relative !important;
                z-index: 200 !important;
            }
            .MiddleHeader .HeaderActions {
                position: relative !important;
                z-index: 200 !important;
                pointer-events: all !important;
            }
            .MiddleHeader .HeaderActions .Button {
                pointer-events: all !important;
                position: relative !important;
                z-index: 200 !important;
            }

            @keyframes _tgAvIn_ {
                from { opacity: 0; transform: scale(0.6); }
                to   { opacity: 1; transform: scale(1);   }
            }
            .custom-message-avatar {
                position: absolute;
                left: 0;
                bottom: 0;
                width: 36px;
                height: 36px;
                border-radius: 50%;
                overflow: hidden;
                z-index: 10;
                animation: _tgAvIn_ 0.2s ease;
            }
            .custom-message-avatar img {
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
                display: block;
            }
        `;
        document.head.appendChild(s);
    }

    var _rcObserver = null;

    // Кэш аватаров: своя — { src, age }, партнёры — { peerId: { src, age } }
    // Кэш партнёров НЕ сбрасывается при смене чата: ключ peerId исключает путаницу.
    // TTL обеспечивает периодическое обновление устаревших blob-ссылок.
    var PARTNER_TTL = 90; // тиков (~90 сек при 1s интервале)
    var MY_TTL = 30;      // тиков для своей аватарки

    var _partnerCache = {};       // { peerId: { src, age } }
    var _myAvatar = { src: '', age: 0 };
    var _mySrcMenu = '';
    var _lastPeerId = '';
    var _myPeerId = '';
    var _switchGrace = 0;

    function updateRightColumn() {
        var main = document.getElementById('Main');
        var isOpen = main && main.classList.contains('right-column-open');
        document.documentElement.style.setProperty('--right-column-width', isOpen ? '25vw' : '0px');
        document.documentElement.style.setProperty('--messages-container-width', isOpen ? '75vw' : '100%');
    }

    function startObserver() {
        if (_rcObserver) return;
        var main = document.getElementById('Main');
        if (!main) return;
        _rcObserver = new MutationObserver(updateRightColumn);
        _rcObserver.observe(main, { attributes: true, attributeFilter:['class'] });
    }

    function getChatType() {
        var headerAvatar = document.querySelector('.MiddleHeader .ChatInfo .Avatar[data-peer-id]');
        if (!headerAvatar) return null;
        var peerId = parseInt(headerAvatar.getAttribute('data-peer-id') || '0', 10);
        if (peerId < 0) return 'other';
        var status = document.querySelector('.MiddleHeader .ChatInfo .status');
        if (status && /member|участник|subscriber|подписч/i.test(status.textContent)) return 'other';
        return 'private';
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

    // Своя аватарка с TTL: периодически перечитываем из DOM
    function findMySrc() {
        _myAvatar.age++;
        if (_myAvatar.age >= MY_TTL) {
            _myAvatar.src = '';
            _myAvatar.age = 0;
            _mySrcMenu = '';
        }

        if (_myAvatar.src) return _myAvatar.src;

        var profileImg = document.querySelector('.settings-content .ProfileInfo .Avatar[data-peer-id] img.Avatar__media');
        if (profileImg && profileImg.src && profileImg.src.startsWith('blob:')) {
            _myAvatar.src = profileImg.src;
            return _myAvatar.src;
        }

        var pid = findMyPeerId();
        if (pid) {
            var anyAvatar = document.querySelector('.Avatar[data-peer-id="' + pid + '"] img.Avatar__media');
            if (anyAvatar && anyAvatar.src && anyAvatar.src.startsWith('blob:')) {
                _myAvatar.src = anyAvatar.src;
                return _myAvatar.src;
            }
        }

        if (!_mySrcMenu) {
            var menuImg = document.querySelector('.MenuItem.account-menu-item .Avatar img');
            if (menuImg && menuImg.src && (menuImg.src.startsWith('data:') || menuImg.src.startsWith('blob:'))) {
                _mySrcMenu = menuImg.src;
            }
        }
        return _mySrcMenu;
    }

    // Аватарка партнёра с TTL по peerId.
    // Кэш сохраняется между переходами в чаты — повторный визит не вызывает запрос к DOM.
    // Путаница между чатами исключена: кэш привязан к peerId.
    // В группах эта функция не вызывается вовсе.
    function findPartnerSrc(peerId) {
        if (!peerId) return '';

        var entry = _partnerCache[peerId];
        if (entry) {
            entry.age++;
            if (entry.age < PARTNER_TTL) return entry.src;
            // TTL истёк — перечитаем из DOM
            delete _partnerCache[peerId];
        }

        var img = document.querySelector(
            '.MiddleHeader .ChatInfo .Avatar[data-peer-id="' + peerId + '"] img.Avatar__media'
        );
        if (img && img.src && (img.src.startsWith('blob:') || img.src.startsWith('data:'))) {
            _partnerCache[peerId] = { src: img.src, age: 0 };
            return img.src;
        }
        return '';
    }

    function injectAvatars() {
        var type = getChatType();
        if (type) {
            document.body.classList.toggle('_tg_private_', type === 'private');
            document.body.classList.toggle('_tg_other_', type === 'other');
        }

        var peerId = getCurrentPeerId();

        // При смене чата: НЕ сбрасываем кэш партнёров — он привязан к peerId.
        // Просто ждём grace-период, пока DOM заголовка обновится.
        if (peerId !== _lastPeerId) {
            _lastPeerId = peerId;
            _switchGrace = 2;
        }

        var mySrc = findMySrc();
        var list = document.querySelector('.MessageList');
        if (!list) return;

        // Своя аватарка — инжектим всегда, независимо от grace
        if (mySrc) {
            list.querySelectorAll('.Message.own:not(.last-in-group) .custom-message-avatar').forEach(function(el) { el.remove(); });
            list.querySelectorAll('.Message.own.last-in-group').forEach(function(msg) {
                var avatarDiv = msg.querySelector('.custom-message-avatar');
                if (!avatarDiv) {
                    avatarDiv = document.createElement('div');
                    avatarDiv.className = 'custom-message-avatar';
                    var img = document.createElement('img');
                    img.src = mySrc;
                    avatarDiv.appendChild(img);
                    msg.appendChild(avatarDiv);
                } else {
                    var img = avatarDiv.querySelector('img');
                    if (img && img.src !== mySrc) img.src = mySrc;
                }
            });
        }

        if (type === 'private') {
            // Grace-период: убираем аватарки партнёра пока DOM не устоялся
            if (_switchGrace > 0) {
                _switchGrace--;
                list.querySelectorAll('.Message:not(.own) .custom-message-avatar').forEach(function(el) { el.remove(); });
                return;
            }

            var partnerSrc = findPartnerSrc(peerId);
            list.querySelectorAll('.Message:not(.own):not(.last-in-group) .custom-message-avatar').forEach(function(el) { el.remove(); });
            list.querySelectorAll('.Message:not(.own).last-in-group').forEach(function(msg) {
                if (!partnerSrc) return;
                var avatarDiv = msg.querySelector('.custom-message-avatar');
                if (!avatarDiv) {
                    avatarDiv = document.createElement('div');
                    avatarDiv.className = 'custom-message-avatar';
                    var img = document.createElement('img');
                    img.src = partnerSrc;
                    avatarDiv.appendChild(img);
                    msg.appendChild(avatarDiv);
                } else {
                    var img = avatarDiv.querySelector('img');
                    if (img && img.src !== partnerSrc) img.src = partnerSrc;
                }
            });
        } else {
            // Группы/каналы: аватарки партнёров не нужны, убираем если остались
            if (_switchGrace > 0) _switchGrace--;
            list.querySelectorAll('.Message:not(.own) .custom-message-avatar').forEach(function(el) { el.remove(); });
        }
    }

    function tick() {
        ensureStyles();
        updateRightColumn();
        startObserver();
        injectAvatars();
    }

    setInterval(tick, 1000);
    tick();
})();
