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
        // Угловой индикатор на любую загрузку (вкл. blob из просмотрщика).
        try{ if(typeof showDownloadIndicator==='function') showDownloadIndicator(data); }catch(e){}
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
            if(!mid && _pendingViewerDl.mid && Date.now()-_pendingViewerDl.ts<8000){
                // Скачали медиа (видео/фото) из просмотрщика — у него нет .File, но mid
                // мы запомнили при клике по кнопке «Загрузка». Привязываем сюда.
                mid = _pendingViewerDl.mid; _pendingViewerDl.mid = null;
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
            r.status = data.status==='completed' ? 'completed' : (data.status==='cancelled' ? 'cancelled' : 'failed');
            applyToMessage(mid);
            if(data.status!=='cancelled') doneFn[mid] = r.origName || r.filename;   // cancelled ≠ downloaded
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
            file.classList.remove('_tgdl_downloading_');
            ensureBadges(file);
        } else if(r.status==='downloading' || r.status==='pending'){
            file.removeAttribute('data-tgdl-done');
            clearBadges(file);
            file.classList.add('_tgdl_downloading_');
            ensureDownloadingBadge(file);
        } else {
            file.removeAttribute('data-tgdl-done');
            file.classList.remove('_tgdl_downloading_');
            clearBadges(file);
            clearDownloadingBadge(file);
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
    function ensureDownloadingBadge(file){
        const cont=file.querySelector('.file-icon-container'); if(!cont) return;
        if(!cont.querySelector('._tgdl_spinner_')){
            const sp=document.createElement('div'); sp.className='_tgdl_spinner_'; sp.setAttribute('aria-hidden','true'); cont.appendChild(sp);
        }
    }
    function clearDownloadingBadge(file){
        const cont=file.querySelector('.file-icon-container'); if(!cont) return;
        const sp=cont.querySelector('._tgdl_spinner_'); if(sp) sp.remove();
    }

    // Перекачка: снимаем оверлей, возвращаем родную стрелку (CSS), не трогаем ПКМ-меню.
    function unpaint(mid){
        const msg = document.querySelector('.Message[data-message-id="'+mid+'"]');
        if(!msg) return;
        const file = msg.querySelector('.File'); if(!file) return;
        file.removeAttribute('data-tgdl-done');
        file.removeAttribute('data-tgdl-id');
        file.removeAttribute('data-tgdl-mid');
        file.classList.remove('_tgdl_downloading_');
        clearBadges(file);
        clearDownloadingBadge(file);
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
        applyLongExt();
    }

    // ── Длинные расширения на превью файла ───────────────────────────────
    // TG вставляет .file-ext только если расширение ≤4 символов (File.tsx),
    // поэтому у .unitypackage/.blend1 иконка пустая. Рисуем свой лейбл,
    // подбирая размер шрифта под ширину иконки (54px). Идемпотентно.
    function extFontSize(len){
        return Math.max(7, Math.min(16, Math.round(50/(0.52*len))));
    }
    function applyLongExt(){
        document.querySelectorAll('#MiddleColumn .File .file-icon').forEach(function(icon){
            const mine = icon.querySelector('._tgdl_ext_');
            if(icon.querySelector('.file-ext:not(._tgdl_ext_)')){ if(mine) mine.remove(); return; }
            const file = icon.closest('.File'); if(!file) return;
            const t = file.querySelector('.file-title');
            const name = t ? (t.getAttribute('title')||t.textContent||'').trim() : '';
            const m = name.match(/\.([^.\s]{5,})$/);
            if(!m){ if(mine) mine.remove(); return; }
            const ext = m[1].toLowerCase();
            if(mine && mine.textContent===ext) return;
            const sp = mine || document.createElement('span');
            sp.className = 'file-ext _tgdl_ext_';
            sp.setAttribute('dir','auto');
            sp.textContent = ext;
            sp.style.setProperty('--tgdl-ext-fs', extFontSize(ext.length)+'px');
            if(!mine) icon.appendChild(sp);
        });
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
    function isUploadFile(file){
        // Upload pending files must not be treated as downloads — their cancel
        // must go to Telegram's MTProto abort, not our download registry.
        try{
            const msg = file.closest && file.closest('.Message');
            if(!msg) return false;
            // Heuristic 1: DOM markers specific to uploading (progress/spinner, no download icon)
            const hasDlIcon = !!file.querySelector('.icon-download, .download-button, [aria-label="Download"], [aria-label="Загрузка"]');
            const hasUploadMarker = !!msg.querySelector('.Message__sending, .message-upload-progress, .File__upload-progress, .progress-ring, .Spinner');
            if(hasUploadMarker && !hasDlIcon) return true;
            const sizeEl = file.querySelector('.file-size, .File__size, .file-subtitle');
            if(sizeEl && /upload|загрузк|отправк/i.test(sizeEl.textContent||'')) return true;
            // Heuristic 2: global state sendingState (most reliable)
            const mid = msg.getAttribute('data-message-id');
            const rt = window.__tgRuntime;
            if(rt && rt.getGlobal && mid){
                const g = rt.getGlobal();
                if(g && g.messages && g.messages.byChatId){
                    for(const cid in g.messages.byChatId){
                        const m = g.messages.byChatId[cid].byId && g.messages.byChatId[cid].byId[mid];
                        if(m && m.sendingState) return true;
                    }
                }
            }
        }catch(e){}
        return false;
    }
    function onFilePointer(e){
        if(e.button!==undefined && e.button!==0) return;   // только ЛКМ
        const file = e.target.closest && e.target.closest('.File');
        if(!file) return;
        if(isUploadFile(file)) return; // let Telegram handle upload cancels natively
        if(file.dataset.tgdlDone==='1'){
            // скачано: TG больше НЕ должен ничего качать по клику на этом файле
            e.preventDefault(); e.stopImmediatePropagation();
            // открываем только по клику на иконку (не по названию — даём его выделять)
            if(e.type==='click' && e.target.closest('.file-icon-container')){
                const id = parseInt(file.dataset.tgdlId,10);
                if(id) INV('open_download_folder',{id}).then(function(r){ if(r&&r.error) resetDownloaded(file); }).catch(function(){});
            }
            return;
        }
        // не скачано: на mousedown запоминаем mid+filename, клик пропускаем к TG
        if(e.type==='mousedown'){
            const msg = file.closest('[data-message-id]'); if(!msg) return;
            const mid = msg.getAttribute('data-message-id');
            const cur = registry[mid];
            if(cur && (cur.status==='pending'||cur.status==='downloading')){
                e.preventDefault(); e.stopImmediatePropagation();
                try{ toast(T('dl_already')); }catch(_){}
                return;
            }
            const t = file.querySelector('.file-title');
            const filename = t ? (t.getAttribute('title')||t.textContent||'').trim() : '';
            if(filename){ expectDownload(mid, filename); _lastStartMark={mid:mid, ts:Date.now()}; }
            return;
        }
        // TG's own X cancels its download before will-download exists — mirror it with a cancelled card.
        if(e.type==='click' && e.target.closest('.file-icon-container')){
            const msg = file.closest('[data-message-id]'); if(!msg) return;
            const mid = msg.getAttribute('data-message-id');
            const r = registry[mid];
            if(!r || r.status!=='pending') return;
            if(_lastStartMark.mid===mid && Date.now()-_lastStartMark.ts<500) return;   // это клик-старт, не отмена
            r.status='cancelled';
            applyToMessage(mid);
            const sid=--_synthCancelId;
            try{
                showDownloadIndicator({type:'start', id:sid, filename:r.filename});
                showDownloadIndicator({type:'done', id:sid, status:'cancelled'});
            }catch(_){}
        }
    }
    let _synthCancelId = 0;
    let _lastStartMark = {mid:null, ts:0};
    ['pointerdown','mousedown','click'].forEach(function(t){ document.addEventListener(t, onFilePointer, true); });

    // ПКМ по .File: (1) запоминаем кандидата для матчинга, если из РОДНОГО меню
    // выберут «Скачать»; (2) если файл уже скачан — запоминаем его id, чтобы добавить
    // в это меню пункт «Открыть папку». Само меню TG не пересобираем — только
    // дорисовываем один родного вида пункт (injectFolderMenuItem).
    let lastCtx = {id:0, ts:0};
    document.addEventListener('contextmenu', function(e){
        lastCtx = {id:0, ts:0};                    // сброс: вдруг ПКМ не по скачанному
        const file = e.target.closest && e.target.closest('.File');
        if(file){
            const msg = file.closest('[data-message-id]'); if(!msg)return;
            const mid = msg.getAttribute('data-message-id');
            const t = file.querySelector('.file-title');
            const filename = t ? (t.getAttribute('title')||t.textContent||'').trim() : '';
            if(filename) (pending[filename] = pending[filename] || []).push(mid);
            if(file.dataset.tgdlDone==='1' && file.dataset.tgdlId){
                lastCtx = {id:parseInt(file.dataset.tgdlId,10), ts:Date.now()};
            }
            return;
        }
        // Медиа (видео/фото) — «Открыть папку» в меню сообщения, если оно скачано.
        const mmsg = e.target.closest && e.target.closest('#MiddleColumn .Message');
        if(mmsg){
            const mc = mmsg.querySelector('.message-content');
            if(mc && /(^| )(media|video)( |$)/.test(mc.className)){
                const dl = midDownload(mmsg.getAttribute('data-message-id'));
                if(dl) lastCtx = {id:dl.id, ts:Date.now()};
            }
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
        it.innerHTML='<i class="icon" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" width="1.4rem" height="1.4rem" fill="currentColor" style="display:block"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg></i>'+T('ctx_open_folder');
        it.addEventListener('click',function(e){
            e.preventDefault(); e.stopPropagation();
            INV('open_download_folder',{id:id}).then(function(r){if(r&&r.error)toast(T('dl_not_found_long'));}).catch(function(){});
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,which:27,bubbles:true}));
        });
        // после пункта «Скачать» (иконка icon-download), иначе в конец
        let after=null;
        [].forEach.call(items.querySelectorAll('.MenuItem'),function(m){ if(m.querySelector('.icon-download')) after=m; });
        if(after) items.insertBefore(it, after.nextSibling);
        else items.appendChild(it);
    }

    // ── Просмотрщик медиа: индикатор «скачано» + «Открыть папку» ──────────
    // У видео/фото нет .File, поэтому статус привязываем к mid сообщения: находим
    // его сопоставлением src открытого медиа со src сообщения в списке. По mid
    // берём завершённую загрузку (registry/savedDl) → рисуем галочку на кнопке
    // «Загрузка» и значок в углу; запоминаем id для «Открыть папку» из ПКМ-меню.
    var _pendingViewerDl = {mid:null, ts:0};
    function viewerMediaMid(){
        var v = document.getElementById('MediaViewer'); if(!v) return null;
        var vid = v.querySelector('#media-viewer-video, video');
        if(vid && vid.src){
            var d = (vid.src.match(/document(\d+)/)||[])[1];
            if(d){
                var vids = document.querySelectorAll('#MiddleColumn .Message video');
                for(var i=0;i<vids.length;i++){ if((vids[i].src||'').indexOf(d)>=0){ var m=vids[i].closest('[data-message-id]'); if(m) return m.getAttribute('data-message-id'); } }
            }
        }
        var img = v.querySelector('.MediaViewerSlide--active img.full-media, .MediaViewerContent img:not(.thumbnail)');
        if(img && img.src){
            var imgs = document.querySelectorAll('#MiddleColumn .Message .media-inner img, #MiddleColumn .Message img.full-media');
            for(var j=0;j<imgs.length;j++){ if(imgs[j].src===img.src){ var mm=imgs[j].closest('[data-message-id]'); if(mm) return mm.getAttribute('data-message-id'); } }
        }
        return null;
    }
    // Завершённая загрузка для mid: id из registry, иначе из savedDl (пережившая рестарт).
    function midDownload(mid){
        if(!mid || forgotten[mid]) return null;
        var r = registry[mid];
        if(r && r.status==='completed' && r.id!=null) return {id:r.id};
        for(var i=0;i<savedDl.length;i++){
            var s=savedDl[i];
            if(s.status==='completed' && String(s.mid)===String(mid) && s.exists!==false) return {id:s.id};
        }
        return null;
    }
    var _tickBtn='<svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4 10-10" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    function viewerDlBtn(){
        var acts=document.querySelector('#MediaViewer .MediaViewerActions'); if(!acts) return null;
        var btns=acts.querySelectorAll('button');
        for(var i=0;i<btns.length;i++){ if(btns[i].querySelector('.icon-download')) return btns[i]; }
        return null;
    }
    var _viewerDlId=null;   // id завершённой загрузки текущего медиа (для «Открыть папку»)
    function refreshViewer(){
        var v=document.getElementById('MediaViewer');
        if(!v){ _viewerDlId=null; return; }
        var mid=viewerMediaMid();
        var dl=mid?midDownload(mid):null;
        _viewerDlId = dl?dl.id:null;
        // Галочка на кнопке «Загрузка».
        var btn=viewerDlBtn();
        if(btn){
            var ok=btn.querySelector('._tgdl_vbtn_ok_');
            if(dl && !ok){ var b=document.createElement('div'); b.className='_tgdl_vbtn_ok_'; b.innerHTML=_tickBtn; btn.appendChild(b); }
            else if(!dl && ok){ ok.remove(); }
        }
        // Значок в углу медиа.
        var content=v.querySelector('.MediaViewerSlide--active .MediaViewerContent') || v.querySelector('.MediaViewerContent');
        if(content){
            if(getComputedStyle(content).position==='static') content.style.position='relative';
            var corner=content.querySelector('._tgdl_vcorner_');
            if(dl && !corner){
                var c=document.createElement('div'); c.className='_tgdl_vcorner_';
                c.title=T('dl_done'); c.innerHTML=_tickBtn;
                content.appendChild(c);
            } else if(!dl && corner){ corner.remove(); }
        }
    }
    setInterval(refreshViewer, 500);
    // Клик по кнопке «Загрузка» в просмотрщике — запоминаем mid, чтобы привязать
    // будущий will-download к сообщению (иначе медиа-загрузка уходит в «несвязанное»).
    document.addEventListener('click', function(e){
        var t=e.target; if(!t||!t.closest) return;
        var btn=viewerDlBtn();
        if(btn && (t===btn || btn.contains(t))){
            var mid=viewerMediaMid();
            if(mid) _pendingViewerDl={mid:mid, ts:Date.now()};
        }
    }, true);
    window.tgBridge.onDownloadEvent(onEvent);
    refreshSaved();   // подтянуть сохранённые загрузки и восстановить статус в чате

    // viewerDownloadId — id завершённой загрузки текущего медиа для «Открыть папку»
    // в ПКМ-меню просмотрщика (core.js строит меню и берёт id отсюда).
    return { registry, byId, fmtBytes, fmtProgress, expectDownload, refreshSaved,
             viewerDownloadId:function(){ return _viewerDlId; } };
})();
} // end if(window.tgBridge) — блок реестра загрузок

// ── Глобальные помощники для модалки/формата ──────────────────────────────
function _fmtBytes_dl(b){ return window.__tgdl ? window.__tgdl.fmtBytes(b) : ''; }
// ──────────────────────────────────────────────────────────────────────────