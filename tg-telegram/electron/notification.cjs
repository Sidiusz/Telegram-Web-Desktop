'use strict';
const { BrowserWindow, screen, ipcMain } = require('electron');

let _getMainWindow = null;
let _win = null;          // persistent stack window, reused
let _ready = false;
let _pending = [];
let _idSeq = 0;

const WIDTH = 384;
const MARGIN = 16;
const CARD_HEIGHT = 156;
const CARD_GAP = 8;
const MAX_CARDS = 3;
const MAX_PENDING = 32;
const STACK_HEIGHT = CARD_HEIGHT * MAX_CARDS + CARD_GAP * (MAX_CARDS - 1);
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

    ipcMain.on('notif-shape', (event, { count } = {}) => {
        if (!isPopupSender(event)) return;
        const n = Math.max(0, Math.min(MAX_CARDS, Math.trunc(Number(count) || 0)));
        try {
            if (!n) {
                _win.setShape([]);
                return;
            }
            const height = CARD_HEIGHT * n + CARD_GAP * (n - 1);
            _win.setShape([{ x: 0, y: STACK_HEIGHT - height, width: WIDTH, height }]);
        } catch (_) {}
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
    #stack{position:absolute;inset:0;overflow:hidden;}
    /* Fixed-slot stack: no flex reflow and no BrowserWindow resize while cards exist. */
    .card{position:absolute;left:8px;right:8px;height:156px;
        background:rgba(33,33,33,.94);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.14);
        border-radius:16px;padding:17px;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.28);
        opacity:1;transform:translate3d(0,0,0);will-change:transform,opacity;}
    .top{display:flex;height:58px;gap:12px;align-items:center;}
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
    .bar{height:100%;background:#8774e1;width:100%;transform:scaleX(1);transform-origin:left center;will-change:transform;}
    @keyframes barshrink{from{transform:scaleX(1);}to{transform:scaleX(0);}}
</style></head>
<body>
<div id="stack"></div>
<script>
    const stack=document.getElementById('stack');
    const cards=new Map();
    const order=[];
    const MAX_CARDS=3;
    const CARD_H=156;
    const GAP=8;
    const STACK_H=484;
    const MOVE_MS=280;
    const FADE_MS=180;
    const MOVE_EASE='cubic-bezier(.25,1,.5,1)';
    let opChain=Promise.resolve();

    function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
    function enqueue(op){opChain=opChain.then(op).catch(function(){});return opChain;}
    function yFor(index,total){
        const fromBottom=total-1-index;
        return STACK_H-CARD_H-fromBottom*(CARD_H+GAP);
    }
    function setPose(c,y,opacity){
        c.y=y;
        c.el.style.transform='translate3d(0,'+y+'px,0)';
        c.el.style.opacity=String(opacity);
    }
    function animatePose(c,toY,toOpacity,duration){
        const fromY=Number.isFinite(c.y)?c.y:toY;
        const fromOpacity=parseFloat(c.el.style.opacity||getComputedStyle(c.el).opacity||'1');
        const a=c.el.animate([
            {transform:'translate3d(0,'+fromY+'px,0)',opacity:String(fromOpacity)},
            {transform:'translate3d(0,'+toY+'px,0)',opacity:String(toOpacity)}
        ],{duration:duration,easing:MOVE_EASE,fill:'forwards'});
        return a.finished.catch(function(){}).then(function(){
            a.cancel();
            if(c.el.isConnected)setPose(c,toY,toOpacity);
        });
    }
    function firstGlyph(s){const chars=Array.from(String(s||'').trim());return(chars[0]||'T').toUpperCase();}
    function firstLetter(s){return firstGlyph(s||'T');}
    function initials(s){
        const words=String(s||'').trim().split(/\s+/).filter(Boolean);
        if(!words.length)return'T';
        const first=firstGlyph(words[0]);
        if(words.length===1)return first||'T';
        const last=firstGlyph(words[words.length-1]);
        return(first+last)||'T';
    }
    function avatarColor(peerId,title){
        const key=String(peerId||title||'Telegram');
        const palette=['#e17076','#faa774','#a695e7','#7bc862','#65aadd','#6ec9cb','#ee7aae'];
        let hash=0;
        for(let i=0;i<key.length;i++)hash=((hash*31)+key.charCodeAt(i))|0;
        return palette[Math.abs(hash)%palette.length];
    }

    function arm(id,duration){
        const c=cards.get(id);if(!c)return;
        clearTimeout(c.timer);
        c.remaining=Math.max(0,Number(duration)||0);
        c.startedAt=Date.now();
        c.timer=setTimeout(function(){enqueue(function(){return removeCardNow(id);});},c.remaining);
    }
    function pauseCard(id){
        const c=cards.get(id);if(!c)return;
        if(c.timer){
            c.remaining=Math.max(0,c.remaining-(Date.now()-c.startedAt));
            clearTimeout(c.timer);c.timer=null;
        }
        c.bar.style.animationPlayState='paused';
    }
    function resumeCard(id){
        const c=cards.get(id);if(!c||c.timer)return;
        c.bar.style.animationPlayState='running';
        c.startedAt=Date.now();
        c.timer=setTimeout(function(){enqueue(function(){return removeCardNow(id);});},Math.max(0,c.remaining));
    }

    function buildCard(data){
        const id=data.id,dur=(data.duration||6)*1000;
        const el=document.createElement('div');el.className='card';
        const title=(data.title||'Telegram').trim()||'Telegram';
        const text=(data.body||'').trim()||'Новое сообщение';

        const top=document.createElement('div');top.className='top';
        const av=document.createElement('div');av.className='avatar';
        av.style.background=avatarColor(data.peerId,title);
        const avatarText=data.anon?firstLetter(title):initials(title);
        if(data.icon){
            const im=document.createElement('img');im.src=data.icon;
            im.onerror=function(){av.textContent=avatarText;};
            av.appendChild(im);
        }else av.textContent=avatarText;

        const bd=document.createElement('div');bd.className='body';
        const tt=document.createElement('div');tt.className='title';tt.textContent=title;
        const tx=document.createElement('div');tx.className='text';tx.textContent=text;
        bd.appendChild(tt);bd.appendChild(tx);

        const cx=document.createElement('button');cx.className='close-x';cx.textContent='✕';
        cx.onclick=function(){enqueue(function(){return removeCardNow(id);});};
        top.appendChild(av);top.appendChild(bd);top.appendChild(cx);

        const acts=document.createElement('div');acts.className='actions';
        const reply=document.createElement('button');reply.className='btn reply';reply.textContent=data.btnOpen||'Открыть';
        reply.onclick=function(){window.notifBridge.sendAction('open',data.peerId);enqueue(function(){return removeCardNow(id);});};
        const read=document.createElement('button');read.className='btn read';read.textContent=data.btnRead||'Прочитано';
        read.onclick=function(){window.notifBridge.sendAction('read',data.peerId);enqueue(function(){return removeCardNow(id);});};
        acts.appendChild(reply);acts.appendChild(read);

        const prog=document.createElement('div');prog.className='progress';
        const bar=document.createElement('div');bar.className='bar';prog.appendChild(bar);
        el.appendChild(top);el.appendChild(acts);el.appendChild(prog);

        const c={id:id,el:el,bar:bar,dur:dur,timer:null,remaining:dur,startedAt:0,y:STACK_H+GAP};
        el.onmouseenter=function(){pauseCard(id);};
        el.onmouseleave=function(){resumeCard(id);};
        return c;
    }

    async function addCard(data){
        const c=buildCard(data);
        stack.appendChild(c.el);
        cards.set(c.id,c);
        order.push(c.id);
        setPose(c,STACK_H+GAP,0);
        window.notifBridge.sendShape(Math.min(order.length,MAX_CARDS));

        let evictedId=null;
        if(order.length>MAX_CARDS)evictedId=order.shift();
        const visible=order.slice();
        const moves=[];

        visible.forEach(function(id,index){
            const item=cards.get(id);if(!item)return;
            moves.push(animatePose(item,yFor(index,visible.length),1,MOVE_MS));
        });

        if(evictedId!=null){
            const evicted=cards.get(evictedId);
            if(evicted){
                clearTimeout(evicted.timer);evicted.timer=null;
                moves.push(animatePose(evicted,-CARD_H-GAP,0,MOVE_MS));
            }
        }

        c.bar.style.animation='barshrink '+c.dur+'ms linear forwards';
        arm(c.id,c.dur);
        await Promise.all(moves);

        if(evictedId!=null){
            const evicted=cards.get(evictedId);
            if(evicted){
                if(evicted.el.parentNode)evicted.el.parentNode.removeChild(evicted.el);
                cards.delete(evictedId);
            }
        }
    }

    async function removeCardNow(id){
        const c=cards.get(id);if(!c)return;
        clearTimeout(c.timer);c.timer=null;
        const pos=order.indexOf(id);
        if(pos!==-1)order.splice(pos,1);

        // Fade the disappearing card in place first. Moving it against the survivor that
        // fills its slot creates a visible cross-over, which reads as a back-and-forth jerk.
        await animatePose(c,c.y,0,FADE_MS);
        if(c.el.parentNode)c.el.parentNode.removeChild(c.el);
        cards.delete(id);

        const survivors=order.slice();
        const moves=[];
        survivors.forEach(function(sid,index){
            const item=cards.get(sid);if(!item)return;
            moves.push(animatePose(item,yFor(index,survivors.length),1,MOVE_MS));
        });
        await Promise.all(moves);

        window.notifBridge.sendShape(order.length);
        if(cards.size===0)window.notifBridge.sendEmpty();
    }

    window.notifBridge.onAdd(function(data){
        enqueue(function(){return addCard(data);});
    });
</script>
</body></html>`;
}

function positionWin(win) {
    if (!win || win.isDestroyed()) return;
    const wa = primaryWorkArea();
    try { win.setPosition(wa.x + wa.width - WIDTH - MARGIN, wa.y + wa.height - STACK_HEIGHT - MARGIN, false); } catch (_) {}
}
function ensureWin() {
    if (_win && !_win.isDestroyed()) { positionWin(_win); return _win; }
    const wa = primaryWorkArea();
    const win = _win = new BrowserWindow({
        width: WIDTH,
        height: STACK_HEIGHT,
        x: wa.x + wa.width - WIDTH - MARGIN,
        y: wa.y + wa.height - STACK_HEIGHT - MARGIN,
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
    try { win.setShape([]); } catch (_) {}

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
    if (_pending.length > MAX_PENDING) _pending.splice(0, _pending.length - MAX_PENDING);
    if (_ready) flush();
}

module.exports = { init, queueNotification };
