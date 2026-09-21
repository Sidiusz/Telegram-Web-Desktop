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
  }));
  const port = await freePort();
  const electron = require('electron');
  let log = '';
  const child = spawn(electron, ['.'], {
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
  const collect = chunk => { log = (log + String(chunk)).slice(-30000); };
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
      const off=api.configure({showDeleted:false,savePublic:false});
      const liveOff=window.__twdMessageHistoryConfig&&window.__twdMessageHistoryConfig.showDeleted===false&&window.__twdMessageHistoryConfig.savePublic===false;
      return {on:on.showDeleted===true,liveOn,publicBlocked,publicOn:publicOn.savePublic===true,publicAllowed,off:off.showDeleted===false&&off.savePublic===false,liveOff};
    })()`);
    assert.deepEqual(historyToggle, { on: true, liveOn: true, publicBlocked: true, publicOn: true, publicAllowed: true, off: true, liveOff: true });

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

    // Force the Telegram renderer to crash. window.cjs must recover it in-place.
    try { await cdp.call('Page.crash'); } catch (_) {}
    cdp.close(); cdp = null;
    const recovered = await waitFor(() => telegramTarget(port), 20000, 'renderer crash recovery');
    assert.match(recovered.url, /^https:\/\/web\.telegram\.org\/a/);
    assert.equal(child.exitCode, null, 'browser process must survive renderer crash');

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
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
})().catch(e => {
  console.error(e.stack || e);
  process.exitCode = 1;
});
