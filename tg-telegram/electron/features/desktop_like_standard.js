(function () {
    function ensureStyles() {
        if (document.getElementById('twd-feature-desktop-standard') || !document.head) return;
        var s = document.createElement('style');
        s.id = 'twd-feature-desktop-standard';
        s.textContent = `
            /* Standard: left-align the native message container without changing
               its virtualization width/max-width. */
            #MiddleColumn .MessageList .messages-container {
                margin-left: 0 !important;
                margin-right: auto !important;
                padding-left: 0 !important;
            }

            /* Match Wide: messages fade at both the top and bottom edges. */
            #MiddleColumn .MessageList {
                -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0.24) 0px, rgb(0,0,0) 64px, rgb(0,0,0) calc(100% - 64px), rgba(0,0,0,0.24) 100%) !important;
                mask-image: linear-gradient(to bottom, rgba(0,0,0,0.24) 0px, rgb(0,0,0) 64px, rgb(0,0,0) calc(100% - 64px), rgba(0,0,0,0.24) 100%) !important;
            }

            /* Standard header follows the same left edge as messages. */
            #MiddleColumn .MiddleHeader {
                margin-left: 0 !important;
                margin-right: auto !important;
                box-sizing: border-box !important;
            }
            ._tg_right_open #MiddleColumn .MiddleHeader {
                margin-right: var(--tgdl-rc, 0px) !important;
                max-width: calc(100% - var(--tgdl-rc, 0px)) !important;
                transform: none !important;
            }

            /* Search replaces the chat header and must follow the same left edge
               as the standard desktop header instead of staying centered. */
            #MiddleColumn #MiddleSearch:not(.visually-hidden) > :first-child {
                top: 16px !important;
                left: 0 !important;
                right: auto !important;
                margin-left: 0 !important;
                margin-right: auto !important;
            }
        `;
        document.head.appendChild(s);
    }

    window.__twdDesktopLikeCommon(ensureStyles);
})();
