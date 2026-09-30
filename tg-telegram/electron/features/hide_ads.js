(function () {
    if (window.__twdHideAdsRuntimeStarted) return;
    window.__twdHideAdsRuntimeStarted = true;

    const STYLE_ID = 'twd-feature-hide-ads';
    const CSS = `
        .SponsoredMessage,
        .sponsored-media-image-container,
        .sponsored-media-preview,
        [data-is-sponsored="true"] {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            pointer-events: none !important;
            overflow: hidden !important;
        }
    `;

    function setEnabled(enabled) {
        window.__twdHideAdsEnabled = enabled === true;
        let style = document.getElementById(STYLE_ID);
        if (window.__twdHideAdsEnabled) {
            if (!style && document.head) {
                style = document.createElement('style');
                style.id = STYLE_ID;
                style.textContent = CSS;
                document.head.appendChild(style);
            }
        } else if (style) {
            style.remove();
        }
    }

    window.addEventListener('__twd_hide_ads_config', function (event) {
        setEnabled(!!(event.detail && event.detail.enabled));
    });

    if (document.head) setEnabled(window.__twdHideAdsEnabled !== false);
    else document.addEventListener('DOMContentLoaded', function () {
        setEnabled(window.__twdHideAdsEnabled !== false);
    }, { once: true });
})();
