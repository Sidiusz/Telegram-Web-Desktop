setInterval(function() {
    if (document.getElementById('twd-feature-hide-ads') || !document.head) return;

    document.head.insertAdjacentHTML('beforeend', `<style id="twd-feature-hide-ads">
        /* Вырезаем рекламный блок полностью */
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
    </style>`);
}, 2000);