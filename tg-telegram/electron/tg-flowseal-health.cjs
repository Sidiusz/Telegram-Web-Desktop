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
        return healthy.concat(cooling.map(x => x.candidate));
    }

    snapshot() {
        this._prune();
        return {
            preferredDomain: this.preferredDomain,
            cooldowns: Object.fromEntries(this.cooldowns),
        };
    }
}

module.exports = { UpstreamHealth, DEFAULT_COOLDOWN_MS };
