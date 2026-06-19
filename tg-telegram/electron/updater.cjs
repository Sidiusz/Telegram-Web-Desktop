'use strict';
const { app, shell, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadSettings, saveSettings } = require('./settings.cjs');

// Репозиторий с релизами (туда заливается установщик + пишутся notes релиза).
const RELEASE_REPO    = 'Sidiusz/tg-web-releases';
// Основной путь: GitHub Releases API — версия из tag, чейнджлог из body, ссылка
// из ассета .exe. Никакого ручного редактирования update.json больше не нужно.
const RELEASES_API_URL = 'https://api.github.com/repos/' + RELEASE_REPO + '/releases/latest';
// Резервный путь (на случай, когда api.github.com недоступен — напр. из РФ):
// старый ручной update.json + changelog.txt в raw. Их же читают старые клиенты.
const UPDATE_INFO_URL = 'https://raw.githubusercontent.com/Sidiusz/tg-web-releases/main/update.json';
const CHANGELOG_URL   = 'https://raw.githubusercontent.com/Sidiusz/tg-web-releases/main/changelog.txt';

let _getWindow = null;
let _checkTimer = null;

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

function scheduleChecks() {
    if (_checkTimer) clearInterval(_checkTimer);
    const s = loadSettings();
    const key = s.update_check_interval || '1h';
    if (key === 'never') return;
    const ms = INTERVALS[key] || INTERVALS['1h'];
    setTimeout(() => {
        checkForUpdate({ silent: true });
        _checkTimer = setInterval(() => checkForUpdate({ silent: true }), ms);
    }, 10000);
}

// Запрашиваем текст с максимальным отключением кэширования
function fetchText(targetUrl, headers) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(targetUrl);
        // Добавляем сразу два анти-кэш параметра
        urlObj.searchParams.set('_t', Date.now());
        urlObj.searchParams.set('rnd', Math.random().toString(36).substring(2));

        const req = net.request({ url: urlObj.toString(), redirect: 'follow' });

        req.setHeader('User-Agent', 'TelegramWebDesktop/1.0');
        // Заставляем сервера GitHub (и любые прокси по пути) забыть про кэш
        req.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        req.setHeader('Pragma', 'no-cache');
        if (headers) for (const k in headers) req.setHeader(k, headers[k]);

        let data = '';
        req.on('response', (res) => {
            if (res.statusCode >= 400) {
                return reject(new Error(`Ошибка HTTP: ${res.statusCode}`));
            }
            res.on('data', chunk => { data += chunk.toString(); });
            res.on('end', () => resolve(data));
            res.on('error', reject);
        });
        
        req.on('error', reject);
        req.end();
    });
}

function fetchJSON(url, headers) {
    return fetchText(url, headers).then(text => {
        try { return JSON.parse(text); }
        catch (e) { throw new Error('Некорректный JSON: ' + text.slice(0, 100)); }
    });
}

function normVer(v) { return String(v == null ? '' : v).replace(/^v/i, '').trim(); }

// Основной путь — GitHub Releases API. Возвращает {version,url,filename,notes} или
// бросает (если API недоступен/нет .exe-ассета), чтобы вызвавший ушёл в fallback.
async function fetchLatestRelease() {
    const rel = await fetchJSON(RELEASES_API_URL, { 'Accept': 'application/vnd.github+json' });
    if (!rel || !rel.tag_name) throw new Error('release без tag_name');
    const version = normVer(rel.tag_name);
    const assets  = Array.isArray(rel.assets) ? rel.assets : [];
    const exe = assets.find(a => /\.exe$/i.test(a.name || ''));
    if (!version || !exe || !exe.browser_download_url) throw new Error('нет .exe-ассета в релизе');
    return { version, url: exe.browser_download_url, filename: exe.name, notes: rel.body || '' };
}

