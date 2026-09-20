'use strict';

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { UpstreamHealth, DEFAULT_COOLDOWN_MS } = require('./tg-flowseal-health.cjs');
const {
    getProxyBootstrap, setBridgeEndpoint,
    reportBridgeRoute, reportBridgeError,
    reportBridgePreferredDomain, clearBridgePreferredDomain,
} = require('./tg-flowseal-route.cjs');

let server = null;
let wss = null;
let bridgePort = 0;
let bridgeToken = '';

const ZERO_64 = Buffer.alloc(64);
const PROTO_ABRIDGED = Buffer.from('efefefef', 'hex');
const PROTO_INTERMEDIATE = Buffer.from('eeeeeeee', 'hex');
const PROTO_PADDED_INTERMEDIATE = Buffer.from('dddddddd', 'hex');
const PROTO_TAGS = new Set([
    PROTO_ABRIDGED.toString('hex'),
    PROTO_INTERMEDIATE.toString('hex'),
    PROTO_PADDED_INTERMEDIATE.toString('hex'),
]);
const RESERVED_FIRST = new Set([0xef]);
const RESERVED_STARTS = new Set([
    '48454144', '504f5354', '47455420',
    'eeeeeeee', 'dddddddd', '16030102',
]);

function makeCipher(key, iv, skip = 0) {
    const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
    if (skip) cipher.update(ZERO_64.subarray(0, skip));
    return cipher;
}
function reverseKeyIv(header) {
    const rev = Buffer.from(header.subarray(8, 56)).reverse();
    return { key: rev.subarray(0, 32), iv: rev.subarray(32, 48) };
}

function decodeClientProtoTag(clientInit) {
    try {
        const cipher = crypto.createDecipheriv(
            'aes-256-ctr', clientInit.subarray(8, 40), clientInit.subarray(40, 56)
        );
        const plain = cipher.update(clientInit);
        const tag = Buffer.from(plain.subarray(56, 60));
        return PROTO_TAGS.has(tag.toString('hex')) ? tag : PROTO_ABRIDGED;
    } catch (_) {
        return PROTO_ABRIDGED;
    }
}

function generateRelayInit(protoTag, dcIdx) {
    let rnd;
    do {
        rnd = crypto.randomBytes(64);
    } while (
        RESERVED_FIRST.has(rnd[0]) ||
        RESERVED_STARTS.has(rnd.subarray(0, 4).toString('hex')) ||
        rnd.subarray(4, 8).equals(Buffer.alloc(4))
    );

    const key = rnd.subarray(8, 40);
    const iv = rnd.subarray(40, 56);
    const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
    const encrypted = cipher.update(rnd);
    const tail = Buffer.alloc(8);
    protoTag.copy(tail, 0);
    tail.writeInt16LE(dcIdx, 4);
    rnd.copy(tail, 6, 62, 64);

    const out = Buffer.from(rnd);
    for (let i = 0; i < 8; i++) {
        const keystream = encrypted[56 + i] ^ rnd[56 + i];
        out[56 + i] = tail[i] ^ keystream;
    }
    return out;
}
function buildCrypto(clientInit, relayInit) {
    const clientOut = makeCipher(clientInit.subarray(8, 40), clientInit.subarray(40, 56), 64);
    const clientRev = reverseKeyIv(clientInit);
    const clientIn = makeCipher(clientRev.key, clientRev.iv);

    const relayOut = makeCipher(relayInit.subarray(8, 40), relayInit.subarray(40, 56), 64);
    const relayRev = reverseKeyIv(relayInit);
    const relayIn = makeCipher(relayRev.key, relayRev.iv);

    return { clientOut, clientIn, relayOut, relayIn };
}

function upstreamCandidates(cfg, dc, media) {
    if (cfg.workerEnabled && cfg.workerDomains?.length && cfg.dcIps?.[dc]) {
        return cfg.workerDomains.map(domain => ({
            kind: 'worker', domain,
            url: `wss://${domain}/apiws?dst=${encodeURIComponent(cfg.dcIps[dc])}&dc=${dc}&media=${media ? 1 : 0}`,
        }));
    }
    return (cfg.domains || []).map(domain => ({
        kind: 'cf', domain,
        url: `wss://kws${dc}.${domain}/apiws`,
    }));
}

