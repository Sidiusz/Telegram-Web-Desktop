(function () {
    function ensureStyles() {
        if (document.getElementById('twd-feature-desktop-wide') || !document.head) return;
        var s = document.createElement('style');
        s.id = 'twd-feature-desktop-wide';
        s.textContent = `
            /* Wide: center a full-width message canvas with fixed 1rem side gutters.
               MessageList itself already accounts for the open Telegram right column. */
            html #MiddleColumn .MessageList .messages-container,
            body #MiddleColumn .MessageList .messages-container,
            #MiddleColumn .MessageList .messages-container {
                max-width: calc(100% - 2rem) !important;
                width: calc(100% - 2rem) !important;
                margin-left: auto !important;
                margin-right: auto !important;
                padding-left: 0 !important;
                box-sizing: border-box !important;
                align-self: center !important;
            }

            /* Remove the top fade that becomes visible under the widened header. */
            #MiddleColumn .MessageList {
                -webkit-mask-image: linear-gradient(to bottom, rgb(0,0,0) 0px, rgb(0,0,0) calc(100% - 64px), rgba(0,0,0,0.24) 100%) !important;
                mask-image: linear-gradient(to bottom, rgb(0,0,0) 0px, rgb(0,0,0) calc(100% - 64px), rgba(0,0,0,0.24) 100%) !important;
            }

            #MiddleColumn .middle-column-footer { margin-left: 0 !important; }

            /* Wide text bubbles may use the available composer width. */
            #MiddleColumn .Message:not(.is-album):not(:has(.message-content.media)) {
                --max-width: 70rem !important;
            }

            /* Albums keep the square corner on the mirrored tail side. */
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own .message-content .Album,
            #MiddleColumn .MessageList:not(.no-avatars) .Message.own .message-content .Album {
                border-bottom-right-radius: var(--border-radius-messages) !important;
            }
            #MiddleColumn.tgdl-private .MessageList.no-avatars .Message.own.last-in-group .message-content .Album,
            #MiddleColumn .MessageList:not(.no-avatars) .Message.own.last-in-group .message-content .Album {
                border-bottom-left-radius: 0 !important;
            }

            /* Keep header buttons clickable after closing the right-side column. */
            .MiddleHeader .header-tools,
            .MiddleHeader .HeaderActions {
                position: relative !important;
                z-index: 200 !important;
            }
            .MiddleHeader .HeaderActions,
            .MiddleHeader .HeaderActions .Button { pointer-events: all !important; }

            /* Wide header island follows the same 1rem gutters as the message canvas. */
            #MiddleColumn .MiddleHeader {
                width: calc(100% - 2rem - var(--tgdl-rc, 0px)) !important;
                max-width: calc(100% - 2rem - var(--tgdl-rc, 0px)) !important;
                margin-left: 1rem !important;
                margin-right: auto !important;
                box-sizing: border-box !important;
            }
            ._tg_right_open #MiddleColumn .MiddleHeader { transform: none !important; }
        `;
        document.head.appendChild(s);
    }

    window.__twdDesktopLikeCommon(ensureStyles);
})();
