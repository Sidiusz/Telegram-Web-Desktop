'use strict';

const TELEGRAM_LINK_HOSTS = new Set(['t.me', 'telegram.me', 'telegram.dog']);

function isTelegramWebLink(raw) {
    try {
        const u = new URL(String(raw || ''));
        if (u.protocol === 'tg:') return true;
        const host = u.hostname.toLowerCase().replace(/^www\./, '');
        return (u.protocol === 'https:' || u.protocol === 'http:') && TELEGRAM_LINK_HOSTS.has(host);
    } catch (_) { return false; }
}

function normalizeToTg(raw) {
    if (!raw || typeof raw !== 'string') return null;
    if (/^tg:\/\//i.test(raw)) return raw;
    let u;
    try { u = new URL(raw); } catch (_) { return null; }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!TELEGRAM_LINK_HOSTS.has(host)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    const first = parts[0];
    const action = first.toLowerCase();
    if (first.startsWith('+') || action === 'joinchat') {
        const invite = first.startsWith('+') ? first.slice(1) : (parts[1] || '');
        return invite ? 'tg://join?invite=' + encodeURIComponent(invite) : null;
    }
    if (action === 'c' && /^\d+$/.test(parts[1] || '') && /^\d+$/.test(parts[2] || '')) {
        const qs = new URLSearchParams(u.searchParams);
        qs.delete('channel'); qs.delete('thread'); qs.delete('post');
        qs.set('channel', parts[1]);
        if (parts[3] && /^\d+$/.test(parts[3])) { qs.set('thread', parts[2]); qs.set('post', parts[3]); }
        else qs.set('post', parts[2]);
        return 'tg://privatepost?' + qs.toString();
    }
    if (action === 'share' && (parts[1] || '').toLowerCase() === 'url') {
        return 'tg://msg_url?' + u.searchParams.toString();
    }
    if (action === 'proxy' || action === 'socks') return 'tg://' + action + '?' + u.searchParams.toString();
    const actionMap = {
        addstickers: 'set', addemoji: 'set', setlanguage: 'lang',
        login: 'code', invoice: 'slug', giftcode: 'slug',
    };
    if (actionMap[action] && parts[1]) {
        const qs = new URLSearchParams(u.searchParams);
        qs.set(actionMap[action], parts[1]);
        return 'tg://' + action + '?' + qs.toString();
    }
    const offset = action === 's' ? 1 : 0;
    const domain = parts[offset];
    if (!domain) return null;
    const qs = new URLSearchParams(u.searchParams);
    qs.set('domain', domain);
    if (parts[offset + 1] && /^\d+$/.test(parts[offset + 1])) qs.set('post', parts[offset + 1]);
    return 'tg://resolve?' + qs.toString();
}

function getTgUrlFromArgs(argv) {
    for (const arg of Array.isArray(argv) ? argv : []) {
        const tg = normalizeToTg(arg);
        if (tg) return tg;
    }
    return null;
}

module.exports = { normalizeToTg, getTgUrlFromArgs, isTelegramWebLink };