const controlUpstreamHealth = new UpstreamHealth();
const mediaUpstreamHealth = new UpstreamHealth();
const MEDIA_SLOW_RESPONSE_MS = 3_000;
const MEDIA_RESPONSE_TIMEOUT_MS = 6_000;
const MEDIA_THROUGHPUT_SAMPLE_BYTES = 128 * 1024;
const MEDIA_MIN_THROUGHPUT_BPS = 96 * 1024;
const MEDIA_THROUGHPUT_IDLE_MS = 900;
const MEDIA_THROUGHPUT_WINDOW_MS = 4_000;

function healthFor(media) {
    return media ? mediaUpstreamHealth : controlUpstreamHealth;
}
function noteUpstreamFailure(candidate, reason, media = false) {
    const domain = candidate && candidate.domain;
    if (!domain) return;
    healthFor(media).markFailure(domain);
    clearBridgePreferredDomain(domain, media);
    console.warn(`[TG-PROXY-BRIDGE] ${domain} ${media ? 'media ' : ''}cooling down for ${Math.round(DEFAULT_COOLDOWN_MS / 1000)}s: ${reason}`);
}

function openUpstream(cfg, dc, media) {
    const health = healthFor(media);
    health.seedPreferred(media ? cfg.preferredMediaDomain : cfg.preferredControlDomain);
    const candidates = health.rank(upstreamCandidates(cfg, dc, media));
    return new Promise((resolve, reject) => {
        if (!candidates.length) return reject(new Error('no upstream routes'));
        const startedAt = Date.now();
        const sockets = new Set();
        const timers = new Set();
        const errors = [];
        let finished = 0;
        let settled = false;

        const cleanup = winner => {
            for (const t of timers) clearTimeout(t);
            timers.clear();
            for (const ws of sockets) {
                if (ws === winner) continue;
                try { ws.terminate(); } catch (_) {}
            }
            sockets.clear();
        };
        const failed = (candidate, message) => {
            errors.push(`${candidate.domain}: ${message}`);
            noteUpstreamFailure(candidate, message, media);
            finished++;
            if (!settled && finished >= candidates.length) {
                settled = true;
                cleanup(null);
                reject(new Error(errors.join('; ') || 'all upstream routes failed'));
            }
        };
        const launch = candidate => {
            if (settled) return;
            let done = false;
            const upstream = new WebSocket(candidate.url, 'binary', {
                handshakeTimeout: 4500,
                perMessageDeflate: false,
            });
            sockets.add(upstream);
            upstream.binaryType = 'arraybuffer';
            const timer = setTimeout(() => {
                if (done || settled) return;
                done = true;
                try { upstream.terminate(); } catch (_) {}
                failed(candidate, 'timeout');
            }, 5000);
            timers.add(timer);
            upstream.once('open', () => {
                if (done || settled) {
                    try { upstream.terminate(); } catch (_) {}
                    return;
                }
                done = true;
                settled = true;
                clearTimeout(timer);
                // A media socket is not considered healthy merely because the
                // WebSocket handshake succeeded. Its domain earns preference only
                // after it actually returns MTProto data for a media request.
                if (!media) {
                    health.markSuccess(candidate.domain);
                    reportBridgePreferredDomain(candidate.domain, false);
                }
                const latencyMs = Date.now() - startedAt;
                cleanup(upstream);
                console.log(`[TG-PROXY-BRIDGE] upstream ${candidate.domain} opened in ${latencyMs}ms`);
                resolve({ upstream, candidate, latencyMs });
            });
            upstream.once('error', err => {
                if (done || settled) return;
                done = true;
                clearTimeout(timer);
                try { upstream.terminate(); } catch (_) {}
                failed(candidate, err?.message || 'connect failed');
            });
        };

        candidates.forEach((candidate, index) => {
            const delay = index === 0 ? 0 : Math.min(900, index * 75);
            const timer = setTimeout(() => {
                timers.delete(timer);
                launch(candidate);
            }, delay);
            timers.add(timer);
        });
    });
}

