'use strict';
const { BrowserWindow, screen, ipcMain } = require('electron');

let _getMainWindow = null;
let _win = null;          // persistent stack window, reused
let _ready = false;
let _pending = [];
let _idSeq = 0;

const WIDTH = 384;
const MARGIN = 16;
const MAX_ICON_DATA_URL = 2 * 1024 * 1024;

function clipText(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max);
}

function sanitizePopupIcon(value) {
    const s = String(value || '');
    if (!s || s.length > MAX_ICON_DATA_URL) return '';
    return /^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,/i.test(s) ? s : '';
}

function isPopupSender(event) {
    return !!(_win && !_win.isDestroyed() && event && event.sender === _win.webContents);
}

function init(getMainWindow) {
    _getMainWindow = getMainWindow;

    ipcMain.on('notif-resize', (event, { h } = {}) => {
        if (!isPopupSender(event)) return;
        const wa = primaryWorkArea();
        const height = Math.max(1, Math.min(Math.round(h) || 1, wa.height - MARGIN * 2));
        _win.setBounds({
            x: wa.x + wa.width - WIDTH - MARGIN,
            y: wa.y + wa.height - height - MARGIN,   // anchor to bottom-right corner
            width: WIDTH,
            height,
        });
    });

    ipcMain.on('notif-empty', (event) => {
        if (!isPopupSender(event)) return;
        _win.hide();
    });

    ipcMain.on('notif-action', (event, { action, peerId } = {}) => {
        if (!isPopupSender(event)) return;
        const peer = String(peerId == null ? '' : peerId);
        if (!/^-?\d+$/.test(peer)) return;
        const win = _getMainWindow && _getMainWindow();
        if (!win || win.isDestroyed()) return;
        if (action === 'open') {
            win.show();
            win.focus();
            openChat(win, peer);
        } else if (action === 'read') {
            // Mark as read in the background — don't show or focus the window.
            markRead(win, peer);
        }
    });
}

// Work area of the display the MAIN window is currently on (not always the primary
// monitor) — otherwise dragging the window to a second, smaller display sends notifications off the edge. Falls back to the primary display.
function primaryWorkArea() {
    try {
        const win = _getMainWindow && _getMainWindow();
        if (win && !win.isDestroyed()) {
            const b = win.getBounds();
            const d = screen.getDisplayMatching(b) ||
                      screen.getDisplayNearestPoint({ x: b.x + Math.round(b.width / 2), y: b.y + Math.round(b.height / 2) });
            if (d) return d.workArea || { x: 0, y: 0, width: d.size.width, height: d.size.height };
        }
    } catch (e) {}
    const d = screen.getPrimaryDisplay();
    return d.workArea || { x: 0, y: 0, width: d.size.width, height: d.size.height };
}

// Opens a chat by peerId. Delegated to the renderer: location.hash does nothing in
// the already-loaded Telegram Web A SPA (the router ignores hash changes), so the renderer clicks the chat-list row instead (see window.__tgNotif in UI_JS).
function openChat(win, peerId) {
    const js = 'window.__tgNotif && window.__tgNotif.openChat(' + JSON.stringify(String(peerId)) + ');';
    win.webContents.executeJavaScript(js).catch(() => {});
}

// Marks a chat read via TG's native context menu (right-click row → "Mark as read").
// Window stays hidden, the chat doesn't open, the active chat doesn't change.
function markRead(win, peerId) {
    const js = 'window.__tgNotif && window.__tgNotif.markRead(' + JSON.stringify(String(peerId)) + ');';
    win.webContents.executeJavaScript(js).catch(() => {});
}

