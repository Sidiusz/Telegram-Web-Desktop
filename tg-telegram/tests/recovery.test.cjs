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
