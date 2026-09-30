'use strict';
const { app, net, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadSettings } = require('./settings.cjs');
const { sanitizeFilename, uniquePath } = require('./utils.cjs');

// Releases repo (installer uploads here + release notes)
const RELEASE_REPO    = 'Sidiusz/Telegram-Web-Desktop';
// Primary path: GitHub Releases API — version from tag, changelog from body,
// link from the .exe asset. No manual update.json editing needed anymore.
const RELEASES_API_URL = 'https://api.github.com/repos/' + RELEASE_REPO + '/releases/latest';
const RELEASES_LIST_URL = 'https://api.github.com/repos/' + RELEASE_REPO + '/releases';
// Secondary path: github.com HTML endpoints (atom feed + expanded_assets). No
// auth, no 60/hr rate limit — survives the API being throttled (which silently
// fell back to a stale update.json and reported "up to date").
const RELEASES_ATOM_URL = 'https://github.com/' + RELEASE_REPO + '/releases.atom';
const assetsUrl = (tag) => 'https://github.com/' + RELEASE_REPO + '/releases/expanded_assets/' + encodeURIComponent(tag);
// Last-resort fallback: the old manual update.json + changelog.txt over raw.
const UPDATE_INFO_URL = 'https://raw.githubusercontent.com/' + RELEASE_REPO + '/main/update.json';
const CHANGELOG_URL   = 'https://raw.githubusercontent.com/' + RELEASE_REPO + '/main/changelog.txt';

const REQUEST_TIMEOUT   = 20000;   // whole metadata request
const STALL_TIMEOUT     = 45000;   // no bytes received during a download
const FETCH_ATTEMPTS    = 3;
const DOWNLOAD_ATTEMPTS = 4;
const RETRY_AFTER_FAIL  = 10 * 60 * 1000;
const PROGRESS_INTERVAL = 150;
const MAX_METADATA_BYTES = 5 * 1024 * 1024;

let _getWindow = null;
let _checkTimer = null;
let _powerHooked = false;
let _armCheck = null;
let _checking = null;
let _lastCheckFailed = false;
let _pendingUpdate = null;

function init(getWindow) {
    _getWindow = getWindow;
}

const INTERVALS = {
    '30m':  30 * 60 * 1000,
    '1h':   60 * 60 * 1000,
    '12h':  12 * 60 * 60 * 1000,
    '24h':  24 * 60 * 60 * 1000,
    '3d':   3 * 24 * 60 * 60 * 1000,
    '7d':   7 * 24 * 60 * 60 * 1000,
    '30d':  30 * 24 * 60 * 60 * 1000,
    'never': 0,
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function isOnline() {
    try { return net.isOnline(); } catch (e) { return true; }
}

// setInterval drifts across sleep/hibernate, so re-arm a timeout after every run.
function scheduleChecks() {
    if (_checkTimer) { clearTimeout(_checkTimer); _checkTimer = null; }
    const key = loadSettings().update_check_interval || '24h';
    if (key === 'never') { _armCheck = null; return; }
    const ms = INTERVALS[key] || INTERVALS['24h'];

    const arm = (delay) => {
        if (_checkTimer) clearTimeout(_checkTimer);
        _checkTimer = setTimeout(run, Math.max(1000, delay));
    };
    const run = async () => {
        if (!isOnline()) return arm(60 * 1000);
        await checkForUpdate({ silent: true }).catch(() => {});
        arm(_lastCheckFailed ? Math.min(RETRY_AFTER_FAIL, ms) : ms);
    };

    _armCheck = arm;
    arm(10000);
    if (!_powerHooked) {
        _powerHooked = true;
        try { powerMonitor.on('resume', () => { if (_armCheck) _armCheck(15000); }); } catch (e) {}
    }
}

// Transient: worth another attempt. Rate limits and 4xx are not.
function isRetriable(err) {
    const s = err && err.status;
    if (!s) return true;
    return s >= 500 && s < 600;
}

function fetchTextOnce(targetUrl, headers, timeout) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(targetUrl);
        // Two anti-cache params at once
        urlObj.searchParams.set('_t', Date.now());
        urlObj.searchParams.set('rnd', Math.random().toString(36).substring(2));

        const req = net.request({ url: urlObj.toString(), redirect: 'follow' });
        req.setHeader('User-Agent', 'TelegramWebDesktop/1.0');
        // Force GitHub servers (and any proxy in between) to ignore cache
        req.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        req.setHeader('Pragma', 'no-cache');
        if (headers) for (const k in headers) req.setHeader(k, headers[k]);

        let settled = false;
        const timer = setTimeout(() => fail(new Error('timeout after ' + timeout + 'ms')), timeout);
        function fail(e) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { req.abort(); } catch (_) {}
            reject(e);
        }
        function done(v) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(v);
        }

        req.on('response', (res) => {
            if (res.statusCode >= 400) {
                const e = new Error('HTTP error: ' + res.statusCode);
                e.status = res.statusCode;
                return fail(e);
            }
            let data = '';
            let bytes = 0;
            res.on('data', chunk => {
                if (settled) return;
                bytes += chunk.length;
                if (bytes > MAX_METADATA_BYTES) return fail(new Error('metadata response is too large'));
                data += chunk.toString();
            });
            res.on('end', () => done(data));
            res.on('error', fail);
            res.on('aborted', () => fail(new Error('response aborted')));
        });
        req.on('error', fail);
        req.on('abort', () => fail(new Error('request aborted')));
        req.end();
    });
}

