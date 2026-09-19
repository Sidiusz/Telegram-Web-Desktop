'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const { normalizeToTg, getTgUrlFromArgs, isTelegramWebLink } = require('../electron/deep-links.cjs');
const { sanitizeFilename } = require('../electron/utils.cjs');

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

test('download filenames cannot address Windows device files', () => {
    assert.equal(sanitizeFilename('CON'), '_CON');
    assert.equal(sanitizeFilename('nul.txt'), '_nul.txt');
    assert.equal(sanitizeFilename('COM9.jpg'), '_COM9.jpg');
    assert.equal(sanitizeFilename('normal file.pdf...   '), 'normal file.pdf');
    assert.equal(sanitizeFilename('../folder/file.txt'), '_folder_file.txt');
});

test('Windows installer registers tg:// as a Default Apps contender without hijacking test builds', () => {
    const nsis = read('build/installer.nsh');
    const main = read('main.cjs');
    assert.match(nsis, /Software\\Classes\\TelegramWebDesktop\.tg/);
    assert.match(nsis, /Capabilities\\UrlAssociations/);
    assert.match(nsis, /Software\\RegisteredApplications/);
    assert.match(nsis, /Software\\Classes\\Applications\\\$\{APP_EXECUTABLE_FILENAME\}\\SupportedProtocols/);
    assert.match(nsis, /SHChangeNotify/);
    assert.match(nsis, /ReadRegStr \$0 HKCU "Software\\Classes\\tg\\shell\\open\\command"/);
    assert.match(main, /function isInstalledBuildPath\(\)/);
    assert.match(main, /app\.isPackaged/);
    assert.match(main, /app\.setAsDefaultProtocolClient\('tg'\)/);

    const ipc = read('electron/ipc.cjs');
    const preload = read('electron/preload.js');
    const settingsUi = read('electron/inject/ui/twd-settings-native.js');
    assert.match(ipc, /handle\('open_default_apps'/);
    assert.match(ipc, /ms-settings:defaultapps\?registeredAppUser=/);
    assert.match(preload, /'open_default_apps'/);
    assert.match(settingsUi, /T\('st_tg_links'\)/);
    assert.match(settingsUi, /INV\('open_default_apps'\)/);
});

test('IPC boundary still validates sender and blocks arbitrary commands', () => {
    const ipc = read('electron/ipc.cjs');
    const preload = read('electron/preload.js');
    const settings = read('electron/settings.cjs');
    assert.match(ipc, /event\.sender !== win\.webContents/);
    assert.match(ipc, /u\.hostname === 'web\.telegram\.org'/);
    assert.match(ipc, /throw new Error\('Forbidden IPC sender'\)/);
    assert.match(ipc, /function isSafeImageResourceUrl/);
    assert.doesNotMatch(ipc, /get_hint_img_url|set_window_title|sanitizeWindowTitle/);
    assert.doesNotMatch(preload, /get_hint_img_url|set_window_title/);
    assert.match(ipc, /invalid-version/);
    assert.match(ipc, /data:image\\\/png;base64/);
    assert.match(settings, /function normalizeSetting/);
    assert.match(settings, /function loadSettings\(\)[\s\S]*normalizeSetting\(key, raw\)/);
    assert.match(settings, /normalized === INVALID \? cloneDefault\(fallback\) : normalized/);
    assert.match(settings, /BOOL_KEYS/);
    assert.match(settings, /UPDATE_INTERVALS/);
    assert.match(settings, /normalized !== INVALID/);
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
    assert.match(src, /function isMainTelegramContents/);
    assert.match(src, /webContents === mainWindow\.webContents/);
    assert.match(src, /u\.hostname === 'web\.telegram\.org'/);
    assert.match(src, /__tgNotifIntercept/);
    assert.match(src, /__twdNotifHealthTimer/);
    assert.match(src, /__twdNotifRepair/);
    assert.doesNotMatch(src, /h === 't\.me'.*ALLOWED_PERMS/s);
});

test('developer tools stay locked until the setting is enabled', () => {
    const win = read('electron/window.cjs');
    const ipc = read('electron/ipc.cjs');
    const settingsUi = read('electron/inject/ui/settings-render.js');

    assert.ok(win.includes('const devToolsAllowed = () =>'));
    assert.ok(win.includes("webContents.on('devtools-opened'"));
    assert.ok(win.includes('event.preventDefault()'));
    assert.ok(win.includes("key === 'f12'"));
    assert.ok(win.includes("key === 'i' || key === 'j' || key === 'c'"));
    assert.ok(ipc.includes("if (settings.devtools_enabled !== true) return { error: 'disabled', open: false };"));
    assert.ok(ipc.includes('win.webContents.isDevToolsOpened()'));
    assert.ok(settingsUi.includes('function _setDevtoolsEnabled(v)'));
    assert.match(settingsUi, /_saveOne\(\{devtools_enabled:!!v\}\)[\s\S]*toggle_devtools/);
});

test('download and addon safety regressions stay covered', () => {
    const ipc = read('electron/ipc.cjs');
    const downloads = read('electron/downloads.cjs');
    const addons = read('electron/addons.cjs');
    assert.match(ipc, /SAFE_OPEN_EXTS/);
    assert.match(ipc, /invalid-url/);
    assert.match(downloads, /\.tmp/);
    assert.match(downloads, /renameSync/);
    assert.match(downloads, /normalizeDownloadRecord/);
    assert.match(downloads, /status === 'downloading'.*status = 'failed'/s);
    assert.match(downloads, /downloads\.slice\(-5000\)/);
    assert.match(ipc, /handle\('get_downloads'[\s\S]*filename: d\.filename[\s\S]*exists:/);
    assert.doesNotMatch(ipc, /handle\('get_downloads'[\s\S]{0,350}\.\.\.d/);
    assert.match(ipc, /normalizeDownloadId/);
    assert.doesNotMatch(addons, /embedded_addons|embedded:/);
    assert.match(addons, /\^user:/);
    assert.match(addons, /function normalizeAddonKey/);
    assert.match(addons, /MAX_JS_BYTES/);
    assert.match(addons, /MAX_CRX_TOTAL_SCRIPT_BYTES/);
    assert.match(addons, /addonFileWithinLimit/);
    assert.match(addons, /scripts\.length >= MAX_CRX_SCRIPTS/);
    assert.match(addons, /manifestEntry\.header\.size > MAX_CRX_MANIFEST_BYTES/);
    assert.match(addons, /\^\[a-zA-Z0-9\._-\]\+\\\.\(js\|crx\)\$/);
    assert.match(ipc, /await fs\.promises\.writeFile\(dest, buf\)/);
    assert.match(ipc, /return \{ ok: true, id \}/);
    assert.doesNotMatch(ipc, /return \{ ok: true, id, path: dest \}/);
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

test('updater selects only our installer and never changes versions silently', () => {
    const updater = read('electron/updater.cjs');
    assert.match(updater, /function isInstallerAssetName/);
    assert.ok(updater.includes("return /^Telegram[ ._-]+Web[ ._-]+Desktop[ ._-]+Setup"));
    assert.match(updater, /trusted update digest is unavailable/);
    assert.match(updater, /release digest mismatch - update rejected/);
    assert.match(updater, /The available update changed; check for updates again/);
    assert.match(updater, /normVer\(fresh\.version\) !== expectedVersion/);
});

test('Telegram Web fallback is release-pinned and never follows master at runtime', () => {
    const fallback = read('electron/telegram-web-fallback.cjs');
    assert.match(fallback, /const FALLBACK_REF = '[0-9a-f]{40}'/);
    assert.match(fallback, /const ref = FALLBACK_REF/);
    assert.doesNotMatch(fallback, /commits\/master|git\/info\/refs|resolveRemoteRef|startRefRefreshForNextSession/);
});

test('built-in client features are separate from user add-ons', () => {
    const dir = path.join(root, 'electron', 'features');
    const loader = read('electron/features.cjs');
    const addons = read('electron/addons.cjs');
    assert.equal(fs.existsSync(path.join(dir, 'desktop_like_standard.js')), true);
    assert.equal(fs.existsSync(path.join(dir, 'desktop_like_wide.js')), true);
    assert.equal(fs.existsSync(path.join(dir, 'hide_ads.js')), true);
    assert.equal(fs.existsSync(path.join(dir, 'message_history.js')), true);
    assert.match(loader, /appearance_message_layout === 'wide'/);
    assert.match(loader, /appearance_message_layout === 'left'/);
    assert.match(loader, /appearance_hide_ads !== false/);
    assert.match(loader, /messages_show_deleted/);
    assert.match(loader, /messages_edit_history/);
    assert.doesNotMatch(addons, /desktop_like|hide_ads|embedded_addons/);
});

const { UpstreamHealth, DEFAULT_COOLDOWN_MS } = require('../electron/tg-flowseal-health.cjs');

test('proxy cooldown is passive and deprioritizes failed domains', () => {
    let now = 1_000;
    const health = new UpstreamHealth({ cooldownMs: 30_000, now: () => now });
    const candidates = ['a.test', 'b.test', 'c.test'].map(domain => ({ domain }));
    health.markSuccess('a.test');
    assert.deepEqual(health.rank(candidates).map(x => x.domain), ['a.test', 'b.test', 'c.test']);
    health.markFailure('a.test');
    assert.deepEqual(health.rank(candidates).map(x => x.domain), ['b.test', 'c.test', 'a.test']);
    assert.equal(health.isCooling('a.test'), true);
    health.markSuccess('b.test');
    assert.deepEqual(health.rank(candidates).map(x => x.domain), ['b.test', 'c.test', 'a.test']);
    now += 30_001;
    assert.equal(health.isCooling('a.test'), false);
    assert.equal(DEFAULT_COOLDOWN_MS, 45_000);
});

test('proxy health does not add heartbeat traffic', () => {
    const bridge = read('electron/tg-flowseal-bridge.cjs');
    assert.doesNotMatch(bridge, /\.ping\s*\(/);
    assert.doesNotMatch(bridge, /['"]pong['"]/i);
    assert.match(bridge, /noteUpstreamFailure/);
});

test('manual launch maximizes while autostart stays hidden', () => {
    const main = read('main.cjs');
    const win = read('electron/window.cjs');
    const settings = read('electron/settings.cjs');
    assert.match(main, /isAutostartLaunch/);
    assert.match(main, /--autostart/);
    assert.match(main, /--hidden/);
    assert.match(main, /showMainWindow\(win, true\)/);
    assert.match(main, /startHidden: initialAutostart/);
    assert.match(win, /const startHidden = options\.startHidden === true/);
    assert.match(win, /ready-to-show/);
    assert.match(win, /mainWindow\.maximize\(\)/);
    assert.match(win, /process\.env\.TWD_SMOKE_HIDDEN === '1' \|\| startHidden/);
    assert.match(settings, /minimize_to_tray:\s*true/);
    assert.match(win, /if \(settings\.minimize_to_tray\) \{[\s\S]*e\.preventDefault\(\);[\s\S]*mainWindow\.hide\(\)/);
});

test('custom UI stays inside Telegram Settings and keeps native navigation semantics', () => {
    const core = read('electron/inject/ui/core.js');
    const inject = read('electron/inject/ui/inject.js');
    const panels = read('electron/inject/ui/native-panels.js');
    const settings = read('electron/inject/ui/settings-render.js');
    const twd = read('electron/inject/ui/twd-settings-native.js');
    const notifications = read('electron/inject/ui/notifications-settings.js');
    const bootstrap = read('electron/inject/ui/bootstrap.js');
    const wide = read('electron/features/desktop_like_wide.js');
    const standard = read('electron/features/desktop_like_standard.js');

    assert.match(inject, /_tgst_twd_/);
    assert.match(inject, /_tgst_dl_/);
    assert.match(inject, /_tgst_ad_/);
    assert.match(inject, /_tgst_modinfo_/);
    assert.match(inject, /icon-settings-filled/);
    assert.match(inject, /openTwdNative\('root'\)/);
    assert.match(inject, /openDownloadsNative\(\)/);
    assert.match(inject, /openAddonsNative\(\)/);
    assert.doesNotMatch(inject, /_tgst_proxy_[\s\S]*openProxyNative/);

    assert.match(twd, /function openTwdNative\(/);
    assert.match(twd, /openNativePanel\(/);
    assert.match(twd, /handleBack/);
    assert.match(twd, /_twdNavigateNative\('root'\)/);
    assert.match(twd, /appearance_message_layout/);
    assert.match(twd, /messages_show_deleted/);
    assert.match(twd, /messages_edit_history/);
    assert.match(twd, /function _twdRangeRow\(/);
    assert.match(twd, /var _twdSaveQueue=Promise\.resolve\(\)/);
    assert.match(twd, /_twdSaveQueue=_twdSaveQueue\.catch/);
    assert.match(twd, /input\.type='range'/);
    assert.match(twd, /notif_duration:Math\.round\(v\)/);
    assert.match(twd, /notif_volume:Math\.max\(0,Math\.min\(100,v\)\)\/100/);
    assert.doesNotMatch(twd, /\['updates','reload'/);
    assert.doesNotMatch(twd, /if\(page==='updates'\)/);
    assert.match(twd, /function _twdAppendUpdates\(/);
    assert.match(twd, /function _twdRenderAbout[\s\S]*_twdAppendUpdates\(content,ctx,s\)/);
    assert.match(twd, /renderProxyNative\(content\)/);
    assert.match(twd, /openChangelogNative\(\)/);
    assert.doesNotMatch(twd, /position:fixed;inset:0|_twd_settings_root_/);

    assert.match(panels, /panel\._titleEl=h3/);
    assert.match(panels, /panel\._content=content/);
    assert.match(panels, /opts\.handleBack/);
    assert.match(panels, /renderDownloadsNative[\s\S]{0,1700}save_path/);
    assert.match(panels, /renderDownloadsNative[\s\S]{0,1700}open_folder_dialog/);
    assert.doesNotMatch(panels, /function openAppSettingsNative/);

    assert.match(bootstrap, /setupNativeWidgetCapture\(\)/);
    assert.doesNotMatch(bootstrap, /setupNotificationSettingsSync\(\)/);
    assert.match(bootstrap, /__tgOpenAppSettings=function\(\)\{ try\{ openTwdNative\('root'\)/);
    assert.doesNotMatch(notifications, /injectNotifBlock|injectGeneralSettings|injectAboutSection/);
    assert.doesNotMatch(settings, /function injectGeneralSettings|function injectAboutSection|function renderSt/);

    assert.match(settings, /_TWD_FILLED_GLYPHS/);
    assert.match(core, /Measured from a live Telegram settings category transition/);
    assert.match(core, /\.3s cubic-bezier\(\.25,1,\.5,1\)/);
    assert.match(core, /@keyframes _twd-settings-in-move_/);
    assert.match(core, /@keyframes _twd-settings-out-move_/);
    assert.match(core, /@keyframes _twd-settings-back-out-move_/);
    assert.match(core, /_twd-range-input_/);
    assert.match(core, /accent-color:var\(--color-primary/);
    assert.doesNotMatch(core, /_tgpanel_\._in_\{animation:slide-in-200|_twd-under_[^{]*push-out/);

    const modal = read('electron/inject/ui/modal.js');
    assert.doesNotMatch(modal, /function makePanel\(|function openPanel\(/);
    assert.match(modal, /function _escHtml\(/);
    assert.match(modal, /msgHtml!=null\?String\(msgHtml\):_escHtml\(msg\)/);
    assert.match(modal, /_escHtml\(checkLabel\)/);
    assert.match(modal, /_escHtml\(o\.label\)/);
    assert.doesNotMatch(settings, /innerHTML\s*=\s*['"][^'"]*['"]\s*\+\s*e\b/);
    assert.doesNotMatch(panels, /innerHTML\s*=.*r\.error/);

    assert.match(wide, /width: calc\(100% - 2rem\) !important/);
    assert.doesNotMatch(wide, /messages-container[\s\S]{0,700}width: calc\(100% - 2rem - var\(--tgdl-rc/);
    assert.match(wide, /align-self: center !important/);
    assert.match(wide, /#MiddleColumn \.MiddleHeader[\s\S]{0,350}width: calc\(100% - 2rem - var\(--tgdl-rc, 0px\)\)/);
    assert.match(wide, /margin-left: 1rem !important/);
    assert.match(wide, /is-in-document-group \.message-content\.audio[\s\S]{0,240}translateX\(45px\)/);
    assert.match(standard, /is-in-document-group \.message-content\.audio[\s\S]{0,240}translateX\(45px\)/);
    assert.match(wide, /Message\.own:not\(\.is-in-document-group\):has\(\.message-content\.media\) \.message-content-wrapper[\s\S]{0,220}justify-content: flex-start/);
});

test('message history is event-driven, session-only and native-integrated', () => {
    const feature = read('electron/features/message_history.js');
    const ipc = read('electron/ipc.cjs');
    const preload = read('electron/preload.js');
    assert.equal(fs.existsSync(path.join(root, 'electron/message-history.cjs')), false);
    assert.match(ipc, /get_history_bootstrap/);
    assert.match(ipc, /message-history\.json/);
    assert.doesNotMatch(ipc, /handle\('history_sync'/);
    assert.doesNotMatch(ipc, /handle\('history_mark_deleted'/);
    assert.match(preload, /historyHandleWorkerMessage/);
    assert.match(preload, /this\.addEventListener\('message', historyHandleWorkerMessage\)/);
    assert.match(preload, /update\['@type'\] === 'deleteMessages'/);
    assert.match(preload, /IDBObjectStore\.prototype\.put/);
    assert.match(preload, /historyIsPrivate/);
    assert.match(preload, /if \(!historyIsPrivate\(chatId\) && active !== chatId\) return/);
    assert.match(preload, /if \(item && !historyIsPrivate\(item\.chatId\) && active !== item\.chatId\) item = null/);
    assert.doesNotMatch(preload, /'history_sync'/);
    assert.doesNotMatch(feature, /setInterval\(scan/);
    assert.doesNotMatch(feature, /querySelectorAll\('#MiddleColumn \.Message\[data-message-id\]:not/);
    assert.match(feature, /document\.addEventListener\('contextmenu'/);
    assert.match(feature, /MessageContextMenu_items/);
    assert.match(feature, /_twd-edit-history-menu_/);
    assert.doesNotMatch(feature, /_twd-edit-history-badge_/);
    assert.match(feature, /className = '_mo_ _twd-history-native_'/);
    assert.doesNotMatch(feature, /_twd-history-native_ \.modal-dialog/);
    assert.match(feature, /window\.__twdMessageHistoryApi/);
});

test('service UI Lab stays hidden and reuses native builders', () => {
    const scripts = read('electron/scripts.cjs');
    const lab = read('electron/inject/ui/ui-lab.js');
    const inject = read('electron/inject/ui/inject.js');
    const panels = read('electron/inject/ui/native-panels.js');
    const settings = read('electron/inject/ui/settings-render.js');

    assert.match(scripts, /'ui-lab\.js'/);
    assert.match(lab, /window\.__twdUiLab/);
    assert.match(lab, /_genNativeSettingRow/);
    assert.match(lab, /_genToggle/);
    assert.match(lab, /_genRadioGroup/);
    assert.match(lab, /_genInput/);
    assert.match(lab, /_genButton/);
    assert.match(lab, /_nativeDlRow/);
    assert.match(settings, /function _appendNativeSection\(/);
    assert.match(settings, /hasVisibleBefore=Array\.prototype\.some\.call/);
    assert.match(settings, /h\.style\.marginTop=hasVisibleBefore\?'16px':'0px'/);
    assert.match(settings, /if\(found\.header\)return found/);
    assert.doesNotMatch(lab, /style\.marginTop='16px'/);
    assert.match(lab, /INV\('get_proxy_status'\)/);
    assert.match(lab, /_uiLabAvatarDataUrl/);
    assert.match(lab, /INV\('preview_notification'/);
    assert.match(lab, /hidden-text/);
    assert.match(lab, /hidden-sender/);
    assert.match(lab, /hidden-all/);
    assert.match(lab, /no-avatar/);
    assert.doesNotMatch(inject, /ui_lab|__twdUiLab/i);
    assert.match(panels, /function _withSettingsReady\(/);
    assert.match(settings, /function _genButton\(/);
    assert.match(settings, /function _wireUiLabUnlock\(/);
    assert.match(settings, /count>=7&&count<10/);
    assert.match(settings, /10-count/);
    assert.match(settings, /openUiLabNative\(\)/);
    const twd = read('electron/inject/ui/twd-settings-native.js');
    assert.match(twd, /_wireUiLabUnlock\(lab\)/);
});

test('desktop notification popup follows Telegram toast geometry and has no dead settings flags', () => {
    const notif = read('electron/notification.cjs');
    const intercept = read('electron/inject/notif-intercept.js');
    const settings = read('electron/settings.cjs');
    const notifSettings = read('electron/inject/ui/notifications-settings.js');
    const ipc = read('electron/ipc.cjs');
    const preload = read('electron/preload.js');
    const notifPreload = read('electron/notification-preload.js');

    assert.match(notif, /const WIDTH = 384/);
    assert.match(notif, /#stack\{position:absolute;inset:0;overflow:hidden/);
    assert.match(notif, /\.card\{position:absolute;left:8px;right:8px;height:156px/);
    assert.match(notif, /background:rgba\(33,33,33,\.94\)/);
    assert.match(notif, /backdrop-filter:blur\(8px\)/);
    assert.match(notif, /border:1px solid rgba\(255,255,255,\.14\)/);
    assert.match(notif, /border-radius:16px;padding:17px;color:#fff/);
    assert.match(notif, /font-size:15px;line-height:1\.25/);
    assert.match(notif, /event\.sender === _win\.webContents/);
    assert.match(notif, /img-src data:;/);
    assert.doesNotMatch(notif, /img-src[^;]*https:/);
    assert.match(notif, /sanitizePopupIcon/);
    assert.match(notif, /const CARD_HEIGHT = 156/);
    assert.match(notif, /const STACK_HEIGHT = CARD_HEIGHT \* MAX_CARDS \+ CARD_GAP \* \(MAX_CARDS - 1\)/);
    assert.match(notif, /height: STACK_HEIGHT/);
    assert.doesNotMatch(notif, /notif-resize|resizeWindow\(|contentHeight\(/);
    assert.match(notif, /ipcMain\.on\('notif-shape'/);
    assert.match(notif, /_win\.setShape/);
    assert.match(notif, /async function addCard\(data\)/);
    assert.match(notif, /order\.push\(c\.id\)/);
    assert.match(notif, /if\(order\.length>MAX_CARDS\)evictedId=order\.shift\(\)/);
    assert.match(notif, /setPose\(c,STACK_H\+GAP,0\)/);
    assert.match(notif, /animatePose\(evicted,-CARD_H-GAP,0,MOVE_MS\)/);
    assert.match(notif, /async function removeCardNow\(id\)/);
    assert.match(notif, /await animatePose\(c,c\.y,0,FADE_MS\)/);
    assert.match(notif, /moves\.push\(animatePose\(item,yFor\(index,survivors\.length\),1,MOVE_MS\)\)/);
    assert.match(notif, /transform:scaleX\(1\)/);
    assert.match(notifPreload, /sendShape: \(count\) => ipcRenderer\.send\('notif-shape'/);
    assert.doesNotMatch(notifPreload, /sendResize|notif-resize/);
    assert.match(notif, /@keyframes barshrink\{from\{transform:scaleX\(1\);\}to\{transform:scaleX\(0\);\}\}/);
    assert.match(notif, /function pauseCard\(id\)/);
    assert.match(notif, /function resumeCard\(id\)/);
    assert.match(ipc, /handle\('preview_notification'/);
    assert.match(ipc, /hidden-text/);
    assert.match(ipc, /hidden-sender/);
    assert.match(ipc, /hidden-all/);
    assert.match(preload, /'preview_notification'/);
    assert.match(intercept, /__twdNotifHealthTimer/);
    assert.match(intercept, /__twdNotifStateRepairTimer/);
    assert.match(intercept, /__twdNotifRepair/);
    assert.match(intercept, /repairNotificationInterception/);
    assert.match(intercept, /__twdNotifPostMessageHook/);
    assert.match(intercept, /proto\.postMessage !== installedHook/);
    assert.match(intercept, /hookServiceWorker\(\)/);
    assert.doesNotMatch(settings, /background_notifications_enabled|webnotif_hint_shown/);
    assert.doesNotMatch(notifSettings, /function bindRow\(|function unlockRow\(|background_notifications_enabled/);
});

test('notification category filter distinguishes Telegram channels from groups', () => {
    const bootstrap = read('electron/inject/ui/bootstrap.js');
    assert.match(bootstrap, /indexedDB\.open\('tt-data'\)/);
    assert.match(bootstrap, /\^tt-global-state\(\?:_\\d\+\)\?\$/);
    assert.match(bootstrap, /type==='chatTypeChannel'.*return 'channel'/s);
    assert.match(bootstrap, /type==='chatTypeBasicGroup'\|\|type==='chatTypeSuperGroup'.*return 'group'/s);
    assert.match(bootstrap, /resolveChatCategory\(pid\)\.then/);
    assert.doesNotMatch(bootstrap, /var cat = \(pid\.charAt\(0\)==='-'\) \? 'group' : 'private'/);
});

test('proxy stall recovery reconnects without heartbeat traffic', () => {
    const bootstrap = read('electron/inject/ui/bootstrap.js');
    const preload = read('electron/preload.js');
    const route = read('electron/tg-flowseal-route.cjs');
    assert.match(bootstrap, /installProxyStallRecovery/);
    assert.match(bootstrap, /now-waitingSince<12000/);
    assert.match(bootstrap, /INV\('reconnect_proxy'\)/);
    assert.match(preload, /'reconnect_proxy'/);
    assert.match(route, /function forceProxyReconnect/);
    assert.match(route, /state\.reconnectEpoch\+\+/);
});
