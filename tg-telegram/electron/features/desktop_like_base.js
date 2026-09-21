(function () {
    if (!document.head || document.getElementById('twd-feature-desktop-base')) return;
    var s = document.createElement('style');
    s.id = 'twd-feature-desktop-base';
    s.textContent = `
        :root { --tgdl-rc: 0px; }

        #MiddleColumn .MessageList {
            width: calc(100% - var(--tgdl-rc, 0px)) !important;
            max-width: calc(100% - var(--tgdl-rc, 0px)) !important;
            align-self: flex-start !important;
            margin-left: 0 !important;
            margin-right: auto !important;
        }
        ._tg_right_open #MiddleColumn .MessageList { transform: none !important; }

        #MiddleColumn .Message .message-content {
            max-width: min(var(--max-width, 30rem), var(--tgdl-avail, 100vw)) !important;
        }
        #MiddleColumn .Message .message-content-wrapper {
            max-width: var(--tgdl-avail, none) !important;
        }

        #MiddleColumn .middle-column-footer {
            width: calc(100% - var(--tgdl-rc, 0px)) !important;
            max-width: calc(100% - var(--tgdl-rc, 0px)) !important;
            box-sizing: border-box !important;
        }
        ._tg_right_open #MiddleColumn .middle-column-footer { transform: none !important; }

        #MiddleColumn .Composer:not(.with-embedded) {
            flex-wrap: nowrap !important;
            box-sizing: border-box !important;
        }
        #MiddleColumn .Composer.with-embedded { box-sizing: border-box !important; }
        #MiddleColumn .Composer .composer-wrapper { min-width: 0 !important; }
        #MiddleColumn .Composer #editable-message-text { min-width: 0 !important; }

        #Main.right-column-open #MiddleColumn .MiddleHeader,
        #Main.right-column-open #MiddleColumn .Composer,
        ._tg_right_open #MiddleColumn .MiddleHeader,
        ._tg_right_open #MiddleColumn .Composer {
            position: relative !important;
            z-index: 10 !important;
        }

        #MiddleColumn.tgdl-private .MessageList.no-avatars .Message {
            padding-left: 44px !important;
            position: relative !important;
        }
        #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own {
            justify-content: flex-start !important;
        }
        #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .message-content-wrapper {
            margin-left: 0 !important;
            margin-right: auto !important;
        }
        #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own:not(.is-in-document-group):has(.message-content.media) .message-content-wrapper {
            display: flex !important;
            justify-content: flex-start !important;
            align-items: flex-start !important;
        }
        #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own:not(.is-in-document-group):has(.message-content.media) .message-content {
            margin-left: 0 !important;
            margin-right: auto !important;
        }
        #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own > .Avatar {
            display: none !important;
        }

        #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .svg-appendix {
            transform: scaleX(-1) !important;
            left: -8px !important;
            right: auto !important;
        }
        #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own.last-in-group .message-content {
            border-bottom-left-radius: 0 !important;
            border-bottom-right-radius: var(--border-radius-messages) !important;
        }

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

        #MiddleColumn .MessageList:not(.no-avatars) .Message.own {
            padding-left: 44px !important;
            position: relative !important;
            justify-content: flex-start !important;
        }
        #MiddleColumn .MessageList:not(.no-avatars) .Message.own .message-content-wrapper {
            margin-left: 0 !important;
            margin-right: auto !important;
        }
        #MiddleColumn .MessageList:not(.no-avatars) .Message.own:not(.is-in-document-group):has(.message-content.media) .message-content-wrapper {
            display: flex !important;
            justify-content: flex-start !important;
            align-items: flex-start !important;
        }
        #MiddleColumn .MessageList:not(.no-avatars) .Message.own:not(.is-in-document-group):has(.message-content.media) .message-content {
            margin-left: 0 !important;
            margin-right: auto !important;
        }
        #MiddleColumn .MessageList:not(.no-avatars) .Message.own > .Avatar { display: none !important; }
        #MiddleColumn .MessageList:not(.no-avatars) .Message.own .svg-appendix {
            transform: scaleX(-1) !important;
            left: -8px !important;
            right: auto !important;
        }
        #MiddleColumn .MessageList:not(.no-avatars) .Message.own.last-in-group .message-content {
            border-bottom-left-radius: 0 !important;
            border-bottom-right-radius: var(--border-radius-messages) !important;
        }
        #MiddleColumn .MessageList:not(.no-avatars) .Message.own .message-action-buttons-container {
            left: auto !important;
            right: -3rem !important;
        }

        #MiddleColumn.tgdl-private .MessageList.no-avatars.select-mode-active .Message.own .message-content-wrapper {
            transform: translateX(40px) !important;
        }
        #MiddleColumn.tgdl-private .MessageList.no-avatars.select-mode-active .custom-message-avatar {
            left: 44px !important;
        }

        #MiddleColumn .MessageList.no-avatars .Message .message-content.has-action-button .quick-reaction,
        #MiddleColumn .MessageList:not(.no-avatars) .Message:not(.own) .message-content.has-action-button .quick-reaction {
            display: none !important;
        }
        #MiddleColumn .MessageList.no-avatars .Message .message-content:not(.has-action-button) .quick-reaction,
        #MiddleColumn .MessageList:not(.no-avatars) .Message:not(.own) .message-content:not(.has-action-button) .quick-reaction {
            left: auto !important;
            right: -1.9rem !important;
            bottom: -1px !important;
            top: auto !important;
            transform: none !important;
        }
        #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .message-action-buttons-container {
            left: auto !important;
            right: -3rem !important;
        }

        #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own.is-in-document-group .message-content.audio,
        #MiddleColumn .MessageList:not(.no-avatars) .Message.own.is-in-document-group .message-content.audio {
            transform: translateX(45px) !important;
        }

        #MiddleColumn .Message .EmbeddedMessage .message-text .embedded-text-wrapper {
            white-space: pre-wrap !important;
        }

        /* Telegram hides the pinned-message island while chat search is open. Keep
           the normal chat header intact and put the search row into that freed slot. */
        #MiddleColumn #MiddleSearch:not(.visually-hidden) > :first-child {
            top: 72px !important;
        }

        #MiddleColumn .Message.own .message-content[data-tgdl-appendix] .svg-appendix {
            display: block !important;
        }

        @keyframes _tgAvIn_ {
            from { opacity: 0; transform: scale(0.6); }
            to { opacity: 1; transform: scale(1); }
        }
        .custom-message-avatar {
            position: absolute;
            left: 4px;
            bottom: 0;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            overflow: hidden;
            z-index: 5;
            pointer-events: none;
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
})();
