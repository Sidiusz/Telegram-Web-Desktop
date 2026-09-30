(function () {
    if (window.__twdDetachedMediaCleanup) return;
    window.__twdDetachedMediaCleanup = true;

    var pending = new Set();
    var timer = null;
    var released = 0;

    function collect(root) {
        if (!root || root.nodeType !== 1) return;
        pending.add(root);
        if (!timer) timer = setTimeout(flush, 1000);
    }

    function releaseElement(el) {
        if (!el || el.isConnected) return;
        try {
            if (el instanceof HTMLMediaElement) {
                try { el.pause(); } catch (_) {}
                try { el.srcObject = null; } catch (_) {}
                el.removeAttribute('src');
                el.removeAttribute('poster');
                el.querySelectorAll('source').forEach(function (s) {
                    s.removeAttribute('src');
                    s.removeAttribute('srcset');
                });
                try { el.load(); } catch (_) {}
                released++;
                return;
            }
            if (el instanceof HTMLImageElement) {
                el.removeAttribute('src');
                el.removeAttribute('srcset');
                released++;
                return;
            }
            if (el instanceof HTMLCanvasElement) {
                el.width = 0;
                el.height = 0;
                released++;
                return;
            }
            if (el.tagName === 'SOURCE') {
                el.removeAttribute('src');
                el.removeAttribute('srcset');
                released++;
            }
        } catch (_) {}
    }

    function releaseTree(root) {
        if (!root || root.isConnected) return;
        releaseElement(root);
        if (root.querySelectorAll) {
            root.querySelectorAll('video,audio,img,canvas,source').forEach(releaseElement);
        }
    }

    function flush() {
        timer = null;
        var roots = Array.from(pending);
        pending.clear();
        roots.forEach(function (root) {
            if (root.parentElement && !root.parentElement.isConnected) return;
            releaseTree(root);
        });
    }

    var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            mutation.removedNodes.forEach(collect);
        });
    });

    function bind() {
        var root = document.getElementById('MiddleColumn');
        if (!root) {
            setTimeout(bind, 250);
            return;
        }
        observer.observe(root, { childList: true, subtree: true });
    }

    window.__twdDetachedMediaStats = function () {
        return { pending: pending.size, released: released };
    };

    bind();
})();