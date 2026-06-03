// @name Desktop-like - Standart
// @version 1.2.0
// @description Сообщения по левой стороне + аватарки.
// @group desktop_like_chat

(function () {
    // Кэш аватаров: своя — простая строка, партнёры — объект { src, age }
    // Кэш партнёров НЕ сбрасывается при смене чата: ключ — peerId,
    // поэтому чужая аватарка никогда не попадёт в чужой чат.
    // TTL позволяет подхватить обновлённый blob через ~90 секунд.
    var PARTNER_TTL = 90; // тиков до принудительного обновления из DOM
    var MY_TTL = 30;      // тиков до обновления своей аватарки

    var myAvatar = { src: null, age: 0 };
    var partnerCache = {}; // { peerId: { src, age } }

    var _lastPeerId = '';
    var _switchGrace = 0; // тики ожидания после смены чата

    function ensureStyles() {
        if (document.getElementById('addon-desktop-left') || !document.head) return;
        var s = document.createElement('style');
        s.id = 'addon-desktop-left';
        s.textContent = `
            /* Прижимаем всё содержимое влево */
            #MiddleColumn .MessageList { align-items: flex-start !important; }
            #MiddleColumn .messages-container { 
                margin-left: 0 !important; 
                margin-right: auto !important; 
                width: 100% !important; 
                max-width: 100% !important; 
                padding-right: 2vw !important; 
                box-sizing: border-box !important; 
            }
            #MiddleColumn .Message { 
                justify-content: flex-start !important; 
                flex-direction: row !important; 
                padding-left: 45px !important; 
                position: relative !important; 
                margin-left: 0 !important; 
                margin-right: auto !important;
            }
            
            #MiddleColumn .Message.own > .Avatar { display: none !important; }
            
            #MiddleColumn .Message.own.last-in-group .message-content { 
                border-bottom-left-radius: 0 !important; 
                border-bottom-right-radius: var(--border-radius-messages) !important; 
            }

            #MiddleColumn .Message.own .svg-appendix { 
                transform: scaleX(-1) !important; 
                left: -8px !important; 
                right: auto !important; 
            }

            /* Баг #3: длинные цитаты (reply) уезжают за экран */
            #MiddleColumn .Message .message-content,
            #MiddleColumn .Message .message-content-inner,
            #MiddleColumn .Message .content-inner {
                max-width: calc(100vw - 7rem) !important;
                min-width: 0 !important;
                overflow: hidden !important;
                box-sizing: border-box !important;
            }
            #MiddleColumn .Message .EmbeddedMessage,
            #MiddleColumn .Message .ReplyInfo,
            #MiddleColumn .Message [class*="reply-info"],
            #MiddleColumn .Message [class*="ReplyInfo"] {
                max-width: 100% !important;
                min-width: 0 !important;
                overflow: hidden !important;
                box-sizing: border-box !important;
            }
            #MiddleColumn .Message .EmbeddedMessage .message-title,
            #MiddleColumn .Message .EmbeddedMessage .message-text {
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
            }

            @keyframes _tgAvIn_ { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
            
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
            .custom-message-avatar img { width: 100% !important; height: 100% !important; object-fit: cover !important; display: block; }
        `;
        document.head.appendChild(s);
    }

    function getChatType() {
        var headerAvatar = document.querySelector('.MiddleHeader .ChatInfo .Avatar[data-peer-id]');
        if (!headerAvatar) return null;
        var peerId = parseInt(headerAvatar.getAttribute('data-peer-id') || '0', 10);
        return peerId < 0 ? 'other' : 'private';
    }

    function getCurrentPeerId() {
        var el = document.querySelector('.MiddleHeader .ChatInfo .Avatar[data-peer-id]');
        return el ? el.getAttribute('data-peer-id') : '';
    }

    // Своя аватарка: периодически обновляем из DOM чтобы подхватить новый blob
    function getMyAvatarSrc() {
        myAvatar.age++;
        if (myAvatar.age >= MY_TTL) {
            myAvatar.src = null;
            myAvatar.age = 0;
        }
        if (myAvatar.src) return myAvatar.src;

        var pa = document.querySelector('.settings-content .ProfileInfo .Avatar img') ||
                 document.querySelector('.MenuItem.account-menu-item .Avatar img');
        if (pa && pa.src) myAvatar.src = pa.src;
        return myAvatar.src;
    }

    // Аватарка партнёра: кэш по peerId с TTL.
    // НЕ сбрасываем весь кэш при смене чата — ключ peerId исключает путаницу.
    function getPartnerAvatarSrc(peerId) {
        if (!peerId) return null;

        var entry = partnerCache[peerId];
        if (entry) {
            entry.age++;
            if (entry.age < PARTNER_TTL) return entry.src;
            // TTL истёк — перечитаем из DOM
            delete partnerCache[peerId];
        }

        var img = document.querySelector(
            '.MiddleHeader .ChatInfo .Avatar[data-peer-id="' + peerId + '"] img'
        );
        if (img && img.src) {
            partnerCache[peerId] = { src: img.src, age: 0 };
            return img.src;
        }
        return null;
    }

    function _injectAvatar(msg, src) {
        var avatarDiv = msg.querySelector('.custom-message-avatar');
        if (!avatarDiv) {
            avatarDiv = document.createElement('div');
            avatarDiv.className = 'custom-message-avatar';
            var img = document.createElement('img');
            img.src = src;
            avatarDiv.appendChild(img);
            msg.appendChild(avatarDiv);
        } else {
            var img = avatarDiv.querySelector('img');
            if (img && img.src !== src) img.src = src;
        }
    }

    function injectAvatars() {
        var peerId = getCurrentPeerId();

        // При смене чата: НЕ сбрасываем кэш партнёров (он привязан к peerId),
        // просто ждём grace-период пока DOM обновится.
        if (peerId !== _lastPeerId) {
            _lastPeerId = peerId;
            _switchGrace = 2;
        }

        var list = document.querySelector('.MessageList');
        if (!list) return;

        var mySrc = getMyAvatarSrc();

        if (_switchGrace > 0) {
            _switchGrace--;
            // Убираем аватарки партнёра пока DOM не устоялся
            list.querySelectorAll('.Message:not(.own) .custom-message-avatar').forEach(function(el) { el.remove(); });
            // Свою аватарку инжектим сразу — она не зависит от смены чата
            if (mySrc) {
                list.querySelectorAll('.Message.own:not(.last-in-group) .custom-message-avatar').forEach(function(el) { el.remove(); });
                list.querySelectorAll('.Message.own.last-in-group').forEach(function(msg) {
                    _injectAvatar(msg, mySrc);
                });
            }
            return;
        }

        // Определяем тип чата — в группах/каналах аватарки партнёров не нужны
        var chatType = getChatType();
        var partnerSrc = (chatType === 'private') ? getPartnerAvatarSrc(peerId) : null;

        list.querySelectorAll('.Message.last-in-group').forEach(function(msg) {
            // Пропускаем сообщения в группе, где TG уже рисует свои аватарки
            if (msg.parentNode.querySelector('.Avatar') && !msg.classList.contains('own')) return;

            var isOwn = msg.classList.contains('own');
            var src = isOwn ? mySrc : partnerSrc;
            if (!src) return;

            _injectAvatar(msg, src);
        });

        // Убираем аватарки у сообщений не из конца группы
        list.querySelectorAll('.Message:not(.last-in-group) .custom-message-avatar').forEach(function(el) { el.remove(); });

        // В группах/каналах убираем аватарки партнёров если вдруг остались
        if (chatType !== 'private') {
            list.querySelectorAll('.Message:not(.own) .custom-message-avatar').forEach(function(el) { el.remove(); });
        }
    }

    function tick() {
        ensureStyles();
        injectAvatars();
    }

    setInterval(tick, 1000);
    tick();
})();
