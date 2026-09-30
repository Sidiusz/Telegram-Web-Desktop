'use strict';

// Rewritten Telegram JS must never be cached by the browser or keep a stale length/encoding.
function transformedJsResponse(response, body, extraHeaders = {}) {
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/javascript; charset=utf-8');
    headers.set('cache-control', 'no-store, no-cache, must-revalidate');
    headers.set('pragma', 'no-cache');
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.delete('content-security-policy');
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

module.exports = { transformedJsResponse };
