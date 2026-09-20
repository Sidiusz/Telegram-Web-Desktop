'use strict';

const { webContents, net } = require('electron');
const { loadSettings, saveSettings } = require('./settings.cjs');

const FLOWSEAL_DOMAIN_LIST_URL =
    'https://raw.githubusercontent.com/Flowseal/tg-ws-proxy/main/.github/cfproxy-domains.txt';
const DOMAIN_REFRESH_MS = 60 * 60 * 1000;
const DEFAULT_CF_BASE_DOMAINS = [
    'pclead.co.uk', 'offshor.co.uk', 'cakeisalie.co.uk', 'noskomnadzor.co.uk',
    'lovetrue.co.uk', 'sorokdva.co.uk', 'pyatdesyatdva.co.uk', 'kartoshka.co.uk',
    'sorokodin.co.uk', 'pyatdesyatodin.co.uk', 'notelega.co.uk', 'ebally.co.uk',
    'nebally.co.uk', 'havegreatday.co.uk', 'pomogite.co.uk', 'fixtelega.co.uk',
    'sadnews.co.uk', 'onedaychamp.co.uk', 'stopblocking.co.uk', 'nothingthere.co.uk',
];
const DC_IPS = Object.freeze({
    1: '149.154.175.50', 2: '149.154.167.51', 3: '149.154.175.100',
    4: '149.154.167.91', 5: '149.154.171.5', 203: '91.105.192.100',
});
const NAMED_DC = Object.freeze({ pluto: 1, venus: 2, aurora: 3, vesta: 4, flora: 5 });