// Сводит источники: сперва API (авто), при ошибке — резервный update.json (РФ/оффлайн).
async function resolveUpdateInfo() {
    try {
        const rel = await fetchLatestRelease();
        return Object.assign({ source: 'api' }, rel);
    } catch (e) {
        console.log(`[Updater] GitHub API недоступен (${e.message}), пробуем update.json…`);
    }
    const info = await fetchJSON(UPDATE_INFO_URL);
    if (!info || !info.version || !info.url) return null;
    return { source: 'json', version: normVer(info.version), url: info.url, filename: info.filename || null, notes: null };
}

async function checkForUpdate({ silent = false } = {}) {
    try {
        const info = await resolveUpdateInfo();
        if (!info || !info.version || !info.url) return null;

        const current = app.getVersion();

        // ВЫВОД В КОНСОЛЬ ДЛЯ ОТЛАДКИ
        console.log(`\n[Updater] === Проверка обновлений ===`);
        console.log(`[Updater] Источник: ${info.source}`);
        console.log(`[Updater] Локальная версия (app.getVersion()): v${current}`);
        console.log(`[Updater] Версия на сервере:                  v${info.version}`);

        if (compareVersions(info.version, current) <= 0) {
            console.log(`[Updater] Версия актуальна. Обновление не требуется.`);
            if (!silent) return { upToDate: true };
            return null;
        }

        console.log(`[Updater] Найдено обновление! v${current} -> v${info.version}`);

        const s = loadSettings();
        if (silent && s.skipped_version === info.version) {
            console.log(`[Updater] Это обновление ранее было пропущено пользователем.`);
            return null;
        }

        const win = _getWindow && _getWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('update-available', {
                version: info.version,
                current,
                url: info.url,
                filename: info.filename,   // из API (имя ассета); null → renderer соберёт сам
                notes: info.notes,         // из release body; null → renderer дёрнет fetch_changelog
                silent,
            });
        }
        return info;
    } catch (e) {
        console.error(`[Updater] Ошибка при проверке:`, e.message);
        if (!silent) throw e;
        return null;
    }
}

function downloadUpdate(url, filename, onProgress) {
    return new Promise((resolve, reject) => {
        const destDir = app.getPath('downloads');
        const destPath = path.join(destDir, filename);
        const file = fs.createWriteStream(destPath);

        const req = net.request({ url, redirect: 'follow' });
        req.setHeader('User-Agent', 'TelegramWebDesktop/1.0');

        req.on('response', (res) => {
            if (res.statusCode >= 400) {
                file.close();
                fs.unlink(destPath, () => {}); 
                return reject(new Error(`Ошибка скачивания: HTTP ${res.statusCode}`));
            }

            const total = parseInt(res.headers['content-length'] || '0');
            let received = 0;

            res.on('data', chunk => {
                received += chunk.length;
                file.write(chunk);
                if (onProgress) onProgress(received, total);
            });

            res.on('end', () => {
                file.end(() => {
                    try {
                        execSync(`powershell -Command "Unblock-File -Path '${destPath.replace(/'/g, "''")}'"`, { stdio: 'ignore' });
                    } catch (e) {}
                    resolve(destPath);
                });
            });

            res.on('error', (e) => { file.destroy(); reject(e); });
        });

        req.on('error', (e) => { file.destroy(); reject(e); });
        req.end();
    });
}

function compareVersions(a, b) {
    const pa = String(a).trim().split('.').map(Number);
    const pb = String(b).trim().split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

// Чейнджлог: сперва notes последнего релиза (API), при недоступности — changelog.txt.
async function fetchChangelog() {
    try {
        const rel = await fetchLatestRelease();
        if (rel && rel.notes && rel.notes.trim()) return rel.notes;
    } catch (e) { /* API недоступен — уходим в raw */ }
    return fetchText(CHANGELOG_URL);
}

module.exports = { init, scheduleChecks, checkForUpdate, downloadUpdate, fetchChangelog };