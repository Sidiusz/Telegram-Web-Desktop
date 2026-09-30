;(() => {
    let cfg = __TWD_PROXY_BOOTSTRAP__;
    let privacy = {
        noReadReceipts: false, noTyping: false,
        noReadForceOn: new Set(), noReadForceOff: new Set(),
        noTypingForceOn: new Set(), noTypingForceOff: new Set(),
    };
    let allowReadPeerId = '';
    let allowReadOnceUntil = 0;
    const live = new Set();
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
            ws.addEventListener('close', () => live.delete(ws), { once: true });
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
