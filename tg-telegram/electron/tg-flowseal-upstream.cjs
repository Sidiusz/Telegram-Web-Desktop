'use strict';

// Routes to Telegram itself, ported from Flowseal tg-ws-proxy: its WebSocket front reached by IP
// (optionally domain-fronted), a pool of pre-opened sockets for it, and raw TCP as the last resort.

const net = require('net');
const { EventEmitter } = require('events');
const { WebSocket } = require('ws');

// Flowseal's SNI for the fronted variant: Telegram's front serves a valid certificate for it.
const FRONTING_SNI = 'sprinthost.ru';
const TG_LABEL = 'web.telegram.org';
const POOL_SIZE = 2;
const POOL_MAX_AGE_MS = 120_000;
const POOL_CHECK_MS = 5_000;
const POOL_CONNECT_TIMEOUT_MS = 8_000;
const POOL_BACKOFF_INITIAL_MS = 1_000;
const POOL_BACKOFF_MAX_MS = 60 * 60 * 1000;

// Flowseal keeps the mode that worked last first (plain SNI vs fronted).
let frontingFirst = false;

function telegramWsHost(dc, media) {
    return `kws${dc}${media ? '-1' : ''}.web.telegram.org`;
}

function telegramCandidates(cfg, dc, media) {
    const ip = cfg.tgWsIps && cfg.tgWsIps[dc];
    if (!ip) return [];
    const url = `wss://${telegramWsHost(dc, media)}/apiws`;
    const plain = { kind: 'tg', domain: TG_LABEL, ip, url, front: false };
    const fronted = { kind: 'tg', domain: FRONTING_SNI, ip, url, front: true };
    return frontingFirst ? [fronted, plain] : [plain, fronted];
}

function tcpCandidates(cfg, dc) {
    const ip = cfg.dcIps && cfg.dcIps[dc];
    return ip ? [{ kind: 'tcp', domain: ip, ip, port: 443 }] : [];
}

function noteTelegramSuccess(candidate) {
    if (candidate && candidate.kind === 'tg') frontingFirst = !!candidate.front;
}

// Pins the socket to the candidate's IP while the URL keeps the real name for the Host header.
function pinnedLookup(ip) {
    return (hostname, options, callback) => {
        if (typeof options === 'function') { callback = options; options = {}; }
        if (options && options.all) callback(null, [{ address: ip, family: 4 }]);
        else callback(null, ip, 4);
    };
}

function openTelegramWs(candidate, { handshakeTimeout = 4500 } = {}) {
    const options = {
        handshakeTimeout,
        perMessageDeflate: false,
        lookup: pinnedLookup(candidate.ip),
    };
    if (candidate.front) {
        // Like Flowseal: the chain is still verified, only the name differs from the Host header.
        // MTProto authenticates Telegram's servers on its own inside the tunnel.
        options.servername = FRONTING_SNI;
        options.checkServerIdentity = () => undefined;
    }
    const ws = new WebSocket(candidate.url, 'binary', options);
    ws.binaryType = 'arraybuffer';
    return ws;
}

// Raw MTProto over TCP, shaped like a ws socket for the bridge: open/message/close/error,
// readyState, send, close and terminate. The obfuscated init is sent as the first bytes.
class TcpUpstream extends EventEmitter {
    constructor(ip, port = 443) {
        super();
        this.readyState = WebSocket.CONNECTING;
        this._socket = net.connect({ host: ip, port, noDelay: true });
        this._socket.once('connect', () => {
            this.readyState = WebSocket.OPEN;
            this.emit('open');
        });
        this._socket.on('data', data => this.emit('message', data));
        this._socket.on('error', err => this.emit('error', err));
        this._socket.once('close', hadError => {
            const wasOpen = this.readyState === WebSocket.OPEN || this.readyState === WebSocket.CLOSING;
            const clean = this.readyState === WebSocket.CLOSING;
            this.readyState = WebSocket.CLOSED;
            if (wasOpen) this.emit('close', clean && !hadError ? 1000 : 1006, Buffer.from(clean ? '' : 'tcp connection closed'));
        });
    }
    send(data) {
        if (this.readyState !== WebSocket.OPEN) return;
        this._socket.write(Buffer.from(data));
    }
    close() {
        if (this.readyState === WebSocket.CLOSED) return;
        if (this.readyState === WebSocket.CONNECTING) { this.terminate(); return; }
        this.readyState = WebSocket.CLOSING;
        this._socket.end();
    }
    terminate() {
        if (this.readyState === WebSocket.CONNECTING) this.readyState = WebSocket.CLOSED;
        else if (this.readyState === WebSocket.OPEN) this.readyState = WebSocket.CLOSING;
        this._socket.destroy();
    }
}

// Pre-opened sockets to Telegram's front per (dc, media), as Flowseal's WsPool: sockets older than
// two minutes are replaced, and refills that keep failing back off exponentially.
class TelegramWsPool {
    constructor({
        size = POOL_SIZE, maxAgeMs = POOL_MAX_AGE_MS, open = openTelegramWs, now = Date.now, isActive = () => true,
    } = {}) {
        this.size = size;
        this.isActive = isActive;
        this.maxAgeMs = maxAgeMs;
        this.open = open;
        this.now = now;
        this.buckets = new Map();
        this.refilling = new Set();
        this.failures = new Map();
        this.retryAt = new Map();
        this.targets = new Map();
        this.timer = null;
    }

