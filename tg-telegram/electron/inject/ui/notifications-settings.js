
// ── Кэш нативных виджетов для клонирования (#3) ─────────────────────────────
// Чтобы наши настройки в «Общие настройки» выглядели 1-в-1 как родные, мы НЕ
// рисуем свою вёрстку, а КЛОНИРУЕМ живые нативные виджеты TG (как блок
// «Уведомления»): тумблер (label.Checkbox), поле ввода (.input-group),
// кнопку (.Button). На странице «Общие» их нет — поэтому ловим образцы с любой
// страницы настроек (Уведомления/Изменить профиль/…) и сохраняем в localStorage,
// чтобы при следующих загрузках они были сразу.
var _tgWidgetTpl = { toggle:null, input:null, button:null, header:null, cardCls:null };
(function restoreWidgetTpl(){
    try{
        var raw=localStorage.getItem('_tgWidgetTpl2');
        if(!raw)return;
        var o=JSON.parse(raw), box=document.createElement('div');
        ['toggle','input','button','header'].forEach(function(k){
            if(o[k]){ box.innerHTML=o[k]; if(box.firstElementChild) _tgWidgetTpl[k]=box.firstElementChild.cloneNode(true); box.innerHTML=''; }
        });
        if(o.cardCls) _tgWidgetTpl.cardCls=o.cardCls;
    }catch(e){}
})();
function captureWidgetTpl(){
    var st=document.getElementById('Settings'); if(!st) return;
    var changed=false;
    if(!_tgWidgetTpl.toggle){ var t=st.querySelector('label.Checkbox'); if(t){ _tgWidgetTpl.toggle=t.cloneNode(true); changed=true; } }
    if(!_tgWidgetTpl.input){ var inp=st.querySelector('.input-group'); if(inp){ _tgWidgetTpl.input=inp.cloneNode(true); changed=true; } }
    if(!_tgWidgetTpl.button){ var b=st.querySelector('.Button:not(.default):not(.translucent)'); if(b){ _tgWidgetTpl.button=b.cloneNode(true); changed=true; } }
    // Карточку и заголовок ловим по стилю (хэши меняются между сборками); перезаписываем при расхождении.
    var nt=_findNativeCardTpl();
    if(nt){
        if(nt.cardCls && _tgWidgetTpl.cardCls!==nt.cardCls){ _tgWidgetTpl.cardCls=nt.cardCls; changed=true; }
        if(nt.header && !_tgWidgetTpl.header){ _tgWidgetTpl.header=nt.header.cloneNode(false); changed=true; }
    }
    if(changed){
        try{
            var o={};
            ['toggle','input','button','header'].forEach(function(k){ if(_tgWidgetTpl[k]) o[k]=_tgWidgetTpl[k].outerHTML; });
            if(_tgWidgetTpl.cardCls) o.cardCls=_tgWidgetTpl.cardCls;
            localStorage.setItem('_tgWidgetTpl2', JSON.stringify(o));
        }catch(e){}
    }
}

