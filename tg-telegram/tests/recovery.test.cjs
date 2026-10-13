'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const read = name => fs.readFileSync(path.join(__dirname, '../electron', name), 'utf8');

test('pending file RPC recovers a silent proxy socket even while another download progresses', async () => {
    let now = 0;
    const timers = new Set();
    class Socket extends EventEmitter {
        static OPEN = 1;
        constructor(url) { super(); this.url = url; this.readyState = 1; this.closed = []; }
        addEventListener(name, fn) { this.on(name, fn); }
        close(code) { this.closed.push(code); this.readyState = 3; this.emit('close'); }
    }
    const context = { WebSocket: Socket, URL, URLSearchParams, console: { log() {} },
        Date: { now: () => now }, setInterval: fn => { timers.add(fn); return fn; },
        clearInterval: fn => timers.delete(fn) };
    vm.createContext(context);
    vm.runInContext(read('tg-flowseal-relay-runtime.js')
        .replace('__TWD_PROXY_BOOTSTRAP__', JSON.stringify({ active: true, bridgePort: 1234, bridgeToken: 'test' }))
        .replace('__TWD_PROXY_CHANNEL__', '"test"'), context);
    const silent = new context.WebSocket('wss://kws2-1.web.telegram.org/apiws');
    const active = new context.WebSocket('wss://kws3-1.web.telegram.org/apiws');
    const control = new context.WebSocket('wss://kws2.web.telegram.org/apiws');
    assert.ok(silent.url.startsWith('ws://127.0.0.1:1234/'), 'recovery uses the configured proxy route');
    assert.equal(timers.size, 0, 'idle sockets alone do not start recovery');
    let finish;
    const result = context.__twdInvokeWithMediaRecovery({ className: 'upload.GetFile' }, () => new Promise(r => { finish = r; }));
    now = 11999;
    for (const tick of timers) tick();
    assert.deepEqual(silent.closed, [], 'recovery waits for the full 12-second stall threshold');
    now = 12000;
    active.emit('message');
    for (const tick of timers) tick();
    assert.deepEqual(silent.closed, [4002]);
    assert.deepEqual(active.closed, []);
    assert.deepEqual(control.closed, []);
    finish('file bytes');
    assert.equal(await result, 'file bytes');
    assert.equal(timers.size, 0);
    await assert.rejects(context.__twdInvokeWithMediaRecovery({ className: 'upload.GetFile' }, () => Promise.reject(Error('cancelled'))), /cancelled/);
    assert.equal(timers.size, 0, 'failed/cancelled requests release recovery timers');
});

test('popup retries an unacknowledged notification after a hang and ignores stale acknowledgements', () => {
    const windows = [], timers = new Set(), ipcMain = new EventEmitter();
    class Window extends EventEmitter {
        constructor() {
            super(); windows.push(this); this.webContents = new EventEmitter(); this.sent = [];
            this.webContents.send = (channel, item) => this.sent.push(item);
        }
        isDestroyed() { return !!this.dead; }
        destroy() { this.dead = true; this.emit('closed'); }
        loadURL() { return Promise.resolve(); }
        setPosition() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setShape() {} showInactive() {}
    }
    const context = { module: { exports: {} }, __dirname, process: { env: {} }, console,
        require: name => name === 'electron' ? { BrowserWindow: Window, ipcMain,
            screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) } } : require(name),
        setTimeout: fn => { timers.add(fn); return fn; }, clearTimeout: fn => timers.delete(fn) };
    vm.createContext(context);
    vm.runInContext(read('notification.cjs'), context);
    const api = context.module.exports;
    api.init(() => null);
    api.queueNotification({ title: 'First', peerId: '1' });
    const first = windows[0];
    first.webContents.emit('did-finish-load');
    const id = first.sent[0].id;
    [...timers][0]();
    const second = windows[1];
    assert.ok(first.dead);
    second.webContents.emit('did-finish-load');
    assert.equal(second.sent[0].id, id, 'undelivered notification survives replacement');
    ipcMain.emit('notif-presented', { sender: first.webContents }, { id });
    api.queueNotification({ title: 'Second', peerId: '1' });
    assert.equal(second.sent.length, 1, 'old renderer cannot acknowledge new delivery');
    ipcMain.emit('notif-presented', { sender: second.webContents }, { id });
    assert.equal(second.sent.length, 2);
    second.emit('unresponsive');
    assert.ok(second.dead, 'BrowserWindow unresponsive event triggers recovery');
    const third = windows[2];
    third.webContents.emit('did-finish-load');
    ipcMain.emit('notif-presented', { sender: third.webContents }, { id: third.sent[0].id });
    assert.equal(timers.size, 0);
});