async function fetchText(targetUrl, headers) {
    let last;
    for (let i = 0; i < FETCH_ATTEMPTS; i++) {
        try { return await fetchTextOnce(targetUrl, headers, REQUEST_TIMEOUT); }
        catch (e) {
            last = e;
            if (!isRetriable(e) || i === FETCH_ATTEMPTS - 1) break;
            await sleep(500 * Math.pow(3, i));
        }
    }
    throw last;
}

function fetchJSON(url, headers) {
    return fetchText(url, headers).then(text => {
        try { return JSON.parse(text); }
        catch (e) { throw new Error('Invalid JSON: ' + text.slice(0, 100)); }
    });
}

function normVer(v) { return String(v == null ? '' : v).replace(/^v/i, '').trim(); }
function isInstallerAssetName(name) {
    return /^Telegram[ ._-]+Web[ ._-]+Desktop[ ._-]+Setup[ ._-]+.+\.exe$/i.test(String(name || ''));
}

// Primary path — GitHub Releases API. Returns {version,url,filename,notes} or
// throws (if API is down / no expected installer asset) so the caller falls back.
async function fetchLatestRelease() {
    const rel = await fetchJSON(RELEASES_API_URL, { 'Accept': 'application/vnd.github+json' });
    if (!rel || !rel.tag_name) throw new Error('release without tag_name');
    const version = normVer(rel.tag_name);
    const assets  = Array.isArray(rel.assets) ? rel.assets : [];
    const exe = assets.find(a => isInstallerAssetName(a.name));
    if (!version || !exe || !exe.browser_download_url) throw new Error('no Telegram Web Desktop installer asset in release');
    return {
        version, url: exe.browser_download_url, filename: exe.name,
        notes: rel.body || '', size: exe.size || 0,
        digest: typeof exe.digest === 'string' ? exe.digest : '',
    };
}