function buildHtml() {
    return String.raw`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline';"><style>
    *{box-sizing:border-box;}
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;user-select:none;}
    #stack{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;gap:8px;padding:0 8px;}
    /* Telegram-like desktop card, with a subtle edge so it does not dissolve into
       dark wallpapers. Slightly roomier than the in-page toast for desktop readability. */
    .card{background:rgba(33,33,33,.94);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.14);
        border-radius:16px;padding:17px;min-height:132px;color:#fff;
        box-shadow:0 6px 24px rgba(0,0,0,.28);
        opacity:1;transform:translateY(0);will-change:transform,opacity;}
    .card.hide{opacity:0;transform:translateY(-12px);}
    .top{display:flex;gap:12px;align-items:center;}
    .avatar{width:44px;height:44px;flex:0 0 44px;border-radius:50%;overflow:hidden;background:#8774e1;
        display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:500;color:#fff;}
    .avatar img{width:100%;height:100%;object-fit:cover;}
    .body{flex:1;min-width:0;font-size:15px;line-height:1.25;overflow-wrap:anywhere;}
    .title{font-size:15px;font-weight:500;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .text{margin-top:2px;font-size:15px;line-height:1.25;color:rgba(255,255,255,.82);
        display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
    .close-x{width:32px;height:32px;flex:0 0 32px;border:0;border-radius:50%;background:transparent;color:#aaa;
        font-size:20px;line-height:32px;cursor:pointer;padding:0;align-self:center;}
    .close-x:hover{background:rgba(255,255,255,.08);color:#fff;}
    .actions{display:flex;justify-content:flex-end;gap:4px;margin-top:12px;}
    .btn{flex:0 0 auto;height:38px;border:0;border-radius:10px;padding:0 13px;background:transparent;
        color:#8774e1;font-size:14px;font-weight:600;cursor:pointer;}
    .btn:hover{background:rgba(135,116,225,.14);}
    .btn.read{color:#aaa;}
    .btn.read:hover{background:rgba(255,255,255,.08);color:#fff;}
    .progress{margin-top:8px;height:4px;border-radius:2px;overflow:hidden;background:rgba(255,255,255,.1);}
    .bar{height:100%;background:#8774e1;width:100%;}
    @keyframes barshrink{from{width:100%;}to{width:0%;}}
</style></head>
<body>
<div id="stack"></div>
<script>
    const stack = document.getElementById('stack');
    const cards = new Map();
    const MAX_CARDS=3;
    const GAP=8;
    const MOVE_MS=280;
    const FADE_MS=180;
    const MOVE_EASE='cubic-bezier(.25,1,.5,1)';

    function visibleStackHeight(){
        const all=Array.from(stack.children), shown=all.slice(-MAX_CARDS);
        if(!shown.length)return 1;
        let h=0;
        shown.forEach(function(el){h+=el.getBoundingClientRect().height;});
        h+=GAP*Math.max(0,shown.length-1);
        return Math.ceil(h)+4;
    }
    function reportSize(){
        window.notifBridge.sendResize(visibleStackHeight());
    }
    function firstLetter(s){ s=(s||'T').trim(); return (s[0]||'T').toUpperCase(); }

    function removeCard(id){
        const c=cards.get(id); if(!c)return;
        clearTimeout(c.timer);
        cards.delete(id);
        c.el.style.transition='opacity 180ms ease, transform 200ms '+MOVE_EASE;
        c.el.classList.add('hide');
        setTimeout(function(){
            if(c.el.parentNode)c.el.parentNode.removeChild(c.el);
            reportSize();
            if(cards.size===0)window.notifBridge.sendEmpty();
        },205);
    }

    function arm(id,duration){
        const c=cards.get(id); if(!c)return;
        clearTimeout(c.timer);
        c.timer=setTimeout(function(){removeCard(id);},duration);
    }

    window.notifBridge.onAdd(function(data){
        const id=data.id;
        const dur=(data.duration||6)*1000;
        const el=document.createElement('div'); el.className='card';
        const title=(data.title||'Telegram').trim()||'Telegram';
        const text=(data.body||'').trim()||'Новое сообщение';
        const top=document.createElement('div'); top.className='top';
        const av=document.createElement('div'); av.className='avatar';
        if(data.anon){av.style.background='#6b6b6b';}
        if(data.icon){const im=document.createElement('img');im.src=data.icon;im.onerror=function(){av.textContent=firstLetter(title);};av.appendChild(im);}
        else av.textContent=firstLetter(title);
        const bd=document.createElement('div'); bd.className='body';
        const tt=document.createElement('div'); tt.className='title'; tt.textContent=title;
        const tx=document.createElement('div'); tx.className='text'; tx.textContent=text;
        bd.appendChild(tt); bd.appendChild(tx);
        const cx=document.createElement('button'); cx.className='close-x'; cx.textContent='✕';
        cx.onclick=function(){removeCard(id);};
        top.appendChild(av); top.appendChild(bd); top.appendChild(cx);

        const acts=document.createElement('div'); acts.className='actions';
        const reply=document.createElement('button'); reply.className='btn reply'; reply.textContent=data.btnOpen||'Открыть';
        reply.onclick=function(){window.notifBridge.sendAction('open', data.peerId);removeCard(id);};
        const read=document.createElement('button'); read.className='btn read'; read.textContent=data.btnRead||'Прочитано';
        read.onclick=function(){window.notifBridge.sendAction('read', data.peerId);removeCard(id);};
        acts.appendChild(reply); acts.appendChild(read);

        const prog=document.createElement('div'); prog.className='progress';
        const bar=document.createElement('div'); bar.className='bar'; prog.appendChild(bar);

        el.appendChild(top); el.appendChild(acts); el.appendChild(prog);

        // FLIP the existing stack. New notifications are appended at the BOTTOM.
        // The BrowserWindow is bottom-anchored, so after it grows upward every old card
        // would otherwise jump. The inverse translate holds each card at its old screen
        // position; releasing that translate makes the new card physically push it up.
        const oldEls=Array.from(stack.children);
        const oldRects=new Map();
        oldEls.forEach(function(node){oldRects.set(node,node.getBoundingClientRect());});
        stack.appendChild(el);

        const afterRects=new Map();
        oldEls.forEach(function(node){afterRects.set(node,node.getBoundingClientRect());});
        oldEls.forEach(function(node){
            const before=oldRects.get(node),after=afterRects.get(node);
            const dy=before.top-after.top;
            node.style.transition='none';
            node.style.transform='translateY('+dy+'px)';
        });

        // Start completely below the bottom edge. body/window clipping makes it look as
        // if the card rises from under the desktop corner, while opacity comes up with it.
        const enterOffset=Math.ceil(el.getBoundingClientRect().height)+GAP;
        el.style.transition='none';
        el.style.opacity='0';
        el.style.transform='translateY('+enterOffset+'px)';

        cards.set(id,{el:el,timer:null});

        // Keep the fourth card in the DOM only for the exit animation. Because the stack
        // is bottom-anchored and the window height is capped to the last three cards, the
        // oldest card's final layout position is already above the clipping edge.
        let evicted=null,evictedId=null;
        if(stack.children.length>MAX_CARDS){
            evicted=stack.firstElementChild;
            cards.forEach(function(v,k){if(v.el===evicted)evictedId=k;});
            if(evictedId!=null){
                const ec=cards.get(evictedId);if(ec)clearTimeout(ec.timer);
                cards.delete(evictedId);
            }
        }

        // Flush the inverse transforms before asking Electron to resize the transparent
        // BrowserWindow. Start on its resize event; at the three-card cap there is no
        // resize, so a short fallback starts the same animation.
        void stack.offsetHeight;
        let started=false;
        const start=function(){
            if(started||!el.isConnected)return;
            started=true;window.removeEventListener('resize',onResize);
            requestAnimationFrame(function(){
                if(!el.isConnected)return;
                oldEls.forEach(function(node){
                    if(!node.isConnected)return;
                    node.style.transition='transform '+MOVE_MS+'ms '+MOVE_EASE+(node===evicted?', opacity '+FADE_MS+'ms ease-out':'');
                    node.style.transform='translateY(0)';
                    if(node===evicted)node.style.opacity='0';
                });
                el.style.transition='transform '+MOVE_MS+'ms '+MOVE_EASE+', opacity '+FADE_MS+'ms ease-out';
                el.style.transform='translateY(0)';
                el.style.opacity='1';
                bar.style.animation='barshrink '+dur+'ms linear forwards';
                arm(id,dur);
            });
            setTimeout(function(){
                oldEls.forEach(function(node){
                    if(node===evicted||!node.isConnected)return;
                    node.style.transition='';node.style.transform='';node.style.opacity='';
                });
                if(el.isConnected){el.style.transition='';el.style.transform='';el.style.opacity='';}
                if(evicted&&evicted.parentNode)evicted.parentNode.removeChild(evicted);
                reportSize();
            },MOVE_MS+30);
        };
        const onResize=function(){start();};
        window.addEventListener('resize',onResize);
        reportSize();
        setTimeout(start,70);

        el.onmouseenter=function(){const c=cards.get(id);if(c)clearTimeout(c.timer);bar.style.animationPlayState='paused';};
        el.onmouseleave=function(){
            bar.style.animation='none'; void bar.offsetWidth;          // restart animation
            bar.style.animation='barshrink '+dur+'ms linear forwards';
            arm(id,dur);
        };
    });
</script>
</body></html>`;
}

