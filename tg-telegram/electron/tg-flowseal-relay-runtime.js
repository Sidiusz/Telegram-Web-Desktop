;(() => {
    let cfg = __TWD_PROXY_INITIAL__;
    const live = new Set();
    const named = { pluto: 1, venus: 2, aurora: 3, vesta: 4, flora: 5 };

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
        // Only changes that require rebuilding the browser-side DC socket belong here.
        // Flowseal domain refreshes are handled by the embedded bridge and must not
        // tear down an already healthy Telegram connection.
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
                dc: String(info.id), media: info.media ? '1' : '0', token: cfg.bridgeToken,
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

    function attach(ws, originalUrl) {
        try {
            const info = dcInfo(new URL(String(originalUrl)).hostname);
            if (!info) return ws;
            live.add(ws);
            ws.addEventListener('close', () => live.delete(ws), { once: true });
        } catch (_) {}
        return ws;
    }

    globalThis.addEventListener('message', e => {
        const data = e && e.data;
        if (!data || !data.__twdProxyConfig) return;
        try { e.stopImmediatePropagation(); } catch (_) {}
        apply(data.__twdProxyConfig);
    }, true);

    try {
        const bc = new BroadcastChannel('__twd_proxy_v1');
        bc.onmessage = e => apply(e.data);
    } catch (_) {}

    globalThis.__twdFlowsealRoute = route;
    globalThis.__twdFlowsealAttach = attach;
    console.log('[TG-PROXY-WORKER] embedded bridge hooks enabled');
})();