'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { WebSocket } = require('ws');

const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

function jsonGet(port, route) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: route }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.once('error', reject);
    req.setTimeout(1500, () => req.destroy(new Error('HTTP timeout')));
  });
}

async function waitFor(fn, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) { last = e; }
    await sleep(250);
  }
  throw new Error(`${label} timed out${last ? ': ' + last.message : ''}`);
}

class Cdp {
  constructor(url) { this.url = url; this.ws = null; this.seq = 0; this.pending = new Map(); }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', data => {
      const msg = JSON.parse(String(data));
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    });
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
    return result.result && result.result.value;
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function telegramTarget(port) {
  const list = await jsonGet(port, '/json/list');
  return list.find(x => x.type === 'page' && /^https:\/\/web\.telegram\.org\/a(?:\/|\?|$)/.test(x.url));
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'twd-smoke-'));
  const smokeDownloads = path.join(profile, 'downloads');
  fs.mkdirSync(smokeDownloads, { recursive: true });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    proxy_mode: 'always', popup_notifications: true, notif_sound: false,
    minimize_to_tray: true, proxy_web_fallback: true, save_path: smokeDownloads,
    // TWD_SMOKE_FALLBACK=1 exercises the pinned Web A build used after a direct-load failure.
    proxy_web_fallback_latched: process.env.TWD_SMOKE_FALLBACK === '1',
  }));
  const port = await freePort();
  const electron = require('electron');
  let log = '';
  // TWD_SMOKE_EXE runs the same checks against a packaged build (dist/win-unpacked).
  const packagedExe = process.env.TWD_SMOKE_EXE || '';
  const child = spawn(packagedExe || electron, packagedExe ? [] : ['.'], {
    cwd: root,
    env: {
      ...process.env,
      TWD_DEV_PROFILE: profile,
      TWD_ALLOW_MULTI_INSTANCE: '1',
      TWD_SMOKE_HIDDEN: '1',
      TWD_CDP_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let events = '';
  const collect = chunk => {
    const text = String(chunk);
    log = (log + text).slice(-30000);
    for (const line of text.split(/\r?\n/)) {
      if (/\[(?:TWD-NOTIF|TWD-MEMORY|TG-PROXY-BRIDGE)\]/.test(line)) events = (events + line + '\n').slice(-200000);
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  let cdp;
  try {
    const target = await waitFor(() => telegramTarget(port), 45000, 'Telegram page');
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.call('Runtime.enable');
    await waitFor(() => cdp.eval('location.href.startsWith("https://web.telegram.org/a")'), 20000, 'Telegram navigation commit');
    const ready = await waitFor(() => cdp.eval('document.readyState === "complete" || document.readyState === "interactive"'), 15000, 'document ready');
    assert.equal(ready, true);
    assert.match(await cdp.eval('location.href'), /^https:\/\/web\.telegram\.org\/a/);

    const proxy = await waitFor(
      () => cdp.eval('window.tgBridge && window.tgBridge.invoke("get_proxy_status")'),
      15000,
      'proxy status'
    );
    assert.equal(proxy.active, true);
    const proxyGlobals = await cdp.eval('({state:typeof window.__twdProxyState,router:typeof window.__twdProxyRouter,channel:typeof window.__twdProxyChannel})');
    assert.deepEqual(proxyGlobals, { state: 'undefined', router: 'undefined', channel: 'undefined' });

    await waitFor(() => /\[TWD-NOTIF\] Telegram notification hooks installed/.test(events), 30000, 'Telegram notification bundle patch');
    await waitFor(() => /\[TWD-MEMORY\] Telegram media cache LRU installed/.test(events), 30000, 'Telegram media cache bundle patch');
    await waitFor(() => /\[TG-PROXY-BRIDGE\] \S+ control route returned MTProto data/.test(events), 45000, 'MTProto through embedded proxy bridge');
    const bundleHooks = await waitFor(
      () => cdp.eval('typeof window.__twdMediaCacheStats==="function"&&typeof window.__twdConsumeSwNotification==="function"'),
      20000,
      'patched Telegram modules in page'
    );
    assert.equal(bundleHooks, true);

    const blocked = await cdp.eval('window.tgBridge.invoke("__smoke_unknown__").then(()=>"allowed",e=>"blocked:"+e.message)');
    assert.match(blocked, /^blocked:/);

    const addons = await cdp.eval('window.tgBridge.invoke("get_addons").then(x=>x.map(a=>a.key))');
    assert.ok(Array.isArray(addons));
    assert.equal(addons.some(k => /^embedded:desktop_like_/i.test(String(k))), false, 'built-in layouts must not appear as user add-ons');
    const standardLayout = await waitFor(
      () => cdp.eval('!!document.getElementById("twd-feature-desktop-standard")'),
      10000,
      'default built-in desktop layout'
    );
    assert.equal(standardLayout, true);

    // Real Web A stylesheets + a synthetic chat: the forward bar must not squeeze the input,
    // and inline media load/cancel must not open a save-to-disk card.
    await cdp.eval(`(async()=>{
      const html=await (await fetch('/a/')).text();
      const found=new Set([...html.matchAll(/assets\\/([\\w.-]+\\.css)/g)].map(m=>m[1]));
      for(const m of html.matchAll(/assets\\/([\\w.-]+\\.js)/g)){
        try{for(const c of (await (await fetch('/a/assets/'+m[1])).text()).matchAll(/(?:useConnectionStatus|main)-[\\w-]+\\.css/g))found.add(c[0]);}catch(_){}
      }
      for(const f of found){const l=document.createElement('link');l.rel='stylesheet';l.href='/a/assets/'+f;document.head.appendChild(l);await new Promise(r=>{l.onload=l.onerror=r;});}
      const host=document.createElement('div');host.id='twd-smoke-chat';
      host.style.cssText='position:fixed;left:0;top:0;width:1200px;height:700px;z-index:2147483600;';
      host.innerHTML='<div id="MiddleColumn" style="position:relative;width:1200px;height:700px">'
        +'<div class="Message" data-message-id="11"><div class="media-inner interactive" id="smoke-m11"><i class="icon icon-download"></i>'
        +'<div class="media-loading"><div class="ProgressSpinner"><i class="icon icon-close"></i></div></div></div></div>'
        +'<div class="middle-column-footer"><div class="Composer is-chat-composer shown mounted" id="smoke-composer">'
        +'<div class="ComposerEmbeddedMessage open"><div class="ComposerEmbeddedMessage_inner"><div class="EmbeddedMessage"><div class="message-text">'
        +'<p class="embedded-text-wrapper">Forwarded channel post preview text</p></div></div></div></div>'
        +'<div class="composer-wrapper"><div class="message-input-wrapper">'
        +'<button class="Button composer-action-button round" style="width:3rem;height:3rem;flex-shrink:0"></button>'
        +'<div id="message-input-text" style="flex-grow:1;min-width:0"><div class="form-control" contenteditable="true">Message</div></div>'
        +'<button class="Button composer-action-button round" style="width:3rem;height:3rem;flex-shrink:0"></button></div></div>'
        +'<button class="Button main-button"></button></div></div></div>';
      document.body.appendChild(host);
    })()`);
    const composerLayout = await cdp.eval(`(()=>{
      const c=document.getElementById('smoke-composer'),w=c.querySelector('.composer-wrapper');
      const withBar=w.getBoundingClientRect().width;
      c.querySelector('.ComposerEmbeddedMessage').remove();
      const plain=w.getBoundingClientRect().width;
      return {withBar:Math.round(withBar),plain:Math.round(plain),composer:Math.round(c.getBoundingClientRect().width)};
    })()`);
    assert.ok(composerLayout.plain > composerLayout.composer * 0.8, `plain composer input is full width: ${JSON.stringify(composerLayout)}`);
    assert.equal(composerLayout.withBar, composerLayout.plain, 'forward/reply bar must not shrink the input');
    const inlineCards = await cdp.eval(`(async()=>{
      const count=()=>document.querySelectorAll('#_cnw_ .dl_card').length,before=count();
      for(const sel of ['#smoke-m11 .icon-download','#smoke-m11 .icon-close'])
        document.querySelector(sel).dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0}));
      await new Promise(r=>setTimeout(r,150));
      const after=count();
      document.getElementById('twd-smoke-chat').remove();
      return after-before;
    })()`);
    assert.equal(inlineCards, 0, 'inline media load/cancel only fills the media cache');

    const historyRuntime = await waitFor(
      () => cdp.eval('!!window.__twdMessageHistoryApi'),
      10000,
      'message history runtime'
    );
    assert.equal(historyRuntime, true, 'history runtime must exist even when all history options start disabled');
    const historyDefaults = await cdp.eval('window.tgBridge.invoke("get_settings").then(s=>({savePublic:s.messages_save_public,scope:s.messages_history_scope}))');
    assert.deepEqual(historyDefaults, { savePublic: false, scope: 'client' });
    const historyToggle = await cdp.eval(`(()=>{
      const api=window.__twdMessageHistoryApi;
      const on=api.configure({showDeleted:true,savePublic:false});
      const liveOn=window.__twdMessageHistoryConfig&&window.__twdMessageHistoryConfig.showDeleted===true;
      window.dispatchEvent(new CustomEvent('__twd_history_update',{detail:{kind:'new',chatId:'-987654321',messageId:'1',text:'blocked public',timestamp:Date.now()}}));
      const publicBlocked=api.get('-987654321','1')===null;
      const publicOn=api.configure({savePublic:true});
      window.dispatchEvent(new CustomEvent('__twd_history_update',{detail:{kind:'new',chatId:'-987654321',messageId:'2',text:'allowed public',timestamp:Date.now()}}));
      const publicAllowed=!!api.get('-987654321','2');
      window.dispatchEvent(new CustomEvent('__twd_history_update',{detail:{kind:'delete',items:[{chatId:'123456789',messageId:'7.125',text:'cancelled local upload',outgoing:true,timestamp:Date.now()}],timestamp:Date.now()}}));
      const localIgnored=api.get('123456789','7.125')===null;
      const off=api.configure({showDeleted:false,savePublic:false});
      const liveOff=window.__twdMessageHistoryConfig&&window.__twdMessageHistoryConfig.showDeleted===false&&window.__twdMessageHistoryConfig.savePublic===false;
      return {on:on.showDeleted===true,liveOn,publicBlocked,publicOn:publicOn.savePublic===true,publicAllowed,localIgnored,off:off.showDeleted===false&&off.savePublic===false,liveOff};
    })()`);
    assert.deepEqual(historyToggle, { on: true, liveOn: true, publicBlocked: true, publicOn: true, publicAllowed: true, localIgnored: true, off: true, liveOff: true });

    const downloads = await cdp.eval('window.tgBridge.invoke("get_downloads")');
    assert.ok(Array.isArray(downloads));

    // Exercise the real blob streaming path: blob URL lives in the page, preload
    // reads it as a stream, main writes chunks to a .part file and atomically renames.
    const blobSaved = await cdp.eval(`(async()=>{
      const bytes=new Uint8Array(2*1024*1024); bytes.fill(0x5a);
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
      try{return await window.tgBridge.saveBlob(url,'smoke-stream.bin');}
      finally{URL.revokeObjectURL(url);}
    })()`);
    assert.equal(blobSaved && blobSaved.ok, true, 'streamed blob must save successfully');
    assert.ok(Number.isInteger(blobSaved.id) && blobSaved.id > 0);
    const streamed = await waitFor(async () => {
      const list = await cdp.eval('window.tgBridge.invoke("get_downloads")');
      return list.find(x => x.id === blobSaved.id && x.status === 'completed' && x.exists) || null;
    }, 10000, 'streamed blob registry entry');
    const streamedPath = path.join(smokeDownloads, streamed.filename);
    assert.equal(fs.statSync(streamedPath).size, 2 * 1024 * 1024);
    const fd = fs.openSync(streamedPath, 'r');
    const first = Buffer.alloc(1);
    try { fs.readSync(fd, first, 0, 1, 0); } finally { fs.closeSync(fd); }
    assert.equal(first[0], 0x5a);
    await cdp.eval(`window.tgBridge.invoke("delete_download",{id:${blobSaved.id}})`);
    assert.equal(fs.existsSync(streamedPath), false, 'smoke blob file must be deleted after verification');

    await waitFor(() => cdp.eval('window.__tgNotifIntercept === true'), 15000, 'notification interception');
    await cdp.eval(`window.tgBridge.invoke("preview_notification",{
      mode:"settings",title:"VISIBLE PREVIEW NAME",body:"VISIBLE PREVIEW BODY",peerId:"1",icon:"",
      previewSettings:{hideText:true,hideSender:true,hideAvatar:true,duration:2}
    }).then(()=>true)`);
    const popupTarget = await waitFor(async () => {
      const list = await jsonGet(port, '/json/list');
      return list.find(x => x.type === 'page' && /^data:text\/html/.test(x.url)) || null;
    }, 10000, 'notification popup renderer');
    const popupCdp = new Cdp(popupTarget.webSocketDebuggerUrl);
    await popupCdp.open();
    try {
      const privacyPreview = await waitFor(async () => popupCdp.eval(`(()=>{
        const cards=[...document.querySelectorAll('.card')];const c=cards[cards.length-1];if(!c)return null;
        return {title:c.querySelector('.title')?.textContent||'',body:c.querySelector('.text')?.textContent||'',hasImage:!!c.querySelector('.avatar img'),avatar:c.querySelector('.avatar')?.textContent?.trim()||''};
      })()`), 5000, 'privacy notification preview');
      assert.notEqual(privacyPreview.title, 'VISIBLE PREVIEW NAME');
      assert.notEqual(privacyPreview.body, 'VISIBLE PREVIEW BODY');
      assert.equal(privacyPreview.hasImage, false);
      assert.equal(Array.from(privacyPreview.avatar).length, 1);
    } finally { popupCdp.close(); }
    await cdp.eval('window.tgBridge.invoke("show_notification",{title:"TWD smoke",body:"notification pipeline",peerId:"1"}).then(()=>true)');
    // Same entry point the patched Web A notifier uses when no service-worker controller exists.
    await cdp.eval('window.__twdConsumeSwNotification({type:"showMessageNotification",payload:{title:"TWD sink",body:"no controller path",chatId:"1",messageId:"99"}})');
    const sinkPopup = await waitFor(async () => {
      const list = await jsonGet(port, '/json/list');
      const target = list.find(x => x.type === 'page' && /^data:text\/html/.test(x.url));
      if (!target) return null;
      const c = new Cdp(target.webSocketDebuggerUrl);
      await c.open();
      try { return await c.eval('[...document.querySelectorAll(".card .title")].some(n=>n.textContent==="TWD sink")'); }
      finally { c.close(); }
    }, 10000, 'notification delivered through SW-less sink');
    assert.equal(sinkPopup, true);

    // Force the Telegram renderer to crash. window.cjs must recover it in-place.
    try { await cdp.call('Page.crash'); } catch (_) {}
    cdp.close(); cdp = null;
    const recovered = await waitFor(() => telegramTarget(port), 20000, 'renderer crash recovery');
    assert.match(recovered.url, /^https:\/\/web\.telegram\.org\/a/);
    assert.equal(child.exitCode, null, 'browser process must survive renderer crash');

    if (process.env.TWD_SMOKE_VERBOSE === '1') console.log('--- Electron tail ---\n' + log);
    console.log('SMOKE PASS: launch, Telegram, proxy, IPC, addons, live history, downloads, notifications, crash recovery');
  } catch (e) {
    console.error('SMOKE FAIL:', e.stack || e.message || e);
    if (log) console.error('--- Electron tail ---\n' + log);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGKILL');
    } catch (_) {}
    await sleep(300);
    // Electron helpers can hold profile files briefly after taskkill.
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch (_) {}
  }
})().catch(e => {
  console.error(e.stack || e);
  process.exitCode = 1;
});
