;(() => {
    let cfg = __TWD_PROXY_BOOTSTRAP__;
    globalThis.__twdBlockHttpTransport = !!cfg.active;
    let privacy = {
        noReadReceipts: false, noTyping: false,
        noReadForceOn: new Set(), noReadForceOff: new Set(),
        noTypingForceOn: new Set(), noTypingForceOff: new Set(),
    };
    let allowReadPeerId = '';
    let allowReadOnceUntil = 0;
    const live = new Set();
    const mediaSockets = new Map();
    // Last sign of life per Telegram socket: opened, a frame arrived, or bytes still leaving.
    const lastProgress = new WeakMap();
    const watchedRequests = new Set();
    let mediaRecoveryTimer = null;
    const MEDIA_REQUEST_STALL_MS = 12000;
    const WATCH_MAX_MS = 3 * 60 * 1000;
    // Requests of exported (media) senders that must get an answer. Uploads (upload.Save*) are
    // left out: a slow uplink sends a part for longer than the stall window without any reply.
    const WATCHED_SEND = /^(upload\.get(file|cdnfile|webfile|filehashes|cdnfilehashes)|auth\.(import|export)authorization|invokewithlayer)$/;

    function senderSocket(sender) {
        try {
            const connection = sender && typeof sender.getConnection === 'function' && sender.getConnection();
            const client = connection && connection.socket && connection.socket.client;
            return client && live.has(client) ? client : null;
        } catch (_) { return null; }
    }
    function stallSocket(ws, now) {
        lastProgress.set(ws, now);
        mediaSockets.set(ws, now);
        try { ws.close(4002, 'media-request-stalled'); } catch (_) {}
    }
    function checkStalls() {
        const now = Date.now();
        if (!cfg.active) return;
        let unknownSenderStalled = false;
        for (const token of Array.from(watchedRequests)) {
            if (now - token.startedAt >= WATCH_MAX_MS) { unwatchRequest(token); continue; }
            if (!token.sender) {
                if (now - token.startedAt >= MEDIA_REQUEST_STALL_MS) unknownSenderStalled = true;
                continue;
            }
            const ws = senderSocket(token.sender);
            if (!ws || ws.readyState !== NativeWebSocket.OPEN) continue;
            if (ws.bufferedAmount > 0) { lastProgress.set(ws, now); continue; }
            // A request resent on a fresh socket after reconnect gets a fresh window from its open time.
            if (now - Math.max(token.startedAt, lastProgress.get(ws) || 0) >= MEDIA_REQUEST_STALL_MS) stallSocket(ws, now);
        }
        // Requests without a known sender (main-sender invoke path): close silent media sockets.
        if (!unknownSenderStalled) return;
        for (const [ws, last] of mediaSockets) {
            if (now - last < MEDIA_REQUEST_STALL_MS || ws.readyState !== NativeWebSocket.OPEN) continue;
            stallSocket(ws, now);
        }
    }
    function watchRequest(sender, signal) {
        const token = { startedAt: Date.now(), sender: sender || null };
        watchedRequests.add(token);
        if (signal && typeof signal.addEventListener === 'function') {
            try { signal.addEventListener('abort', () => unwatchRequest(token), { once: true }); } catch (_) {}
        }
        if (!mediaRecoveryTimer) mediaRecoveryTimer = setInterval(checkStalls, 1000);
        return token;
    }
    function unwatchRequest(token) {
        watchedRequests.delete(token);
        if (!watchedRequests.size && mediaRecoveryTimer) {
            clearInterval(mediaRecoveryTimer);
            mediaRecoveryTimer = null;
        }
    }

    // Watch actual file RPCs, not socket silence: MTProto acknowledgements and idle
    // pooled sockets legitimately receive no reply. The old first-frame probe stops
    // after authentication, before most file transfers even begin.
    globalThis.__twdInvokeWithMediaRecovery = async (request, invoke) => {
        if (!cfg.active || !/^upload\.(getfile|getcdnfile|getwebfile)$/.test(requestName(request))) return invoke();
        const token = watchRequest(null, null);
        try { return await invoke(); }
        finally { unwatchRequest(token); }
    };
    // Patched MTProtoSender.send of exported senders: Web A downloads files there, and a relay
    // that keeps the socket open but stops answering leaves the file at 0% until a restart.
    // Closing that sender's socket makes GramJS reconnect and resend the pending request.
    globalThis.__twdWatchSend = (sender, request, promise, signal) => {
        try {
            if (!cfg.active || !promise || typeof promise.then !== 'function' || !WATCHED_SEND.test(requestName(request))) return promise;
            const token = watchRequest(sender, signal);
            promise.then(() => unwatchRequest(token), () => unwatchRequest(token));
        } catch (_) {}
        return promise;
    };
    const readReceiptMethods = new Set([
        'messages.readhistory',
        'channels.readhistory',
        'messages.readdiscussion',
        'messages.readmessagecontents',
        'channels.readmessagecontents',
        'messages.readmentions',
        'messages.readreactions',
    ]);
    const privacyLogAt = new Map();
    const named = { pluto: 1, venus: 2, aurora: 3, vesta: 4, flora: 5 };
    const channelName = __TWD_PROXY_CHANNEL__;

    function dcInfo(host) {
        const h = String(host || '').toLowerCase();
        if (!h.endsWith('.web.telegram.org')) return null;
        const label = h.slice(0, -'.web.telegram.org'.length);
        const m = /^(?:kws|zws)(\d+)(-1)?$/.exec(label);
        if (m) return { id: Number(m[1]), media: !!m[2] };
        const n = /^([a-z]+)(-1)?$/.exec(label);
        return n && named[n[1]] ? { id: named[n[1]], media: !!n[2] } : null;
    }

    function signature(x) {
        return JSON.stringify([
            !!x.active, x.bridgePort || 0, x.bridgeToken || '', x.reconnectEpoch || 0,
        ]);
    }

    function route(originalUrl) {
        const target = String(originalUrl);
        try {
            const u = new URL(target);
            const info = dcInfo(u.hostname);
            if (!cfg.active || !cfg.bridgePort || !cfg.bridgeToken || !info) return target;
            const q = new URLSearchParams({
                dc: String(info.id),
                media: info.media ? '1' : '0',
                token: cfg.bridgeToken,
            });
            return `ws://127.0.0.1:${cfg.bridgePort}/apiws?${q}`;
        } catch (_) { return target; }
    }

    function apply(next) {
        if (!next || typeof next !== 'object') return;
        const changed = signature(cfg) !== signature(next);
        cfg = next;
        globalThis.__twdBlockHttpTransport = !!cfg.active;
        if (!changed) return;
        console.log('[TG-PROXY-WORKER] route update');
        for (const ws of Array.from(live)) {
            try { ws.close(4001, 'proxy-route-changed'); } catch (_) {}
        }
    }

    function applyPrivacy(next) {
        if (!next || typeof next !== 'object') return;
        privacy = {
            noReadReceipts: next.noReadReceipts === true,
            noTyping: next.noTyping === true,
            noReadForceOn: new Set((next.noReadForceOn || []).map(String)),
            noReadForceOff: new Set((next.noReadForceOff || []).map(String)),
            noTypingForceOn: new Set((next.noTypingForceOn || []).map(String)),
            noTypingForceOff: new Set((next.noTypingForceOff || []).map(String)),
        };
        console.log(`[TWD-PRIVACY] unread=${privacy.noReadReceipts ? 'on' : 'off'} typing=${privacy.noTyping ? 'on' : 'off'}`);
    }

    function requestName(request) {
        try {
            return String(request && (request.className || request.constructor && request.constructor.className) || '').toLowerCase();
        } catch (_) { return ''; }
    }

    function requestPeerId(request) {
        try {
            const peer = request && (request.peer || request.channel);
            if (!peer) return '';
            const kind = String(peer.className || peer.constructor && peer.constructor.className || '').toLowerCase();
            if (kind.includes('peeruser') && peer.userId != null) return String(peer.userId);
            if (kind.includes('peerchat') && peer.chatId != null) return '-' + String(peer.chatId);
            if ((kind.includes('peerchannel') || kind === 'inputchannel') && peer.channelId != null) return '-100' + String(peer.channelId);
        } catch (_) {}
        return '';
    }

    function effective(base, forceOn, forceOff, peerId) {
        if (peerId && forceOff.has(peerId)) return false;
        if (peerId && forceOn.has(peerId)) return true;
        return base;
    }

    globalThis.__twdPrivacyShouldBlock = request => {
        const name = requestName(request);
        const peerId = requestPeerId(request);
        let blocked = false;
        if (effective(privacy.noReadReceipts, privacy.noReadForceOn, privacy.noReadForceOff, peerId) && readReceiptMethods.has(name)) {
            if (Date.now() <= allowReadOnceUntil && (!allowReadPeerId || !peerId || allowReadPeerId === peerId)) {
                console.log(`[TWD-PRIVACY] allowed explicit ${name}`);
                return false;
            }
            blocked = true;
        }
        if (!blocked && effective(privacy.noTyping, privacy.noTypingForceOn, privacy.noTypingForceOff, peerId) && name === 'messages.settyping') {
            let actionName = '';
            try { actionName = String(request && request.action && (request.action.className || request.action.constructor && request.action.constructor.className) || '').toLowerCase(); } catch (_) {}
            blocked = !actionName.includes('emojiinteraction');
        }
        if (!blocked) return false;
        const now = Date.now();
        if (now - (privacyLogAt.get(name) || 0) > 1500) {
            privacyLogAt.set(name, now);
            console.log(`[TWD-PRIVACY] blocked ${name}`);
        }
        return true;
    };

    function attach(ws, originalUrl) {
        try {
            const info = dcInfo(new URL(String(originalUrl)).hostname);
            if (!info) return ws;
            live.add(ws);
            lastProgress.set(ws, Date.now());
            if (info.media) mediaSockets.set(ws, Date.now());
            ws.addEventListener('message', () => {
                const now = Date.now();
                lastProgress.set(ws, now);
                if (mediaSockets.has(ws)) mediaSockets.set(ws, now);
            });
            ws.addEventListener('close', () => { live.delete(ws); mediaSockets.delete(ws); }, { once: true });
        } catch (_) {}
        return ws;
    }

    const NativeWebSocket = globalThis.WebSocket;
    if (typeof NativeWebSocket === 'function') {
        globalThis.WebSocket = new Proxy(NativeWebSocket, {
            construct(Target, args, newTarget) {
                const nextArgs = Array.from(args);
                const originalUrl = nextArgs[0];
                let telegram = false;
                try { telegram = !!dcInfo(new URL(String(originalUrl)).hostname); } catch (_) {}
                if (telegram) nextArgs[0] = route(originalUrl);
                const ws = Reflect.construct(Target, nextArgs, newTarget);
                return telegram ? attach(ws, originalUrl) : ws;
            },
        });
    }

    try {
        const channel = new BroadcastChannel(channelName);
        channel.onmessage = event => {
            const data = event && event.data;
            if (data && data.__twdProxyConfig) apply(data.__twdProxyConfig);
            if (data && data.__twdPrivacyConfig) applyPrivacy(data.__twdPrivacyConfig);
            if (data && Object.prototype.hasOwnProperty.call(data, '__twdPrivacyAllowReadOnce')) {
                allowReadPeerId = String(data.__twdPrivacyAllowReadOnce || '');
                allowReadOnceUntil = Date.now() + 2000;
            }
        };
        channel.postMessage({ __twdProxyHello: true });
    } catch (_) {}

    console.log('[TG-PROXY-WORKER] embedded bridge WebSocket wrapper enabled');
})();