// ── Синхронизация и разблокировка Telegram-уведомлений ────────────────────
function setupNotificationSettingsSync() {
    function savePatch(patch) {
        return INV('get_settings').then(function(s) {
            return INV('save_settings', { settings: Object.assign({}, s || {}, patch) });
        }).catch(function() {});
    }

    function normalizeText(value) {
        return String(value == null ? '' : value).replace(/s+/g, ' ').trim();
    }

    function findSettingRow(pattern) {
        var candidates = Array.from(document.querySelectorAll('label, button, div, span, li, a, .Row, .row, .ListItem, .MenuItem'));
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            var text = normalizeText(el.textContent || '');
            if (!text || !pattern.test(text)) continue;

            var node = el;
            for (var depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
                if (node && typeof node.querySelector === 'function' && node.querySelector('input[type="checkbox"]')) {
                    return node;
                }
            }

            var parent = el.parentElement;
            if (parent && typeof parent.querySelector === 'function' && parent.querySelector('input[type="checkbox"]')) {
                return parent;
            }
        }
        return null;
    }

    function unlockRow(row) {
        if (!row) return null;
        row.style.pointerEvents = 'auto';
        row.style.opacity = '1';
        row.style.cursor = 'pointer';
        row.removeAttribute('aria-disabled');
        row.removeAttribute('disabled');
        row.classList.remove('disabled', 'is-disabled', 'locked');
        row.querySelectorAll('[aria-disabled="true"]').forEach(function(el) { el.removeAttribute('aria-disabled'); });
        row.querySelectorAll('[disabled]').forEach(function(el) { el.disabled = false; el.removeAttribute('disabled'); });
        row.querySelectorAll('input[type="checkbox"]').forEach(function(input) {
            input.disabled = false;
            input.style.pointerEvents = 'auto';
            input.tabIndex = 0;
        });
        Array.from(row.querySelectorAll('div, span')).forEach(function(el) {
            if (/не поддерживается/i.test(normalizeText(el.textContent || ''))) {
                el.textContent = '';
            }
        });
        return row;
    }

    function bindRow(row, key) {
        if (!row || row.dataset.tgNotifBound === '1') return;
        row.dataset.tgNotifBound = '1';
        unlockRow(row);

        var input = row.querySelector('input[type="checkbox"]');
        if (!input) return;

        input.disabled = false;
        input.tabIndex = 0;
        input.style.pointerEvents = 'auto';

        INV('get_settings').then(function(s) {
            if (!s) return;
            if (key === 'web' && typeof s.popup_notifications !== 'undefined') input.checked = !!s.popup_notifications;
            if (key === 'background' && typeof s.background_notifications_enabled !== 'undefined') input.checked = !!s.background_notifications_enabled;
        }).catch(function() {});

        var apply = function(nextValue) {
            input.checked = !!nextValue;
            var patch = {};
            if (key === 'web') patch.popup_notifications = !!input.checked;
            if (key === 'background') patch.background_notifications_enabled = !!input.checked;
            savePatch(patch);
        };

        input.addEventListener('change', function() {
            apply(input.checked);
        }, true);

        row.addEventListener('click', function(e) {
            var interactive = e.target && e.target.closest && e.target.closest('button,a,input,label');
            if (interactive && interactive !== row) return;
            apply(!input.checked);
            e.preventDefault();
            e.stopPropagation();
        }, true);
    }

    // ── Наш блок настроек уведомлений в нативных Настройках→Уведомления ──────
    // Вставляется самым первым ребёнком .settings-content (над блоком ТГ).
    // Идемпотентно (id=_tgnotif_block_). Перестраивается только при первом
    // появлении; состояние тумблеров синхронизируем с настройками на каждом scan.
    // Находит заголовок секции «Веб-уведомления» — прямой ребёнок .settings-content.
    // Классы TG хэшированы и меняются между сборками, поэтому цепляемся к ТЕКСТУ
    // (RU + EN). Возвращает элемент-заголовок или null.
    function findWebNotifHeader(sc) {
        var kids = sc.children;
        for (var i = 0; i < kids.length; i++) {
            var t = (kids[i].textContent || '').trim();
            if (/^(Веб-уведомления|Web notifications)$/i.test(t)) return kids[i];
        }
        return null;
    }

    // Строит нашу секцию КЛОНИРУЯ нативные узлы TG (тумблер .Checkbox, ползунок
    // .RangeSlider, заголовок секции). Это даёт точный нативный вид без своих
    // стилей и переживает смену хэшированных классов между сборками.
    function injectNotifBlock() {
        var sc = document.querySelector('.settings-content');
        if (!sc) return;
        if (sc.querySelector('#_tgnf_hdr_')) return;            // уже вставлено
        var header = findWebNotifHeader(sc);
        if (!header) return;                                    // не раздел «Уведомления»
        var body = header.nextElementSibling;
        if (!body) return;
        var nativeToggle = body.querySelector('label.Checkbox');
        var nativeSlider = body.querySelector('.RangeSlider');
        if (!nativeToggle) return;                              // нет образца — не рискуем

        var card = document.createElement('div');
        card.className = body.className;                        // тот же класс-карточка (хэш живьём)

        var inputs = {};

        function addToggle(key, labelText) {
            var n = nativeToggle.cloneNode(true);
            n.classList.remove('withSubLabel');
            var sub = n.querySelector('.subLabel'); if (sub) sub.remove();
            var av = n.querySelector('.user-avatar'); if (av) av.remove();
            var lab = n.querySelector('.label'); if (lab) lab.textContent = labelText;
            var inp = n.querySelector('input[type=checkbox]');
            inp.checked = false; inp.removeAttribute('id');
            inp.addEventListener('change', function () {
                var p = {}; p[key] = !!inp.checked; savePatch(p);
            });
            card.appendChild(n);
            inputs[key] = inp;
        }

        function addSlider(key, labelText, min, max, def, fmt, toSetting) {
            if (!nativeSlider) return;
            var n = nativeSlider.cloneNode(true);
            var lab = n.querySelector('.slider-top-row .label'); if (lab) lab.textContent = labelText;
            var valEl = n.querySelector('.slider-top-row .value');
            var fill = n.querySelector('.slider-fill-track');
            var inp = n.querySelector('input[type=range]');
            inp.min = min; inp.max = max; inp.step = 1; inp.value = def; inp.removeAttribute('id');
            function refresh() {
                var v = parseInt(inp.value, 10);
                if (fill) fill.style.width = ((v - min) / (max - min) * 100) + '%';
                if (valEl) valEl.textContent = fmt(v);
            }
            refresh();
            inp.addEventListener('input', refresh);
            var t = null;
            inp.addEventListener('change', function () {
                clearTimeout(t);
                t = setTimeout(function () { savePatch(toSetting(parseInt(inp.value, 10))); }, 150);
            });
            card.appendChild(n);
            inputs[key] = { input: inp, refresh: refresh };
        }

        addToggle('popup_notifications', T('ns_popup'));
        addToggle('notif_sound', T('ns_sound'));
        // Громкость отдельную не делаем — берём из TG «Громкость звука» (см. syncTgVolume).
        addSlider('notif_duration', T('ns_duration'), 3, 20, 6,
            function (v) { return v + T('unit_sec'); },
            function (v) { return { notif_duration: v }; });
        addToggle('notif_cat_private', T('ns_sec_private'));
        addToggle('notif_cat_group', T('ns_sec_group'));
        addToggle('notif_cat_channel', T('ns_sec_channel'));
        addToggle('notif_hide_text', T('ns_hide_text'));
        addToggle('notif_hide_sender', T('ns_hide_sender'));

        // Заголовок-категория: клон нативного заголовка с нашим текстом.
        var hdr = header.cloneNode(false);
        hdr.id = '_tgnf_hdr_';
        hdr.textContent = T('ns_section');

        // Вставляем сразу ПОСЛЕ секции «Веб-уведомления»: заголовок, затем карточка.
        var ref = body.nextSibling;
        sc.insertBefore(hdr, ref);
        sc.insertBefore(card, ref);

        // Начальные значения из настроек.
        INV('get_settings').then(function (s) {
            if (!s) return;
            inputs.popup_notifications.checked = s.popup_notifications !== false;
            inputs.notif_sound.checked = s.notif_sound !== false;
            inputs.notif_cat_private.checked = s.notif_cat_private !== false;
            inputs.notif_cat_group.checked = s.notif_cat_group !== false;
            inputs.notif_cat_channel.checked = s.notif_cat_channel !== false;
            inputs.notif_hide_text.checked = s.notif_hide_text === true;
            inputs.notif_hide_sender.checked = s.notif_hide_sender === true;
            if (inputs.notif_duration) {
                var d = parseInt(s.notif_duration, 10); if (isNaN(d)) d = 6;
                inputs.notif_duration.input.value = d; inputs.notif_duration.refresh();
            }
        }).catch(function () {});
    }

    // Подхватываем громкость из нативного слайдера TG «Громкость звука» (0..max)
    // и кладём в notif_volume (0..1) — чтобы у попапа не было своего дубля.
    // Доступно только когда открыты Настройки→Уведомления; иначе используем кэш.
    var _lastTgVol = null;
    function syncTgVolume() {
        var sc = document.querySelector('.settings-content');
        if (!sc) return;
        var sliders = sc.querySelectorAll('.RangeSlider');
        var inp = null;
        for (var i = 0; i < sliders.length; i++) {
            var lab = sliders[i].querySelector('.slider-top-row .label');
            if (lab && /Громкость|Volume/i.test(lab.textContent)) {
                inp = sliders[i].querySelector('input[type=range]');
                if (inp) break;
            }
        }
        if (!inp) return;
        var v = parseInt(inp.value, 10);
        var max = parseInt(inp.max, 10) || 10;
        if (isNaN(v) || !max) return;
        var norm = Math.max(0, Math.min(1, v / max));
        if (_lastTgVol === norm) return;
        _lastTgVol = norm;
        savePatch({ notif_volume: norm });
    }

    function scan() {
        // Наш блок настроек + синхронизация громкости из TG. Галку «Веб-уведомления»
        // не трогаем: звук/попапы работают независимо (см. setupIncomingSound).
        injectNotifBlock();
        syncTgVolume();
        captureWidgetTpl();                              // #3: ловим образцы нативных виджетов
        try { injectGeneralSettings(); } catch (e) {}   // #3: секции в «Общие настройки»
        try { injectAboutSection(); } catch (e) {}       // #3: «О приложении» внизу главного экрана
    }

    scan();
    setInterval(scan, 500);
}

// Старый вступительный хинт про веб-уведомления удалён — больше не актуален.
