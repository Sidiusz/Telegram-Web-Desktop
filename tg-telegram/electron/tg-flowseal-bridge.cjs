'use strict';

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const {
    UpstreamHealth, DEFAULT_COOLDOWN_MS, watchFrameStall, rotateCandidates, hedgedOpen, readTransportError,
} = require('./tg-flowseal-health.cjs');
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
const CONTROL_RESPONSE_TIMEOUT_MS = 8_000;
const MEDIA_SLOW_RESPONSE_MS = 3_000;
const MEDIA_RESPONSE_TIMEOUT_MS = 10_000;
const FRAME_STALL_MS = 12_000;
const UPSTREAM_HEDGE_MS = 1_200;
const MEDIA_SPREAD_WIDTH = 4;
let mediaSpreadCursor = 0;

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
    if (!media && cfg.avoidControlDomain && Number(cfg.avoidControlUntil) > Date.now()) {
        health.markFailure(cfg.avoidControlDomain);
    }
    let candidates = health.rank(upstreamCandidates(cfg, dc, media));
    // Telegram opens several media sockets at once; spreading them avoids piling every
    // download onto one Cloudflare hostname and its WebSocket limits.
    if (media) candidates = rotateCandidates(candidates, mediaSpreadCursor++, MEDIA_SPREAD_WIDTH);
    // A route is not considered healthy merely because the WebSocket handshake
    // succeeded; domains earn preference only after they return MTProto data.
    return hedgedOpen(candidates, candidate => {
        const upstream = new WebSocket(candidate.url, 'binary', {
            handshakeTimeout: 4500,
            perMessageDeflate: false,
        });
        upstream.binaryType = 'arraybuffer';
        return upstream;
    }, {
        hedgeMs: UPSTREAM_HEDGE_MS,
        maxInFlight: 2,
        timeoutMs: 5000,
        onFailure: (candidate, message) => noteUpstreamFailure(candidate, message, media),
    }).then(opened => {
        console.log(`[TG-PROXY-BRIDGE] upstream ${opened.candidate.domain} opened in ${opened.latencyMs}ms`);
        return opened;
    });
}