// Minimal HTML → text for atom <content> (release body arrives HTML-escaped).
function htmlToText(h) {
    let s = String(h == null ? '' : h)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    s = s.replace(/<li[^>]*>/gi, '• ').replace(/<br\s*\/?>/gi, '\n')
         .replace(/<\/(p|div|li|h\d|ul|ol|tr)>/gi, '\n').replace(/<[^>]+>/g, '');
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Secondary path — github.com atom feed + expanded_assets page (no API, no rate
// limit). Returns {version,url,filename,notes} or throws.
async function fetchLatestReleaseWeb() {
    const atom = await fetchText(RELEASES_ATOM_URL);
    // Feed order follows creation date, so pick the highest version instead of the first.
    const entries = atom.split(/<entry>/).slice(1).map(e => {
        const t = e.match(/releases\/tag\/([^"<\s]+)/);
        if (!t) return null;
        const c = e.match(/<content[^>]*>([\s\S]*?)<\/content>/);
        return { rawTag: t[1], version: normVer(decodeURIComponent(t[1])), notes: c ? htmlToText(c[1]) : null };
    }).filter(Boolean);
    if (!entries.length) throw new Error('no tag in atom feed');
    const best = entries.reduce((a, b) => (compareVersions(b.version, a.version) > 0 ? b : a));

    const html = await fetchText(assetsUrl(best.rawTag));
    const links = Array.from(html.matchAll(/href="([^"]*releases\/download\/[^"]*\.exe)"/ig))
        .map(m => m[1].replace(/&amp;/g, '&'));
    const exePath = links.find(link => {
        try { return isInstallerAssetName(decodeURIComponent(link.split('/').pop())); }
        catch (_) { return false; }
    });
    if (!exePath) throw new Error('no Telegram Web Desktop installer asset on release page');
    const url = 'https://github.com' + exePath;
    return { version: best.version, url, filename: decodeURIComponent(url.split('/').pop()), notes: best.notes };
}

// Reconcile sources: API → github.com HTML → update.json (last resort).
async function resolveUpdateInfo() {
    try {
        return Object.assign({ source: 'api' }, await fetchLatestRelease());
    } catch (e) {
        console.log(`[Updater] GitHub API unavailable (${e.message}), trying github.com…`);
    }
    try {
        return Object.assign({ source: 'web' }, await fetchLatestReleaseWeb());
    } catch (e) {
        console.log(`[Updater] github.com releases unavailable (${e.message}), trying update.json…`);
    }
    const info = await fetchJSON(UPDATE_INFO_URL);
    if (!info || !info.version || !info.url) return null;
    return { source: 'json', version: normVer(info.version), url: info.url, filename: info.filename || null, notes: null };
}

async function checkForUpdate(opts = {}) {
    // Serialize checks so the interval and a manual click can't race into two modals.
    while (_checking) { try { await _checking; } catch (e) {} }
    const p = runCheck(opts);
    _checking = p;
    try { return await p; }
    finally { if (_checking === p) _checking = null; }
}

async function runCheck({ silent = false } = {}) {
    try {
        const info = await resolveUpdateInfo();
        _lastCheckFailed = false;
        if (!info || !info.version || !info.url) return null;

        const current = app.getVersion();

        console.log(`\n[Updater] === Update check ===`);
        console.log(`[Updater] Source: ${info.source}`);
        console.log(`[Updater] Local version (app.getVersion()): v${current}`);
        console.log(`[Updater] Server version:                  v${info.version}`);

        if (compareVersions(info.version, current) <= 0) {
            _pendingUpdate = null;
            console.log(`[Updater] Up to date. No update needed.`);
            if (!silent) return { upToDate: true };
            return null;
        }

        _pendingUpdate = info;
        console.log(`[Updater] Update found! v${current} -> v${info.version}`);

        const s = loadSettings();
        if (silent && s.skipped_version === info.version) {
            console.log(`[Updater] This update was previously skipped by the user.`);
            return null;
        }

        const win = _getWindow && _getWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('update-available', {
                version: info.version,
                current,
                filename: info.filename,   // from API (asset name); null → renderer builds it
                notes: info.notes,         // from release body; null → renderer calls fetch_changelog
                silent,
            });
        }
        return info;
    } catch (e) {
        _lastCheckFailed = true;
        console.error(`[Updater] Check error:`, e.message);
        if (!silent) throw e;
        return null;
    }
}

function assertAllowedHost(url) {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error('Update URL must use HTTPS');
    if (u.hostname !== 'github.com') throw new Error('Update host not allowed: ' + u.hostname);
    const prefix = '/Sidiusz/Telegram-Web-Desktop/releases/download/';
    if (!u.pathname.startsWith(prefix)) throw new Error('Update URL is outside the release repository');
    return u;
}

function statSize(p) {
    try { return fs.statSync(p).size; } catch (e) { return 0; }
}

// One attempt. Resumes from `startAt` with a Range request when the server allows it.
function downloadOnce(url, partPath, startAt, onProgress) {
    return new Promise((resolve, reject) => {
        const req = net.request({ url, redirect: 'follow' });
        req.setHeader('User-Agent', 'TelegramWebDesktop/1.0');
        req.setHeader('Cache-Control', 'no-cache');
        if (startAt > 0) req.setHeader('Range', 'bytes=' + startAt + '-');

        let file = null;
        let settled = false;
        let received = startAt;
        let total = 0;
        let stallTimer = null;

        const clearStall = () => { if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; } };
        const armStall = () => {
            clearStall();
            stallTimer = setTimeout(() => fail(new Error('download stalled')), STALL_TIMEOUT);
        };
        function fail(e) {
            if (settled) return;
            settled = true;
            clearStall();
            try { req.abort(); } catch (_) {}
            // Flush what arrived instead of dropping it — the retry resumes from there.
            if (file) { try { file.end(); } catch (_) {} }
            reject(e);
        }
        function finish() {
            if (settled) return;
            settled = true;
            clearStall();
            file.end(() => resolve({ received, total }));
        }

        req.on('response', (res) => {
            const code = res.statusCode;
            if (code >= 400) {
                const e = new Error(`Download error: HTTP ${code}`);
                e.status = code;
                if (code === 416) e.resetResume = true;   // stale .part longer than the asset
                return fail(e);
            }
            // Range ignored — start over from byte 0.
            const resumed = startAt > 0 && code === 206;
            if (startAt > 0 && !resumed) received = 0;

            const len = parseInt(res.headers['content-length'] || 0, 10) || 0;
            const cr = String(res.headers['content-range'] || '');
            const crTotal = cr.match(/\/(\d+)\s*$/);
            total = crTotal ? parseInt(crTotal[1], 10) : (received + len);

            file = fs.createWriteStream(partPath, { flags: received > 0 ? 'a' : 'w' });
            file.on('error', fail);

            armStall();
            res.on('data', chunk => {
                if (settled) return;
                received += chunk.length;
                armStall();
                if (!file.write(chunk)) {
                    res.pause();
                    file.once('drain', () => { if (!settled) res.resume(); });
                }
                if (onProgress) onProgress(received, total);
            });
            res.on('end', finish);
            res.on('error', fail);
            res.on('aborted', () => fail(new Error('connection aborted')));
        });
        req.on('error', fail);
        req.end();
    });
}

function hashFile(filePath, algorithm, encoding) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash(algorithm);
        const stream = fs.createReadStream(filePath);
        stream.on('data', d => h.update(d));
        stream.on('end', () => resolve(h.digest(encoding)));
        stream.on('error', reject);
    });
}
function sha512Base64(filePath) { return hashFile(filePath, 'sha512', 'base64'); }
function sha256Hex(filePath) { return hashFile(filePath, 'sha256', 'hex'); }

