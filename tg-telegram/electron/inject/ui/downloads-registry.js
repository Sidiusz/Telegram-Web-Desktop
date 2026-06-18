if(!window.tgBridge) {
    // нет моста — ничего не поделаешь
} else {
const DL = window.__tgdl = (function(){
    // pending[filename] = [mid,...]  — кликнули, ждём start от main
    const pending = {};
    // registry[mid] = { id, filename, status, recv, total }
    // registryById[id] = mid
    const registry = {};
    const byId = {};
    // filename→mids, которые уже скачаны (для re-download: повторный клик)
    const doneFn = {};  // doneFn[mid] = filename
    // mids, у которых файл пропал с диска: не восстанавливаем «скачано», пока не
    // перекачают (иначе restoreForChat снова покажет галочку на удалённом файле).
    const forgotten = {};

    function fmtBytes(b){
        if(b==null)return '';
        if(b<1024)return b+' B';
        if(b<1048576)return (b/1024).toFixed(1)+' KB';
        if(b<1073741824)return (b/1048576).toFixed(1)+' MB';
        return (b/1073741824).toFixed(2)+' GB';
    }
    function fmtProgress(recv,total){
        if(!total)return recv?fmtBytes(recv):'…';
        const pct=Math.round(recv/total*100);
        return fmtBytes(recv)+' / '+fmtBytes(total)+' · '+pct+'%';
    }

    // ── Восстановление статуса «скачано» после перезапуска (#3) ───────────
    // Сохранённые записи (downloads.json) с привязкой mid+peerId — кэшируем и при
    // открытии чата сеем в registry как completed, чтобы показать галочку/«открыть».
    let savedDl = [];
    function currentPeer(){
        const a = document.querySelector('#MiddleColumn .Avatar[data-peer-id]');
        return a ? a.getAttribute('data-peer-id') : null;
    }
    function refreshSaved(){
        return INV('get_downloads').then(function(d){ savedDl = d||[]; restoreForChat(); }).catch(function(){});
    }
    function restoreForChat(){
        const pid = currentPeer(); if(!pid) return;
        const byMid = {};
        savedDl.forEach(function(r){
            // exists — снимок ФС из get_downloads. false = файл удалили (напр. из
            // Проводника): галочку «скачано» НЕ восстанавливаем, пусть TG качает заново.
            if(r.status==='completed' && r.mid && String(r.peerId)===String(pid) && r.exists!==false){
                const prev = byMid[r.mid];
                if(!prev || r.id>prev.id) byMid[r.mid] = r;   // последняя загрузка побеждает
            }
        });
        for(const mid in byMid){
            if(forgotten[mid]) continue;          // файл удалён — не восстанавливаем
            const r = byMid[mid];
            if(!registry[mid] || registry[mid].status!=='completed'){
                registry[mid] = { mid:mid, id:r.id, filename:r.filename, status:'completed' };
                applyToMessage(mid);
            }
        }
    }

    // Renderer-side: запомнить что кликнули файл с mid/filename.
    // Вызывается на capture-клике по .File. Идемпотентен для повторных кликов.
    function expectDownload(mid, filename){
        if(!mid||!filename)return;
        (pending[filename] = pending[filename] || []).push(mid);
        // сразу покажем состояние «ожидание» на сообщении
        registry[mid] = Object.assign(registry[mid]||{}, {mid, filename, status:'pending'});
        applyToMessage(mid);
    }

    // Main шлёт download-event. Связываем filename→mid.
    function onEvent(data){
        if(!data)return;
        if(data.type==='start'){
            // Матчим по ОРИГИНАЛЬНОМУ имени (как в сообщении). filename может быть
            // « (1)» из-за дедупликации на диске — по нему матчить нельзя.
            const orig = data.origName || data.filename;
            const mids = pending[orig];
            let mid = mids && mids.length ? mids.pop() : null;
            if(!mid){
                // нет клика в renderer — возможно ПЕРЕКАЧКА уже скачанного файла
                // через родное ПКМ-меню TG (его НЕ трогаем). Ищем mid по имени
                // среди завершённых — туда вернём состояние «качается».
                for(const m in doneFn){ if(doneFn[m]===orig){ mid=m; break; } }
            }
            if(!mid){
                // не было нашего клика (напр. сбросили состояние и качаем заново):
                // привяжем к ВИДИМОМУ сообщению с тем же именем — чтобы скачанное
                // ВСЕГДА отображалось галочкой, а не уходило в «несвязанное».
                const titles = document.querySelectorAll('.File .file-title');
                for(let i=0;i<titles.length;i++){
                    const nm = (titles[i].getAttribute('title')||titles[i].textContent||'').trim();
                    if(nm!==orig) continue;
                    const fm = titles[i].closest('[data-message-id]'); if(!fm) continue;
                    const cand = fm.getAttribute('data-message-id');
                    if(!registry[cand] || registry[cand].status!=='completed'){ mid=cand; break; }
                }
            }
            if(!mid){
                // совсем не наше (инициировано не из чата) — покажется только в модалке
                mid = '__noid__'+data.id;
            }
            // перекачка: снимаем оверлей «открыть», пусть снова идёт нативный прогресс TG
            if(registry[mid] && registry[mid].status==='completed') unpaint(mid);
            delete doneFn[mid];
            delete forgotten[mid];   // снова качают — забытый mid опять валиден
            registry[mid] = { mid, id:data.id, filename:data.filename, origName:orig, status:'downloading', recv:0, total:0 };
            byId[data.id] = mid;
            // привязка к сообщению/чату — чтобы статус пережил перезапуск (#3)
            if(mid.indexOf('__noid__')!==0){
                INV('bind_download',{id:data.id, mid:mid, peerId:currentPeer()}).catch(function(){});
            }
            applyToMessage(mid);
        } else if(data.type==='progress'){
            const mid = byId[data.id]; if(!mid)return;
            const r = registry[mid]; if(!r)return;
            r.recv = data.received||0; r.total = data.total||0;
            applyToMessage(mid);
        } else if(data.type==='done'){
            const mid = byId[data.id]; if(!mid)return;
            const r = registry[mid]; if(!r)return;
            r.status = data.status==='completed' ? 'completed' : 'failed';
            applyToMessage(mid);
            doneFn[mid] = r.origName || r.filename;   // по имени из сообщения (для перекачки)
            refreshSaved();   // обновим кэш сохранённых загрузок (для восстановления)
        }
        // нативная панель «Загрузки», если открыта — обновим список
        if(window.__tgdlNativeRefresh) window.__tgdlNativeRefresh();
    }

    // ── In-message overlay ───────────────────────────────────────────────
    // .file-icon-container стабилен; кладём туда наш ._tgdl-ov_. Идемпотентно.
    function applyToMessage(mid){
        if(!mid || mid.indexOf('__noid__')===0) return;   // не привязано к сообщению
        const r = registry[mid]; if(!r)return;
        const msg = document.querySelector('.Message[data-message-id="'+mid+'"]');
        if(!msg) return;                                   // виртуализировано — пропустим, интервал доберёт
        paintMessage(msg, r);
    }
    // ВАЖНО: родные ноды TG (.action-icon, .file-icon) НЕ мутируем — иначе ломается
    // кнопка скачивания и hover-анимация «ушка». Только накладываем свои оверлеи
    // и прячем родную стрелку через CSS (обратимо: снимаем data-атрибут).
    function paintMessage(msg, r){
        const file = msg.querySelector('.File'); if(!file)return;
        if(r.status==='completed'){
            file.dataset.tgdlDone='1';
            file.dataset.tgdlId = r.id!=null ? String(r.id) : (file.dataset.tgdlId||'');
            file.dataset.tgdlMid = r.mid;
            ensureBadges(file);
        } else {
            // pending/downloading/failed — никаких оверлеев, нативный прогресс TG сам
            file.removeAttribute('data-tgdl-done');
            clearBadges(file);
        }
    }

    // Скачанный файл: в центре иконки — «открыть» (на месте стрелки), в углу —
    // зелёная галочка-индикатор. Открытие — кликом по иконке (см. mousedown),
    // оверлеи pointer-events:none. «Открыть папку» — в родном ПКМ-меню.
    function ensureBadges(file){
        const cont = file.querySelector('.file-icon-container'); if(!cont)return;
        file.classList.add('_tgdl_done_ok_');                 // прячем родную стрелку (идемпотентно)
        if(!cont.querySelector('._tgdl_open_')){
            const op = document.createElement('div');
            op.className='_tgdl_open_'; op.setAttribute('aria-hidden','true');
            op.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg>';
            cont.appendChild(op);
        }
        if(!cont.querySelector('._tgdl_ok_')){
            const ok = document.createElement('div');
            ok.className='_tgdl_ok_'; ok.setAttribute('aria-hidden','true');
            ok.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4 10-10" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            cont.appendChild(ok);
        }
    }
    function clearBadges(file){
        file.classList.remove('_tgdl_done_ok_');
        const cont = file.querySelector('.file-icon-container'); if(!cont)return;
        ['._tgdl_open_','._tgdl_ok_'].forEach(function(s){const el=cont.querySelector(s); if(el)el.remove();});
    }

    // Перекачка: снимаем оверлей, возвращаем родную стрелку (CSS), не трогаем ПКМ-меню.
    function unpaint(mid){
        const msg = document.querySelector('.Message[data-message-id="'+mid+'"]');
        if(!msg) return;
        const file = msg.querySelector('.File'); if(!file) return;
        file.removeAttribute('data-tgdl-done');
        file.removeAttribute('data-tgdl-id');
        file.removeAttribute('data-tgdl-mid');
        clearBadges(file);
    }

    // Файл пропал с диска: молча сбрасываем «скачано» → возвращается родная стрелка,
    // клик по ней снова качает через TG (свежий blob; программно не дёрнуть). Никаких
    // предупреждений. Забываем привязку (локально + в downloads.json).
    function resetDownloaded(file){
        const mid = file && file.dataset.tgdlMid;
        if(!mid) return;
        forgotten[mid] = 1;
        delete registry[mid];
        delete doneFn[mid];
        unpaint(mid);
        INV('forget_download',{mid:mid}).then(refreshSaved).catch(function(){});
    }

    // Переприменяем состояние ко всем сообщениям из реестра (идемпотентно).
    function scanMessages(){
        for(const mid in registry){ applyToMessage(mid); }
    }
    // Файлы могли удалить/переместить из Проводника — проверяем их существование
    // (exists из get_downloads) на каждом свежем запросе, а не верим сохранённому
    // status:'completed'. Кэш savedDl протухает между запросами, поэтому при смене/
    // открытии чата перезапрашиваем: пользователь «смотрит» на бейджи именно тогда.
    // exists!==false (а не ===true) — чтобы старые записи без поля не отваливались.
    let _lastPeer = null;
    function restoreForChatIfPeerChanged(){
        const pid = currentPeer();
        if(pid && pid !== _lastPeer){
            _lastPeer = pid;
            refreshSaved();   // обновит savedDl свежим exists → restoreForChat отфильтрует
        }
    }
    // Страховочный таймер (виртуализация/редкие случаи).
    setInterval(scanMessages, 600);
    // TG перерисовывает .action-icon после своей загрузки и при повторном входе в
    // диалог — затирая наш оверлей. MutationObserver ловит перерисовку и сразу
    // переприменяет, без задержки таймера. Дебаунс 50мс; paint идемпотентен
    // (повторный проход не мутирует DOM → не зациклится). Смена/открытие чата
    // детектится здесь же (через restoreForChatIfPeerChanged) и перезапрашивает ФС.
    let _moT=null;
    const _mo=new MutationObserver(function(){
        if(_moT)return;
        _moT=setTimeout(function(){_moT=null;scanMessages();injectFolderMenuItem();restoreForChatIfPeerChanged();},50);
    });
    (function startMO(){
        if(document.body) _mo.observe(document.body,{childList:true,subtree:true});
        else setTimeout(startMO,200);
    })();

    // ── Клик-перехват на .File (capture) ─────────────────────────────────
    // Ловим mid+filename до того, как TG начнёт скачивание. Не блокируем клик —
    // пусть TG создаст blob: и отправит его в will-download.
    // TG запускает свою загрузку по 'click' (не mousedown), поэтому preventDefault
    // на mousedown её НЕ отменяет — и скачанный файл повторно качался при открытии.
    // Поэтому блокируем родную загрузку на ВСЕХ pointer-событиях (capture), а файл
    // открываем один раз — по 'click' на иконке.
    function onFilePointer(e){
        if(e.button!==undefined && e.button!==0) return;   // только ЛКМ
        const file = e.target.closest && e.target.closest('.File');
        if(!file) return;
        if(file.dataset.tgdlDone==='1'){
            // скачано: TG больше НЕ должен ничего качать по клику на этом файле
            e.preventDefault(); e.stopImmediatePropagation();
            // открываем только по клику на иконку (не по названию — даём его выделять)
            if(e.type==='click' && e.target.closest('.file-icon-container')){
                const id = parseInt(file.dataset.tgdlId,10);
                if(id) INV('open_download_file',{id}).then(function(r){ if(r&&r.error) resetDownloaded(file); }).catch(function(){});
            }
            return;
        }
        // не скачано: на mousedown запоминаем mid+filename, клик пропускаем к TG
        if(e.type==='mousedown'){
            const msg = file.closest('[data-message-id]'); if(!msg) return;
            const mid = msg.getAttribute('data-message-id');
            const t = file.querySelector('.file-title');
            const filename = t ? (t.getAttribute('title')||t.textContent||'').trim() : '';
            if(filename) expectDownload(mid, filename);
        }
    }
    ['pointerdown','mousedown','click'].forEach(function(t){ document.addEventListener(t, onFilePointer, true); });

    // ПКМ по .File: (1) запоминаем кандидата для матчинга, если из РОДНОГО меню
    // выберут «Скачать»; (2) если файл уже скачан — запоминаем его id, чтобы добавить
    // в это меню пункт «Открыть папку». Само меню TG не пересобираем — только
    // дорисовываем один родного вида пункт (injectFolderMenuItem).
    let lastCtx = {id:0, ts:0};
    document.addEventListener('contextmenu', function(e){
        lastCtx = {id:0, ts:0};                    // сброс: вдруг ПКМ не по скачанному
        const file = e.target.closest && e.target.closest('.File');
        if(!file)return;
        const msg = file.closest('[data-message-id]'); if(!msg)return;
        const mid = msg.getAttribute('data-message-id');
        const t = file.querySelector('.file-title');
        const filename = t ? (t.getAttribute('title')||t.textContent||'').trim() : '';
        if(filename) (pending[filename] = pending[filename] || []).push(mid);
        if(file.dataset.tgdlDone==='1' && file.dataset.tgdlId){
            lastCtx = {id:parseInt(file.dataset.tgdlId,10), ts:Date.now()};
        }
    }, true);

    // Дорисовываем «Открыть папку» в родное меню сообщения — только если ПКМ был
    // по скачанному файлу (≤2.5с назад). Стиль/иконку берём как у родных пунктов.
    function injectFolderMenuItem(){
        if(!lastCtx.id || Date.now()-lastCtx.ts>2500) return;
        const items = document.querySelector('.MessageContextMenu_items');
        if(!items || items.querySelector('._tgdl_openfolder_')) return;
        const id = lastCtx.id;
        const it = document.createElement('div');
        it.className='MenuItem compact _tgdl_openfolder_';
        it.setAttribute('role','menuitem'); it.tabIndex=0;
        it.innerHTML='<i class="icon" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" width="1.4rem" height="1.4rem" fill="currentColor" style="display:block"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg></i>Открыть папку';
        it.addEventListener('click',function(e){
            e.preventDefault(); e.stopPropagation();
            INV('open_download_folder',{id:id}).then(function(r){if(r&&r.error)toast('Файл не найден — возможно, перемещён или удалён');}).catch(function(){});
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,which:27,bubbles:true}));
        });
        // после пункта «Скачать» (иконка icon-download), иначе в конец
        let after=null;
        [].forEach.call(items.querySelectorAll('.MenuItem'),function(m){ if(m.querySelector('.icon-download')) after=m; });
        if(after) items.insertBefore(it, after.nextSibling);
        else items.appendChild(it);
    }

    window.tgBridge.onDownloadEvent(onEvent);
    refreshSaved();   // подтянуть сохранённые загрузки и восстановить статус в чате

    return { registry, byId, fmtBytes, fmtProgress, expectDownload, refreshSaved };
})();
} // end if(window.tgBridge) — блок реестра загрузок

// ── Глобальные помощники для модалки/формата ──────────────────────────────
function _fmtBytes_dl(b){ return window.__tgdl ? window.__tgdl.fmtBytes(b) : ''; }
// ──────────────────────────────────────────────────────────────────────────