function closePeer(ws, code = 1011, reason = 'bridge closed') {
    try {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            ws.close(code, String(reason).slice(0, 100));
        }
    } catch (_) {}
}

function handleLocalConnection(local, request) {
    const u = new URL(request.url, 'ws://127.0.0.1');
    const dc = Number(u.searchParams.get('dc'));
    const media = u.searchParams.get('media') === '1';
    const token = u.searchParams.get('token') || '';
    if (token !== bridgeToken || ![1, 2, 3, 4, 5, 203].includes(dc)) {
        local.close(1008, 'invalid bridge request');
        return;
    }
    let upstream = null;
    let upstreamCandidate = null;
    let upstreamFailureNoted = false;
    let ctx = null;
    let closed = false;
    let chain = Promise.resolve();
    let mediaProbeTimer = null;
    let mediaProbeStartedAt = 0;
    let mediaProbeDone = !media;
    let mediaConnectionPenalized = false;
    let mediaSampleActive = false;
    let mediaSampleStartedAt = 0;
    let mediaSampleBytes = 0;
    let mediaSampleIdleTimer = null;
    let mediaSampleWindowTimer = null;
    const initialCfg = getProxyBootstrap();
    const upstreamReady = initialCfg.active
        ? openUpstream(initialCfg, dc, media).then(opened => ({ opened }), error => ({ error }))
        : null;

    const clearMediaProbe = () => {
        if (mediaProbeTimer) clearTimeout(mediaProbeTimer);
        mediaProbeTimer = null;
    };
    const clearMediaSample = () => {
        if (mediaSampleIdleTimer) clearTimeout(mediaSampleIdleTimer);
        if (mediaSampleWindowTimer) clearTimeout(mediaSampleWindowTimer);
        mediaSampleIdleTimer = null;
        mediaSampleWindowTimer = null;
        mediaSampleActive = false;
        mediaSampleBytes = 0;
        mediaSampleStartedAt = 0;
    };
    const fail = err => {
        clearMediaProbe();
        clearMediaSample();
        if (closed) return;
        const message = err?.message || String(err || 'bridge failure');
        reportBridgeError(dc, message);
        console.error(`[TG-PROXY-BRIDGE] DC${dc}${media ? ' media' : ''}: ${message}`);
        closePeer(local, 1011, 'upstream failed');
        if (upstream) closePeer(upstream, 1011, 'bridge failed');
    };
    const noteActiveFailure = reason => {
        if (upstreamFailureNoted) return;
        upstreamFailureNoted = true;
        noteUpstreamFailure(upstreamCandidate, reason, media);
    };
    const armMediaProbe = () => {
        if (!media || mediaProbeDone || mediaProbeTimer || !upstreamCandidate) return;
        mediaProbeStartedAt = Date.now();
        mediaProbeTimer = setTimeout(() => {
            mediaProbeTimer = null;
            if (closed || mediaProbeDone) return;
            const reason = `media first response timeout after ${MEDIA_RESPONSE_TIMEOUT_MS}ms`;
            noteActiveFailure(reason);
            fail(new Error(reason));
        }, MEDIA_RESPONSE_TIMEOUT_MS);
        if (mediaProbeTimer.unref) mediaProbeTimer.unref();
    };
    const finishMediaSample = (reason) => {
        if (!mediaSampleActive || !upstreamCandidate) return;
        const elapsedMs = Math.max(1, Date.now() - mediaSampleStartedAt);
        const bytes = mediaSampleBytes;
        const bps = Math.round(bytes * 1000 / elapsedMs);
        const shouldEvaluate = reason === 'window' || bytes >= MEDIA_THROUGHPUT_SAMPLE_BYTES;
        clearMediaSample();
        if (!shouldEvaluate) return;

        if (bps < MEDIA_MIN_THROUGHPUT_BPS) {
            const why = `slow media throughput ${Math.round(bps / 1024)}KiB/s`;
            mediaConnectionPenalized = true;
            noteActiveFailure(why);
            console.warn(`[TG-PROXY-BRIDGE] ${upstreamCandidate.domain} ${why}`);
            // Forward the current chunk first, then rotate this media socket so
            // Telegram can immediately retry the request through another upstream.
            const timer = setTimeout(() => {
                if (!closed) fail(new Error(why));
            }, 0);
            if (timer.unref) timer.unref();
            return;
        }

        if (!mediaConnectionPenalized) {
            mediaUpstreamHealth.markSuccess(upstreamCandidate.domain);
            reportBridgePreferredDomain(upstreamCandidate.domain, true);
        }
        console.log(`[TG-PROXY-BRIDGE] ${upstreamCandidate.domain} media throughput ${Math.round(bps / 1024)}KiB/s`);
    };
    const addMediaSampleBytes = count => {
        if (!mediaSampleActive || !Number.isFinite(count) || count <= 0) return;
        mediaSampleBytes += count;
        if (mediaSampleIdleTimer) clearTimeout(mediaSampleIdleTimer);
        mediaSampleIdleTimer = setTimeout(() => {
            // A short response (thumbnail, small metadata packet) is not a useful
            // throughput sample and must never penalize a healthy route.
            finishMediaSample('idle');
        }, MEDIA_THROUGHPUT_IDLE_MS);
        if (mediaSampleIdleTimer.unref) mediaSampleIdleTimer.unref();
        if (mediaSampleBytes >= MEDIA_THROUGHPUT_SAMPLE_BYTES) finishMediaSample('sample');
    };
    const startMediaSample = initialBytes => {
        if (!media || mediaSampleActive || !upstreamCandidate) return;
        mediaSampleActive = true;
        mediaSampleStartedAt = Date.now();
        mediaSampleBytes = 0;
        mediaSampleWindowTimer = setTimeout(() => {
            if (mediaSampleActive) finishMediaSample('window');
        }, MEDIA_THROUGHPUT_WINDOW_MS);
        if (mediaSampleWindowTimer.unref) mediaSampleWindowTimer.unref();
        addMediaSampleBytes(initialBytes);
    };
    const finishMediaProbe = initialBytes => {
        if (!media || mediaProbeDone || !mediaProbeTimer || !upstreamCandidate) return;
        const responseMs = Math.max(0, Date.now() - mediaProbeStartedAt);
        clearMediaProbe();
        mediaProbeDone = true;
        if (responseMs > MEDIA_SLOW_RESPONSE_MS) {
            mediaConnectionPenalized = true;
            upstreamFailureNoted = true;
            noteUpstreamFailure(upstreamCandidate, `slow media first response ${responseMs}ms`, true);
            console.warn(`[TG-PROXY-BRIDGE] ${upstreamCandidate.domain} media response slow: ${responseMs}ms`);
        } else {
            mediaUpstreamHealth.markSuccess(upstreamCandidate.domain);
            reportBridgePreferredDomain(upstreamCandidate.domain, true);
            console.log(`[TG-PROXY-BRIDGE] ${upstreamCandidate.domain} media first response ${responseMs}ms`);
        }
        startMediaSample(initialBytes);
    };

    local.on('message', data => {
        chain = chain.then(async () => {
            const chunk = Buffer.from(data);
            if (!ctx) {
                if (chunk.length !== 64) throw new Error(`expected 64-byte init, got ${chunk.length}`);
                const cfg = getProxyBootstrap();
                if (!cfg.active) throw new Error('proxy became inactive');
                const protoTag = decodeClientProtoTag(chunk);
                const relayInit = generateRelayInit(protoTag, media ? -dc : dc);
                console.log(`[TG-PROXY-BRIDGE] DC${dc}${media ? ' media' : ''} proto=${protoTag.toString('hex')}`);
                ctx = buildCrypto(chunk, relayInit);
                let opened;
                if (upstreamReady) {
                    const warmed = await upstreamReady;
                    if (warmed.error) throw warmed.error;
                    opened = warmed.opened;
                } else {
                    opened = await openUpstream(cfg, dc, media);
                }
                upstream = opened.upstream;
                upstreamCandidate = opened.candidate;
                reportBridgeRoute(dc, opened.candidate.domain, opened.candidate.kind);
                console.log(`[TG-PROXY-BRIDGE] DC${dc}${media ? ' media' : ''} via ${opened.candidate.domain}`);

                upstream.on('message', incoming => {
                    try {
                        const raw = Buffer.from(incoming);
                        if (!mediaProbeDone) finishMediaProbe(raw.length);
                        else addMediaSampleBytes(raw.length);
                        const plain = ctx.relayIn.update(raw);
                        const clientCipher = ctx.clientIn.update(plain);
                        if (local.readyState === WebSocket.OPEN) local.send(clientCipher, { binary: true });
                    } catch (e) { fail(e); }
                });
                upstream.on('close', (code, reason) => {
                    if (closed) return;
                    const why = reason?.toString() || `upstream closed ${code}`;
                    if (code !== 1000) noteActiveFailure(why);
                    closePeer(local, code === 1000 ? 1000 : 1011, why);
                });
                upstream.on('error', err => {
                    noteActiveFailure(err?.message || 'upstream error');
                    fail(err);
                });
                upstream.send(relayInit, { binary: true });
                return;
            }

            if (!upstream || upstream.readyState !== WebSocket.OPEN) throw new Error('upstream is not open');
            const plain = ctx.clientOut.update(chunk);
            const relayed = ctx.relayOut.update(plain);
            if (media) {
                if (!mediaProbeDone) armMediaProbe();
                else if (!mediaSampleActive) startMediaSample(0);
            }
            upstream.send(relayed, { binary: true });
        }).catch(fail);
    });
    local.on('close', () => {
        clearMediaProbe();
        clearMediaSample();
        closed = true;
        if (upstream) {
            try { upstream.close(1000, 'local closed'); } catch (_) {}
        }
    });
    local.on('error', err => {
        if (!closed) console.warn('[TG-PROXY-BRIDGE] local socket error:', err?.message || err);
    });
}