// Minimal reader for electron-builder's latest.yml — enough for the file entry we downloaded.
function parseLatestYml(yml, filename) {
    const unquote = (v) => v.replace(/^['"]|['"]$/g, '');
    let hash = null, size = 0, inFile = false, fallbackHash = null;
    for (const line of String(yml).split(/\r?\n/)) {
        const urlM = line.match(/^\s*-?\s*url:\s*(.+?)\s*$/);
        if (urlM) {
            inFile = decodeURIComponent(unquote(urlM[1])).replace(/\+/g, ' ') === filename;
            continue;
        }
        const shaM = line.match(/^\s*-?\s*sha512:\s*(\S+)\s*$/);
        if (shaM) {
            if (inFile) hash = unquote(shaM[1]);
            else if (!fallbackHash) fallbackHash = unquote(shaM[1]);
        }
        const sizeM = line.match(/^\s*-?\s*size:\s*(\d+)\s*$/);
        if (sizeM && inFile) size = parseInt(sizeM[1], 10);
    }
    if (hash) return { sha512: hash, size };
    return fallbackHash ? { sha512: fallbackHash, size: 0 } : null;
}

// electron-builder publishes latest.yml next to the installer; use it when it exists.
async function fetchExpectedHash(url, filename) {
    try {
        const ymlUrl = url.slice(0, url.lastIndexOf('/') + 1) + 'latest.yml';
        return parseLatestYml(await fetchTextOnce(ymlUrl, null, REQUEST_TIMEOUT), filename);
    } catch (e) {
        return null;
    }
}

async function verifyDownload(filePath, total, expected, releaseDigest) {
    const size = statSize(filePath);
    if (total && size !== total) throw new Error(`incomplete download (${size}/${total} bytes)`);
    if (size < 1024) throw new Error('downloaded file is too small');

    const fd = await fs.promises.open(filePath, 'r');
    try {
        const buf = Buffer.alloc(2);
        await fd.read(buf, 0, 2, 0);
        if (buf.toString('latin1') !== 'MZ') { const e = new Error('downloaded file is not a Windows installer'); e.permanent = true; throw e; }
    } finally { await fd.close(); }

    const digestMatch = /^sha256:([0-9a-f]{64})$/i.exec(String(releaseDigest || ''));
    if (!digestMatch) { const e = new Error('trusted update digest is unavailable'); e.permanent = true; throw e; }
    const got256 = await sha256Hex(filePath);
    if (got256.toLowerCase() !== digestMatch[1].toLowerCase()) {
        const e = new Error('release digest mismatch - update rejected'); e.permanent = true; throw e;
    }
    console.log('[Updater] sha256 verified against GitHub release asset digest');

    if (expected && expected.size && size !== expected.size) throw new Error(`size mismatch (${size}/${expected.size} bytes)`);
    if (expected && expected.sha512) {
        const got = await sha512Base64(filePath);
        if (got !== expected.sha512) { const e = new Error('latest.yml checksum mismatch'); e.permanent = true; throw e; }
    }
}

async function downloadUpdate(url, filename, onProgress, releaseDigest) {
    assertAllowedHost(url);

    const destDir = app.getPath('downloads');
    const safeName = sanitizeFilename(filename) || sanitizeFilename(new URL(url).pathname.split('/').pop()) || 'update.exe';
    if (!safeName.toLowerCase().endsWith('.exe')) throw new Error('Invalid filename');
    const destPath = uniquePath(path.join(destDir, safeName));
    const partPath = destPath + '.part';
    try { fs.unlinkSync(partPath); } catch (e) {}

    let lastReport = 0;
    const report = (received, total) => {
        if (!onProgress) return;
        const now = Date.now();
        if (!(total && received >= total) && now - lastReport < PROGRESS_INTERVAL) return;
        lastReport = now;
        onProgress(received, total);
    };

    const expected = await fetchExpectedHash(url, safeName);
    let startAt = 0;
    let lastErr = null;

    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
        try {
            const { total } = await downloadOnce(url, partPath, startAt, report);
            await verifyDownload(partPath, total, expected, releaseDigest);
            await fs.promises.rename(partPath, destPath);
            if (onProgress) onProgress(statSize(destPath), statSize(destPath));
            return destPath;
        } catch (e) {
            lastErr = e;
            if (e.permanent || attempt === DOWNLOAD_ATTEMPTS) break;
            if (e.resetResume) { try { fs.unlinkSync(partPath); } catch (_) {} }
            startAt = statSize(partPath);
            console.log(`[Updater] Download attempt ${attempt} failed (${e.message}), resuming from ${startAt} bytes…`);
            await sleep(1000 * attempt);
        }
    }

    try { fs.unlinkSync(partPath); } catch (e) {}
    throw lastErr || new Error('Download failed');
}

async function downloadPendingUpdate(onProgress) {
    let info = _pendingUpdate;
    const current = app.getVersion();
    if (!info || compareVersions(info.version, current) <= 0) {
        const fresh = await fetchLatestRelease();
        if (!fresh || compareVersions(fresh.version, current) <= 0) throw new Error('No update is available');
        info = fresh;
        _pendingUpdate = fresh;
    } else if (!/^sha256:[0-9a-f]{64}$/i.test(String(info.digest || ''))) {
        // A fallback metadata source can announce an update, but installation still
        // requires GitHub's trusted asset digest. Do not silently switch to a different
        // version if the latest release changed between "check" and "download".
        const expectedVersion = normVer(info.version);
        const fresh = await fetchLatestRelease();
        if (!fresh || normVer(fresh.version) !== expectedVersion) {
            _pendingUpdate = fresh || null;
            throw new Error('The available update changed; check for updates again');
        }
        info = fresh;
        _pendingUpdate = fresh;
    }
    assertAllowedHost(info.url);
    if (!/^sha256:[0-9a-f]{64}$/i.test(String(info.digest || ''))) throw new Error('Release integrity metadata is unavailable');
    return downloadUpdate(info.url, info.filename, onProgress, info.digest);
}

function compareVersions(a, b) {
    // A non-numeric part (1.2.7-beta) becomes -1, so it sorts below the plain release.
    const parse = (v) => String(v).trim().split(/[.\-+]/).filter(Boolean).map(x => (/^\d+$/.test(x) ? parseInt(x, 10) : -1));
    const pa = parse(a), pb = parse(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] === undefined ? 0 : pa[i];
        const nb = pb[i] === undefined ? 0 : pb[i];
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

// All releases (for the block "Changelog" screen), from the atom feed — no API.
async function fetchReleasesWeb() {
    const atom = await fetchText(RELEASES_ATOM_URL);
    return atom.split(/<entry>/).slice(1).map(e => {
        const t = e.match(/releases\/tag\/([^"<\s]+)/);
        if (!t) return null;
        const c = e.match(/<content[^>]*>([\s\S]*?)<\/content>/);
        return { version: normVer(decodeURIComponent(t[1])), notes: c ? htmlToText(c[1]) : '' };
    }).filter(Boolean);
}

// All releases as a list. For the block "Changelog" screen. API first, then atom feed.
async function fetchReleases() {
    try {
        const arr = await fetchJSON(RELEASES_LIST_URL, { 'Accept': 'application/vnd.github+json' });
        if (Array.isArray(arr) && arr.length) {
            return arr.filter(r => r && r.tag_name).map(r => ({ version: normVer(r.tag_name), notes: r.body || '' }));
        }
    } catch (e) { /* API down/throttled — fall back to atom */ }
    return fetchReleasesWeb();
}

// Changelog: latest release notes — API, then github.com, then changelog.txt.
async function fetchChangelog() {
    try {
        const rel = await fetchLatestRelease();
        if (rel && rel.notes && rel.notes.trim()) return rel.notes;
    } catch (e) { /* API down */ }
    try {
        const rel = await fetchLatestReleaseWeb();
        if (rel && rel.notes && rel.notes.trim()) return rel.notes;
    } catch (e) { /* github.com down */ }
    return fetchText(CHANGELOG_URL);
}

module.exports = { init, scheduleChecks, checkForUpdate, downloadPendingUpdate, fetchChangelog, fetchReleases };
module.exports._internals = { compareVersions, parseLatestYml, downloadOnce, verifyDownload };