const state = {
    installed: false, session: null, mode: 'auto', autoLatched: false,
    autoReason: '', flowsealDomains: DEFAULT_CF_BASE_DOMAINS.slice(),
    domainSource: 'flowseal', customDomains: [], pinnedDomain: '',
    preferredControlDomain: '', preferredMediaDomain: '',
    workerEnabled: false, workerDomains: [], autoFailures: 1,
    autoWindowSec: 12, webFallback: true, webFallbackLatched: false,
    dcIps: { ...DC_IPS }, cursor: new Map(), directFailures: [],
    lastRoute: 'direct', lastDomain: '', lastError: '', lastDc: 0,
    refreshTimer: null, revision: 0, reconnectEpoch: 0, bridgePort: 0, bridgeToken: '',
};function normalizeMode(mode) { return mode === 'always' || mode === 'off' ? mode : 'auto'; }
function isProxyActive() { return state.mode === 'always' || (state.mode === 'auto' && state.autoLatched); }
function validDomain(domain) {
    const d = String(domain || '').trim().toLowerCase().replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
    if (!d || d.length > 253 || d.startsWith('.') || d.endsWith('.')) return false;
    const labels = d.split('.');
    return labels.length > 1 && labels.every(x => x && x.length <= 63 &&
        !x.startsWith('-') && !x.endsWith('-') && /^[a-z0-9-]+$/i.test(x));
}
function normalizeDomains(value) {
    const list = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
    return Array.from(new Set(list.map(x => String(x).trim().toLowerCase()
        .replace(/^wss?:\/\//, '').replace(/\/.*$/, '')).filter(validDomain)));
}
function validIpv4(value) {
    const p = String(value || '').trim().split('.');
    return p.length === 4 && p.every(x => /^\d{1,3}$/.test(x) && Number(x) >= 0 && Number(x) <= 255);
}
function normalizeDcIps(value) {
    const out = {};
    const entries = typeof value === 'string'
        ? value.split(/\r?\n|[,;]+/).map(x => x.trim()).filter(Boolean).map(x => x.split(':', 2))
        : Object.entries(value && typeof value === 'object' ? value : {});
    for (const [dcRaw, ipRaw] of entries) {
        const dc = Number(dcRaw); const ip = String(ipRaw || '').trim();
        if ([1,2,3,4,5,203].includes(dc) && validIpv4(ip)) out[dc] = ip;
    }
    return out;
}
function activeDomains() {
    const pool = state.domainSource === 'custom' && state.customDomains.length
        ? state.customDomains : state.flowsealDomains;
    if (state.pinnedDomain && pool.includes(state.pinnedDomain)) return [state.pinnedDomain];
    return pool.length ? pool.slice() : DEFAULT_CF_BASE_DOMAINS.slice();
}
function getProxyBootstrap() {
    return {
        active: isProxyActive(), domains: activeDomains(), revision: state.revision,
        reconnectEpoch: state.reconnectEpoch,
        preferredControlDomain: state.preferredControlDomain,
        preferredMediaDomain: state.preferredMediaDomain,
        workerEnabled: state.workerEnabled && state.workerDomains.length > 0,
        workerDomains: state.workerDomains.slice(), dcIps: { ...state.dcIps },
        bridgePort: state.bridgePort, bridgeToken: state.bridgeToken,
    };
}
function setBridgeEndpoint(port, token) {
    state.bridgePort = Number(port) || 0;
    state.bridgeToken = String(token || '');
    broadcastProxyState();
}
function reportBridgeRoute(dc, domain, kind = 'cf') {
    state.lastRoute = kind; state.lastDomain = String(domain || '');
    state.lastDc = Number(dc) || 0; state.lastError = '';
}
function reportBridgePreferredDomain(domain, media = false) {
    const d = validDomain(domain) ? String(domain).trim().toLowerCase() : '';
    if (!d) return;
    const field = media ? 'preferredMediaDomain' : 'preferredControlDomain';
    const key = media ? 'proxy_last_good_media_domain' : 'proxy_last_good_control_domain';
    if (state[field] === d) return;
    state[field] = d;
    const s = loadSettings();
    saveSettings(Object.assign({}, s, { [key]: d }));
}
function clearBridgePreferredDomain(domain, media = false) {
    const d = String(domain || '').trim().toLowerCase();
    const field = media ? 'preferredMediaDomain' : 'preferredControlDomain';
    const key = media ? 'proxy_last_good_media_domain' : 'proxy_last_good_control_domain';
    if (!d || state[field] !== d) return;
    state[field] = '';
    const s = loadSettings();
    saveSettings(Object.assign({}, s, { [key]: '' }));
}
function reportBridgeError(dc, error) {
    state.lastDc = Number(dc) || state.lastDc;
    state.lastError = String(error || 'bridge error');
}
function broadcastProxyState() {
    state.revision++;
    const payload = getProxyBootstrap();
    for (const wc of webContents.getAllWebContents()) {
        try { if (!wc.isDestroyed()) wc.send('proxy-state-changed', payload); } catch (_) {}
    }
}function dcFromTelegramWsHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    if (!h.endsWith('.web.telegram.org')) return null;
    const label = h.slice(0, -'.web.telegram.org'.length);
    const numeric = /^(?:kws|zws)(\d+)(?:-1)?$/.exec(label);
    if (numeric) return Number(numeric[1]);
    const named = /^([a-z]+)(?:-1)?$/.exec(label);
    return named && NAMED_DC[named[1]] ? NAMED_DC[named[1]] : null;
}
function parseRoutedTarget(urlString) {
    try {
        const u = new URL(urlString);
        const cf = /^kws(\d+)\.(.+)$/i.exec(u.hostname);
        if (cf) return { dc: Number(cf[1]), domain: cf[2].toLowerCase(), kind: 'cf' };
        if (state.workerDomains.includes(u.hostname.toLowerCase()) && u.pathname === '/apiws') {
            return { dc: Number(u.searchParams.get('dc')) || 0, domain: u.hostname.toLowerCase(), kind: 'worker' };
        }
    } catch (_) {}
    return null;
}
function decodeFlowsealDomain(value) {
    const s = String(value || '').trim().toLowerCase();
    if (!s.endsWith('.com')) return s;
    const p = s.slice(0, -4);
    const n = Array.from(p).filter(c => /[a-z]/i.test(c)).length;
    let out = '';
    for (const c of p) {
        if (!/[a-z]/i.test(c)) { out += c; continue; }
        const base = c === c.toLowerCase() ? 97 : 65;
        out += String.fromCharCode((c.charCodeAt(0) - base - n + 2600) % 26 + base);
    }
    return out + '.co.uk';
}
async function refreshFlowsealDomains() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
        const r = await net.fetch(`${FLOWSEAL_DOMAIN_LIST_URL}?t=${Date.now()}`, {
            bypassCustomProtocolHandlers: true, signal: ctrl.signal,
            headers: { 'User-Agent': 'Telegram-Web-Desktop' },
        });
        if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
        const lines = (await r.text()).split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#'));
        const decoded = normalizeDomains(lines.map(decodeFlowsealDomain));
        if (decoded.length < 3) return { ok: false, error: 'domain list too short' };
        state.flowsealDomains = decoded;
        state.cursor.clear();
        broadcastProxyState();
        console.log(`[TG-PROXY] Flowseal domain pool refreshed (${decoded.length})`);
        return { ok: true, domains: decoded.length };
    } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
    finally { clearTimeout(timer); }
}function applySettings(s) {
    state.mode = normalizeMode(s.proxy_mode);
    state.autoLatched = state.mode === 'auto' && s.proxy_auto_latched === true;
    state.domainSource = s.proxy_domain_source === 'custom' ? 'custom' : 'flowseal';
    state.customDomains = normalizeDomains(s.proxy_custom_domains);
    state.pinnedDomain = validDomain(s.proxy_pinned_domain) ? String(s.proxy_pinned_domain).trim().toLowerCase() : '';
    state.preferredControlDomain = validDomain(s.proxy_last_good_control_domain) ? String(s.proxy_last_good_control_domain).trim().toLowerCase() : '';
    state.preferredMediaDomain = validDomain(s.proxy_last_good_media_domain) ? String(s.proxy_last_good_media_domain).trim().toLowerCase() : '';
    state.workerEnabled = s.proxy_worker_enabled === true;
    state.workerDomains = normalizeDomains(s.proxy_worker_domains);
    state.autoFailures = Math.max(1, Math.min(10, Number(s.proxy_auto_failures) || 1));
    state.autoWindowSec = Math.max(3, Math.min(120, Number(s.proxy_auto_window_sec) || 12));
    state.webFallback = s.proxy_web_fallback !== false;
    state.webFallbackLatched = state.webFallback && s.proxy_web_fallback_latched === true;
    state.dcIps = normalizeDcIps(s.proxy_dc_ips);
    if (!Object.keys(state.dcIps).length) state.dcIps = { ...DC_IPS };
    if (!state.autoLatched) state.autoReason = '';
}
function configureProxySettings(settings) {
    applySettings(settings || loadSettings());
    state.cursor.clear();
    broadcastProxyState();
    if (isProxyActive() && state.domainSource === 'flowseal') refreshFlowsealDomains().catch(() => {});
    return getProxyStatus();
}
function persist(patch) {
    const s = Object.assign({}, loadSettings(), patch);
    saveSettings(s);
    applySettings(s);
    state.cursor.clear();
    broadcastProxyState();
    return s;
}
function setProxyMode(mode) {
    const next = normalizeMode(mode);
    persist({ proxy_mode: next, proxy_auto_latched: false });
    state.autoLatched = false;
    state.autoReason = '';
    state.directFailures = [];
    state.lastError = '';
    state.lastRoute = next === 'always' ? 'cf' : 'direct';
    if (isProxyActive() && state.domainSource === 'flowseal') refreshFlowsealDomains().catch(() => {});
    return getProxyStatus();
}
function resetAutoProxy() {
    persist({ proxy_mode: 'auto', proxy_auto_latched: false, proxy_web_fallback_latched: false });
    state.autoLatched = false;
    state.webFallbackLatched = false;
    state.autoReason = '';
    state.directFailures = [];
    state.lastError = '';
    state.lastRoute = 'direct';
    return getProxyStatus();
}
function forceProxyReconnect(reason = 'renderer-network-stall') {
    if (!isProxyActive()) {
        if (state.mode === 'auto' && !state.autoLatched) {
            state.reconnectEpoch++;
            persistAutoLatch(reason === 'renderer-network-stall' ? 'direct-network-stall' : reason);
            console.warn(`[TG-PROXY] direct Telegram transport stalled; switching auto mode to embedded proxy`);
        }
        return getProxyStatus();
    }
    state.reconnectEpoch++;
    state.lastError = '';
    console.warn(`[TG-PROXY] forcing Telegram socket reconnect (${reason})`);
    broadcastProxyState();
    return getProxyStatus();
}
function updateProxyOptions(options) {
    const o = options || {};
    const patch = {};
    if ('domainSource' in o) patch.proxy_domain_source = o.domainSource === 'custom' ? 'custom' : 'flowseal';
    if ('customDomains' in o) patch.proxy_custom_domains = normalizeDomains(o.customDomains);
    if ('pinnedDomain' in o) patch.proxy_pinned_domain = validDomain(o.pinnedDomain) ? String(o.pinnedDomain).trim().toLowerCase() : '';
    if ('workerEnabled' in o) patch.proxy_worker_enabled = o.workerEnabled === true;
    if ('workerDomains' in o) patch.proxy_worker_domains = normalizeDomains(o.workerDomains);
    if ('autoFailures' in o) patch.proxy_auto_failures = Math.max(1, Math.min(10, Number(o.autoFailures) || 1));
    if ('autoWindowSec' in o) patch.proxy_auto_window_sec = Math.max(3, Math.min(120, Number(o.autoWindowSec) || 12));
    if ('webFallback' in o) {
        patch.proxy_web_fallback = o.webFallback !== false;
        if (o.webFallback === false) patch.proxy_web_fallback_latched = false;
    }
    if ('dcIps' in o) patch.proxy_dc_ips = normalizeDcIps(o.dcIps);
    const before = loadSettings();
    const routeKeys = ['proxy_domain_source','proxy_custom_domains','proxy_pinned_domain','proxy_worker_enabled','proxy_worker_domains','proxy_dc_ips'];
    const needsReconnect = routeKeys.some(k => k in patch && JSON.stringify(before[k]) !== JSON.stringify(patch[k]));
    if (needsReconnect) state.reconnectEpoch++;
    persist(patch);
    return getProxyStatus();
}function persistAutoLatch(reason) {
    if (state.mode !== 'auto' || state.autoLatched) return false;
    state.autoLatched = true;
    state.autoReason = reason || 'direct-ws-failed';
    state.lastRoute = 'cf';
    const s = loadSettings();
    saveSettings(Object.assign({}, s, { proxy_mode: 'auto', proxy_auto_latched: true }));
    console.warn(`[TG-PROXY] auto switched to embedded proxy (${state.autoReason})`);
    broadcastProxyState();
    if (state.domainSource === 'flowseal') refreshFlowsealDomains().catch(() => {});
    return true;
}
function recordDirectFailure(details) {
    if (state.mode !== 'auto' || state.autoLatched) return;
    const now = Date.now();
    const windowMs = state.autoWindowSec * 1000;
    state.directFailures = state.directFailures.filter(x => now - x.at < windowMs);
    state.directFailures.push({ at: now, url: details.url, error: details.error || '' });
    state.lastError = details.error || 'direct websocket failed';
    if (state.directFailures.length >= state.autoFailures) persistAutoLatch('direct-ws-failed');
}
function getProxyStatus() {
    return {
        mode: state.mode, autoLatched: state.autoLatched, active: isProxyActive(),
        reason: state.autoReason, route: state.lastRoute, domain: state.lastDomain,
        lastError: state.lastError, lastDc: state.lastDc, domains: activeDomains(),
        flowsealDomains: state.flowsealDomains.slice(), domainSource: state.domainSource,
        customDomains: state.customDomains.slice(), pinnedDomain: state.pinnedDomain,
        preferredControlDomain: state.preferredControlDomain, preferredMediaDomain: state.preferredMediaDomain,
        workerEnabled: state.workerEnabled, workerDomains: state.workerDomains.slice(),
        autoFailures: state.autoFailures, autoWindowSec: state.autoWindowSec,
        reconnectEpoch: state.reconnectEpoch,
        webFallback: state.webFallback, webFallbackLatched: state.webFallbackLatched,
        dcIps: { ...state.dcIps },
    };
}
function isWebFallbackEnabled() { return state.webFallback; }

function testWs(url, timeoutMs = 6000) {
    return new Promise(resolve => {
        let done = false;
        const finish = (ok, error = '') => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'test'); } catch (_) {}
            resolve({ ok, error });
        };
        let ws;
        try { ws = new WebSocket(url, 'binary'); }
        catch (e) { resolve({ ok: false, error: e.message }); return; }
        const timer = setTimeout(() => finish(false, 'timeout'), timeoutMs);
        ws.addEventListener('open', () => finish(true), { once: true });
        ws.addEventListener('error', () => finish(false, 'connection failed'), { once: true });
    });
}
async function testProxyConnectivity() {
    const cfg = getProxyBootstrap();
    return Promise.all([1, 2, 3, 4, 5].map(async (dc) => {
        const attempts = [];
        if (cfg.workerEnabled && cfg.dcIps[dc]) {
            for (const domain of cfg.workerDomains) {
                attempts.push({ domain, url: `wss://${domain}/apiws?dst=${encodeURIComponent(cfg.dcIps[dc])}&dc=${dc}&media=0` });
            }
        } else {
            for (const domain of cfg.domains) attempts.push({ domain, url: `wss://kws${dc}.${domain}/apiws` });
        }
        let final = { dc, ok: false, error: 'no routes', domain: '', url: '' };
        for (const attempt of attempts) {
            const r = await testWs(attempt.url, 4500);
            final = { dc, domain: attempt.domain, url: attempt.url, ok: r.ok, error: r.error };
            if (r.ok) break;
        }
        return final;
    }));
}

