'use strict';
const { transformedJsResponse } = require('./tg-bundle-patch.cjs');
const FORWARD_CHUNK_RE = /\/assets\/extra-[^/]+\.js$/i;
const FORWARD_MARKER = 'forwardToMultipleChats';

// The share picker opens the chat when exactly one recipient is selected, but sends in place for
// two or more. Route a single recipient through the same in-place send (Saved Messages keeps its own path).
const SINGLE_RE = /if\(([\w$]+)\.length===1\)\{let\{peerId:([\w$]+),topicId:([\w$]+)\}=\1\[0\];if\(\2===([\w$]+)\)\{([\w$]+)\(\);return\}[\w$]+\(\{chatId:\2,topicId:\3\}\)(?:;return\}|\}else )/;

function patchTelegramForward(body) {
    const source = String(body || '');
    if (!source.includes(FORWARD_MARKER)) return { body: source, patched: false };
    const m = SINGLE_RE.exec(source);
    if (!m) return { body: source, patched: false };
    const [, list, , , self, toSaved] = m;
    const replacement = `if(${list}.length===1&&${list}[0].peerId===${self}){${toSaved}();return}`;
    return { body: source.slice(0, m.index) + replacement + source.slice(m.index + m[0].length), patched: true };
}

async function injectTelegramForward(response, urlString) {
    let u;
    try { u = new URL(urlString); } catch (_) { return response; }
    if (u.hostname !== 'web.telegram.org' || !FORWARD_CHUNK_RE.test(u.pathname)) return response;
    const source = await response.text();
    const patched = patchTelegramForward(source);
    if (patched.patched) console.log('[TWD-FWD] single-recipient forward stays in the current chat');
    else if (source.includes(FORWARD_MARKER)) console.warn('[TWD-FWD] share picker pattern not found; single forward opens the chat');
    return transformedJsResponse(response, patched.body);
}

module.exports = { injectTelegramForward, patchTelegramForward };