async function startEmbeddedFlowsealBridge() {
    if (server && bridgePort) return { port: bridgePort, token: bridgeToken };
    bridgeToken = crypto.randomBytes(16).toString('hex');
    server = http.createServer((req, res) => {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
    });
    wss = new WebSocketServer({
        server,
        path: '/apiws',
        perMessageDeflate: false,
        handleProtocols(protocols) {
            return protocols.has('binary') ? 'binary' : false;
        },
    });
    wss.on('connection', handleLocalConnection);
    wss.on('error', err => console.error('[TG-PROXY-BRIDGE] server error:', err));

    await new Promise((resolve, reject) => {
        const onError = err => { server.off('listening', onListen); reject(err); };
        const onListen = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListen);
        server.listen(0, '127.0.0.1');
    });
    bridgePort = server.address().port;
    setBridgeEndpoint(bridgePort, bridgeToken);
    console.log(`[TG-PROXY-BRIDGE] listening on 127.0.0.1:${bridgePort}`);
    return { port: bridgePort, token: bridgeToken };
}
async function stopEmbeddedFlowsealBridge() {
    setBridgeEndpoint(0, '');
    bridgePort = 0;
    bridgeToken = '';
    if (wss) {
        for (const client of wss.clients) {
            try { client.terminate(); } catch (_) {}
        }
        try { wss.close(); } catch (_) {}
        wss = null;
    }
    if (server) {
        const current = server;
        server = null;
        await new Promise(resolve => {
            try { current.close(() => resolve()); } catch (_) { resolve(); }
        });
    }
}

module.exports = { startEmbeddedFlowsealBridge, stopEmbeddedFlowsealBridge };