function installFlowsealWsRoute(ses, initialSettings) {
    if (state.installed || !ses) return getProxyStatus();
    state.installed = true;
    state.session = ses;
    applySettings(initialSettings || loadSettings());
    const wr = ses.webRequest;
    wr.onBeforeRequest({ urls: ['wss://*/*', 'ws://*/*'] }, (details, callback) => {
        try {
            const u = new URL(details.url);
            const directDc = dcFromTelegramWsHost(u.hostname);
            const routed = parseRoutedTarget(details.url);
            if (routed) {
                state.lastRoute = routed.kind;
                state.lastDomain = routed.domain;
                state.lastDc = routed.dc;
                console.log(`[TG-PROXY] DC${routed.dc} via ${routed.domain}`);
            } else if (directDc) {
                state.lastRoute = 'direct';
                state.lastDc = directDc;
            }
        } catch (e) { state.lastError = e && e.message ? e.message : String(e); }
        callback({});
    });
    wr.onErrorOccurred({ urls: ['wss://*/*', 'ws://*/*'] }, details => {
        let host = '';
        try { host = new URL(details.url).hostname; } catch (_) {}
        const directDc = dcFromTelegramWsHost(host);
        if (directDc && !isProxyActive()) {
            console.warn(`[TG-PROXY] direct DC${directDc} failed: ${details.error || 'unknown error'}`);
            recordDirectFailure(details);
            return;
        }
        const routed = parseRoutedTarget(details.url);
        if (!routed) return;
        state.lastError = details.error || 'proxy websocket failed';
        state.lastDc = routed.dc;
    });
    wr.onCompleted({ urls: ['wss://*/*', 'ws://*/*'] }, details => {
        const routed = parseRoutedTarget(details.url);
        if (routed && details.statusCode < 400) {
            state.lastRoute = routed.kind;
            state.lastDomain = routed.domain;
            state.lastDc = routed.dc;
            state.lastError = '';
        }
    });
    if (!state.refreshTimer) {
        state.refreshTimer = setInterval(() => {
            if (state.domainSource === 'flowseal') refreshFlowsealDomains().catch(() => {});
        }, DOMAIN_REFRESH_MS);
        if (state.refreshTimer.unref) state.refreshTimer.unref();
    }
    if (state.domainSource === 'flowseal') refreshFlowsealDomains().catch(() => {});
    console.log(`[TG-PROXY] route installed; mode=${state.mode}; active=${isProxyActive()}`);
    return getProxyStatus();
}
function noteTelegramLoadFailure(error) {
    state.lastError = error ? String(error) : 'Telegram page load failed';
    if (state.webFallback && !state.webFallbackLatched) {
        state.webFallbackLatched = true;
        const s = loadSettings();
        saveSettings(Object.assign({}, s, { proxy_web_fallback_latched: true }));
        console.warn('[TG-PROXY] Web A direct path marked unavailable; fallback will be used on next start');
    }
    const justActivated = state.mode === 'auto' && !state.autoLatched
        ? persistAutoLatch('telegram-load-failed') : false;
    return Object.assign(getProxyStatus(), { justActivated });
}

module.exports = {
    installFlowsealWsRoute, configureProxySettings, setProxyMode, resetAutoProxy, forceProxyReconnect,
    updateProxyOptions, getProxyStatus, getProxyBootstrap, noteTelegramLoadFailure,
    refreshFlowsealDomains, testProxyConnectivity, isWebFallbackEnabled,
    dcFromTelegramWsHost, DEFAULT_CF_BASE_DOMAINS, DC_IPS,
    setBridgeEndpoint, reportBridgeRoute, reportBridgeError,
    reportBridgePreferredDomain, clearBridgePreferredDomain,
};