function formatBytes(n) {
    return n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(1)}KB` : `${(n / 1048576).toFixed(1)}MB`;
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
    let controlProbeTimer = null;
    let controlProbeDone = media;
    let mediaProbeTimer = null;
    let mediaProbeStartedAt = 0;
    let mediaProbeDone = !media;
    let stopStallWatch = () => {};
    let protoTag = null;
    let closedBy = '';
    const traffic = { upBytes: 0, upFrames: 0, downBytes: 0, downFrames: 0, maxDown: 0, openedAt: Date.now() };
    const initialCfg = getProxyBootstrap();
    const upstreamReady = initialCfg.active
        ? openUpstream(initialCfg, dc, media).then(opened => ({ opened }), error => ({ error }))
        : null;

    const clearControlProbe = () => {
        if (controlProbeTimer) clearTimeout(controlProbeTimer);
        controlProbeTimer = null;
    };
    const clearMediaProbe = () => {
        if (mediaProbeTimer) clearTimeout(mediaProbeTimer);
        mediaProbeTimer = null;
    };
    const fail = err => {
        clearControlProbe();
        clearMediaProbe();
        stopStallWatch();
        if (closed) return;
        const message = err?.message || String(err || 'bridge failure');
        reportBridgeError(dc, message);
        console.error(`[TG-PROXY-BRIDGE] DC${dc}${media ? ' media' : ''}: ${message}`);
        closedBy = closedBy || `bridge (${message})`;
        closePeer(local, 1011, 'upstream failed');
        if (upstream) closePeer(upstream, 1011, 'bridge failed');
    };
    const noteActiveFailure = reason => {
        if (upstreamFailureNoted) return;
        upstreamFailureNoted = true;
        noteUpstreamFailure(upstreamCandidate, reason, media);
    };
    const armControlProbe = () => {
        if (media || controlProbeDone || controlProbeTimer || !upstreamCandidate) return;
        controlProbeTimer = setTimeout(() => {
            controlProbeTimer = null;
            if (closed || controlProbeDone) return;
            const reason = `control first response timeout after ${CONTROL_RESPONSE_TIMEOUT_MS}ms`;
            noteActiveFailure(reason);
            fail(new Error(reason));
        }, CONTROL_RESPONSE_TIMEOUT_MS);
        if (controlProbeTimer.unref) controlProbeTimer.unref();
    };
    const finishControlProbe = () => {
        if (media || controlProbeDone || !upstreamCandidate) return;
        clearControlProbe();
        controlProbeDone = true;
        controlUpstreamHealth.markSuccess(upstreamCandidate.domain);
        reportBridgePreferredDomain(upstreamCandidate.domain, false);
        console.log(`[TG-PROXY-BRIDGE] ${upstreamCandidate.domain} control route returned MTProto data`);
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
    // Idle media sockets are normal (acks get no reply), so only a first-response timeout
    // or a frame that stops mid-transfer counts against a route.
    const finishMediaProbe = () => {
        if (!media || mediaProbeDone || !mediaProbeTimer || !upstreamCandidate) return;
        const responseMs = Math.max(0, Date.now() - mediaProbeStartedAt);
        clearMediaProbe();
        mediaProbeDone = true;
        if (responseMs > MEDIA_SLOW_RESPONSE_MS) {
            upstreamFailureNoted = true;
            noteUpstreamFailure(upstreamCandidate, `slow media first response ${responseMs}ms`, true);
            console.warn(`[TG-PROXY-BRIDGE] ${upstreamCandidate.domain} media response slow: ${responseMs}ms`);
        } else {
            mediaUpstreamHealth.markSuccess(upstreamCandidate.domain);
            // Media sockets rotate across domains; persist only a fallback seed, not every rotation.
            if (!getProxyBootstrap().preferredMediaDomain) reportBridgePreferredDomain(upstreamCandidate.domain, true);
            console.log(`[TG-PROXY-BRIDGE] ${upstreamCandidate.domain} media first response ${responseMs}ms`);
        }
    };

    local.on('message', data => {
        chain = chain.then(async () => {
            const chunk = Buffer.from(data);
            if (!ctx) {
                if (chunk.length !== 64) throw new Error(`expected 64-byte init, got ${chunk.length}`);
                const cfg = getProxyBootstrap();
                if (!cfg.active) throw new Error('proxy became inactive');
                protoTag = decodeClientProtoTag(chunk);
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
                if (closed) {
                    try { opened.upstream.terminate(); } catch (_) {}
                    return;
                }
                upstream = opened.upstream;
                upstreamCandidate = opened.candidate;
                reportBridgeRoute(dc, opened.candidate.domain, opened.candidate.kind);
                console.log(`[TG-PROXY-BRIDGE] DC${dc}${media ? ' media' : ''} via ${opened.candidate.domain}`);

                stopStallWatch = watchFrameStall(upstream, {
                    stallMs: FRAME_STALL_MS,
                    onStall: idleMs => {
                        const why = `transfer stalled mid-frame for ${Math.round(idleMs / 1000)}s`;
                        noteActiveFailure(why);
                        fail(new Error(why));
                    },
                });
                upstream.on('message', incoming => {
                    try {
                        const raw = Buffer.from(incoming);
                        traffic.downBytes += raw.length;
                        traffic.downFrames++;
                        if (raw.length > traffic.maxDown) traffic.maxDown = raw.length;
                        if (!media && !controlProbeDone) finishControlProbe();
                        if (!mediaProbeDone) finishMediaProbe();
                        const plain = ctx.relayIn.update(raw);
                        const transportError = readTransportError(plain, protoTag);
                        if (transportError) {
                            console.warn(`[TG-PROXY-BRIDGE] DC${dc}${media ? ' media' : ''} via ${upstreamCandidate.domain}: Telegram transport error ${transportError}`);
                        }
                        const clientCipher = ctx.clientIn.update(plain);
                        if (local.readyState === WebSocket.OPEN) local.send(clientCipher, { binary: true });
                    } catch (e) { fail(e); }
                });
                upstream.on('close', (code, reason) => {
                    if (closed) return;
                    const why = reason?.toString() || `upstream closed ${code}`;
                    if (code !== 1000 || (!media && !controlProbeDone) || (media && !mediaProbeDone)) noteActiveFailure(why);
                    closedBy = closedBy || `upstream (${code}${reason?.length ? ' ' + reason : ''})`;
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
            traffic.upBytes += chunk.length;
            traffic.upFrames++;
            const plain = ctx.clientOut.update(chunk);
            const relayed = ctx.relayOut.update(plain);
            if (media) {
                if (!mediaProbeDone) armMediaProbe();
            } else if (!controlProbeDone) {
                armControlProbe();
            }
            upstream.send(relayed, { binary: true });
        }).catch(fail);
    });
    local.on('close', code => {
        clearControlProbe();
        clearMediaProbe();
        stopStallWatch();
        if (!closed && upstreamCandidate) {
            const secs = ((Date.now() - traffic.openedAt) / 1000).toFixed(1);
            console.log(`[TG-PROXY-BRIDGE] DC${dc}${media ? ' media' : ''} via ${upstreamCandidate.domain} closed by ${closedBy || `client (${code})`} after ${secs}s: ` +
                `up ${formatBytes(traffic.upBytes)}/${traffic.upFrames}, down ${formatBytes(traffic.downBytes)}/${traffic.downFrames} (max ${formatBytes(traffic.maxDown)})`);
        }
        closed = true;
        if (upstream) {
            try { upstream.close(1000, 'local closed'); } catch (_) {}
        } else if (upstreamReady) {
            upstreamReady.then(r => { if (r.opened && r.opened.upstream !== upstream) r.opened.upstream.terminate(); }).catch(() => {});
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
        // Only Telegram's own MTProto worker may use the relay (not Mini App frames or other local pages).
        verifyClient: ({ origin }) => origin === 'https://web.telegram.org',
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