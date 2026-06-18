'use strict';
const { BrowserWindow, screen, ipcMain } = require('electron');

let _getMainWindow = null;
let _win = null;          // постоянное окно-стек, переиспользуется
let _ready = false;
let _pending = [];
let _idSeq = 0;

const WIDTH = 380;
const MARGIN = 16;

function init(getMainWindow) {
    _getMainWindow = getMainWindow;

    ipcMain.on('notif-resize', (_e, { h }) => {
        if (!_win || _win.isDestroyed()) return;
        const wa = primaryWorkArea();
        const height = Math.max(1, Math.min(Math.round(h) || 1, wa.height - MARGIN * 2));
        _win.setBounds({
            x: wa.x + wa.width - WIDTH - MARGIN,
            y: wa.y + wa.height - height - MARGIN,   // привязка к нижнему-правому углу
            width: WIDTH,
            height,
        });
    });

    ipcMain.on('notif-empty', () => {
        if (_win && !_win.isDestroyed()) _win.hide();
    });

    ipcMain.on('notif-action', (_e, { action, peerId }) => {
        const win = _getMainWindow && _getMainWindow();
        if (!win || win.isDestroyed() || !peerId) return;
        if (action === 'open') {
            win.show();
            win.focus();
            openChat(win, String(peerId));
        } else if (action === 'read') {
            // Помечаем прочитанным в фоне — окно не показываем/не фокусируем.
            markRead(win, String(peerId));
        }
    });
}

function primaryWorkArea() {
    const d = screen.getPrimaryDisplay();
    return d.workArea || { x: 0, y: 0, width: d.size.width, height: d.size.height };
}

// Открывает чат по peerId. Делегируем в рендерер: location.hash в уже
// загруженной SPA Telegram Web A НЕ работает (роутер игнорирует изменение hash),
// поэтому рендерер кликает по строке чат-листа (см. window.__tgNotif в UI_JS).
function openChat(win, peerId) {
    const js = 'window.__tgNotif && window.__tgNotif.openChat(' + JSON.stringify(String(peerId)) + ');';
    win.webContents.executeJavaScript(js).catch(() => {});
}

// Помечает чат прочитанным через нативное меню TG (ПКМ по строке → «Отметить как
// прочитанное»). Окно не показываем, чат не открывается, текущий чат не меняется.
function markRead(win, peerId) {
    const js = 'window.__tgNotif && window.__tgNotif.markRead(' + JSON.stringify(String(peerId)) + ');';
    win.webContents.executeJavaScript(js).catch(() => {});
}

