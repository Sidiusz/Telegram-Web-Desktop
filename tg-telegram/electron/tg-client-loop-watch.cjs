'use strict';

// Web A can get stuck after a network drop: it reopens its main MTProto socket, closes it itself
// ~31 s later and repeats for hours while chats stay on "updating". Only a reload recovers it.
const SHORT_MIN_MS = 20000;
const SHORT_MAX_MS = 45000;
const LOOP_THRESHOLD = 6;
const RELOAD_COOLDOWN_MS = 10 * 60 * 1000;

function createClientLoopWatch({ onLoop, now = Date.now } = {}) {
    let streak = 0;
    let lastReloadAt = -Infinity;
    return {
        noteMainClose({ lifetimeMs, byClient }) {
            if (!byClient) return false;
            if (lifetimeMs < SHORT_MIN_MS || lifetimeMs > SHORT_MAX_MS) {
                streak = 0;
                return false;
            }
            streak++;
            if (streak < LOOP_THRESHOLD || now() - lastReloadAt < RELOAD_COOLDOWN_MS) return false;
            streak = 0;
            lastReloadAt = now();
            try { onLoop && onLoop(); } catch (_) {}
            return true;
        },
        reset() { streak = 0; },
    };
}

module.exports = { createClientLoopWatch, LOOP_THRESHOLD };
