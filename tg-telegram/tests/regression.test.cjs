'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const { normalizeToTg, getTgUrlFromArgs, isTelegramWebLink } = require('../electron/deep-links.cjs');
const { sanitizeFilename } = require('../electron/utils.cjs');
const { patchTelegramMediaCache } = require('../electron/tg-media-cache.cjs');

test('Telegram deep links normalize without launching anything', () => {
    assert.equal(normalizeToTg('tg://resolve?domain=microsoft_help_bot'), 'tg://resolve?domain=microsoft_help_bot');
    assert.equal(normalizeToTg('https://t.me/microsoft_help_bot'), 'tg://resolve?domain=microsoft_help_bot');
    assert.equal(normalizeToTg('https://www.t.me/test/42?single=1'), 'tg://resolve?single=1&domain=test&post=42');
    assert.equal(normalizeToTg('https://t.me/+AbCd_123'), 'tg://join?invite=AbCd_123');
    assert.equal(normalizeToTg('https://t.me/joinchat/AbCd_123'), 'tg://join?invite=AbCd_123');
    assert.equal(normalizeToTg('https://t.me/c/12345/678'), 'tg://privatepost?channel=12345&post=678');
    assert.equal(normalizeToTg('https://t.me/c/12345/7/678'), 'tg://privatepost?channel=12345&thread=7&post=678');
    assert.equal(normalizeToTg('https://t.me/c/12345/678?channel=999&post=999&thread=9&single=1'), 'tg://privatepost?single=1&channel=12345&post=678');
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
    assert.match(settings, /function repairLegacyUtf8Mojibake\(/);
    assert.match(settings, /new TextDecoder\('windows-1251'\)/);
    assert.match(settings, /new TextDecoder\('utf-8', \{ fatal: true \}\)/);
    assert.match(settings, /function loadSettings\(\)[\s\S]*normalizeSetting\(key, raw\)/);
    assert.match(settings, /normalized === INVALID \? cloneDefault\(fallback\) : normalized/);
    assert.match(settings, /key === 'save_path'[\s\S]{0,140}store\.set\(key, normalized\)/);
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
    assert.match(src, /function repaintWindowSurface\(\)/);
    assert.match(src, /webContents\.invalidate\(\)/);
    assert.match(src, /WEB_A_ENTRY_TIMEOUT_MS = 8000/);
    assert.match(src, /function isWebAUrl\(url, protocol\)/);
    assert.match(src, /u\.hostname === 'web\.telegram\.org'[\s\S]{0,120}u\.pathname === '\/a' \|\| u\.pathname\.startsWith\('\/a\/'\)/);
    assert.doesNotMatch(src, /url\.startsWith\('https:\/\/web\.telegram\.org\/a'\)/);
    assert.match(src, /AbortSignal\.timeout\(WEB_A_ENTRY_TIMEOUT_MS\)/);
    assert.doesNotMatch(src, /new AbortController\(\)/);
    assert.match(src, /if \(entry\) return fetchTelegramWebAFallback\(url\)/);
    assert.match(src, /webContents\.on\('did-stop-loading', repaintWindowSurface\)/);
    assert.match(src, /mainWindow\.on\('show'.*repaintWindowSurface/s);
    assert.match(src, /mainWindow\.on\('restore'.*repaintWindowSurface/s);
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
    const win = read('electron/window.cjs');
    const downloads = read('electron/downloads.cjs');
    const downloadRegistry = read('electron/inject/ui/downloads-registry.js');
    const nativePanels = read('electron/inject/ui/native-panels.js');
    const core = read('electron/inject/ui/core.js');
    const addons = read('electron/addons.cjs');
    const preload = read('electron/preload.js');
    const bootstrap = read('electron/inject/ui/bootstrap.js');
    assert.match(ipc, /SAFE_OPEN_EXTS/);
    assert.match(ipc, /invalid-url/);
    assert.match(downloads, /\.tmp/);
    assert.match(downloads, /renameSync/);
    assert.match(downloads, /normalizeDownloadRecord/);
    assert.match(downloads, /status === 'downloading'.*status = 'failed'/s);
    assert.match(downloads, /downloads\.slice\(-5000\)/);
    assert.match(ipc, /handle\('get_downloads'[\s\S]*filename: d\.filename[\s\S]*recv[\s\S]*total[\s\S]*exists/);
    assert.match(ipc, /fs\.statSync\(d\.path\)\.size/);
    assert.match(downloads, /const recv = Number\(raw\.recv\)/);
    assert.match(downloads, /const total = Number\(raw\.total\)/);
    assert.doesNotMatch(ipc, /handle\('get_downloads'[\s\S]{0,350}\.\.\.d/);
    assert.match(ipc, /handle\('open_downloads_folder'/);
    assert.match(ipc, /shell\.openPath\(dir\)/);
    assert.match(ipc, /normalizeDownloadId/);
    assert.match(ipc, /handle\('delete_download', async[\s\S]{0,300}cancelActive\(safeId\)[\s\S]{0,180}cancelBlobSaveByDownloadId\(safeId\)/);
    assert.match(win, /fs\.mkdirSync\(downloadDir, \{ recursive: true \}\)/);
    assert.match(win, /\[DOWNLOAD\] save directory is unavailable/);
    assert.match(nativePanels, /function _nativeDlRow\(/);
    assert.match(nativePanels, /function _downloadStatusText\(d\)/);
    assert.match(nativePanels, /fmtProgress\(recv,total\)/);
    assert.match(nativePanels, /T\('dl_waiting'\)\+\(pendingSize\?' · '\+pendingSize:''\)/);
    assert.match(nativePanels, /T\('dl_done'\)[\s\S]*doneSize/);
    assert.match(nativePanels, /T\('dl_failed'\)[\s\S]*failedSize/);
    assert.match(nativePanels, /T\('dl_cancelled'\)[\s\S]*cancelledSize/);
    assert.match(nativePanels, /INV\('open_downloads_folder'\)/);
    assert.match(nativePanels, /INV\('open_download_folder',\{id:d\.id\}\)/);
    assert.match(nativePanels, /INV\('open_download_file',\{id:d\.id\}\)/);
    assert.match(nativePanels, /INV\('delete_download',\{id:d\.id\}\)/);
    assert.match(downloadRegistry, /file\.classList\.remove\('_tgdl_downloading_'\);\s*clearDownloadingBadge\(file\);\s*ensureBadges\(file\);/);
    assert.match(downloadRegistry, /_twdFitMenuViewport\(items\)/);
    assert.match(core, /function _twdFitMenuViewport\(/);
    assert.match(core, /setProperty\('max-height',maxH\+'px','important'\)/);
    assert.match(core, /setProperty\('translate','0 '\+Math\.round\(dy\)\+'px','important'\)/);
    assert.match(bootstrap, /\[0,60,140,260\]\.forEach/);
    assert.match(core, /\.Notification-container\.dl_card\{margin-left:auto;margin-right:auto;/);
    assert.doesNotMatch(addons, /embedded_addons|embedded:/);
    assert.match(addons, /\^user:/);
    assert.match(addons, /function normalizeAddonKey/);
    assert.match(addons, /MAX_JS_BYTES/);
    assert.match(addons, /MAX_CRX_TOTAL_SCRIPT_BYTES/);
    assert.match(addons, /addonFileWithinLimit/);
    assert.match(addons, /scripts\.length >= MAX_CRX_SCRIPTS/);
    assert.match(addons, /manifestEntry\.header\.size > MAX_CRX_MANIFEST_BYTES/);
    assert.match(addons, /\^\[a-zA-Z0-9\._-\]\+\\\.\(js\|crx\)\$/);
    assert.match(ipc, /handle\('begin_blob_save'/);
    assert.match(ipc, /handle\('append_blob_chunk'/);
    assert.match(ipc, /handle\('finish_blob_save'/);
    assert.match(ipc, /handle\('abort_blob_save'/);
    assert.match(ipc, /fs\.promises\.open\(temp, 'wx'\)/);
    assert.match(ipc, /\.twd-part/);
    assert.match(ipc, /type: 'progress'/);
    assert.match(ipc, /await fs\.promises\.rename\(item\.temp, item\.dest\)/);
    assert.match(ipc, /cancelBlobSaveByDownloadId/);
    assert.match(ipc, /function detachBlobSender\(item\)/);
    assert.match(ipc, /removeListener\('destroyed', item\.senderDestroyedHandler\)/);
    assert.match(ipc, /senderDestroyedHandler: null/);
    assert.match(ipc, /event\.sender\.once\('destroyed', item\.senderDestroyedHandler\)/);
    assert.match(ipc, /handle\('begin_blob_save'[\s\S]{0,550}fs\.mkdirSync\(dir, \{ recursive: true \}\)[\s\S]{0,180}mkdir-failed/);
    assert.doesNotMatch(ipc, /handle\('save_blob'/);
    assert.doesNotMatch(ipc, /384 \* 1024 \* 1024/);
    assert.match(preload, /'open_downloads_folder'/);
    assert.match(preload, /async function twdSaveBlob\(/);
    assert.match(preload, /ipcRenderer\.invoke\('begin_blob_save'/);
    assert.match(preload, /ipcRenderer\.invoke\('append_blob_chunk'/);
    assert.match(preload, /ipcRenderer\.invoke\('finish_blob_save'/);
    assert.match(preload, /ipcRenderer\.invoke\('abort_blob_save'/);
    assert.match(preload, /MAX_IPC_CHUNK = 1024 \* 1024/);
    assert.match(preload, /saveBlob: twdSaveBlob/);
    assert.doesNotMatch(preload, /'begin_blob_save'.*TWD_ALLOWED_INVOKE/s);
    assert.doesNotMatch(preload, /'save_blob'/);
    assert.match(bootstrap, /window\.tgBridge\.saveBlob\(href,name\)/);
    assert.doesNotMatch(bootstrap, /INV\('save_blob'/);
    assert.doesNotMatch(bootstrap.slice(bootstrap.indexOf('Скачивание медиа из просмотрщика'), bootstrap.indexOf('// ── #4:')), /readAsDataURL/);
    assert.doesNotMatch(ipc, /return \{ ok: true, id, path: dest \}/);
});

test('notification interception and popup crash recovery are present', () => {
    const intercept = read('electron/inject/notif-intercept.js');
    const popup = read('electron/notification.cjs');
    const bootstrap = read('electron/inject/ui/bootstrap.js');
    assert.match(intercept, /window\.__tgNotifIntercept/);
    assert.match(intercept, /ServiceWorker\.prototype/);
    assert.match(intercept, /Object\.defineProperty\(proto, 'postMessage'/);
    assert.match(intercept, /hasWebNotifications/);
    assert.match(intercept, /hasPushNotifications/);
    assert.match(popup, /render-process-gone/);
    assert.match(popup, /unresponsive/);
    assert.match(bootstrap, /timer=setTimeout\(function\(\)\{finish\(''\);\},250\)/);
    assert.match(bootstrap, /fr\.onabort=function\(\)\{finish\(''\);\}/);
    assert.match(bootstrap, /if\(done\)return;/);
});

test('notification avatar conversion cannot block popup delivery', async () => {
    const src = read('electron/inject/ui/bootstrap.js');
    const start = src.indexOf('function toDataUrl(src){');
    const end = src.indexOf('// Реальный тип чата', start);
    assert.ok(start >= 0 && end > start, 'toDataUrl helper not found');

    const context = vm.createContext({
        Promise,
        setTimeout,
        clearTimeout,
        fetch: () => new Promise(() => {}),
        FileReader: class {},
    });
    vm.runInContext(src.slice(start, end) + '; this.toDataUrl = toDataUrl;', context);

    const started = Date.now();
    assert.equal(await context.toDataUrl('blob:stale-avatar'), '');
    assert.ok(Date.now() - started < 1000, 'stale avatar blocked notification delivery');
});

test('release hardening fuses stay enabled', () => {
    const pkg = JSON.parse(read('package.json'));
    const release = read('scripts/release-build.cjs');
    const workflow = fs.readFileSync(path.join(root, '..', '.github', 'workflows', 'release.yml'), 'utf8');
    const f = pkg.build.electronFuses;
    assert.equal(pkg.build.electronDist, undefined, 'global electronDist breaks clean CI builds');
    assert.equal(f.runAsNode, false);
    assert.equal(f.enableNodeOptionsEnvironmentVariable, false);
    assert.equal(f.enableNodeCliInspectArguments, false);
    assert.equal(f.enableEmbeddedAsarIntegrityValidation, true);
    assert.equal(f.onlyLoadAppFromAsar, true);
    assert.equal(f.grantFileProtocolExtraPrivileges, false);
    assert.match(release, /run\(process\.execPath, \[npmCli, 'test'\]/);
    assert.match(release, /run\(process\.execPath, \[npmCli, 'run', 'test:smoke'\]/);
    assert.match(release, /electron-builder.*out.*cli.*cli\.js/s);
    assert.match(workflow, /npx electron-builder --publish never/);
    assert.doesNotMatch(workflow, /Build release installer[\s\S]{0,180}npm run build/);
    assert.match(workflow, /if \(Test-Path \$notes\)/);
    assert.match(workflow, /--generate-notes --verify-tag --latest/);
    assert.doesNotMatch(release, /WIN_CSC_LINK|CSC_LINK|forceCodeSigning|Authenticode|signingConfigured|Signed release|Unsigned release/i);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /if \(\$releaseId\) \{[\s\S]{0,200}gh release upload \$version \$installer --clobber/);
    assert.match(workflow, /Smoke test packaged app[\s\S]{0,300}TWD_SMOKE_EXE[\s\S]{0,120}npm run test:smoke/);
    assert.match(release, /process\.env\.TWD_SMOKE_EXE = artifacts\[0\]/);
});

test('every release note ships both English and Russian blocks', () => {
    const dir = path.join(root, '..', '.github', 'release-notes');
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
        const text = fs.readFileSync(path.join(dir, file), 'utf8');
        assert.match(text, /<!-- lang:en -->/, `${file} lacks an English block`);
        assert.match(text, /<!-- lang:ru -->/, `${file} lacks a Russian block`);
    }
});

test('updater selects only our installer and never changes versions silently', () => {
    const updater = read('electron/updater.cjs');
    const settings = read('electron/settings.cjs');
    const settingsUi = read('electron/inject/ui/twd-settings-native.js');
    assert.match(settings, /update_check_interval:\s*'24h'/);
    assert.match(updater, /update_check_interval \|\| '24h'/);
    assert.match(updater, /INTERVALS\[key\] \|\| INTERVALS\['24h'\]/);
    assert.match(settingsUi, /update_check_interval\|\|'24h'/);
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
    assert.equal(fs.existsSync(path.join(dir, 'desktop_like_base.js')), true);
    assert.equal(fs.existsSync(path.join(dir, 'desktop_like_common.js')), true);
    assert.equal(fs.existsSync(path.join(dir, 'desktop_like_standard.js')), true);
    assert.equal(fs.existsSync(path.join(dir, 'desktop_like_wide.js')), true);
    assert.equal(fs.existsSync(path.join(dir, 'hide_ads.js')), true);
    assert.equal(fs.existsSync(path.join(dir, 'message_filter.js')), true);
    assert.equal(fs.existsSync(path.join(dir, 'message_history.js')), true);
    assert.match(loader, /appearance_message_layout === 'wide' \|\| s\.appearance_message_layout === 'left'/);
    assert.match(loader, /readFeature\('desktop_like_base\.js'\)/);
    assert.match(loader, /readFeature\('desktop_like_common\.js'\)/);
    assert.ok(loader.indexOf("readFeature('desktop_like_base.js')") < loader.indexOf("readFeature('desktop_like_common.js')"));
    const base = read('electron/features/desktop_like_base.js');
    const common = read('electron/features/desktop_like_common.js');
    const standard = read('electron/features/desktop_like_standard.js');
    const wide = read('electron/features/desktop_like_wide.js');
    assert.match(base, /twd-feature-desktop-base/);
    assert.match(base, /custom-message-avatar/);
    assert.match(base, /is-in-document-group \.message-content\.audio/);
    assert.match(base, /Message\.own:not\(\.is-in-document-group\):has\(\.message-content\.media\)/);
    assert.doesNotMatch(base, /#MiddleColumn #MiddleSearch:not\(\.visually-hidden\)/);
    assert.match(standard, /#MiddleColumn #MiddleSearch:not\(\.visually-hidden\) > :first-child[\s\S]{0,220}top: 16px !important[\s\S]{0,220}left: 0 !important/);
    assert.match(wide, /#MiddleColumn #MiddleSearch:not\(\.visually-hidden\) > :first-child[\s\S]{0,260}top: 16px !important[\s\S]{0,260}left: 1rem !important[\s\S]{0,320}width: calc\(100% - 2rem - var\(--tgdl-rc, 0px\)\) !important/);
    assert.match(common, /window\.__twdDesktopLikeCommon/);
    assert.match(common, /window\.__twdDesktopLikeRuntimeStarted/);
    assert.match(common, /function injectAvatars\(/);
    assert.match(common, /function ensureOwnMediaAppendix\(/);
    assert.match(common, /function syncRightColumn\(/);
    assert.match(standard, /window\.__twdDesktopLikeCommon\(ensureStyles\)/);
    assert.match(wide, /window\.__twdDesktopLikeCommon\(ensureStyles\)/);
    assert.doesNotMatch(standard, /function injectAvatars\(/);
    assert.doesNotMatch(wide, /function injectAvatars\(/);
    assert.match(loader, /window\.__twdHideAdsEnabled=/);
    assert.match(loader, /readFeature\('hide_ads\.js'\)/);
    assert.match(loader, /window\.__twdMessageFilterConfig=/);
    assert.match(loader, /readFeature\('message_filter\.js'\)/);
    assert.match(loader, /message_filter_private === true/);
    assert.match(loader, /message_filter_mark_only === true/);
    assert.match(loader, /window\.__twdMessageHistoryConfig=/);
    assert.match(loader, /readFeature\('message_history\.js'\)/);
    assert.doesNotMatch(loader, /if \(s\.appearance_hide_ads !== false\)/);
    assert.doesNotMatch(loader, /if \(s\.messages_show_deleted/);
    assert.doesNotMatch(addons, /desktop_like|hide_ads|embedded_addons/);
});


test('message filter stays channel-first, keeps private chats opt-in, and separates Telegram sponsored blocks', () => {
    const feature = read('electron/features/message_filter.js');
    const ui = read('electron/inject/ui/twd-settings-native.js');
    const lang = read('electron/inject/ui/lang.js');
    const settings = read('electron/settings.cjs');
    const core = read('electron/inject/ui/core.js');

    assert.match(settings, /message_filter_enabled: false/);
    assert.match(settings, /message_filter_private: false/);
    assert.match(settings, /message_filter_mark_only: false/);
    assert.match(settings, /message_filter_short_disabled: \[\]/);
    assert.match(settings, /message_filter_custom: \[\]/);
    assert.match(feature, /cat==='channel'\|\|\(cat==='private'&&cfg\.includePrivate===true\)/);
    assert.match(feature, /cat==='private'&&msg\.classList\.contains\('own'\)/);
    assert.match(feature, /#\(\?:реклама\|ad\|ads\|advertisement\|advertising\|sponsored\|promo\)/);
    assert.match(feature, /bit\.ly/);
    assert.match(feature, /ali\.pub/);
    assert.match(feature, /_twd-filter-marked_/);
    assert.match(feature, /#ff9800/);
    assert.doesNotMatch(feature, /полит|военн|war|politic/i);

    assert.match(ui, /T\('twd_hide_ads'\)/);
    assert.match(ui, /T\('twd_message_filter_enabled'\)/);
    assert.match(ui, /_twdExpandableFilterGroup/);
    assert.match(ui, /_TWD_FILTER_SHORT_DOMAINS/);
    assert.match(ui, /_TWD_FILTER_REF_DOMAINS/);
    assert.match(ui, /message_filter_custom/);
    assert.match(lang, /Скрывать рекламу внизу чатов/);
    assert.match(lang, /Скрывать рекламные сообщения в каналах/);
    assert.match(lang, /Работает только в каналах/);
    assert.match(lang, /Рекламные хэштеги/);
    assert.match(lang, /Например: #реклама, #ad, #advertisement/);
    assert.match(lang, /Фильтровать входящие сообщения в личных чатах/);
    assert.match(lang, /Фильтр сообщений/);
    assert.match(ui, /filter\.appendChild\(_twdCardDivider\(\)\)/);
    assert.match(core, /_twd-card-divider_/);
    assert.match(core, /_twd-filter-domain-row_\{margin-inline-start:3rem!important;\}/);
    assert.doesNotMatch(core, /_twd-filter-domain-list_\{[^}]*border-(?:top|bottom)/);
});

const { UpstreamHealth, DEFAULT_COOLDOWN_MS } = require('../electron/tg-flowseal-health.cjs');

test('proxy cooldown suppresses failed domains while healthy routes exist', () => {
    let now = 1_000;
    const health = new UpstreamHealth({ cooldownMs: 30_000, now: () => now });
    const candidates = ['a.test', 'b.test', 'c.test'].map(domain => ({ domain }));
    health.seedPreferred('c.test');
    assert.deepEqual(health.rank(candidates).map(x => x.domain), ['c.test', 'a.test', 'b.test']);
    health.markSuccess('a.test');
    assert.deepEqual(health.rank(candidates).map(x => x.domain), ['a.test', 'b.test', 'c.test']);
    health.markFailure('a.test');
    assert.deepEqual(health.rank(candidates).map(x => x.domain), ['b.test', 'c.test']);
    assert.equal(health.isCooling('a.test'), true);
    health.markFailure('b.test');
    health.markFailure('c.test');
    assert.deepEqual(health.rank(candidates).map(x => x.domain), ['a.test', 'b.test', 'c.test']);
    now += 30_001;
    assert.equal(health.isCooling('a.test'), false);
    health.markSuccess('b.test');
    assert.deepEqual(health.rank(candidates).map(x => x.domain), ['b.test', 'a.test', 'c.test']);
    assert.equal(DEFAULT_COOLDOWN_MS, 45_000);
});

test('proxy stall watchdog fires only for a frame frozen mid-transfer', async () => {
    const { WebSocketServer, WebSocket } = require('ws');
    const { watchFrameStall } = require('../electron/tg-flowseal-health.cjs');
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise(r => server.once('listening', r));
    const peers = [];
    server.on('connection', ws => peers.push(ws));
    const url = `ws://127.0.0.1:${server.address().port}`;
    const connect = async () => {
        const ws = new WebSocket(url);
        await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
        await new Promise(r => setTimeout(r, 30));
        return { ws, peer: peers[peers.length - 1] };
    };
    try {
        const idle = await connect();
        let idleStalled = false;
        const stopIdle = watchFrameStall(idle.ws, { stallMs: 150, checkMs: 30, onStall: () => { idleStalled = true; } });
        idle.peer.send(Buffer.alloc(64 * 1024));
        await new Promise(r => setTimeout(r, 400));
        assert.equal(idleStalled, false, 'a quiet socket between frames is healthy');
        stopIdle();

        const frozen = await connect();
        let stalledAfter = 0;
        watchFrameStall(frozen.ws, { stallMs: 150, checkMs: 30, onStall: ms => { stalledAfter = ms; } });
        const header = Buffer.from([0x82, 127, 0, 0, 0, 0, 0, 0x10, 0, 0]);
        frozen.peer._socket.write(Buffer.concat([header, Buffer.alloc(16 * 1024)]));
        await new Promise(r => setTimeout(r, 450));
        assert.ok(stalledAfter >= 150, 'a frame that stops arriving must be reported');
        idle.ws.terminate(); frozen.ws.terminate();
    } finally {
        await new Promise(r => server.close(r));
    }
});

test('proxy upstream opening is hedged instead of racing every domain', async () => {
    const { EventEmitter } = require('node:events');
    const { hedgedOpen, rotateCandidates } = require('../electron/tg-flowseal-health.cjs');
    assert.deepEqual(rotateCandidates(['a', 'b', 'c', 'd', 'e'], 1, 4), ['b', 'c', 'd', 'a', 'e']);
    assert.deepEqual(rotateCandidates(['a', 'b', 'c', 'd', 'e'], 4, 4), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(rotateCandidates(['a'], 3, 4), ['a']);

    const started = [];
    const fake = behavior => candidate => {
        const s = new EventEmitter();
        s.terminate = () => { s.terminated = true; };
        started.push({ domain: candidate.domain, at: Date.now(), s });
        behavior(candidate, s);
        return s;
    };
    const t0 = Date.now();
    const opened = await hedgedOpen(
        ['slow', 'dead', 'good', 'unused'].map(domain => ({ domain })),
        fake((c, s) => {
            if (c.domain === 'dead') setTimeout(() => s.emit('error', new Error('refused')), 10);
            if (c.domain === 'good') setTimeout(() => s.emit('open'), 20);
        }),
        { hedgeMs: 120, maxInFlight: 2, timeoutMs: 2000 }
    );
    assert.equal(opened.candidate.domain, 'good');
    assert.deepEqual(started.map(x => x.domain), ['slow', 'dead', 'good']);
    assert.ok(started[1].at - t0 >= 100, 'second route waits for the hedge delay');
    assert.ok(started[2].at - started[1].at < 80, 'a failed route immediately hands over to the next one');
    assert.equal(started[0].s.terminated, true, 'losing sockets are closed');

    started.length = 0;
    await assert.rejects(
        hedgedOpen([{ domain: 'x' }, { domain: 'y' }], fake((c, s) => setTimeout(() => s.emit('error', new Error('nope')), 5)), { hedgeMs: 1000 }),
        /x: nope; y: nope/
    );
});

test('proxy bridge decodes Telegram transport errors and logs per-socket traffic', () => {
    const { readTransportError } = require('../electron/tg-flowseal-health.cjs');
    const abridged = Buffer.from('efefefef', 'hex');
    const intermediate = Buffer.from('eeeeeeee', 'hex');
    const err = code => { const b = Buffer.alloc(4); b.writeInt32LE(code); return b; };
    assert.equal(readTransportError(Buffer.concat([Buffer.from([1]), err(-404)]), abridged), -404);
    assert.equal(readTransportError(Buffer.concat([Buffer.from([4, 0, 0, 0]), err(-429)]), intermediate), -429);
    assert.equal(readTransportError(Buffer.concat([Buffer.from([1]), err(7)]), abridged), 0);
    assert.equal(readTransportError(Buffer.alloc(40), abridged), 0);
    const bridge = read('electron/tg-flowseal-bridge.cjs');
    assert.match(bridge, /closed by \$\{closedBy \|\| `client \(\$\{code\}\)`\}/);
    assert.match(bridge, /Telegram transport error \$\{transportError\}/);
});

test('proxy health does not add heartbeat traffic and validates routes by MTProto response', () => {
    const bridge = read('electron/tg-flowseal-bridge.cjs');
    assert.doesNotMatch(bridge, /\.ping\s*\(/);
    assert.doesNotMatch(bridge, /['"]pong['"]/i);
    assert.match(bridge, /const controlUpstreamHealth = new UpstreamHealth\(\)/);
    assert.match(bridge, /const mediaUpstreamHealth = new UpstreamHealth\(\)/);
    assert.match(bridge, /health\.seedPreferred\(media \? cfg\.preferredMediaDomain : cfg\.preferredControlDomain\)/);
    assert.match(bridge, /CONTROL_RESPONSE_TIMEOUT_MS = 8_000/);
    assert.match(bridge, /controlUpstreamHealth\.markSuccess\(upstreamCandidate\.domain\)/);
    assert.match(bridge, /reportBridgePreferredDomain\(upstreamCandidate\.domain, false\)/);
    assert.match(bridge, /reportBridgePreferredDomain\(upstreamCandidate\.domain, true\)/);
    assert.match(bridge, /clearBridgePreferredDomain\(domain, media\)/);
    assert.match(bridge, /MEDIA_SLOW_RESPONSE_MS = 3_000/);
    assert.match(bridge, /MEDIA_RESPONSE_TIMEOUT_MS = 10_000/);
    assert.match(bridge, /FRAME_STALL_MS = 12_000/);
    // Idle media sockets (acks without replies) must never be treated as slow routes.
    assert.doesNotMatch(bridge, /THROUGHPUT|startMediaSample|slow media throughput/);
    assert.match(bridge, /watchFrameStall\(upstream,/);
    assert.match(bridge, /hedgedOpen\(candidates,/);
    assert.doesNotMatch(bridge, /index \* 75/);
    assert.match(bridge, /rotateCandidates\(candidates, mediaSpreadCursor\+\+, MEDIA_SPREAD_WIDTH\)/);
    assert.match(bridge, /finishControlProbe\(\)/);
    assert.match(bridge, /control first response timeout/);
    assert.match(bridge, /cfg\.avoidControlDomain/);
    assert.match(bridge, /finishMediaProbe\(\)/);
    assert.match(bridge, /mediaUpstreamHealth\.markSuccess\(upstreamCandidate\.domain\)/);
    assert.match(bridge, /slow media first response/);
    assert.match(bridge, /media first response timeout/);
    const route = read('electron/tg-flowseal-route.cjs');
    const settings = read('electron/settings.cjs');
    const ipc = read('electron/ipc.cjs');
    assert.match(settings, /proxy_last_good_control_domain:\s*''/);
    assert.match(settings, /proxy_last_good_media_domain:\s*''/);
    assert.match(route, /preferredControlDomain/);
    assert.match(route, /preferredMediaDomain/);
    assert.match(route, /reportBridgePreferredDomain/);
    assert.match(route, /clearBridgePreferredDomain/);
    // electron-store rewrites the file per key; proxy bookkeeping must save only changed keys.
    assert.doesNotMatch(route, /saveSettings\(Object\.assign\(\{\}, (?:s|loadSettings\(\))/);
    assert.match(bridge, /if \(!getProxyBootstrap\(\)\.preferredMediaDomain\) reportBridgePreferredDomain/);
    assert.match(ipc, /proxyConfigChanged/);
    assert.match(ipc, /if \(proxyConfigChanged\) configureProxySettings/);
});

test('proxy worker routing is wrapper-based and keeps bridge credentials out of page globals', () => {
    const preload = read('electron/preload.js');
    const worker = read('electron/tg-flowseal-worker.cjs');
    const runtime = read('electron/tg-flowseal-relay-runtime.js');
    assert.match(preload, /crypto\.getRandomValues\(_proxyChannelBytes\)/);
    assert.match(preload, /new Uint8Array\(16\)/);
    assert.match(preload, /__twd_proxy_channel/);
    assert.match(preload, /new BroadcastChannel\(_proxyChannelName\)/);
    const smoke = read('scripts/smoke.cjs');
    assert.match(smoke, /window\.tgBridge && window\.tgBridge\.invoke\("get_proxy_status"\)/);
    assert.doesNotMatch(smoke, /__twdProxyRouter &&/);
    assert.doesNotMatch(preload, /window\.__twdProxyState/);
    assert.doesNotMatch(preload, /__twdProxyRouter/);
    assert.doesNotMatch(preload, /window\.__twdProxyChannel/);
    assert.match(worker, /workerProxyChannel/);
    assert.match(worker, /getProxyBootstrap/);
    assert.match(worker, /__TWD_PROXY_BOOTSTRAP__/);
    assert.match(runtime, /let cfg = __TWD_PROXY_BOOTSTRAP__/);
    assert.doesNotMatch(worker, /patchTelegramTransport/);
    assert.doesNotMatch(worker, /this\\\.client=new WebSocket/);
    assert.match(runtime, /new Proxy\(NativeWebSocket/);
    assert.match(runtime, /construct\(Target, args, newTarget\)/);
    assert.match(runtime, /channel\.postMessage\(\{ __twdProxyHello: true \}\)/);
    assert.doesNotMatch(runtime, /globalThis\.__twdFlowsealRoute|globalThis\.__twdFlowsealAttach/);
});

test('proxy runtime routes the first Telegram socket from synchronous bootstrap', () => {
    const source = read('electron/tg-flowseal-relay-runtime.js')
        .replace('__TWD_PROXY_CHANNEL__', JSON.stringify('__twd_proxy_test'))
        .replace('__TWD_PROXY_BOOTSTRAP__', JSON.stringify({
            active: true,
            bridgePort: 43210,
            bridgeToken: 'boot-token',
            reconnectEpoch: 0,
        }));
    let constructedUrl = '';
    class MockWebSocket {
        constructor(url) { constructedUrl = String(url); this.readyState = 1; }
        addEventListener() {}
        close() {}
    }
    MockWebSocket.OPEN = 1;
    MockWebSocket.CONNECTING = 0;
    class MockBroadcastChannel {
        postMessage() {}
    }
    const context = {
        BroadcastChannel: MockBroadcastChannel,
        WebSocket: MockWebSocket,
        URL,
        URLSearchParams,
        console: { log() {}, warn() {} },
    };
    vm.createContext(context);
    vm.runInContext(source, context);

    new context.WebSocket('wss://zws2.web.telegram.org/apiws');
    assert.match(constructedUrl, /^ws:\/\/127\.0\.0\.1:43210\/apiws\?/);
    assert.match(constructedUrl, /dc=2/);
    assert.match(constructedUrl, /token=boot-token/);
});

test('global unread and typing privacy defaults are off and RPC guard is injected before invoke', () => {
    const settings = read('electron/settings.cjs');
    const ipc = read('electron/ipc.cjs');
    const preload = read('electron/preload.js');
    const ui = read('electron/inject/ui/twd-settings-native.js');
    const lang = read('electron/inject/ui/lang.js');
    const runtime = read('electron/tg-flowseal-relay-runtime.js');
    const { patchTelegramPrivacy } = require('../electron/tg-flowseal-worker.cjs');

    assert.match(settings, /privacy_no_read_receipts:\s*false/);
    assert.match(settings, /privacy_no_typing:\s*false/);
    assert.match(settings, /privacy_no_read_force_on:\s*\[\]/);
    assert.match(settings, /privacy_no_read_force_off:\s*\[\]/);
    assert.match(settings, /privacy_no_typing_force_on:\s*\[\]/);
    assert.match(settings, /privacy_no_typing_force_off:\s*\[\]/);
    assert.match(settings, /PRIVACY_PEER_LIST_KEYS/);
    assert.match(settings, /'privacy_no_read_receipts','privacy_no_typing'/);
    assert.match(ipc, /get_privacy_bootstrap/);
    assert.match(ipc, /privacy-state-changed/);
    assert.match(preload, /get_privacy_bootstrap/);
    assert.match(preload, /__twdPrivacyConfig/);
    assert.match(preload, /privacy_allow_read_once/);
    assert.match(preload, /__twdPrivacyAllowReadOnce/);
    assert.match(preload, /peerId/);
    assert.match(ui, /twd_no_read/);
    assert.match(ui, /twd_no_typing/);
    assert.match(ui, /function _twdPrivacyPeerIds\(s\)/);
    assert.match(ui, /function _twdPrivacyEffective\(s,peerId,baseKey,onKey,offKey\)/);
    assert.match(ui, /function _twdPrivacyPatchRule\(s,peerId,baseKey,onKey,offKey,next\)/);
    assert.match(ui, /function _twdResolvePrivacyPeers\(ids\)/);
    assert.match(ui, /page==='privacy_peers'/);
    assert.match(ui, /_twdNavigateNative\('privacy_peers'\)/);
    assert.match(ui, /_genIconButton\('eye'/);
    assert.match(ui, /_genIconButton\('edit'/);
    assert.match(ui, /_twd-privacy-toggle_/);
    assert.match(ui, /aria-pressed/);
    assert.match(ui, /return page==='privacy_peers'\?'messages':'root'/);
    assert.match(ui, /privacy_no_read_force_on','privacy_no_read_force_off','privacy_no_typing_force_on','privacy_no_typing_force_off/);
    assert.match(ui, /function _twdSwitchRow\(ctx,title,sub,checked,onChange\)[\s\S]*?_genToggle\(title,!!checked,onChange,sub\|\|''\)/);
    assert.doesNotMatch(ui, /_genSwitcher\(/);
    assert.doesNotMatch(read('electron/inject/ui/native-panels.js'), /_genSwitcher\(/);
    assert.doesNotMatch(read('electron/inject/ui/ui-lab.js'), /_genSwitcher\(/);
    assert.doesNotMatch(read('electron/inject/ui/settings-render.js'), /function _genSwitcher\(/);
    assert.match(lang, /Нечиталка везде/);
    assert.match(lang, /Неписалка везде/);
    assert.match(lang, /Менеджер нечиталки\/неписалки/);
    assert.match(lang, /Управление исключениями для отдельных чатов/);
    assert.match(ui, /privacy\.appendChild\(_genNativeSettingRow\(ctx\.liEl,T\('twd_privacy_personal'\)/);
    assert.doesNotMatch(ui, /_twdStaticRow\(ctx,T\('twd_privacy_personal'\)/);
    assert.match(lang, /twd_show_messages_desc:\{ru:'Отображаются до обновления страницы или перезапуска приложения'/);
    assert.match(lang, /twd_save_messages_desc:\{ru:'Сохраняются в локальном хранилище для последующего просмотра через меню действий с чатом'/);
    assert.doesNotMatch(lang, /twd_show_deleted_desc|twd_show_disappearing_desc|twd_save_deleted_desc|twd_save_disappearing_desc/);
    assert.match(ui, /visibility\.appendChild\(_twdPassiveText\(T\('twd_show_messages_desc'\)\)\)/);
    assert.match(ui, /saved\.appendChild\(_twdPassiveText\(T\('twd_save_messages_desc'\)\)\)/);
    assert.match(lang, /Нечиталка включена/);
    assert.match(lang, /Неписалка выключена/);
    assert.match(read('electron/inject/ui/core.js'), /_twd-privacy-toggle_\._twd-off_\{opacity:\.35;\}/);
    assert.match(read('electron/inject/ui/core.js'), /_twd-privacy-peer-avatar_/);
    assert.match(lang, /Включить нечиталку/);
    assert.match(lang, /Выключить неписалку/);
    const bootstrap = read('electron/inject/ui/bootstrap.js');
    assert.match(bootstrap, /_twd-chat-privacy-read_/);
    assert.match(bootstrap, /_twdNativeMenuSeparator\(host\)/);
    assert.match(read('electron/inject/ui/inject.js'), /function _twdNativeMenuSeparator\(preferredRoot\)/);
    assert.doesNotMatch(read('electron/inject/ui/core.js'), /_twd-chat-privacy-separator_/);
    assert.match(read('electron/inject/ui/core.js'), /_twd-crossed-pencil_::after/);
    assert.match(bootstrap, /typingOn\?'icon-edit'\:'icon-edit _twd-crossed-pencil_'/);
    assert.match(bootstrap, /readOn\?'icon-eye'\:'icon-eye-crossed'/);
    assert.match(read('electron/inject/ui/core.js'), /border-radius:0!important/);
    assert.match(bootstrap, /privacy_no_read_force_off/);
    assert.match(bootstrap, /_twd-unread-keep_/);
    assert.match(bootstrap, /MutationObserver\(restoreUnreadBadges\)/);
    assert.match(bootstrap, /__twdClearUnreadKeep/);
    assert.match(runtime, /messages\.readhistory/);
    assert.match(runtime, /channels\.readhistory/);
    assert.match(runtime, /messages\.readdiscussion/);
    assert.match(runtime, /messages\.readmessagecontents/);
    assert.match(runtime, /channels\.readmessagecontents/);
    assert.match(runtime, /messages\.settyping/);
    assert.match(runtime, /allowReadOnceUntil/);
    assert.match(runtime, /allowed explicit/);
    assert.match(runtime, /__twdPrivacyAllowReadOnce/);
    assert.match(runtime, /actionName\.includes\('emojiinteraction'\)/);
    assert.match(read('electron/tg-flowseal-worker.cjs'), /Telegram RPC hook was not found in the MTProto worker/);

    const fixture = 'async function $(e,t={}){let x=1;try{let t=await Lg.invoke(e,i,d,c);return gm(t),!r&&fc(t)&&$m(t),u?t&&!0:t}catch(t){return}}';
    const patched = patchTelegramPrivacy(fixture);
    assert.equal(patched.patched, true);
    assert.match(patched.body, /__twdPrivacyShouldBlock\(e\)\)return;let t=await Lg\.invoke\(e,i,d,c\)/);

});

test('personal privacy manager rules collapse back to the global default', () => {
    const ui = read('electron/inject/ui/twd-settings-native.js');
    const start = ui.indexOf('function _twdPrivacyEffective');
    const end = ui.indexOf('function _twdPrivacyInitials');
    assert.ok(start >= 0 && end > start);
    const context = {};
    vm.createContext(context);
    vm.runInContext(ui.slice(start, end), context);

    const baseOff = {
        privacy_no_read_receipts: false,
        privacy_no_read_force_on: ['101'],
        privacy_no_read_force_off: [],
    };
    assert.equal(context._twdPrivacyEffective(baseOff, '101', 'privacy_no_read_receipts', 'privacy_no_read_force_on', 'privacy_no_read_force_off'), true);
    const offPatch = context._twdPrivacyPatchRule(baseOff, '101', 'privacy_no_read_receipts', 'privacy_no_read_force_on', 'privacy_no_read_force_off', false);
    assert.deepEqual(Array.from(offPatch.privacy_no_read_force_on), []);
    assert.deepEqual(Array.from(offPatch.privacy_no_read_force_off), []);

    const baseOn = {
        privacy_no_read_receipts: true,
        privacy_no_read_force_on: [],
        privacy_no_read_force_off: ['202'],
    };
    assert.equal(context._twdPrivacyEffective(baseOn, '202', 'privacy_no_read_receipts', 'privacy_no_read_force_on', 'privacy_no_read_force_off'), false);
    const onPatch = context._twdPrivacyPatchRule(baseOn, '202', 'privacy_no_read_receipts', 'privacy_no_read_force_on', 'privacy_no_read_force_off', true);
    assert.deepEqual(Array.from(onPatch.privacy_no_read_force_on), []);
    assert.deepEqual(Array.from(onPatch.privacy_no_read_force_off), []);
});


test('extended chat pins add five local slots on top of the account pin limit', () => {
    const pins = require('../electron/tg-extended-pins.cjs');
    const prelude = pins.extendedPinsPrelude(true);
    assert.doesNotThrow(() => new Function(prelude));
    assert.match(prelude, /slice\(0,15\)/);
    assert.match(prelude, /limit\(s\)\{return this\.cap\(s\)\+5\}/);
    assert.match(prelude, /cur\.length>=this\.limit\(s\)/);
    assert.match(prelude, /isPremium===true\?10:5/);
    assert.match(prelude, /serverAfter\(before,next,id,pin,cap\)/);
    assert.match(prelude, /inc=uniq\(\[\.\.\.pins,\.\.\.\(f\.includedChatIds\|\|\[\]\)\]\)/);

    const storage = new Map();
    const context = {
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
        },
    };
    vm.createContext(context);
    vm.runInContext(prelude, context);
    const api = context.__twdExtendedPins;
    assert.equal(api.toggle({}, {}, { id: '1' }, null), false, 'without patched reducers Telegram keeps native pinning');
    context.__twdExtendedPinsReducersReady = true;
    const chats = Object.fromEntries(['1','2','3','4','5','6','7'].map(id => [id, { id, folderId: 0 }]));
    const state = {
        currentUserId: '99',
        users: { byId: { '99': { isPremium: false } } },
        chats: { byId: chats, orderedPinnedIds: { active: ['1','2','3','4','5'], archived: [] } },
        chatFolders: { byId: {} },
    };
    const updates = [];
    const rpcCalls = [];
    const actions = { apiUpdate(update) { updates.push(update); } };
    const rpc = (...args) => { rpcCalls.push(args); return Promise.resolve(); };

    assert.equal(api.toggle(state, actions, { id: '6', folderId: 0 }, rpc), true);
    let saved = JSON.parse(storage.get('__twd_extended_pins_v1'));
    assert.deepEqual(Array.from(saved.accounts['99'].orders['0']), ['6','1','2','3','4','5']);
    assert.deepEqual(Array.from(saved.accounts['99'].server['0']), ['1','2','3','4','5']);
    assert.equal(rpcCalls.length, 0, 'the sixth local pin must not reshuffle a full server pin set');

    assert.equal(api.toggle(state, actions, { id: '6', folderId: 0 }, rpc), true);
    saved = JSON.parse(storage.get('__twd_extended_pins_v1'));
    assert.deepEqual(Array.from(saved.accounts['99'].orders['0']), ['1','2','3','4','5']);
    assert.deepEqual(Array.from(saved.accounts['99'].server['0']), ['1','2','3','4','5']);
    assert.equal(rpcCalls.length, 0, 'pinning then unpinning a local extra must be server-neutral');

    state.chatFolders.byId[2] = {
        id: 2,
        pinnedChatIds: ['1','2','3','4','5'],
        includedChatIds: Array.from({ length: 30 }, (_, i) => String(100 + i)),
    };
    chats['6'].folderId = 2;
    updates.length = 0;
    assert.equal(api.toggle(state, actions, { id: '6', folderId: 2 }, rpc), true);
    assert.ok(updates[0].folder.includedChatIds.length > 15, 'extended pins must not truncate ordinary folder members');
    assert.equal(rpcCalls.length, 0, 'an extra local folder pin must not rewrite a full server pin set');

    const actionSource = 'z(`toggleChatPinned`,(e,n,r)=>{let{ id:i }=r,s=w(e,i);R(`toggleChatPinned`,{chat:s,shouldBePinned:true})}),z(`toggleChatArchived`,()=>{})';
    const action = pins.patchTelegramExtendedPins(actionSource);
    assert.equal(action.actionPatched, true);
    assert.match(action.body, /__twdExtendedPins\.toggle\(e,n,r,R\)/);

    const settings = read('electron/settings.cjs');
    const windowSource = read('electron/window.cjs');
    const ui = read('electron/inject/ui/twd-settings-native.js');
    assert.match(settings, /messages_extended_pins: false/);
    assert.match(settings, /'messages_extended_pins'/);
    assert.match(windowSource, /injectTelegramExtendedPins/);
    assert.match(windowSource, /injectExtendedPinsPrelude/);
    assert.match(ui, /twd_extended_pins/);
    assert.match(ui, /_twdSetExtendedPins/);
});

test('privacy explicit read bypass and per-peer overrides stay scoped to one peer', () => {
    const source = read('electron/tg-flowseal-relay-runtime.js')
        .replace('__TWD_PROXY_CHANNEL__', JSON.stringify('__twd_proxy_test'))
        .replace('__TWD_PROXY_BOOTSTRAP__', JSON.stringify({ active: true, bridgePort: 12345, bridgeToken: 'token', reconnectEpoch: 0 }));
    let channel = null;
    class MockBroadcastChannel {
        constructor() { channel = this; }
        postMessage() {}
    }
    const context = {
        BroadcastChannel: MockBroadcastChannel,
        WebSocket: undefined,
        URL,
        URLSearchParams,
        console: { log() {}, warn() {} },
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    assert.ok(channel && typeof channel.onmessage === 'function');

    const config = {
        noReadReceipts: true,
        noTyping: true,
        noReadForceOn: [],
        noReadForceOff: [],
        noTypingForceOn: [],
        noTypingForceOff: [],
    };
    channel.onmessage({ data: { __twdPrivacyConfig: config } });

    const readReq = id => ({
        className: 'messages.ReadHistory',
        peer: { className: 'InputPeerUser', userId: id },
    });
    const typingReq = id => ({
        className: 'messages.SetTyping',
        peer: { className: 'InputPeerUser', userId: id },
        action: { className: 'SendMessageTypingAction' },
    });

    assert.equal(context.__twdPrivacyShouldBlock(readReq(101)), true);
    assert.equal(context.__twdPrivacyShouldBlock(typingReq(101)), true);

    channel.onmessage({ data: { __twdPrivacyAllowReadOnce: '101' } });
    assert.equal(context.__twdPrivacyShouldBlock(readReq(101)), false);
    assert.equal(context.__twdPrivacyShouldBlock(readReq(202)), true);

    channel.onmessage({ data: { __twdPrivacyConfig: {
        ...config,
        noReadForceOff: ['101'],
        noTypingForceOff: ['101'],
    } } });
    assert.equal(context.__twdPrivacyShouldBlock(readReq(101)), false);
    assert.equal(context.__twdPrivacyShouldBlock(typingReq(101)), false);
    assert.equal(context.__twdPrivacyShouldBlock(readReq(202)), true);
    assert.equal(context.__twdPrivacyShouldBlock(typingReq(202)), true);
});

test('manual launch maximizes while autostart stays hidden', () => {
    const main = read('main.cjs');
    const win = read('electron/window.cjs');
    const settings = read('electron/settings.cjs');
    assert.match(main, /isAutostartLaunch/);
    assert.match(main, /TWD_DEV_PROFILE/);
    assert.match(main, /TWD_ALLOW_MULTI_INSTANCE === '1'/);
    assert.match(main, /remote-debugging-port/);
    assert.ok(main.indexOf("app.setPath('userData'") < main.indexOf("require('./electron/window.cjs')"));
    assert.match(main, /--autostart/);
    assert.match(main, /--hidden/);
    assert.match(main, /showMainWindow\(win, true\)/);
    assert.match(main, /startHidden: initialAutostart/);
    assert.doesNotMatch(main, /powerSaveBlocker|disable-renderer-backgrounding|disable-background-timer-throttling|disable-backgrounding-occluded-windows/);
    assert.match(win, /backgroundThrottling: false/);
    assert.match(win, /const startHidden = options\.startHidden === true/);
    assert.match(win, /ready-to-show/);
    assert.match(win, /mainWindow\.maximize\(\)/);
    assert.match(win, /process\.env\.TWD_SMOKE_HIDDEN === '1' \|\| startHidden/);
    assert.match(settings, /minimize_to_tray:\s*true/);
    assert.match(win, /if \(settings\.minimize_to_tray\) \{[\s\S]*e\.preventDefault\(\);[\s\S]*mainWindow\.hide\(\)/);
});

test('startup surface follows the persisted Telegram theme without a blocking overlay', () => {
    const win = read('electron/window.cjs');
    const bootstrap = read('electron/inject/ui/bootstrap.js');
    const settings = read('electron/settings.cjs');
    assert.match(settings, /appearance_startup_theme:\s*'dark'/);
    assert.match(settings, /STARTUP_THEMES = new Set\(\['light','dark'\]\)/);
    assert.match(win, /function injectStartupSurface\(body, theme\)/);
    assert.doesNotMatch(win, /twd-startup-loader/);
    assert.match(win, /backgroundColor: startupBackground\(startupTheme\(initialSettings\)\)/);
    assert.match(win, /injectStartupSurface\(body, startupTheme\(loadSettings\(\)\)\)/);
    assert.match(bootstrap, /function installStartupThemeSync\(\)/);
    assert.match(bootstrap, /classList\.contains\('theme-dark'\)/);
    assert.match(bootstrap, /appearance_startup_theme:theme/);
});

test('custom UI stays inside Telegram Settings and keeps native navigation semantics', () => {
    const core = read('electron/inject/ui/core.js');
    const scripts = read('electron/scripts.cjs');
    const inject = read('electron/inject/ui/inject.js');
    const panels = read('electron/inject/ui/native-panels.js');
    const settings = read('electron/inject/ui/settings-render.js');
    const twd = read('electron/inject/ui/twd-settings-native.js');
    const notifications = read('electron/inject/ui/notifications-settings.js');
    const bootstrap = read('electron/inject/ui/bootstrap.js');
    const modal = read('electron/inject/ui/modal.js');
    const lang = read('electron/inject/ui/lang.js');
    const preload = read('electron/preload.js');
    const ipc = read('electron/ipc.cjs');
    const baseLayout = read('electron/features/desktop_like_base.js');
    const wide = read('electron/features/desktop_like_wide.js');
    const standard = read('electron/features/desktop_like_standard.js');
    const largeIcons = ['settings','messages','notifications','proxy','data','info','download','addons','trash_bin'];
    largeIcons.forEach(name => assert.equal(fs.existsSync(path.join(root, 'electron', 'assets', 'icons', name + '.svg')), true));
    assert.match(scripts, /LARGE_ICON_NAMES/);
    assert.match(scripts, /__twdLargeSvgIcons/);
    assert.match(settings, /function _largeSvgGlyph\(/);
    assert.match(settings, /__twdLargeSvgIcons\[icon\]/);
    assert.doesNotMatch(twd, /'visual_interface'/);
    assert.match(twd, /'messages'/);
    assert.match(twd, /'proxy'/);
    assert.match(twd, /'data'/);
    assert.match(twd, /'trash_bin'/);
    assert.match(inject, /'_tgst_ad_','addons'/);

    assert.match(inject, /_tgmi_twd_/);
    assert.match(inject, /Telegram Web Desktop/);
    assert.match(inject, /tgSettings\.after\(twd\)/);
    assert.match(inject, /openTwdNative\('root'\)/);
    assert.match(inject, /_tgst_twd_/);
    assert.match(inject, /_tgst_dl_/);
    assert.match(inject, /_tgst_ad_/);
    assert.match(inject, /_tgst_modinfo_/);
    assert.match(inject, /'_tgst_modinfo_','info',T\('sec_about'\)/);
    assert.match(inject, /Telegram Web Desktop · v/);
    assert.match(inject, /icon-settings-filled/);
    assert.match(inject, /openTwdNative\('root'\)/);
    assert.match(inject, /openDownloadsNative\(\)/);
    assert.match(inject, /openAddonsNative\(\)/);
    assert.doesNotMatch(inject, /_tgst_proxy_[\s\S]*openProxyNative/);

    assert.match(twd, /function openTwdNative\(/);
    assert.match(twd, /openNativePanel\(/);
    assert.match(twd, /handleBack/);
    assert.match(twd, /function _twdNativeParent\(page\)/);
    assert.match(twd, /_twdNavigateNative\(_twdNativeParent\(_twdNativePage\),true\)/);
    assert.match(twd, /appearance_message_layout/);
    assert.match(twd, /_genNativeSettingRow\(ctx\.liEl,T\('twd_layout'\)/);
    assert.doesNotMatch(twd, /function _twdRenderAppearance\(/);
    assert.doesNotMatch(twd, /\['appearance','visual_interface'/);
    assert.match(twd, /ctx\.section\(T\('twd_message_display'\),display\)/);
    assert.match(twd, /ctx\.section\(T\('twd_message_visibility'\),visibility\)/);
    assert.match(lang, /twd_message_display:\{ru:'Чаты'/);
    assert.match(lang, /twd_message_visibility:\{ru:'Отображение сообщений'/);
    assert.match(lang, /twd_message_storage:\{ru:'История сообщений'/);
    assert.match(lang, /twd_extended_pins:\{ru:'Расширенные закрепления чатов'/);
    assert.ok(twd.indexOf("ctx.section(T('twd_message_visibility'),visibility)") < twd.indexOf("ctx.section(T('twd_privacy'),privacy)"), 'message visibility must sit directly after the first chat section');
    assert.doesNotMatch(twd, /_twdStaticRow\(ctx,T\('twd_layout'/);
    assert.match(twd, /messages_show_deleted/);
    assert.match(twd, /messages_show_disappearing/);
    assert.match(twd, /messages_save_deleted/);
    assert.match(twd, /messages_save_disappearing/);
    const messagesSection=twd.slice(twd.indexOf('function _twdRenderMessages'),twd.indexOf('function _twdNotificationPreviewIcon'));
    const dataSection=twd.slice(twd.indexOf('function _twdRenderData'),twd.indexOf('function _twdRenderAbout'));
    assert.doesNotMatch(messagesSection, /twd_clear_history/);
    assert.match(dataSection, /twd_clear_history/);
    assert.match(twd, /messages_edit_history/);
    assert.match(twd, /messages_save_public/);
    assert.match(twd, /T\('twd_save_public'\)/);
    assert.match(twd, /messages_history_scope/);
    assert.match(twd, /twd_history_limits/);
    assert.match(twd, /_twdPassiveText\(T\('twd_history_limits'\)\)/);
    assert.match(twd, /function _twdConfigureHistory\(/);
    assert.match(twd, /function _twdSetHideAds\(/);
    assert.match(twd, /footerNote:T\('twd_reload_notice'\)/);
    assert.match(twd, /INV\('apply_features'\)/);
    assert.match(twd, /function _twdDropExtendedPinScriptCache\(/);
    assert.match(twd, /\^tt-assets\(\?:\$\|-\)/);
    assert.match(twd, /caches\.delete\(name\)/);
    assert.doesNotMatch(twd.slice(twd.indexOf('function _twdDropExtendedPinScriptCache'),twd.indexOf('function _twdSetExtendedPins')), /tt-media|tt-media-avatars/);
    assert.match(twd, /_twdDropExtendedPinScriptCache\(\)\.then\(function\(\)\{return INV\('prepare_extended_pins'\);\}\)/);
    assert.match(preload, /'prepare_extended_pins'/);
    assert.match(ipc, /handle\('prepare_extended_pins', async/);
    const pinPrep=ipc.slice(ipc.indexOf("handle('prepare_extended_pins'"),ipc.indexOf("handle('apply_features'"));
    assert.match(pinPrep, /reloadIgnoringCache\(\)/);
    assert.doesNotMatch(pinPrep, /\.clearStorageData\(|\.clearCache\(|storages:\s*\['cachestorage'\]/);
    assert.doesNotMatch(twd, /_twdFeatureApplyBar|_twd-apply-bar_|twd_apply/);
    assert.doesNotMatch(panels, /_twd-apply-bar_|ad_apply/);
    assert.match(panels, /footerNote:T\('twd_reload_notice'\)/);
    assert.match(panels, /INV\('apply_addons'\)/);
    assert.match(modal, /dialog-footer-note/);
    assert.match(modal, /footerNote/);
    assert.match(core, /_twd-clarification_[^{]*\{[^}]*border-top/);
    assert.doesNotMatch(lang, /twd_history_scope_desc/);
    const ruVisibleStrings=[...lang.matchAll(/ru:'((?:\\.|[^'])*)'/g)].map(m=>m[1].replace(/<[^>]*>/g,''));
    ruVisibleStrings.forEach(text=>assert.doesNotMatch(text,/\"/,'Russian visible UI text must use «ёлочки», not straight quotes'));
    assert.match(lang, /twd_save_deleted:\{ru:'Сохранять удалённые сообщения'/);
    assert.doesNotMatch(lang, /twd_save_deleted:\{ru:'Сохранять все удалённые сообщения'/);
    assert.match(lang, /twd_save_public:\{ru:'Сохранять публичные чаты'/);
    assert.match(lang, /twd_history_scope:\{ru:'Хранить историю'/);
    assert.match(lang, /twd_history_scope_chat:\{ru:'Пока открыт чат'/);
    assert.match(lang, /twd_history_scope_client:\{ru:'Пока открыто приложение'/);
    assert.match(lang, /twd_history_scope_always:\{ru:'Даже когда приложение в трее'/);
    assert.doesNotMatch(lang, /twd_history_scope:\{ru:'Метод сохранения сообщений'/);
    assert.match(lang, /twd_edit_history_desc:\{ru:'Для просмотра выберите соответствующий пункт в меню действий с сообщением\.'/);
    assert.doesNotMatch(lang, /twd_edit_history_desc:\{ru:'[^']*«\(ред\.\)»/);
    assert.doesNotMatch(lang, /в зависимости от режима «Как сохранять»/);
    assert.match(twd, /value:'chat'/);
    assert.match(twd, /value:'client'/);
    assert.match(twd, /value:'always'/);
    assert.match(twd, /function _twdRangeRow\(/);
    assert.match(twd, /function _twdRangeRow[\s\S]*_genNativeSettingRow\(ctx\.liEl,title,sub\|\|'','',null\)/);
    assert.doesNotMatch(twd, /function _twdRangeRow[\s\S]*?_twdStaticRow\(ctx,title,sub\|\|''/);
    assert.match(twd, /function _twdWrapNativePage\(/);
    assert.match(twd, /function _twdCloneInnerPage\(/);
    assert.match(twd, /async function _twdNavigateNative\(page,backwards\)/);
    assert.match(twd, /_twd-page-forward-from_/);
    assert.match(twd, /_twd-page-back-from_/);
    assert.match(core, /_twd-native-page_\._twd-page-forward-to_[^{]*\{[^}]*slide-in-200/);
    assert.match(core, /_twd-native-page_\._twd-page-back-to_[^{]*\{[^}]*push-out-backwards/);
    assert.match(twd, /var _twdSaveQueue=Promise\.resolve\(\)/);
    assert.match(twd, /_twdSaveQueue=_twdSaveQueue\.catch/);
    assert.match(twd, /input\.type='range'/);
    assert.match(twd, /notif_duration:Math\.round\(v\)/);
    assert.match(twd, /var rawVolume=Number\(s\.notif_volume\)/);
    assert.match(twd, /Number\.isFinite\(rawVolume\)\?rawVolume:0\.8/);
    assert.doesNotMatch(twd, /Number\(s\.notif_volume\)\|\|0\.8/);
    assert.match(twd, /notif_volume:Math\.max\(0,Math\.min\(100,v\)\)\/100/);
    assert.doesNotMatch(twd, /\['updates','reload'/);
    assert.doesNotMatch(twd, /if\(page==='updates'\)/);
    assert.match(twd, /function _twdAppendUpdates\(/);
    assert.match(twd, /function _twdRenderAbout[\s\S]*_twdAppendUpdates\(content,ctx,s\)/);
    assert.match(twd, /renderProxyNative\(content\)/);
    assert.match(twd, /openChangelogNative\('about'\)/);
    assert.match(panels, /function openChangelogNative\(returnPage\)/);
    assert.match(panels, /if\(returnPage==='about'\) openTwdNative\('about'\)/);
    assert.doesNotMatch(twd, /position:fixed;inset:0|_twd_settings_root_/);

    assert.match(panels, /panel\._titleEl=h3/);
    assert.match(panels, /panel\._content=content/);
    assert.match(panels, /opts\.handleBack/);
    assert.match(panels, /renderDownloadsNative[\s\S]{0,1700}save_path/);
    assert.match(panels, /renderDownloadsNative[\s\S]{0,1700}open_folder_dialog/);
    assert.match(panels, /function _clSelectLanguage\(notes\)/);
    assert.match(panels, /<!--\\s\*lang\\s\*:/);
    assert.match(panels, /function _clMarkdownLines\(notes\)/);
    assert.match(panels, /line\.match\(\/\^#\{1,6\}\\s\+\(\.\+\)\$\//);
    assert.match(panels, /_clPlainMarkdown/);
    assert.doesNotMatch(panels, /String\(v\.notes\|\|''\)\.split\(\/\\r\?\\n\//);
    assert.doesNotMatch(panels, /function openAppSettingsNative/);

    assert.match(bootstrap, /setupNativeWidgetCapture\(\)/);
    assert.match(bootstrap, /let bound=null, boundObserver=null, seq=0/);
    assert.match(bootstrap, /if\(boundObserver\)\{boundObserver\.disconnect\(\);boundObserver=null;\}/);
    assert.doesNotMatch(bootstrap, /setupNotificationSettingsSync\(\)/);
    assert.match(bootstrap, /__tgOpenAppSettings=function\(\)\{ try\{ openTwdNative\('root'\)/);
    assert.doesNotMatch(notifications, /injectNotifBlock|injectGeneralSettings|injectAboutSection/);
    assert.doesNotMatch(settings, /function injectGeneralSettings|function injectAboutSection|function renderSt/);

    assert.match(settings, /_TWD_FILLED_GLYPHS/);
    assert.match(core, /Use Telegram Web A's own settings keyframes/);
    assert.match(core, /slide-in-200 var\(--slide-transition/);
    assert.match(core, /slide-in-200-backwards var\(--slide-transition/);
    assert.match(core, /push-out var\(--slide-transition/);
    assert.match(core, /push-out-backwards var\(--slide-transition/);
    assert.match(core, /transform:translateX\(200%\)/);
    assert.match(core, /_twd-range-control_\{[^}]*width:22rem;[^}]*flex:0 0 22rem/);
    assert.match(core, /_twd-range-input_/);
    assert.match(core, /accent-color:var\(--color-primary/);
    assert.doesNotMatch(core, /@keyframes _twd-settings-/);
    assert.match(panels, /addEventListener\('animationend',finishBack\)/);
    assert.match(panels, /querySelectorAll\('\._twd-under_,\._twd-under-back_'\)/);

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
    assert.match(wide, /MessageList \.messages-container[\s\S]{0,500}padding-left: 0 !important/);
    assert.match(standard, /MessageList \.messages-container[\s\S]{0,260}padding-left: 0 !important/);
    assert.match(baseLayout, /is-in-document-group \.message-content\.audio[\s\S]{0,240}translateX\(45px\)/);
    assert.match(baseLayout, /Message\.own:not\(\.is-in-document-group\):has\(\.message-content\.media\) \.message-content-wrapper[\s\S]{0,260}justify-content: flex-start/);
    assert.doesNotMatch(wide, /is-in-document-group \.message-content\.audio/);
    assert.doesNotMatch(standard, /is-in-document-group \.message-content\.audio/);
});

test('message history keeps memory independent from local persistence scope', () => {
    const feature = read('electron/features/message_history.js');
    const ipc = read('electron/ipc.cjs');
    const preload = read('electron/preload.js');
    assert.equal(fs.existsSync(path.join(root, 'electron/message-history.cjs')), false);
    assert.match(ipc, /get_history_bootstrap/);
    assert.match(ipc, /savePublic: s\.messages_save_public === true/);
    assert.match(ipc, /handle\('get_window_state'/);
    assert.match(ipc, /win\.isVisible\(\)/);
    assert.match(ipc, /win\.isMinimized\(\)/);
    assert.match(ipc, /message-history\.json/);
    assert.doesNotMatch(ipc, /handle\('history_sync'/);
    assert.doesNotMatch(ipc, /handle\('history_mark_deleted'/);
    assert.match(preload, /historyHandleWorkerMessage/);
    assert.match(preload, /function historyEnabled\(\)/);
    assert.match(preload, /c\.showDeleted === true[\s\S]{0,180}c\.editHistory === true/);
    assert.doesNotMatch(preload, /const historyEnabled = true/);
    assert.match(preload, /__twd_history_config/);
    assert.match(preload, /this\.addEventListener\('message', historyHandleWorkerMessage\)/);
    assert.match(preload, /update\['@type'\] === 'deleteMessages'/);
    assert.match(preload, /update\['@type'\] === 'newMessage' \|\| update\['@type'\] === 'updateMessage'/);
    assert.match(preload, /historyByMessageId\.set/);
    assert.match(preload, /function historyIsServerMessageId\(messageId\)/);
    assert.match(preload, /return Number\.isInteger\(Number\(messageId\)\)/);
    assert.match(preload, /if \(!historyIsServerMessageId\(messageId\)\) \{[\s\S]{0,100}remaining\.push\(rawId\);[\s\S]{0,100}return;/);
    assert.match(preload, /if \(!item && active\) item = historyDomSnapshot\(active, messageId\)/);
    assert.match(preload, /function historyIsPrivate\(chatId\)/);
    assert.match(preload, /function historyChatAllowed\(chatId\)/);
    assert.match(preload, /historyConfig && historyConfig\.savePublic === true/);
    assert.match(preload, /!historyChatAllowed\(chatId\)/);
    assert.match(preload, /!historyChatAllowed\(item\.chatId\)/);
    assert.match(feature, /function historyEnabled\(\)/);
    assert.doesNotMatch(feature, /if \(!cfg\.showDeleted && !cfg\.showDisappearing && !cfg\.saveDeleted && !cfg\.saveDisappearing && !cfg\.editHistory\) return/);
    assert.match(feature, /function isServerMessageId\(messageId\)/);
    assert.match(feature, /return Number\.isInteger\(Number\(messageId\)\)/);
    assert.match(feature, /discardedLocal=true/);
    assert.match(feature, /function isValidChatId\(chatId\)/);
    assert.match(feature, /function isPrivateChatId\(chatId\)/);
    assert.match(feature, /function historyChatAllowed\(chatId\)/);
    assert.match(feature, /cfg\.savePublic === true/);
    assert.match(feature, /!historyChatAllowed\(chatId\)/);
    assert.match(feature, /!isValidChatId\(rec\.chatId\)/);
    assert.match(feature, /!isValidChatId\(x\.chatId\)/);
    assert.match(feature, /function shouldPersistEvent\(chatId\)/);
    assert.match(feature, /get_window_state/);
    assert.match(feature, /state\.visible === true \|\| state\.minimized === true/);
    assert.doesNotMatch(feature, /state\.visible === true && state\.minimized !== true/);
    assert.match(feature, /savedEdits/);
    assert.match(feature, /persistEditIfAllowed/);
    assert.match(feature, /persistDeletionIfAllowed/);
    assert.match(feature, /localStorage\.setItem\(PERSIST_KEY/);
    assert.doesNotMatch(feature, /enforceChatScope/);
    assert.doesNotMatch(preload, /historyScopeAllows/);
    assert.match(preload, /IDBObjectStore\.prototype\.put/);
    assert.doesNotMatch(preload, /'history_sync'/);
    assert.doesNotMatch(feature, /setInterval\(scan/);
    assert.doesNotMatch(feature, /querySelectorAll\('#MiddleColumn \.Message\[data-message-id\]:not/);
    assert.match(feature, /document\.addEventListener\('contextmenu'/);
    assert.match(feature, /MessageContextMenu_items/);
    assert.match(feature, /_twd-edit-history-menu_/);
    assert.match(feature, /window\.__twdFitMenuViewport\(items\)/);
    assert.match(read('electron/inject/ui/core.js'), /window\.__twdFitMenuViewport=_twdFitMenuViewport/);
    assert.doesNotMatch(feature, /_twd-edit-history-badge_/);
    assert.match(feature, /domTextSnapshots/);
    assert.match(feature, /trackDomMessage/);
    assert.match(feature, /messageListObserver\.observe\(list,\{childList:true,subtree:true,attributes:true,attributeFilter:\['class'\]\}\)/);
    assert.doesNotMatch(feature, /characterData: true/);
    assert.match(feature, /Посмотреть изменения/);
    assert.match(feature, /View changes/);
    assert.match(feature, /recordsByChat/);
    assert.match(feature, /deletedDomSnapshots/);
    assert.match(feature, /domTextSnapshots\.delete\(key\)/);
    assert.match(feature, /html: clone\.outerHTML/);
    assert.doesNotMatch(feature, /node: clone/);
    assert.match(feature, /tpl\.innerHTML=String\(snapshot\.html\)\.trim\(\)/);
    assert.match(preload, /const HISTORY_MAX_RECORDS = 5000/);
    assert.match(preload, /const historyDeletedOrder = \[\]/);
    assert.match(preload, /while \(historyDeletedOrder\.length > HISTORY_MAX_RECORDS\)/);
    assert.match(feature, /deletedDomSnapshotsByChat/);
    assert.match(feature, /messageListObserver\.observe\(list/);
    assert.match(feature, /setInterval\(bindMessageList,1000\)/);
    assert.match(feature, /queueBindMessageList/);
    assert.match(feature, /__twdHistoryWrapped/);
    assert.doesNotMatch(feature, /messageListHostObserver/);
    assert.doesNotMatch(feature, /\.observe\(document\.body/);
    assert.match(feature, /is-deleting/);
    assert.match(feature, /is-dissolving/);
    assert.match(feature, /mutation\.removedNodes\.forEach\(inspectRemoved\)/);
    assert.match(feature, /\.message-content:has\(>\._twd-deleted-trash_\)/);
    assert.match(feature, /outline:2px dashed var\(--color-error,#e65b5b\)/);
    assert.doesNotMatch(feature, /toLocaleString\(\)/);
    assert.match(feature, /_twd-deleted-trash_/);
    assert.match(feature, /quick-reaction/);
    assert.match(feature, /stripDeletedReactionMenu/);
    assert.match(feature, /ReactionSelector/);
    assert.match(feature, /pointer-events:none!important/);
    assert.match(feature, /icon icon-delete/);
    assert.doesNotMatch(feature, /_twd-deleted-mark_/);
    assert.doesNotMatch(feature, /trash_bin/);
    assert.match(feature, /className = '_mo_ _twd-history-native_'/);
    assert.doesNotMatch(feature, /_twd-history-native_ \.modal-dialog/);
    assert.match(feature, /window\.__twdMessageHistoryApi/);
    assert.match(feature, /configure: function \(next\)/);
    assert.match(feature, /if\(historyEnabled\(\)\)startAddedObserver\(\);else stopAddedObserver\(\)/);
    assert.match(feature, /function stopAddedObserver\(\)/);
    assert.match(feature, /if\(historyEnabled\(\)\)startAddedObserver\(\);/);
    assert.match(feature, /reconcileDeletedVisibility\(\)/);
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
    assert.match(twd, /_wireUiLabUnlock\(ver\)/);
    assert.doesNotMatch(twd, /_wireUiLabUnlock\(lab\)/);
    assert.doesNotMatch(twd, /_twdStaticRow\(ctx,'UI Lab'/);
    assert.match(twd, /ctx\.section\(T\('twd_app_section'\),card\)/);
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
    assert.match(notif, /function positionWin\(win\)/);
    assert.match(notif, /win\.setPosition\(wa\.x \+ wa\.width - WIDTH - MARGIN, wa\.y \+ wa\.height - STACK_HEIGHT - MARGIN/);
    assert.match(notif, /if \(_win && !_win\.isDestroyed\(\)\) \{ positionWin\(_win\); return _win; \}/);
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
    assert.match(notif, /function firstGlyph\(s\)/);
    assert.match(notif, /Array\.from\(String\(s\|\|''\)\.trim\(\)\)/);
    assert.match(notif, /function initials\(s\)/);
    assert.match(notif, /firstGlyph\(words\[0\]\)/);
    assert.match(notif, /firstGlyph\(words\[words\.length-1\]\)/);
    assert.match(notif, /function avatarColor\(peerId,title\)/);
    assert.match(notif, /avatarColor\(data\.peerId,title\)/);
    assert.match(notif, /data\.anon\?firstLetter\(title\):initials\(title\)/);
    assert.match(settings, /notif_hide_avatar:\s*false/);
    assert.match(settings, /'notif_hide_sender','notif_hide_avatar'/);
    assert.match(ipc, /const hideAvatar = hideSender \|\| settings\.notif_hide_avatar === true/);
    assert.match(ipc, /icon: hideAvatar \? '' : icon/);
    assert.match(ipc, /handle\('preview_notification'/);
    assert.match(ipc, /hidden-text/);
    assert.match(ipc, /hidden-sender/);
    assert.match(ipc, /hidden-all/);
    assert.match(ipc, /'settings'/);
    assert.match(ipc, /const settingsPreview = variant === 'settings'/);
    assert.match(ipc, /const explicit = previewSettings && typeof previewSettings === 'object'/);
    assert.match(ipc, /explicit \? explicit\.hideSender === true : settings\.notif_hide_sender === true/);
    assert.match(ipc, /explicit \? explicit\.hideText === true : settings\.notif_hide_text === true/);
    assert.match(ipc, /explicit \? explicit\.hideAvatar === true : settings\.notif_hide_avatar === true/);
    assert.match(ipc, /Number\.isFinite\(Number\(explicit\.duration\)\)/);
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
    const twdSettings = read('electron/inject/ui/twd-settings-native.js');
    const lang = read('electron/inject/ui/lang.js');
    assert.match(twdSettings, /T\('ns_hide_avatar'\)/);
    assert.match(twdSettings, /notif_hide_avatar/);
    assert.match(twdSettings, /function _twdPreviewCurrentNotification\(\)/);
    assert.match(twdSettings, /await _twdSaveQueue\.catch/);
    assert.match(twdSettings, /var current=await INV\('get_settings'\)/);
    assert.match(twdSettings, /mode:'settings'/);
    assert.match(twdSettings, /previewSettings:\{/);
    assert.match(twdSettings, /hideText:current\.notif_hide_text===true/);
    assert.match(twdSettings, /hideSender:current\.notif_hide_sender===true/);
    assert.match(twdSettings, /hideAvatar:current\.notif_hide_avatar===true/);
    assert.match(twdSettings, /__twd_preview_notification_sound/);
    assert.match(twdSettings, /T\('twd_notif_check'\)/);
    assert.match(lang, /ns_hide_avatar:[^\n]*Скрывать аватарки входящих сообщений/);
    assert.match(lang, /twd_notif_check:\{ru:'Проверить'/);
    assert.match(lang, /twd_notif_check_desc:[^\n]*звука, времени и приватности/);
});

test('notification category filter distinguishes Telegram channels from groups', () => {
    const bootstrap = read('electron/inject/ui/bootstrap.js');
    assert.match(bootstrap, /function playSound\(force\)/);
    assert.match(bootstrap, /var _nativeMediaPlay=null/);
    assert.match(bootstrap, /force&&typeof _nativeMediaPlay==='function'\?_nativeMediaPlay\.call\(a\):a\.play\(\)/);
    assert.match(bootstrap, /if\(!force&&Date\.now\(\)-lastTgSound<1500\)return/);
    assert.match(bootstrap, /__twd_preview_notification_sound/);
    assert.match(bootstrap, /refreshCfg\(\)\.then\(function\(\)\{playSound\(true\);\}\)/);
    assert.match(bootstrap, /function currentPeer\(\)[\s\S]{0,120}location\.hash[\s\S]{0,80}#\(-\?\\d\+\)/);
    assert.match(bootstrap, /function domAvatar\(pid\)[\s\S]{0,420}a\[href\^=\"#\"\][\s\S]{0,220}chatId===want/);
    assert.match(bootstrap, /indexedDB\.open\('tt-data'\)/);
    assert.match(bootstrap, /\^tt-global-state\(\?:_\\d\+\)\?\$/);
    assert.match(bootstrap, /type==='chatTypeChannel'.*return 'channel'/s);
    assert.match(bootstrap, /type==='chatTypeBasicGroup'\|\|type==='chatTypeSuperGroup'.*return 'group'/s);
    assert.match(bootstrap, /resolveChatCategory\(pid\)\.then/);
    assert.doesNotMatch(bootstrap, /var cat = \(pid\.charAt\(0\)==='-'\) \? 'group' : 'private'/);
});

test('notification backlog stays memory-bounded if the popup renderer is unavailable', () => {
    const popup = read('electron/notification.cjs');
    assert.match(popup, /const MAX_PENDING = 32/);
    assert.match(popup, /if \(_pending\.length > MAX_PENDING\) _pending\.splice\(0, _pending\.length - MAX_PENDING\)/);
    assert.match(popup, /const MAX_ICON_DATA_URL = 2 \* 1024 \* 1024/);
});

test('detached Telegram media releases decoder and canvas backing resources', () => {
    const feature = read('electron/features/media_cleanup.js');
    const loader = read('electron/features.cjs');
    assert.match(loader, /readFeature\('media_cleanup\.js'\)/);
    assert.match(feature, /mutation\.removedNodes\.forEach\(collect\)/);
    assert.match(feature, /if \(root\.parentElement && !root\.parentElement\.isConnected\) return/);
    assert.match(feature, /el\.srcObject = null/);
    assert.match(feature, /el\.removeAttribute\('src'\)/);
    assert.match(feature, /el\.width = 0/);
    assert.match(feature, /el\.height = 0/);
    assert.match(feature, /__twdDetachedMediaStats/);
});

test('Telegram media cache patch evicts only unreferenced blob URLs and keeps diagnostics', () => {
    const sample = 'var vt=new Map,yt=new Map;function Ct(e){return vt.get(e)}' +
        'async function Ot(e){let n=`blob:a`;vt.set(e,n);if(!n)throw Error(`Failed to fetch media ${e}`);' +
        'let l=`blob:b`;return vt.set(e,l),l}async function kt(e){vt.delete(e);await Promise.resolve()}';
    const patched = patchTelegramMediaCache(sample);
    assert.equal(patched.patched, true);
    assert.match(patched.body, /__twdMediaCacheSet/);
    assert.match(patched.body, /__twdMediaCacheDrop/);
    assert.match(patched.body, /__twdMediaCacheRefs/);
    assert.match(patched.body, /globalThis\.__twdMediaCacheStats/);
    assert.match(patched.body, /if\([^)]*\.size<=96\)return/);
    assert.match(patched.body, /if\([^)]*\.size<=64\)break/);
    assert.match(patched.body, /refs\.has\(v\)/);
    assert.match(patched.body, /URL\.revokeObjectURL\(v\)/);

    const win = read('electron/window.cjs');
    assert.match(win, /injectTelegramMediaCache/);
    assert.match(win, /WEB_ASSET_PATCH_REVISION = 'pins-v7'/);
    assert.match(win, /clearStorageData\(\{ origin: 'https:\/\/web\.telegram\.org', storages: \['cachestorage'\] \}\)/);
    assert.doesNotMatch(win, /storages: \[[^\]]*(?:cookies|indexdb|localstorage)/);
});

test('Telegram notifications are not held hostage by avatar downloads or a missing SW controller', async () => {
    const { patchTelegramNotifications } = require('../electron/tg-notification-patch.cjs');
    const sample = 'async function gt(e){return globalThis.avatar(e)}function K(){return!0}' +
        'function G(){return globalThis.state}function A(){return globalThis.actions}function W(){return{hasWebNotifications:!0}}' +
        'async function yt({chat:e,message:t,isReaction:r=!1}){let i=G(),{hasWebNotifications:a}=W(i);if(!t)return;' +
        'let d=await gt(e),{title:f,body:p}={title:`T`,body:`B`};if(K())navigator.serviceWorker?.controller&&' +
        'navigator.serviceWorker.controller.postMessage({type:`showMessageNotification`,payload:{title:f,body:p,icon:d,chatId:e.id}});' +
        'else{let n=A(),o={body:p,icon:d};new Notification(f,o)}}globalThis.notify=yt;export{yt as t};';
    const patched = patchTelegramNotifications(sample);
    assert.equal(patched.iconPatched, true);
    assert.equal(patched.sinkPatched, true);
    assert.equal(patched.runtimeExposed, true, 'Web A getGlobal/getActions are published for the desktop UI');
    assert.equal(patchTelegramNotifications(patched.body).body, patched.body, 'patch is idempotent');

    const delivered = [];
    const context = {
        setTimeout, Promise,
        navigator: { serviceWorker: { controller: null } },
        avatar: () => new Promise(() => {}),
        __twdConsumeSwNotification: m => { delivered.push(m); return true; },
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(patched.body.replace(/export\{[^}]*\};?/, ''), context);
    const startedAt = Date.now();
    context.state = { chats: {} };
    context.actions = { openChat() {} };
    assert.equal(context.__twdTelegramRuntime.getGlobal(), context.state);
    assert.equal(context.__twdTelegramRuntime.getActions(), context.actions);
    await context.notify({ chat: { id: '-100' }, message: { id: 7 } });
    assert.ok(Date.now() - startedAt < 3000, 'a hung avatar download is bounded');
    const core = read('electron/inject/ui/core.js');
    assert.match(core, /var rt=window\.__twdTelegramRuntime/);
    assert.match(read('electron/inject/ui/bootstrap.js'), /if\(byId\[id\]&&byId\[id\]\.isForum\)\{/);
    assert.equal(delivered.length, 1, 'notification is delivered without a service-worker controller');
    assert.equal(delivered[0].type, 'showMessageNotification');
    assert.equal(delivered[0].payload.icon, undefined);

    const intercept = read('electron/inject/notif-intercept.js');
    assert.match(intercept, /window\.__twdConsumeSwNotification = consumeServiceWorkerNotification/);
    assert.match(intercept, /function scheduleOrphanDrain\(\)/);
    const popup = read('electron/notification.cjs');
    assert.match(popup, /Promise\.race\(\[a\.finished\.catch\(function\(\)\{\}\),wait\(duration\+250\)\]\)/);
    assert.match(popup, /win\.webContents\.on\('did-fail-load', drop\)/);
    assert.match(popup, /!_ready && Date\.now\(\) - _createdAt > READY_TIMEOUT_MS/);
    const bootstrap = read('electron/inject/ui/bootstrap.js');
    assert.match(bootstrap, /chatTypeLoad=new Promise\(function\(resolve\)\{\s*\/\/[^\n]*\n\s*setTimeout\(resolve,3000\);/);
    const win = read('electron/window.cjs');
    assert.equal((win.match(/resp = await injectTelegramNotifications\(resp, url\);/g) || []).length, 2);
});

test('inline media load/cancel buttons never open a save-to-disk download card', () => {
    const bootstrap = read('electron/inject/ui/bootstrap.js');
    const trigger = bootstrap.slice(bootstrap.indexOf('function isDownloadTrigger'), bootstrap.indexOf('document.addEventListener(\'click\', function(e){', bootstrap.indexOf('function isDownloadTrigger')));
    assert.match(trigger, /\.media-inner,\.RoundVideo,\.media-loading/);
    const exclusion = trigger.indexOf('.media-inner');
    assert.ok(exclusion > 0 && exclusion < trigger.indexOf('.icon-download'), 'media exclusion runs before icon matching');
});

test('desktop layouts keep Telegram composer wrap whenever a reply/edit/forward bar exists', () => {
    const base = read('electron/features/desktop_like_base.js');
    assert.match(base, /\.Composer:not\(\.with-embedded\):not\(:has\(\.ComposerEmbeddedMessage\)\) \{\s*flex-wrap: nowrap !important;/);
    assert.doesNotMatch(base, /\.Composer:not\(\.with-embedded\) \{/);
});

test('downloads never share a target path, never delete foreign files, and carry Mark-of-the-Web', () => {
    const os = require('node:os');
    const { uniquePath, reservePath, markFromInternet } = require('../electron/utils.cjs');
    const { deleteDownload } = require('../electron/downloads.cjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twd-dl-test-'));
    try {
        const first = uniquePath(path.join(dir, 'x.pdf'));
        const release = reservePath(first);
        const second = uniquePath(path.join(dir, 'x.pdf'));
        assert.notEqual(second, first, 'an in-flight download reserves its name');
        release();
        assert.equal(uniquePath(path.join(dir, 'x.pdf')), first);

        assert.equal(sanitizeFilename('NUL.tar.gz'), '_NUL.tar.gz');
        assert.equal(sanitizeFilename('com1.txt'), '_com1.txt');
        assert.equal(sanitizeFilename('console.log'), 'console.log');

        const newer = path.join(dir, 'report.pdf');
        fs.writeFileSync(newer, 'B');
        const list = [
            { id: 1, path: newer, status: 'cancelled' },
            { id: 2, path: newer, status: 'completed' },
        ];
        deleteDownload(list, 1);
        assert.equal(fs.existsSync(newer), true, 'deleting a cancelled record keeps the newer file with the same name');
        const own = path.join(dir, 'own.pdf');
        fs.writeFileSync(own, 'C');
        deleteDownload([{ id: 3, path: own, status: 'completed' }], 3);
        assert.equal(fs.existsSync(own), false, 'a completed record still deletes its own file');

        if (process.platform === 'win32') {
            const saved = path.join(dir, 'doc.zip');
            fs.writeFileSync(saved, 'Z');
            if (markFromInternet(saved)) assert.match(fs.readFileSync(saved + ':Zone.Identifier', 'utf8'), /ZoneId=3/);
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    const ipc = read('electron/ipc.cjs');
    assert.match(ipc, /const releasePath = reservePath\(dest\)/);
    assert.match(ipc, /await fs\.promises\.rename\(item\.temp, item\.dest\);\s*markFromInternet\(item\.dest\);/);
    assert.match(read('electron/window.cjs'), /const releasePath = reservePath\(item\.getSavePath\(\)\)/);
});

test('message history never removes Telegram-owned nodes, stays under a storage budget, and keeps savePublic', () => {
    const history = read('electron/features/message_history.js');
    assert.doesNotMatch(history, /else node\.remove\(\);|else \{ msg\.remove\(\); return; \}/);
    assert.match(history, /function hideDeletedNode\(node\) \{\s*if \(node\.classList\.contains\('_twd-deleted-clone_'\)\) node\.remove\(\);/);
    assert.match(history, /'\._twd-deleted-hidden_\{display:none!important;\}'/);
    assert.match(history, /var MAX_PERSIST_CHARS = 1500000;/);
    assert.match(history, /size \+ parts\[start - 1\]\.length \+ 1 <= MAX_PERSIST_CHARS/);
    assert.match(read('electron/features.cjs'), /savePublic: s\.messages_save_public === true/);
});

test('Web A fallback latch recovers and offline failures never latch it', () => {
    const win = read('electron/window.cjs');
    const route = read('electron/tg-flowseal-route.cjs');
    assert.match(win, /if \(!net\.isOnline\(\)\) throw e;\s*noteTelegramLoadFailure/);
    assert.match(win, /clearWebFallbackLatch\(\)\) \{\s*console\.log\('\[TG-PROXY\] direct Web A reachable again/);
    assert.match(win, /webContents\.on\('did-fail-load', \(_event, code, description, _url, isMainFrame\) => \{/);
    assert.match(win, /code === -3/);
    assert.match(route, /function clearWebFallbackLatch\(\) \{[\s\S]{0,160}saveSettings\(\{ proxy_web_fallback_latched: false \}\)/);
});

test('settings saves keep main-owned state and do not re-arm update prompts', () => {
    const ipc = read('electron/ipc.cjs');
    const updater = read('electron/updater.cjs');
    assert.match(ipc, /const MAIN_OWNED_SETTINGS = \['proxy_auto_latched', 'proxy_web_fallback_latched', 'proxy_last_good_control_domain', 'proxy_last_good_media_domain', 'skipped_version'\]/);
    assert.match(ipc, /for \(const k of MAIN_OWNED_SETTINGS\) delete next\[k\];/);
    assert.match(ipc, /if \(current\.update_check_interval !== state\.settings\.update_check_interval\) scheduleChecks\(\);/);
    assert.match(updater, /if \(!_downloadInFlight\) \{\s*_downloadInFlight = downloadPendingUpdateOnce\(onProgress\)\.finally/);
});

test('patched MTProto worker is never stored in the service-worker cache', async () => {
    const { injectTelegramWorkerProxy } = require('../electron/tg-flowseal-worker.cjs');
    const url = 'https://web.telegram.org/a/worker-abc.js?__twd_proxy=1&__twd_proxy_channel=__twd_proxy_' + 'a'.repeat(32);
    const Module = require('node:module');
    const origLoad = Module._load;
    Module._load = function (request, ...rest) {
        if (request === 'electron') return { webContents: { getAllWebContents: () => [] }, net: {} };
        if (request.endsWith('settings.cjs')) return { loadSettings: () => ({}), saveSettings: () => {} };
        return origLoad.call(this, request, ...rest);
    };
    try {
        const res = await injectTelegramWorkerProxy(new Response('self.x=1;', { headers: { 'content-type': 'text/javascript' } }), url);
        assert.equal(res.headers.get('vary'), '*');
        assert.match(await res.text(), /self\.x=1;/);
    } finally {
        Module._load = origLoad;
    }
    assert.match(read('electron/inject/ui/bootstrap.js'), /if\(\/__twd_proxy_channel=\/\.test\(k\.url\)\)c\.delete\(k\);/);
});

test('notification flag repair rewrites Telegram state only when a flag changed', () => {
    const intercept = read('electron/inject/notif-intercept.js');
    assert.match(intercept, /if\(changed\)\{ needsReload=true; try\{ c\.update\(v\); \}catch\(e\)\{\} \}/);
    assert.doesNotMatch(intercept, /needsReload=true; \}\s*try\{ c\.update\(v\); \}catch\(e\)\{\}\s*\}/);
});

test('a notification arriving during the last fade-out re-shows the popup', () => {
    const popup = read('electron/notification.cjs');
    assert.match(popup, /_win\.setShape\(\[\{ x: 0, y: STACK_HEIGHT - height, width: WIDTH, height \}\]\);[\s\S]{0,200}if \(!_win\.isVisible\(\) && process\.env\.TWD_SMOKE_HIDDEN !== '1'\) _win\.showInactive\(\);/);
});

test('updater only trusts our HTTPS release assets with a matching digest', async () => {
    const os = require('node:os');
    const crypto = require('node:crypto');
    const Module = require('node:module');
    const origLoad = Module._load;
    Module._load = function (request, ...rest) {
        if (request === 'electron') return { app: { getVersion: () => '1.3.2', getPath: () => os.tmpdir() }, net: {}, powerMonitor: { on() {} } };
        if (request === 'electron-store') return { default: class { constructor() { this.store = {}; } get(k, d) { return d; } has() { return false; } set() {} delete() {} } };
        return origLoad.call(this, request, ...rest);
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twd-upd-test-'));
    try {
        delete require.cache[require.resolve('../electron/updater.cjs')];
        delete require.cache[require.resolve('../electron/settings.cjs')];
        const { compareVersions, parseLatestYml, verifyDownload, assertAllowedHost, isInstallerAssetName } = require('../electron/updater.cjs')._internals;
        assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
        assert.ok(compareVersions('1.2.7-beta', '1.2.7') < 0);
        assert.equal(compareVersions('v1.3.2'.replace(/^v/, ''), '1.3.2'), 0);

        const yml = 'version: 1.3.3\nfiles:\n  - url: Telegram-Web-Desktop-Setup-1.3.3.exe\n    sha512: abc==\n    size: 42\n';
        assert.deepEqual(parseLatestYml(yml, 'Telegram-Web-Desktop-Setup-1.3.3.exe'), { sha512: 'abc==', size: 42 });

        const ok = 'https://github.com/Sidiusz/Telegram-Web-Desktop/releases/download/1.3.3/Telegram.Web.Desktop.Setup.1.3.3.exe';
        assert.doesNotThrow(() => assertAllowedHost(ok));
        for (const bad of [ok.replace('https:', 'http:'), ok.replace('github.com', 'github.com.evil.io'), ok.replace('Sidiusz/Telegram-Web-Desktop', 'someone/else')]) {
            assert.throws(() => assertAllowedHost(bad));
        }
        assert.equal(isInstallerAssetName('Telegram.Web.Desktop.Setup.1.3.3.exe'), true);
        assert.equal(isInstallerAssetName('Telegram.Web.Desktop.Setup.1.3.3.exe.blockmap'), false);

        const exe = path.join(dir, 'setup.exe');
        const body = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(4096)]);
        fs.writeFileSync(exe, body);
        const digest = 'sha256:' + crypto.createHash('sha256').update(body).digest('hex');
        await verifyDownload(exe, body.length, null, digest);
        await assert.rejects(verifyDownload(exe, body.length, null, ''), /trusted update digest is unavailable/);
        await assert.rejects(verifyDownload(exe, body.length, null, 'sha256:' + '0'.repeat(64)), /digest mismatch/);
        const notExe = path.join(dir, 'fake.exe');
        fs.writeFileSync(notExe, Buffer.concat([Buffer.from('PK'), crypto.randomBytes(4096)]));
        await assert.rejects(verifyDownload(notExe, 4098, null, digest), /not a Windows installer/);
    } finally {
        Module._load = origLoad;
        delete require.cache[require.resolve('../electron/updater.cjs')];
        delete require.cache[require.resolve('../electron/settings.cjs')];
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('bundle patches fail safe: pins need every reducer, cache patch keeps identifier boundaries', () => {
    const { patchTelegramExtendedPins, extendedPinsPrelude } = require('../electron/tg-extended-pins.cjs');
    const partial = patchTelegramExtendedPins('case`updatePinnedChatIds`:let{ids:a,folderId:b}=c,d=b===1?`archived`:`active`;return x;case`updatePinnedSavedDialogIds`:');
    assert.equal(partial.body.includes('__twdExtendedPinsReducersReady'), false, 'a half-patched reducer set must not enable local pin takeover');
    assert.match(extendedPinsPrelude(true), /toggle\(s,a,p,rpc\)\{if\(!this\.enabled\|\|!globalThis\.__twdExtendedPinsReducersReady\)return false;/);
    const sample = 'var vt=new Map,o={vt:new Map};function Ct(e){return vt.get(e)}function Ot(e,n){o.vt.set(e,n);Xvt.set(e,n);vt.set(e,n);if(!n)throw Error(`Failed to fetch media ${e}`);return vt.set(e,n),n}' +
        'async function kt(e){vt.delete(e);await 0}var Xvt=new Map;';
    const patched = patchTelegramMediaCache(sample);
    assert.equal(patched.patched, true);
    assert.match(patched.body, /o\.vt\.set\(e,n\);Xvt\.set\(e,n\);__twdMediaCacheSet\(e,n\)/);
    assert.match(read('electron/tg-flowseal-route.cjs'), /try \{ ws\.close\(1000, 'test'\); \} catch \(_\) \{\}/);
});

test('main process survives late download events and cleans interrupted blob saves', () => {
    const win = read('electron/window.cjs');
    const ipc = read('electron/ipc.cjs');
    assert.doesNotMatch(win, /mainWindow\.webContents\.send\('download-event'/);
    assert.match(win, /function sendDownloadEvent\(payload\) \{\s*const win = getWindow\(\);/);
    assert.match(win, /webContents\.on\('console-message', \(event\) => \{\s*const message = String\(event\.message \|\| ''\);/);
    assert.match(ipc, /event\.sender\.once\('render-process-gone', item\.senderDestroyedHandler\);/);
    assert.match(ipc, /event\.sender\.on\('did-start-navigation', item\.senderNavigationHandler\);/);
    assert.match(ipc, /item\.sender\.removeListener\('did-start-navigation', item\.senderNavigationHandler\)/);
});

test('settings are read once per load and written once per save', () => {
    const Module = require('node:module');
    const origLoad = Module._load;
    const stores = [];
    class FakeStore {
        constructor(opts) { this.name = opts && opts.name; this.data = {}; this.reads = 0; this.writes = 0; stores.push(this); }
        get store() { this.reads++; return JSON.parse(JSON.stringify(this.data)); }
        get(k, d) { this.reads++; return k in this.data ? this.data[k] : d; }
        has(k) { return k in this.data; }
        set(k, v) { this.writes++; if (k && typeof k === 'object') Object.assign(this.data, k); else this.data[k] = v; }
        delete(k) { this.writes++; delete this.data[k]; }
    }
    Module._load = function (request, ...rest) {
        if (request === 'electron-store') return { default: FakeStore };
        return origLoad.call(this, request, ...rest);
    };
    try {
        delete require.cache[require.resolve('../electron/settings.cjs')];
        const { loadSettings, saveSettings } = require('../electron/settings.cjs');
        const main = stores.find(s => s.name === 'settings');
        main.data._builtin_features_migrated_131 = true;
        main.reads = 0;
        const s = loadSettings();
        assert.equal(s.proxy_mode, 'auto');
        assert.ok(main.reads <= 2, `loadSettings read the file ${main.reads} times`);
        main.writes = 0;
        saveSettings(Object.assign({}, s, { notif_sound: false, proxy_mode: 'always' }));
        assert.equal(main.writes, 1, 'a full snapshot save is one write');
        assert.equal(main.data.proxy_mode, 'always');
        saveSettings(loadSettings());
        assert.equal(main.writes, 1, 'saving unchanged settings writes nothing');
        saveSettings({ notif_volume: 'loud' });
        assert.equal(main.writes, 1, 'invalid values are ignored');
    } finally {
        Module._load = origLoad;
        delete require.cache[require.resolve('../electron/settings.cjs')];
    }
});

test('every injected script compiles exactly as it is shipped', () => {
    const Module = require('node:module');
    const origLoad = Module._load;
    Module._load = function (request, ...rest) {
        if (request === 'electron') return { app: { isPackaged: false } };
        return origLoad.call(this, request, ...rest);
    };
    try {
        delete require.cache[require.resolve('../electron/scripts.cjs')];
        const { getScripts } = require('../electron/scripts.cjs');
        const { loadFeatureScripts } = require('../electron/features.cjs');
        const scripts = getScripts();
        for (const name of ['UI_JS', 'NOTIF_INTERCEPT_JS', 'AUDIO_JS', 'EXTERNAL_JS']) {
            assert.doesNotThrow(() => new vm.Script(scripts[name], { filename: name }), `${name} must parse`);
        }
        for (const layout of ['native', 'left', 'wide']) {
            loadFeatureScripts({ appearance_message_layout: layout, message_filter_enabled: true }).forEach((code, i) => {
                assert.doesNotThrow(() => new vm.Script(code, { filename: `${layout}-feature-${i}` }), `${layout} feature ${i} must parse`);
            });
        }
    } finally {
        Module._load = origLoad;
    }
    const panels = read('electron/inject/ui/native-panels.js');
    assert.match(panels, /msgHtml:T\('dl_clear_m'\)/);
    assert.match(panels, /msgHtml:'«'\+_escHtml\(String\(d\.filename\|\|''\)\)/);
    assert.match(panels, /if\(content\.__twdDlSig===sig&&content\.childElementCount\)return;/);
    assert.match(read('electron/inject/ui/twd-settings-native.js'), /input\.maxLength=160;/);
    assert.match(read('electron/inject/ui/bootstrap.js'), /function waitBody\(cb\)\{const run=\(\)=>\{try\{cb\(\);\}catch\(e\)/);
});

test('external link hook never bypasses Telegram link confirmation or double-opens', () => {
    const source = read('electron/inject/external.js');
    const opened = [];
    let clickHandler = null;
    const anchor = { href: 'https://example.com/secret' };
    const context = {
        URL,
        document: { addEventListener: (type, fn) => { if (type === 'click') clickHandler = fn; } },
        window: { open: () => 'native', tgBridge: { invoke: (cmd, args) => { opened.push([cmd, args.url]); return Promise.resolve(); } } },
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    const click = defaultPrevented => ({
        defaultPrevented, target: { closest: () => anchor },
        preventDefault() {}, stopImmediatePropagation() {},
    });
    clickHandler(click(true));
    assert.deepEqual(opened, [], 'a click Telegram already handled (confirmation modal) must not open the browser');
    clickHandler(click(false));
    assert.deepEqual(opened, [['open_url', 'https://example.com/secret']], 'unhandled external anchors still open externally');
});

test('message filter can hide hidden bot/invite hyperlinks without hiding channel footers', () => {
    const filter = read('electron/features/message_filter.js');
    const settings = read('electron/settings.cjs');
    const features = read('electron/features.cjs');
    const ui = read('electron/inject/ui/twd-settings-native.js');
    const lang = read('electron/inject/ui/lang.js');
    assert.match(filter, /\.text-content a\.text-entity-link\[href\]/);
    assert.match(filter, /function signatureKeys\(messages\)/);
    assert.match(filter, /hiddenDisabled:\['external'\]/);
    assert.match(settings, /message_filter_hidden_links: true/);
    assert.match(settings, /message_filter_hidden_disabled: \['external'\]/);
    assert.match(settings, /MESSAGE_FILTER_HIDDEN_KINDS = new Set\(\['bots','invites','external'\]\)/);
    assert.match(features, /hiddenLinks: s\.message_filter_hidden_links !== false/);
    assert.match(ui, /message_filter_hidden_disabled:'hiddenDisabled'/);
    assert.match(ui, /T\('twd_message_filter_hidden_'\+kind\)/);
    for (const key of ['hidden', 'hidden_desc', 'hidden_bots', 'hidden_invites', 'hidden_external']) {
        assert.match(lang, new RegExp(`twd_message_filter_${key}:\\{ru:`));
    }
});

test('Telegram media cache never hands back a revoked blob for a fresh or on-screen entry', () => {
    const sample = 'var vt=new Map;function Ct(e){return vt.get(e)}' +
        'function Ot(e,n){if(!n)throw Error(`Failed to fetch media ${e}`);vt.set(e,n);return vt.set(e,n),n}' +
        'async function kt(e){vt.delete(e);await Promise.resolve()}globalThis.api={Ct,Ot,kt,vt};';
    const patched = patchTelegramMediaCache(sample);
    assert.equal(patched.patched, true);
    let clock = 1_000_000;
    const onScreen = new Set();
    const revoked = new Set();
    const context = {
        Date: { now: () => clock },
        URL: { revokeObjectURL: v => revoked.add(v) },
        setTimeout: () => 0,
        document: {
            querySelectorAll: sel => sel.startsWith('img[src^="blob:"]')
                ? [...onScreen].map(src => ({ src, currentSrc: src })) : [],
        },
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(patched.body, context);
    const { Ct, Ot, vt } = context.api;

    for (let i = 0; i < 70; i++) { Ot(`r${i}`, `blob:r${i}`); onScreen.add(`blob:r${i}`); }
    for (let i = 0; i < 30; i++) Ot(`u${i}`, `blob:u${i}`);
    clock += 120_000;
    const fresh = Ot('new', 'blob:new');
    assert.equal(fresh, 'blob:new');
    assert.equal(revoked.has('blob:new'), false, 'the entry being stored must never be revoked');
    assert.equal(Ct('new'), 'blob:new');
    assert.equal([...revoked].every(v => v.startsWith('blob:u')), true, 'only idle off-screen entries are revoked');
    assert.equal(revoked.size, 30);

    for (let i = 0; i < 40; i++) Ot(`p${i}`, `blob:p${i}`);
    clock += 5_000;
    Ct('p0');
    for (let i = 0; i < 10; i++) Ot(`q${i}`, `blob:q${i}`);
    assert.equal([...revoked].some(v => /^blob:[pq]/.test(v)), false, 'recently used entries stay alive');
    assert.ok(vt.size > 96);
    assert.equal(context.__twdMediaCacheStats().protectMs, 60000);
});

test('proxy stall recovery activates auto proxy and rotates away from a stalled domain', () => {
    const bootstrap = read('electron/inject/ui/bootstrap.js');
    const preload = read('electron/preload.js');
    const route = read('electron/tg-flowseal-route.cjs');
    assert.match(bootstrap, /installProxyStallRecovery/);
    assert.match(bootstrap, /now-waitingSince<12000/);
    assert.match(bootstrap, /INV\('reconnect_proxy'\)/);
    assert.match(preload, /'reconnect_proxy'/);
    assert.match(route, /function forceProxyReconnect/);
    assert.match(route, /state\.mode === 'auto' && !state\.autoLatched/);
    assert.match(route, /persistAutoLatch\(reason === 'renderer-network-stall' \? 'direct-network-stall'/);
    assert.match(route, /STALL_ROTATE_COOLDOWN_MS = 45 \* 1000/);
    assert.match(route, /state\.avoidControlDomain = String\(stalledDomain\)/);
    assert.match(route, /clearBridgePreferredDomain\(state\.avoidControlDomain, false\)/);
    assert.match(route, /state\.reconnectEpoch\+\+/);
});

test('visual maintenance is event-driven instead of hot polling', () => {
    const bootstrap = read('electron/inject/ui/bootstrap.js');
    const filter = read('electron/features/message_filter.js');
    const desktop = read('electron/features/desktop_like_common.js');
    const preload = read('electron/preload.js');
    const ipc = read('electron/ipc.cjs');
    const win = read('electron/window.cjs');

    assert.doesNotMatch(bootstrap, /setInterval\(injectMenu,\s*500\)/);
    assert.doesNotMatch(bootstrap, /setInterval\(injectSettingsRows,\s*500\)/);
    assert.match(bootstrap, /_injectionNodeRelevant/);
    assert.match(bootstrap, /15000/);
    assert.doesNotMatch(bootstrap, /setInterval\(refreshCfg,\s*2000\)/);
    assert.match(bootstrap, /onSettingsChanged/);
    assert.match(bootstrap, /installVisualStateSync/);
    assert.match(bootstrap, /__twdVisualActive/);
    assert.doesNotMatch(bootstrap, /setInterval\(function\(\)\{\s*var p=curPeer\(\)/);

    assert.match(filter, /dirtyMessages=new Set\(\)/);
    assert.match(filter, /m\.addedNodes\.forEach\(queueNode\)/);
    assert.match(filter, /__twd_window_state/);
    assert.doesNotMatch(filter, /},700\)/);

    assert.match(desktop, /scheduleMessageRefresh/);
    assert.match(desktop, /new MutationObserver\(function\(\)\{ scheduleMessageRefresh\(\); \}\)/);
    assert.match(desktop, /10000/);
    assert.doesNotMatch(desktop, /setInterval\(tick,\s*1000\)/);
    assert.doesNotMatch(desktop, /avatarBurst/);

    assert.match(preload, /onSettingsChanged/);
    assert.match(preload, /onWindowStateChanged/);
    assert.match(ipc, /webContents\.send\('settings-changed', state\.settings\)/);
    assert.match(win, /webContents\.send\('window-state-changed'/);
    assert.match(win, /mainWindow\.on\('minimize', emitWindowState\)/);
});

test('desktop-like modes keep reactions below messages and fade both list edges', () => {
    const base = read('electron/features/desktop_like_base.js');
    const standard = read('electron/features/desktop_like_standard.js');
    const wide = read('electron/features/desktop_like_wide.js');
    assert.match(base, /message-content-wrapper:has\(> \.Reactions\.is-outside\)/);
    assert.match(base, /flex-direction: column !important/);
    assert.match(base, /> \.Reactions\.is-outside \{[\s\S]*width: fit-content !important[\s\S]*flex-direction: row !important/);
    assert.match(standard, /rgba\(0,0,0,0\.24\) 0px, rgb\(0,0,0\) 64px, rgb\(0,0,0\) calc\(100% - 64px\), rgba\(0,0,0,0\.24\) 100%/);
    assert.match(wide, /rgba\(0,0,0,0\.24\) 0px, rgb\(0,0,0\) 64px, rgb\(0,0,0\) calc\(100% - 64px\), rgba\(0,0,0,0\.24\) 100%/);
});

test('update modal sanitizes release Markdown and changelog opens once per app version', () => {
    const notif = read('electron/inject/ui/notif-ui.js');
    assert.match(notif, /function _updPlainNotes\(notes\)/);
    assert.match(notif, /_clSelectLanguage\(src\)/);
    assert.match(notif, /openChangelogNative\(\)/);
    assert.match(notif, /whatsnew_shown_version===ver/);
    assert.match(notif, /whatsnew_shown_version:ver/);
    assert.doesNotMatch(notif, /WHATSNEW_VERSION/);

    const source = notif.match(/function _updPlainNotes\(notes\)\{[\s\S]*?\n\}/)?.[0];
    assert.ok(source, 'update-note sanitizer source must be present');
    const context = {
        _clSelectLanguage: s => s,
        _clPlainMarkdown: s => String(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1'),
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    assert.equal(
        context._updPlainNotes('## Исправлено\n\n- **Уведомления** теперь работают\n- `Поиск` исправлен'),
        'Исправлено\n\n• Уведомления теперь работают\n• Поиск исправлен'
    );
    assert.equal(
        context._updPlainNotes('**Full Changelog**: https://github.com/Sidiusz/Telegram-Web-Desktop/compare/1.3.0...1.3.1'),
        ''
    );
});

test('package and lockfile versions stay in sync', () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[''].version, pkg.version);
});
