'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const { normalizeToTg, getTgUrlFromArgs, isTelegramWebLink } = require('../electron/deep-links.cjs');

test('Telegram deep links normalize without launching anything', () => {
    assert.equal(normalizeToTg('tg://resolve?domain=microsoft_help_bot'), 'tg://resolve?domain=microsoft_help_bot');
    assert.equal(normalizeToTg('https://t.me/microsoft_help_bot'), 'tg://resolve?domain=microsoft_help_bot');
    assert.equal(normalizeToTg('https://www.t.me/test/42?single=1'), 'tg://resolve?single=1&domain=test&post=42');
    assert.equal(normalizeToTg('https://t.me/+AbCd_123'), 'tg://join?invite=AbCd_123');
    assert.equal(normalizeToTg('https://t.me/joinchat/AbCd_123'), 'tg://join?invite=AbCd_123');
    assert.equal(normalizeToTg('https://t.me/c/12345/678'), 'tg://privatepost?channel=12345&post=678');
    assert.equal(normalizeToTg('https://t.me/c/12345/7/678'), 'tg://privatepost?channel=12345&thread=7&post=678');
    assert.equal(normalizeToTg('https://example.com/test'), null);
});

test('deep-link argv parser ignores unrelated arguments', () => {
    assert.equal(getTgUrlFromArgs(['app.exe', '--flag', 'https://t.me/example']), 'tg://resolve?domain=example');
    assert.equal(getTgUrlFromArgs(['app.exe', '--flag']), null);
    assert.equal(isTelegramWebLink('https://telegram.dog/example'), true);
    assert.equal(isTelegramWebLink('https://example.com/'), false);
});

test('IPC boundary still validates sender and blocks arbitrary commands', () => {
    const ipc = read('electron/ipc.cjs');
    const preload = read('electron/preload.js');
    assert.match(ipc, /event\.sender !== win\.webContents/);
    assert.match(ipc, /u\.hostname === 'web\.telegram\.org'/);
    assert.match(ipc, /throw new Error\('Forbidden IPC sender'\)/);
    assert.match(preload, /const TWD_ALLOWED_INVOKE = new Set/);
    assert.match(preload, /IPC command is not allowed/);
});

test('navigation and renderer-crash recovery guards remain installed', () => {
    const src = read('electron/window.cjs');
    assert.match(src, /webContents\.on\('will-navigate'/);
    assert.match(src, /webContents\.on\('will-redirect'/);
    assert.match(src, /webContents\.setWindowOpenHandler/);
    assert.match(src, /render-process-gone/);
    assert.match(src, /rendererRecoveries\.length >= 3/);
    assert.match(src, /minimize_to_tray/);
});

test('download and addon safety regressions stay covered', () => {
    const ipc = read('electron/ipc.cjs');
    const downloads = read('electron/downloads.cjs');
    const addons = read('electron/addons.cjs');
    assert.match(ipc, /SAFE_OPEN_EXTS/);
    assert.match(ipc, /invalid-url/);
    assert.match(downloads, /\.tmp/);
    assert.match(downloads, /renameSync/);
    assert.match(addons, /GROUP_DEFAULTS/);
    assert.match(addons, /\^\[a-zA-Z0-9\._-\]\+\\\.\(js\|crx\)\$/);
});

test('notification interception and popup crash recovery are present', () => {
    const intercept = read('electron/inject/notif-intercept.js');
    const popup = read('electron/notification.cjs');
    assert.match(intercept, /window\.__tgNotifIntercept/);
    assert.match(intercept, /ServiceWorker\.prototype/);
    assert.match(intercept, /Object\.defineProperty\(proto, 'postMessage'/);
    assert.match(intercept, /hasWebNotifications/);
    assert.match(intercept, /hasPushNotifications/);
    assert.match(popup, /render-process-gone/);
    assert.match(popup, /unresponsive/);
});

test('release hardening fuses stay enabled', () => {
    const pkg = JSON.parse(read('package.json'));
    const f = pkg.build.electronFuses;
    assert.equal(f.runAsNode, false);
    assert.equal(f.enableNodeOptionsEnvironmentVariable, false);
    assert.equal(f.enableNodeCliInspectArguments, false);
    assert.equal(f.enableEmbeddedAsarIntegrityValidation, true);
    assert.equal(f.onlyLoadAppFromAsar, true);
    assert.equal(f.grantFileProtocolExtraPrivileges, false);
});

test('embedded desktop addons exist', () => {
    const dir = path.join(root, 'electron', 'embedded_addons');
    assert.equal(fs.existsSync(path.join(dir, 'desktop_like_standart.js')), true);
    assert.equal(fs.existsSync(path.join(dir, 'desktop_like_wide.js')), true);
});