    _key(dc, media) { return `${dc}:${media ? 1 : 0}`; }

    _fresh(entry, now) {
        return entry.ws.readyState === WebSocket.OPEN && now - entry.createdAt < this.maxAgeMs;
    }

    // Takes a ready socket, or null; either way the bucket is topped up in the background.
    take(dc, media, candidates) {
        if (!candidates.length) return null;
        const key = this._key(dc, media);
        this.targets.set(key, { dc, media, candidates });
        const bucket = this.buckets.get(key) || [];
        const now = this.now();
        let picked = null;
        while (bucket.length && !picked) {
            const entry = bucket.shift();
            if (this._fresh(entry, now)) picked = entry;
            else this._discard(entry);
        }
        this.buckets.set(key, bucket);
        this._refill(key);
        this._startTimer();
        if (!picked) return null;
        picked.ws.removeListener('close', picked.onClose);
        return { upstream: picked.ws, candidate: picked.candidate, latencyMs: 0 };
    }

    // True while refills for this key keep failing: callers then skip the route instead of waiting on it.
    isBackingOff(dc, media) {
        return this.now() < (this.retryAt.get(this._key(dc, media)) || 0);
    }

    _discard(entry) {
        try { entry.ws.removeListener('close', entry.onClose); } catch (_) {}
        try { entry.ws.terminate(); } catch (_) {}
    }

    _refill(key) {
        if (!this.isActive()) { this.reset(); return; }
        const target = this.targets.get(key);
        if (!target || this.refilling.has(key) || this.now() < (this.retryAt.get(key) || 0)) return;
        const bucket = this.buckets.get(key) || [];
        const needed = this.size - bucket.length;
        if (needed <= 0) return;
        this.refilling.add(key);
        Promise.all(Array.from({ length: needed }, () => this._connectOne(target.candidates))).then(results => {
            this.refilling.delete(key);
            if (!this.targets.has(key)) { results.forEach(e => e && this._discard(e)); return; }
            const opened = results.filter(Boolean);
            const current = this.buckets.get(key) || [];
            for (const entry of opened) {
                if (current.length >= this.size) { this._discard(entry); continue; }
                entry.onClose = () => {
                    const list = this.buckets.get(key) || [];
                    const at = list.indexOf(entry);
                    if (at >= 0) list.splice(at, 1);
                };
                entry.ws.on('close', entry.onClose);
                current.push(entry);
            }
            this.buckets.set(key, current);
            if (opened.length) {
                this.failures.delete(key);
                this.retryAt.delete(key);
            } else {
                const failures = (this.failures.get(key) || 0) + 1;
                this.failures.set(key, failures);
                const delay = Math.min(POOL_BACKOFF_INITIAL_MS * 2 ** Math.min(failures - 1, 12), POOL_BACKOFF_MAX_MS);
                this.retryAt.set(key, this.now() + delay);
                console.warn(`[TG-PROXY-BRIDGE] Telegram WS pool refill failed for DC${target.dc}${target.media ? ' media' : ''}, retry in ${Math.round(delay / 1000)}s`);
            }
        });
    }

    // Tries the plain and fronted variants in order, like Flowseal's _connect_one.
    async _connectOne(candidates) {
        for (const candidate of candidates) {
            const ws = await new Promise(resolve => {
                let socket;
                try { socket = this.open(candidate, { handshakeTimeout: POOL_CONNECT_TIMEOUT_MS }); }
                catch (_) { resolve(null); return; }
                socket.on('error', () => {});
                const done = ok => {
                    socket.removeListener('open', onOpen);
                    socket.removeListener('close', onFail);
                    if (!ok) { try { socket.terminate(); } catch (_) {} }
                    resolve(ok ? socket : null);
                };
                const onOpen = () => done(true);
                const onFail = () => done(false);
                socket.once('open', onOpen);
                socket.once('close', onFail);
            });
            if (ws) {
                noteTelegramSuccess(candidate);
                return { ws, candidate, createdAt: this.now() };
            }
        }
        return null;
    }

    _startTimer() {
        if (this.timer) return;
        this.timer = setInterval(() => this._rotate(), POOL_CHECK_MS);
        if (this.timer.unref) this.timer.unref();
    }

    _rotate() {
        if (!this.isActive()) { this.reset(); return; }
        const now = this.now();
        for (const [key, bucket] of this.buckets) {
            const kept = bucket.filter(entry => {
                if (this._fresh(entry, now)) return true;
                this._discard(entry);
                return false;
            });
            this.buckets.set(key, kept);
            this._refill(key);
        }
    }

    // Drops every pooled socket and forgets targets, e.g. when the proxy is switched off or the
    // network changes; the next connection warms the pool again.
    reset() {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        for (const bucket of this.buckets.values()) bucket.forEach(entry => this._discard(entry));
        this.buckets.clear();
        this.targets.clear();
        this.refilling.clear();
        this.failures.clear();
        this.retryAt.clear();
        frontingFirst = false;
    }

    // Retries right away after a network change instead of waiting out a long backoff.
    clearBackoff() {
        this.failures.clear();
        this.retryAt.clear();
    }
}

module.exports = {
    FRONTING_SNI, TG_LABEL, POOL_SIZE, POOL_MAX_AGE_MS,
    telegramWsHost, telegramCandidates, tcpCandidates, noteTelegramSuccess,
    pinnedLookup, openTelegramWs, TcpUpstream, TelegramWsPool,
};