function buildHtml() {
    return String.raw`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box;}
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;user-select:none;}
    #stack{display:flex;flex-direction:column;gap:8px;padding:0;}
    .card{background:rgba(30,39,51,.98);border-radius:14px;padding:12px 14px;color:#fff;
        box-shadow:0 10px 32px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.06);
        opacity:0;transform:translateY(-10px);transition:opacity .2s ease,transform .2s ease;}
    .card.show{opacity:1;transform:translateY(0);}
    .card.hide{opacity:0;transform:translateY(-8px);}
    .top{display:flex;gap:12px;align-items:center;}
    .avatar{width:40px;height:40px;flex:0 0 40px;border-radius:50%;overflow:hidden;background:#2b5278;
        display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;color:#fff;}
    .avatar img{width:100%;height:100%;object-fit:cover;}
    .body{flex:1;min-width:0;}
    .title{font-size:13px;font-weight:700;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .text{margin-top:2px;font-size:12px;line-height:1.35;color:#c2c9d1;
        display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
    .close-x{background:none;border:none;color:#7e8794;font-size:16px;line-height:1;cursor:pointer;padding:0 0 0 6px;align-self:flex-start;}
    .close-x:hover{color:#fff;}
    .actions{display:flex;gap:8px;margin-top:10px;}
    .btn{flex:1;border:none;border-radius:8px;padding:7px 0;font-size:12px;font-weight:600;cursor:pointer;}
    .btn.reply{background:#5288c1;color:#fff;}
    .btn.reply:hover{filter:brightness(1.1);}
    .btn.read{background:rgba(255,255,255,.08);color:#c2c9d1;}
    .btn.read:hover{background:rgba(255,255,255,.14);color:#fff;}
    .progress{margin-top:10px;height:2px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.08);}
    .bar{height:100%;background:#5288c1;width:100%;}
    @keyframes barshrink{from{width:100%;}to{width:0%;}}
</style></head>
<body>
<div id="stack"></div>
<script>
    const { ipcRenderer } = require('electron');
    const stack = document.getElementById('stack');
    const cards = new Map();

    function reportSize(){
        requestAnimationFrame(function(){
            const h = stack.scrollHeight;
            ipcRenderer.send('notif-resize', { h: h + 4 });
        });
    }
    function firstLetter(s){ s=(s||'T').trim(); return (s[0]||'T').toUpperCase(); }

    function removeCard(id){
        const c=cards.get(id); if(!c)return;
        clearTimeout(c.timer);
        c.el.classList.remove('show'); c.el.classList.add('hide');
        cards.delete(id);
        setTimeout(function(){
            if(c.el.parentNode)c.el.parentNode.removeChild(c.el);
            reportSize();
            if(cards.size===0)ipcRenderer.send('notif-empty');
        },200);
    }

    function arm(id,duration){
        const c=cards.get(id); if(!c)return;
        clearTimeout(c.timer);
        c.timer=setTimeout(function(){removeCard(id);},duration);
    }

    const MAX_CARDS=3;
    function dropOldest(){
        const first=stack.firstChild; if(!first)return;
        let oid=null; cards.forEach(function(v,k){ if(v.el===first)oid=k; });
        if(oid!=null){ const c=cards.get(oid); if(c)clearTimeout(c.timer); cards.delete(oid); }
        if(first.parentNode)first.parentNode.removeChild(first);
    }

    ipcRenderer.on('notif-add', function(_e, data){
        const id=data.id;
        const dur=(data.duration||6)*1000;
        const el=document.createElement('div'); el.className='card';
        const title=(data.title||'Telegram').trim()||'Telegram';
        const text=(data.body||'').trim()||'Новое сообщение';
        // Группы/каналы (peerId < 0) — отвечать нельзя списком, кнопка «Открыть».
        const canReply = data.peerId && String(data.peerId).charAt(0)!=='-';

        const top=document.createElement('div'); top.className='top';
        const av=document.createElement('div'); av.className='avatar';
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
        const reply=document.createElement('button'); reply.className='btn reply'; reply.textContent=canReply?'Ответить':'Открыть';
        reply.onclick=function(){ipcRenderer.send('notif-action',{action:'open',peerId:data.peerId});removeCard(id);};
        const read=document.createElement('button'); read.className='btn read'; read.textContent='Прочитано';
        read.onclick=function(){ipcRenderer.send('notif-action',{action:'read',peerId:data.peerId});removeCard(id);};
        acts.appendChild(reply); acts.appendChild(read);

        const prog=document.createElement('div'); prog.className='progress';
        const bar=document.createElement('div'); bar.className='bar'; prog.appendChild(bar);

        el.appendChild(top); el.appendChild(acts); el.appendChild(prog);
        stack.appendChild(el); // новые снизу, у самого угла

        cards.set(id,{el:el,timer:null});
        while(cards.size>MAX_CARDS)dropOldest();   // лимит пула — старое уходит
        requestAnimationFrame(function(){
            el.classList.add('show'); reportSize();
            bar.style.animation='barshrink '+dur+'ms linear forwards';
        });
        arm(id,dur);

        el.onmouseenter=function(){const c=cards.get(id);if(c)clearTimeout(c.timer);bar.style.animationPlayState='paused';};
        el.onmouseleave=function(){
            bar.style.animation='none'; void bar.offsetWidth;          // рестарт анимации
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
    _win = new BrowserWindow({
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
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false,
            sandbox: false,
        },
    });
    _win.setAlwaysOnTop(true, 'screen-saver');
    try { _win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) {}

    _ready = false;
    _win.webContents.once('did-finish-load', () => { _ready = true; flush(); });
    const html = buildHtml();
    _win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
    _win.on('closed', () => { _win = null; _ready = false; });
    return _win;
}

function flush() {
    if (!_win || _win.isDestroyed() || !_ready) return;
    const items = _pending;
    _pending = [];
    if (!items.length) return;
    items.forEach(it => _win.webContents.send('notif-add', it));
    _win.showInactive();
}

function queueNotification(data) {
    const payload = {
        id: ++_idSeq,
        title: String((data && data.title) || '').trim() || 'Telegram',
        body: String((data && data.body) || '').trim() || 'Новое сообщение',
        icon: String((data && data.icon) || ''),
        peerId: (data && data.peerId) || '',
        playSound: data && data.playSound !== false,
        duration: (data && data.duration) || 6,
    };
    ensureWin();
    _pending.push(payload);
    if (_ready) flush();
}

module.exports = { init, queueNotification };
