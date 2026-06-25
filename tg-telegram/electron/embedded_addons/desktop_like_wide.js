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
            /* Скругляем ФОРМУ пузыря (.message-content) под хвостик СЛЕВА — и свои, и
               входящие. Саму маску картинки (.media-inner/.full-media) скругляем ТОЛЬКО
               для ОДИНОЧНЫХ медиа (:not(.is-album)). В альбомах (видео+картинка и т.п.)
               кадры скруглять НЕ нужно — у альбома скруглены лишь внешние углы (нативно). */
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

            /* Каналы/сообщества (no-avatars, не личка) — НЕ трогаем: рендерим нативно
               (хвостик и родные углы). Прежнее «выравнивание» (скрытие appendix +
               принудительные углы) убрано — оно ломало вид на постах с «Комментариями»
               (хвостик проступал на ховере). */

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

            /* Новый дизайн TG сделал шапку чата плавающим «островом» (max-width:728px,
               авто-поля, скруглённая) — с лево-выровненными сообщениями она висит по
               центру и не тянется. Возвращаем прежний вид: на всю ширину колонки. */
            #MiddleColumn .MiddleHeader {
                max-width: 100% !important; width: 100% !important;
                margin-left: 0 !important; margin-right: 0 !important;
                border-radius: 0 !important;
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
        // Не личка определяем по ХЭШУ (стабильно), а НЕ по .no-avatars: класс мигает
        // при перерисовках, и на таком кадре аватарки вайпались целиком и «пропадали».
        if (!hashIsPrivate()) {
            list.querySelectorAll('.custom-message-avatar').forEach(function (el) { el.remove(); });
            return;
        }
        var peerId = getCurrentPeerId();
        var mySrc = findMySrc();
        if (mySrc) {
            list.querySelectorAll('.Message.own:not(.last-in-group) .custom-message-avatar').forEach(function (el) { el.remove(); });
            list.querySelectorAll('.Message.own.last-in-group').forEach(function (msg) { _inject(msg, mySrc); });
        }
        // Аватар собеседника ставим, когда шапка показывает текущий чат (peer шапки ==
        // peer хэша). При НЕсовпадении НИЧЕГО не удаляем — иначе на миг рассинхрона
        // шапки аватарки пропадают; просто ждём следующего прохода.
        var hashPeer = (location.hash || '').match(/#(-?\d+)/);
        hashPeer = hashPeer ? hashPeer[1] : '';
        if (peerId && peerId === hashPeer) {
            var partnerSrc = findPartnerSrc(peerId);
            list.querySelectorAll('.Message:not(.own):not(.last-in-group) .custom-message-avatar').forEach(function (el) { el.remove(); });
            if (partnerSrc) list.querySelectorAll('.Message:not(.own).last-in-group').forEach(function (msg) { _inject(msg, partnerSrc); });
        }
    }
    // Личка определяется по ХЭШУ синхронно (#положительный peerId), без ожидания
    // .no-avatars в DOM — иначе класс встаёт с задержкой и пузыри прыгают.
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

    // После смены чата аватарки появлялись только на следующем тике (≈1с) — гоняем
    // короткую серию частых проходов (~2с по 150мс), чтобы поймать момент, когда
    // шапка/аватар нового чата домонтировались, и поставить аватарки сразу.
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

    // Pre-warm: TG webZ переключает чат через history.pushState (событие hashchange
    // НЕ стреляет), а .tgdl-private навешивался только тиком в 1с — отсюда «прыжок»
    // (свои пузыри мигают справа до применения аддона). Перехватываем pushState/
    // replaceState/popstate/hashchange и ставим класс СИНХРОННО по хэшу — он уже на
    // #MiddleColumn к моменту, когда React монтирует новый список → без вспышки.
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
