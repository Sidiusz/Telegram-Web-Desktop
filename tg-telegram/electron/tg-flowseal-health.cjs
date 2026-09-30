'use strict';

const DEFAULT_COOLDOWN_MS = 45_000;

class UpstreamHealth {
    constructor(options = {}) {
        this.cooldownMs = Math.max(1_000, Number(options.cooldownMs) || DEFAULT_COOLDOWN_MS);
        this.now = typeof options.now === 'function' ? options.now : Date.now;
        this.preferredDomain = '';
        this.cooldowns = new Map();
    }

    _prune(now = this.now()) {
        for (const [domain, until] of this.cooldowns) {
            if (until <= now) this.cooldowns.delete(domain);
        }
    }

    seedPreferred(domain) {
        const d = String(domain || '');
        if (d && !this.preferredDomain) this.preferredDomain = d;
    }

    markSuccess(domain) {
        const d = String(domain || '');
        if (!d) return;
        this.cooldowns.delete(d);
        this.preferredDomain = d;
    }

    markFailure(domain) {
        const d = String(domain || '');
        if (!d) return 0;
        const until = this.now() + this.cooldownMs;
        this.cooldowns.set(d, until);
        if (this.preferredDomain === d) this.preferredDomain = '';
        return until;
    }

    isCooling(domain) {
        this._prune();
        return (this.cooldowns.get(String(domain || '')) || 0) > this.now();
    }

    rank(candidates) {
        const now = this.now();
        this._prune(now);
        const healthy = [];
        const cooling = [];
        for (const candidate of candidates || []) {
            const until = this.cooldowns.get(candidate.domain) || 0;
            if (until > now) cooling.push({ candidate, until });
            else healthy.push(candidate);
        }
        healthy.sort((a, b) =>
            (b.domain === this.preferredDomain ? 1 : 0) -
            (a.domain === this.preferredDomain ? 1 : 0));
        cooling.sort((a, b) => a.until - b.until);
        // A cooldown must actually suppress retries while there are healthy routes.
        // Only fall back to cooling candidates when every known route is cooling.
        return healthy.length ? healthy : cooling.map(x => x.candidate);
    }

}

// ws Receiver states: 0 = waiting for a new frame header, 6 = deferred event emit.
function frameInProgress(ws) {
    const rx = ws && ws._receiver;
    if (!rx || typeof rx._bufferedBytes !== 'number') return false;
    return rx._bufferedBytes > 0 ||
        (rx._state !== 0 && rx._state !== 6) ||
        (Array.isArray(rx._fragments) && rx._fragments.length > 0);
}

// Fires onStall once when a frame has started arriving but no bytes follow for stallMs.
// An idle socket between frames is never treated as stalled.
function watchFrameStall(ws, { stallMs, onStall, checkMs, now = Date.now } = {}) {
    const socket = ws && ws._socket;
    if (!socket || typeof onStall !== 'function') return () => {};
    let lastRx = now();
    let stopped = false;
    const onData = () => { lastRx = now(); };
    socket.on('data', onData);
    const timer = setInterval(() => {
        if (stopped || !frameInProgress(ws) || now() - lastRx < stallMs) return;
        stop();
        onStall(now() - lastRx);
    }, Math.max(50, Number(checkMs) || Math.min(2000, Math.floor(stallMs / 4))));
    if (timer.unref) timer.unref();
    function stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        try { socket.off('data', onData); } catch (_) {}
    }
    return stop;
}

// Moves one of the first `width` candidates to the front so parallel sockets spread across routes.
function rotateCandidates(list, offset, width = 4) {
    const items = Array.isArray(list) ? list.slice() : [];
    const span = Math.min(items.length, Math.max(1, width));
    if (span < 2) return items;
    const shift = ((Number(offset) || 0) % span + span) % span;
    return items.slice(shift, span).concat(items.slice(0, shift), items.slice(span));
}

// Opens candidates one at a time; the next one starts after hedgeMs or right after a failure.
function hedgedOpen(candidates, connect, {
    hedgeMs = 1200, maxInFlight = 2, timeoutMs = 5000, onFailure,
} = {}) {
    const list = Array.isArray(candidates) ? candidates.slice() : [];
    return new Promise((resolve, reject) => {
        if (!list.length) return reject(new Error('no upstream routes'));
        const startedAt = Date.now();
        const live = new Set();
        const errors = [];
        let next = 0;
        let settled = false;
        let hedgeTimer = null;

        const finish = () => {
            if (hedgeTimer) clearTimeout(hedgeTimer);
            hedgeTimer = null;
        };
        const armHedge = () => {
            if (hedgeTimer) clearTimeout(hedgeTimer);
            hedgeTimer = next < list.length ? setTimeout(() => { hedgeTimer = null; launch(); }, hedgeMs) : null;
        };
        const failed = (candidate, message) => {
            errors.push(`${candidate.domain}: ${message}`);
            if (typeof onFailure === 'function') { try { onFailure(candidate, message); } catch (_) {} }
            if (settled) return;
            if (next < list.length) { launch(); return; }
            if (!live.size) {
                settled = true;
                finish();
                reject(new Error(errors.join('; ') || 'all upstream routes failed'));
            }
        };
        function launch() {
            if (settled || next >= list.length) return;
            if (live.size >= maxInFlight) { armHedge(); return; }
            const candidate = list[next++];
            let socket;
            try { socket = connect(candidate); }
            catch (e) { failed(candidate, e && e.message || 'connect failed'); return; }
            socket.on('error', () => {});
            const entry = { socket, done: false };
            live.add(entry);
            const timer = setTimeout(() => {
                if (entry.done) return;
                entry.done = true;
                live.delete(entry);
                try { socket.terminate(); } catch (_) {}
                failed(candidate, 'timeout');
            }, timeoutMs);
            socket.once('open', () => {
                if (entry.done) return;
                entry.done = true;
                clearTimeout(timer);
                live.delete(entry);
                if (settled) { try { socket.terminate(); } catch (_) {} return; }
                settled = true;
                finish();
                for (const other of live) {
                    other.done = true;
                    try { other.socket.terminate(); } catch (_) {}
                }
                live.clear();
                resolve({ upstream: socket, candidate, latencyMs: Date.now() - startedAt });
            });
            socket.once('error', err => {
                if (entry.done) return;
                entry.done = true;
                clearTimeout(timer);
                live.delete(entry);
                try { socket.terminate(); } catch (_) {}
                failed(candidate, err && err.message || 'connect failed');
            });
            armHedge();
        }
        launch();
    });
}

// Telegram reports transport-level failures (e.g. -404 unknown auth key, -429 flood) as a bare
// 4-byte negative int packet instead of an MTProto message.
function readTransportError(plain, protoTag) {
    if (!plain || !protoTag) return 0;
    let code = 0;
    if (protoTag.toString('hex') === 'efefefef') {
        if (plain.length === 5 && plain[0] === 1) code = plain.readInt32LE(1);
    } else if (plain.length === 8 && plain.readUInt32LE(0) === 4) {
        code = plain.readInt32LE(4);
    }
    return code < 0 ? code : 0;
}

module.exports = {
    UpstreamHealth, DEFAULT_COOLDOWN_MS, frameInProgress, watchFrameStall, rotateCandidates, hedgedOpen,
    readTransportError,
};