function ensureWin() {
    if (_win && !_win.isDestroyed()) return _win;
    const wa = primaryWorkArea();
    const win = _win = new BrowserWindow({
        width: WIDTH,
        height: 120,
        x: wa.x + wa.width - WIDTH - MARGIN,
        y: wa.y + wa.height - 120 - MARGIN,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        show: false,
        hasShadow: false,
        backgroundThrottling: false,
        roundedCorners: true,
        type: 'notification',
        webPreferences: {
            preload: require('path').join(__dirname, 'notification-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
            sandbox: true,
        },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) {}

    _ready = false;
    win.webContents.once('did-finish-load', () => {
        if (_win !== win || win.isDestroyed()) return;
        _ready = true;
        flush();
    });
    const html = buildHtml();
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
    win.on('closed', () => {
        // An old popup can finish closing after a replacement was already created.
        // Never let the stale window clear the handle/ready state of the new one.
        if (_win === win) { _win = null; _ready = false; }
    });
    // Renderer crash/hang leaves the BrowserWindow alive but blank. Destroy exactly
    // the failed instance; the next queueNotification will build a fresh one.
    const drop = () => {
        try { if (!win.isDestroyed()) win.destroy(); } catch (e) {}
        if (_win === win) { _win = null; _ready = false; }
    };
    win.webContents.on('render-process-gone', drop);
    win.webContents.on('unresponsive', drop);
    return win;
}

function flush() {
    if (!_win || _win.isDestroyed() || !_ready) return;
    const items = _pending;
    _pending = [];
    if (!items.length) return;
    items.forEach(it => _win.webContents.send('notif-add', it));
    if (process.env.TWD_SMOKE_HIDDEN !== '1') _win.showInactive();
}

function queueNotification(data) {
    const rawDuration = Number(data && data.duration);
    const peer = String((data && data.peerId) || '');
    const payload = {
        id: ++_idSeq,
        title: clipText(data && data.title, 256) || 'Telegram',
        body: clipText(data && data.body, 4096) || 'Новое сообщение',
        icon: sanitizePopupIcon(data && data.icon),
        anon: !!(data && data.anon),
        btnOpen: clipText(data && data.btnOpen, 64),
        btnRead: clipText(data && data.btnRead, 64),
        peerId: /^-?\d+$/.test(peer) ? peer : '',
        playSound: data && data.playSound !== false,
        duration: Number.isFinite(rawDuration) ? Math.max(2, Math.min(30, rawDuration)) : 6,
    };
    ensureWin();
    _pending.push(payload);
    if (_ready) flush();
}

module.exports = { init, queueNotification };