test('notification health repair does not accumulate permission wrappers over a long session', async () => {
    let nativeCalls = 0;
    const context = {
        Notification: function() {}, navigator: { permissions: {
            query: async () => { nativeCalls++; return { state: 'prompt' }; },
        } }, setInterval: () => 1, setTimeout: () => 1,
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(read('inject/notif-intercept.js'), context);
    const query = context.navigator.permissions.query;
    for (let i = 0; i < 20000; i++) context.__twdNotifRepair();
    assert.equal(context.navigator.permissions.query, query);
    assert.equal((await query({ name: 'camera' })).state, 'prompt');
    assert.equal(nativeCalls, 1);
    assert.equal((await query({ name: 'notifications' })).state, 'granted');
});

test('Telegram notify gate survives a reset hasWebNotifications flag in the current Web A build shape', async () => {
    const { patchTelegramNotifications } = require('../electron/tg-notification-patch.cjs');
    // Shape of Web A's lock chunk as shipped: minifier names differ from older builds (isReaction:n).
    const sample = 'function A(){return globalThis.state}function I(){return globalThis.actions}' +
        'function s(e){return e.settings.byKey}function Rt(){return!0}function Ct(){return!0}function Q(){return!0}' +
        'async function Bt(e){return`data:image/png;base64,AA`}' +
        'async function Ut({chat:e,message:t,isReaction:n=!1}){let r=A(),{hasWebNotifications:i}=s(r);if(!Rt(e,t))return;' +
        'let l=Ct();if(!i||!l){return}if(!l||!t.id)return;let f=await Bt(e),{title:p,body:m}={title:`T`,body:`B`};' +
        'if(Q())navigator.serviceWorker?.controller&&navigator.serviceWorker.controller.postMessage({type:`showMessageNotification`,' +
        'payload:{title:p,body:m,icon:f,chatId:e.id,messageId:t.id}});else{let r=I(),i={body:m,icon:f,badge:f,tag:String(t.id)};' +
        'new Notification(p,i)}}globalThis.notify=Ut;export{Ut as g};';
    const patched = patchTelegramNotifications(sample);
    assert.deepEqual({ ...patched, body: undefined },
        { body: undefined, iconPatched: true, sinkPatched: true, gatePatched: true, runtimeExposed: true });
    const again = patchTelegramNotifications(patched.body);
    assert.equal(again.body, patched.body);
    assert.equal(again.gatePatched, true);
    assert.equal(again.runtimeExposed, true);

    const delivered = [];
    const context = { setTimeout, Promise, Object,
        navigator: { serviceWorker: { controller: null } },
        state: { settings: { byKey: { hasWebNotifications: false, hasPushNotifications: true } } },
        actions: { updateWebNotificationSettings() {} },
        __twdConsumeSwNotification: m => { delivered.push(m); return true; },
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(patched.body.replace(/export\{[^}]*\};?/, ''), context);
    assert.equal(context.__twdNotifGatePatched, true);
    assert.equal(context.__twdTelegramRuntime.getGlobal(), context.state);
    assert.equal(context.__twdTelegramRuntime.getActions(), context.actions);
    await context.notify({ chat: { id: '5' }, message: { id: 9 } });
    assert.equal(delivered.length, 1, 'a reset hasWebNotifications flag no longer drops the notification');
    assert.equal(context.state.settings.byKey.hasWebNotifications, false, 'Telegram state itself is not mutated');
});

test('idle notification popup is rebuilt after sleep, unlock or a display change', () => {
    const windows = [], ipcMain = new EventEmitter(), powerMonitor = new EventEmitter();
    const screen = new EventEmitter();
    screen.getPrimaryDisplay = () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } });
    class Window extends EventEmitter {
        constructor() {
            super(); windows.push(this); this.webContents = new EventEmitter(); this.sent = []; this.visible = false;
            this.webContents.send = (channel, item) => this.sent.push(item);
        }
        isDestroyed() { return !!this.dead; }
        destroy() { this.dead = true; this.emit('closed'); }
        loadURL() { return Promise.resolve(); }
        isVisible() { return this.visible; }
        hide() { this.visible = false; }
        showInactive() { this.visible = true; }
        setPosition() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setShape() {}
    }
    const context = { module: { exports: {} }, __dirname, process: { env: {} }, console, Date,
        require: name => name === 'electron' ? { BrowserWindow: Window, ipcMain, powerMonitor, screen } : require(name),
        setTimeout: () => ({}), clearTimeout: () => {} };
    vm.createContext(context);
    vm.runInContext(read('notification.cjs'), context);
    const api = context.module.exports;
    api.init(() => null);

    api.queueNotification({ title: 'First', peerId: '1' });
    const first = windows[0];
    first.webContents.emit('did-finish-load');
    powerMonitor.emit('resume');
    assert.equal(first.dead, undefined, 'a popup with a card in flight is kept');
    ipcMain.emit('notif-presented', { sender: first.webContents }, { id: first.sent[0].id });
    powerMonitor.emit('resume');
    assert.equal(first.dead, undefined, 'a popup showing a card is kept');
    ipcMain.emit('notif-empty', { sender: first.webContents });
    assert.equal(first.visible, false);
    powerMonitor.emit('resume');
    assert.equal(first.dead, true, 'an idle popup is dropped after resume');

    api.queueNotification({ title: 'Second', peerId: '2' });
    const second = windows[1];
    assert.ok(second && second !== first, 'next notification builds a fresh popup');
    second.webContents.emit('did-finish-load');
    assert.equal(second.sent[0].title, 'Second');
    ipcMain.emit('notif-presented', { sender: second.webContents }, { id: second.sent[0].id });
    ipcMain.emit('notif-empty', { sender: second.webContents });
    screen.emit('display-removed');
    assert.equal(second.dead, true, 'an idle popup is dropped after a display change');
});
