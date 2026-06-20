// @name Desktop-like - Wide Messages
// @version 2.1.0
// @description Сообщения по левому краю + аватарки + широкие пузыри и нижняя панель.
// @group desktop_like_chat

(function () {
    // Применяется ТОЛЬКО в личных чатах (.MessageList.no-avatars). В группах TG сам
    // рисует аватарки — не трогаем. НЕ меняем width/max-width у .messages-container:
    // это ломает виртуализацию (пропадают сообщения при быстром скролле). Прижим — margin.
    function ensureStyles() {
        if (document.getElementById('addon-desktop-wide') || !document.head) return;
        var s = document.createElement('style');
        s.id = 'addon-desktop-wide';
        s.textContent = `
            /* Широкая область сообщений + прижим к левому краю — во ВСЕХ чатах
               (и личные, и группы/каналы), иначе в группах остаётся центрованный
               контейнер 728px с большим отступом слева. Ширину МЕНЯЕМ на загрузке
               (в аддоне), а не вживую — тогда виртуализация считает её с самого начала. */
            #MiddleColumn .MessageList .messages-container {
                /* Оставляем правый «жёлоб» ~3.5rem: широкие пузыри не доходят до
                   скроллбара, чтобы сердечко/«переслать» справа не залезали на него. */
                max-width: calc(100% - 3.5rem) !important; width: calc(100% - 3.5rem) !important;
                margin-left: 0 !important; margin-right: auto !important;
                box-sizing: border-box !important;
            }

            /* Широкая нижняя панель ввода на ВСЮ ширину (width, не только max-width —
               иначе панель сжимается по содержимому). Не виртуализирована, менять безопасно. */
            #MiddleColumn .middle-column-footer { width: 100% !important; max-width: 100% !important; }
            #MiddleColumn .middle-column-footer .composer-wrapper { width: 100% !important; max-width: 100% !important; margin-left: 0 !important; }

            /* Широкие пузыри — под ширину поля ввода. */
            #MiddleColumn .Message { --max-width: 70rem !important; }

            /* Свои сообщения — на левую сторону. ТОЛЬКО в личных 1-на-1: класс
               .tgdl-private вешает JS по hash (#положительный). В каналах/группах
               (no-avatars, но #-100...) НЕ трогаем — иначе остаётся пустой отступ
               слева под несуществующую аватарку и кривой хвостик пузыря. */
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message { padding-left: 44px !important; position: relative !important; }
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own { justify-content: flex-start !important; }
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .message-content-wrapper { margin-left: 0 !important; margin-right: auto !important; }
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own > .Avatar { display: none !important; }

            /* Хвостик своих — слева (зеркалим), нижние углы как у входящего. */
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .svg-appendix { transform: scaleX(-1) !important; left: -8px !important; right: auto !important; }
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own.last-in-group .message-content {
                border-bottom-left-radius: 0 !important;
                border-bottom-right-radius: var(--border-radius-messages) !important;
            }
            /* Картинка обрезается .media-inner — у него радиусы заданы под хвостик
               СПРАВА (TR6, BR0, BL15). У нас хвостик СЛЕВА → правые углы скругляем,
               нижний-левый острый (под хвостик у last-in-group), иначе скруглён. */
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .message-content.media,
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .message-content.media .media-inner,
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .message-content.media .full-media {
                border-top-right-radius: var(--border-radius-messages) !important;
                border-bottom-right-radius: var(--border-radius-messages) !important;
                border-bottom-left-radius: var(--border-radius-messages) !important;
            }
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own.last-in-group .message-content.media,
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own.last-in-group .message-content.media .media-inner,
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own.last-in-group .message-content.media .full-media {
                border-bottom-left-radius: 0 !important;
            }

            /* Каналы/сообщества (no-avatars, не личка): убираем «хвостик» пузыря и
               скругляем все углы — ровный вид без торчащего уголка (по просьбе). */
            #MiddleColumn:not(.tgdl-private) .MessageList.no-avatars .Message .svg-appendix { display: none !important; }
            /* Скругляем ВСЕ 4 угла. TG для .last-in-group зануляет нижний угол под
               «хвостик» (longhand !important) — перебиваем явными longhand'ами с
               той же спецификой (+ .last-in-group), иначе нижний-левый остаётся острым. */
            #MiddleColumn:not(.tgdl-private) .MessageList.no-avatars .Message .message-content,
            #MiddleColumn:not(.tgdl-private) .MessageList.no-avatars .Message.last-in-group .message-content,
            #MiddleColumn:not(.tgdl-private) .MessageList.no-avatars .Message.first-in-group .message-content {
                border-radius: var(--border-radius-messages) !important;
                border-bottom-left-radius: var(--border-radius-messages) !important;
                border-bottom-right-radius: var(--border-radius-messages) !important;
                border-top-left-radius: var(--border-radius-messages) !important;
            }

            /* Выделение: свои пузыри сдвигаем вправо как входящие, аватарки — тоже вправо,
               чтобы кружок-галочка встал ровно на их прежнее место (а не поверх). */
            #MiddleColumn.tgdl-private .MessageList.no-avatars.select-mode-active .Message.own .message-content-wrapper { transform: translateX(40px) !important; }
            #MiddleColumn.tgdl-private .MessageList.no-avatars.select-mode-active .custom-message-avatar { left: 44px !important; }

            /* Быстрая реакция (сердечко):
               • на постах с кнопкой «переслать» (.has-action-button) — убираем совсем:
                 там она конфликтует с меню действий (переслать/к оригиналу), реакции
                 ставятся через ПКМ/меню реакций;
               • на обычных сообщениях — просто за правым краем пузыря (не на timestamp). */
            #MiddleColumn .MessageList.no-avatars .Message .message-content.has-action-button .quick-reaction,
            #MiddleColumn .MessageList:not(.no-avatars) .Message:not(.own) .message-content.has-action-button .quick-reaction {
                display: none !important;
            }
            #MiddleColumn .MessageList.no-avatars .Message .message-content:not(.has-action-button) .quick-reaction,
            #MiddleColumn .MessageList:not(.no-avatars) .Message:not(.own) .message-content:not(.has-action-button) .quick-reaction {
                left: auto !important; right: -1.9rem !important; bottom: -1px !important; top: auto !important; transform: none !important;
            }
            /* У своих (личка, перевёрнуты влево) кнопки «переслать» — справа. */
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .message-action-buttons-container { left: auto !important; right: -3rem !important; }

            /* Длинные цитаты (reply) не уезжают за экран. */
            #MiddleColumn .Message .EmbeddedMessage .message-text .embedded-text-wrapper { white-space: pre-wrap !important; }

            /* Кнопки шапки не блокируются после закрытия правой колонки. */
            .MiddleHeader .header-tools,
            .MiddleHeader .HeaderActions { position: relative !important; z-index: 200 !important; }
            .MiddleHeader .HeaderActions, .MiddleHeader .HeaderActions .Button { pointer-events: all !important; }

            @keyframes _tgAvIn_ { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
            .custom-message-avatar {
                position: absolute; left: 4px; bottom: 0; width: 36px; height: 36px;
                border-radius: 50%; overflow: hidden; z-index: 5; pointer-events: none; animation: _tgAvIn_ 0.2s ease;
            }
            .custom-message-avatar img { width: 100% !important; height: 100% !important; object-fit: cover !important; display: block; }
        `;
        document.head.appendChild(s);
    }

    // ── Аватарки: кэш по peerId с TTL ─────────────────────────────────────────
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
        // Каналы/группы/новостные ленты тоже no-avatars. data-peer-id у них «обрезан»
        // до положительного, а в URL-hash сохраняется минус (#-100...). Кастомные
        // аватарки рисуем ТОЛЬКО в личных 1-на-1 (положительный peer в hash).
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
    function injectAvatars() {
        var list = document.querySelector('#MiddleColumn .MessageList');
        if (!list) return;
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
    function applyPrivateClass() {
        var mc = document.getElementById('MiddleColumn');
        if (mc) mc.classList.toggle('tgdl-private', isPrivate());
    }
    function tick() { ensureStyles(); applyPrivateClass(); injectAvatars(); }
    setInterval(tick, 1000);
    tick();
})();
