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
        `;
        document.head.appendChild(s);
    }

    window.__twdDesktopLikeCommon(ensureStyles);
})();
