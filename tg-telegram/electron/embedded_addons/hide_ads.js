// @name Hide Channel Ads
// @version 1.0.0
// @description Скрывает встроенную на каналах рекламу

setInterval(function() {
    if (document.getElementById('addon-hide-ads') || !document.head) return;

    document.head.insertAdjacentHTML('beforeend', `<style id="addon-hide-ads">
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