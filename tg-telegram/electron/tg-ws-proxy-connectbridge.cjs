'use strict';

const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const tls = require('tls');

const HANDSHAKE_LEN = 64;
const ABRIDGED_TAG = Buffer.from([0xef, 0xef, 0xef, 0xef]);
const ZERO_64 = Buffer.alloc(64);
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const LOCAL_HOST = '127.0.0.1';
const DEFAULT_ADAPTER_PORT = 18443;
const TELEGRAM_WS_HOST_RE = /^(?:zws|kws)([1-5])(-1)?\.web\.telegram\.org$/i;

let bridgeState = null;
let logFile = null;

function log(level, message) {
    const text = `[${new Date().toISOString()}] ${message}`;
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    try { fn(text); } catch (_) {}
    try {
        if (app.isReady()) {
            if (!logFile) logFile = path.join(app.getPath('userData'), 'tg-ws-proxy-bridge.log');
            fs.appendFileSync(logFile, text + '\n');
        }
    } catch (_) {}
}

function resetLog() {
    try {
        logFile = path.join(app.getPath('userData'), 'tg-ws-proxy-bridge.log');
        fs.writeFileSync(logFile, '');
    } catch (_) {}
}

function getStandardConfigPath() {
    if (process.platform === 'win32') {
        const base = process.env.APPDATA || app.getPath('appData');
        return path.join(base, 'TgWsProxy', 'config.json');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'TgWsProxy', 'config.json');
    }
    const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(base, 'TgWsProxy', 'config.json');
}

function normalizeSecret(value) {
    let secret = String(value || '').trim().toLowerCase();
    if (secret.length === 34 && (secret.startsWith('dd') || secret.startsWith('ee'))) {
        secret = secret.slice(2);
    }
    if (!/^[0-9a-f]{32}$/.test(secret)) return null;
    return Buffer.from(secret, 'hex');
}

function readProxyConfig() {
    const configPath = process.env.TG_WS_PROXY_CONFIG || getStandardConfigPath();
    let disk = {};
    try { disk = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (_) {}

    const host = process.env.TG_WS_PROXY_HOST || disk.host || '127.0.0.1';
    const port = Number(process.env.TG_WS_PROXY_PORT || disk.port || 1443);
    const secret = normalizeSecret(process.env.TG_WS_PROXY_SECRET || disk.secret);
    if (!secret || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host: String(host), port, secret, configPath };
}

function getAdapterPort() {
    const port = Number(process.env.TG_WS_PROXY_WEB_PORT || DEFAULT_ADAPTER_PORT);
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_ADAPTER_PORT;
}

function parseTelegramTarget(hostname, requestPath) {
    const match = TELEGRAM_WS_HOST_RE.exec(String(hostname || '').toLowerCase());
    if (!match) return null;

    let pathname;
    try { pathname = new URL(String(requestPath || '/'), 'https://telegram.invalid').pathname; } catch (_) { return null; }
    if (!/^\/apiws(?:_|$)/.test(pathname)) return null;

    const dc = Number(match[1]);
    const isMedia = Boolean(match[2]);
    const isTest = /_test(?:_|$)/.test(pathname);
    const routedDc = dc + (isTest ? 10000 : 0);
    return {
        dc: isMedia ? -routedDc : routedDc,
        dcId: dc,
        isMedia,
        isTest,
        hostname: String(hostname).toLowerCase(),
    };
}

function makeCipher(key, iv) {
    return crypto.createCipheriv('aes-256-ctr', key, iv);
}

function xorBuffers(a, b) {
    const out = Buffer.allocUnsafe(Math.min(a.length, b.length));
    for (let i = 0; i < out.length; i += 1) out[i] = a[i] ^ b[i];
    return out;
}

function isReservedHeader(random) {
    if (random[0] === 0xef) return true;
    const first4 = random.subarray(0, 4).toString('hex');
    if (new Set(['48454144', '504f5354', '47455420', '4f505449', 'eeeeeeee', 'dddddddd', '16030102']).has(first4)) return true;
    return random.subarray(4, 8).equals(Buffer.alloc(4));
}

function buildProxyCrypto(secret, dc) {
    let random;
    do { random = crypto.randomBytes(HANDSHAKE_LEN); } while (isReservedHeader(random));

    const preKeyIv = random.subarray(8, 56);
    const encKey = crypto.createHash('sha256')
        .update(preKeyIv.subarray(0, 32))
        .update(secret)
        .digest();
    const encIv = preKeyIv.subarray(32, 48);
    const toProxy = makeCipher(encKey, encIv);

    const plain = Buffer.from(random);
    ABRIDGED_TAG.copy(plain, 56);
    plain.writeInt16LE(dc, 60);
    const encrypted = toProxy.update(plain);

    const handshake = Buffer.from(random);
    encrypted.copy(handshake, 56, 56, 64);

    const reversed = Buffer.from(preKeyIv).reverse();
    const decKey = crypto.createHash('sha256')
        .update(reversed.subarray(0, 32))
        .update(secret)
        .digest();
    const decIv = reversed.subarray(32, 48);
    const fromProxy = makeCipher(decKey, decIv);
    return { handshake, toProxy, fromProxy };
}

function buildWebCrypto(header) {
    if (header.length !== HANDSHAKE_LEN) throw new Error('Invalid Telegram Web transport header');

    const preKeyIv = header.subarray(8, 56);
    const fromWeb = makeCipher(preKeyIv.subarray(0, 32), preKeyIv.subarray(32, 48));
    const keyStream = fromWeb.update(ZERO_64);
    const plainTail = xorBuffers(header.subarray(56, 64), keyStream.subarray(56, 64));
    if (!plainTail.subarray(0, 4).equals(ABRIDGED_TAG)) {
        throw new Error('Unsupported Telegram Web transport (expected abridged obfuscation)');
    }

    const reversed = Buffer.from(preKeyIv).reverse();
    const toWeb = makeCipher(reversed.subarray(0, 32), reversed.subarray(32, 48));
    return { fromWeb, toWeb };
}

function makeServerFrame(opcode, payload = Buffer.alloc(0)) {
    payload = Buffer.from(payload);
    const length = payload.length;
    let header;
    if (length < 126) {
        header = Buffer.from([0x80 | opcode, length]);
    } else if (length <= 0xffff) {
        header = Buffer.allocUnsafe(4);
        header[0] = 0x80 | opcode;
        header[1] = 126;
        header.writeUInt16BE(length, 2);
    } else {
        header = Buffer.allocUnsafe(10);
        header[0] = 0x80 | opcode;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(length), 2);
    }
    return Buffer.concat([header, payload]);
}

class LocalWebSocketPeer {
    constructor(socket, onBinary, onClose) {
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        this.onBinary = onBinary;
        this.onClose = onClose;
        this.closed = false;
        this.fragmentParts = [];
        this.fragmentOpcode = null;
        socket.on('data', (chunk) => this.feed(chunk));
        socket.once('error', () => this.finish());
        socket.once('close', () => this.finish());
    }

    feed(chunk) {
        if (this.closed || !chunk || !chunk.length) return;
        this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
        this.parseFrames();
    }

    parseFrames() {
        while (!this.closed) {
            if (this.buffer.length < 2) return;
            const b0 = this.buffer[0];
            const b1 = this.buffer[1];
            const fin = Boolean(b0 & 0x80);
            const opcode = b0 & 0x0f;
            const masked = Boolean(b1 & 0x80);
            let payloadLen = b1 & 0x7f;
            let offset = 2;

            if (!masked) return this.protocolError('Client WebSocket frame is not masked');
            if (payloadLen === 126) {
                if (this.buffer.length < offset + 2) return;
                payloadLen = this.buffer.readUInt16BE(offset);
                offset += 2;
            } else if (payloadLen === 127) {
                if (this.buffer.length < offset + 8) return;
                const big = this.buffer.readBigUInt64BE(offset);
                if (big > BigInt(Number.MAX_SAFE_INTEGER)) return this.protocolError('WebSocket frame too large');
                payloadLen = Number(big);
                offset += 8;
            }

            if (this.buffer.length < offset + 4 + payloadLen) return;
            const mask = this.buffer.subarray(offset, offset + 4);
            offset += 4;
            const payload = Buffer.from(this.buffer.subarray(offset, offset + payloadLen));
            this.buffer = this.buffer.subarray(offset + payloadLen);
            for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];

            if (opcode === 0x8) {
                this.sendFrame(0x8, payload.subarray(0, 125));
                try { this.socket.end(); } catch (_) {}
                return this.finish();
            }
            if (opcode === 0x9) {
                this.sendFrame(0xA, payload.subarray(0, 125));
                continue;
            }
            if (opcode === 0xA) continue;

            if (opcode === 0x2) {
                if (this.fragmentOpcode !== null) return this.protocolError('Unexpected new data frame during fragmentation');
                if (fin) this.onBinary(payload);
                else {
                    this.fragmentOpcode = opcode;
                    this.fragmentParts = [payload];
                }
                continue;
            }
            if (opcode === 0x0) {
                if (this.fragmentOpcode === null) return this.protocolError('Unexpected continuation frame');
                this.fragmentParts.push(payload);
                if (fin) {
                    const message = Buffer.concat(this.fragmentParts);
                    this.fragmentParts = [];
                    this.fragmentOpcode = null;
                    this.onBinary(message);
                }
                continue;
            }
            return this.protocolError('Only binary WebSocket frames are supported');
        }
    }

    protocolError(message) {
        log('error', `[tg-ws-proxy] local WebSocket protocol error: ${message}`);
        this.close(1002, message);
    }

    sendFrame(opcode, payload) {
        if (this.closed || this.socket.destroyed) return;
        try { this.socket.write(makeServerFrame(opcode, payload)); } catch (_) { this.finish(); }
    }

    sendBinary(payload) { this.sendFrame(0x2, payload); }

    close(code = 1000, reason = '') {
        if (this.closed) return;
        const reasonBytes = Buffer.from(String(reason), 'utf8').subarray(0, 123);
        const payload = Buffer.allocUnsafe(2 + reasonBytes.length);
        payload.writeUInt16BE(code, 0);
        reasonBytes.copy(payload, 2);
        this.sendFrame(0x8, payload);
        try { this.socket.end(); } catch (_) {}
        this.finish();
    }

    finish() {
        if (this.closed) return;
        this.closed = true;
        try { this.onClose?.(); } catch (_) {}
    }
}

class ProxyConnection {
    constructor(peer, target, config, onDone) {
        this.peer = peer;
        this.target = target;
        this.config = config;
        this.onDone = onDone;
        this.socket = null;
        this.webHeader = Buffer.alloc(0);
        this.webCrypto = null;
        this.proxyCrypto = null;
        this.closed = false;
    }

    connect() {
        log('info', `[tg-ws-proxy] Web A ${this.target.hostname} -> DC${Math.abs(this.target.dc)}${this.target.dc < 0 ? ' media' : ''} -> ${this.config.host}:${this.config.port}`);
        const socket = net.createConnection({ host: this.config.host, port: this.config.port });
        this.socket = socket;
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 15000);
        socket.once('connect', () => log('info', `[tg-ws-proxy] connected to local TG WS Proxy for DC${Math.abs(this.target.dc)}`));
        socket.on('data', (chunk) => this.onProxyData(chunk));
        socket.once('error', (error) => {
            log('error', `[tg-ws-proxy] local TG WS Proxy connection failed: ${error.code || ''} ${error.message}`);
            this.peer.close(1011, 'TG WS Proxy unavailable');
            this.destroy();
        });
        socket.once('close', () => {
            if (!this.closed) this.peer.close(1011, 'TG WS Proxy closed');
            this.closed = true;
            try { this.onDone?.(); } catch (_) {}
        });
    }

    onWebData(value) {
        if (this.closed || !this.socket) return;
        const chunk = Buffer.from(value);
        if (!this.webCrypto) {
            this.webHeader = Buffer.concat([this.webHeader, chunk]);
            if (this.webHeader.length < HANDSHAKE_LEN) return;
            const header = this.webHeader.subarray(0, HANDSHAKE_LEN);
            const rest = this.webHeader.subarray(HANDSHAKE_LEN);
            this.webHeader = Buffer.alloc(0);
            try {
                this.webCrypto = buildWebCrypto(header);
                this.proxyCrypto = buildProxyCrypto(this.config.secret, this.target.dc);
                this.socket.write(this.proxyCrypto.handshake);
                log('info', `[tg-ws-proxy] MTProto bridge ready for DC${Math.abs(this.target.dc)}`);
                if (rest.length) this.forwardWebCiphertext(rest);
            } catch (error) {
                log('error', `[tg-ws-proxy] bridge handshake failed: ${error.message}`);
                this.peer.close(1002, error.message);
                this.destroy();
            }
            return;
        }
        this.forwardWebCiphertext(chunk);
    }

    forwardWebCiphertext(chunk) {
        if (!chunk.length || !this.webCrypto || !this.proxyCrypto || !this.socket) return;
        const plain = this.webCrypto.fromWeb.update(chunk);
        const encrypted = this.proxyCrypto.toProxy.update(plain);
        if (encrypted.length) this.socket.write(encrypted);
    }

    onProxyData(chunk) {
        if (!this.webCrypto || !this.proxyCrypto || this.closed) return;
        const plain = this.proxyCrypto.fromProxy.update(chunk);
        const encryptedForWeb = this.webCrypto.toWeb.update(plain);
        if (encryptedForWeb.length) this.peer.sendBinary(encryptedForWeb);
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        try { this.socket?.end(); } catch (_) {}
        try { this.socket?.destroy(); } catch (_) {}
        try { this.onDone?.(); } catch (_) {}
    }

    destroy() {
        if (this.closed) return;
        this.closed = true;
        try { this.socket?.destroy(); } catch (_) {}
        try { this.onDone?.(); } catch (_) {}
    }
}

function parseHeaders(raw) {
    const lines = raw.split('\r\n');
    const first = lines.shift() || '';
    const headers = {};
    for (const line of lines) {
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    return { first, headers };
}

function attachTlsWebSocket(tlsSocket, connectHostname, config, connections) {
    let headerBuffer = Buffer.alloc(0);
    const onData = (chunk) => {
        headerBuffer = headerBuffer.length ? Buffer.concat([headerBuffer, chunk]) : Buffer.from(chunk);
        if (headerBuffer.length > 64 * 1024) {
            log('error', `[tg-ws-proxy] oversized HTTP header from ${connectHostname}`);
            tlsSocket.destroy();
            return;
        }

        const end = headerBuffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        tlsSocket.off('data', onData);

        const headerText = headerBuffer.subarray(0, end).toString('latin1');
        const rest = headerBuffer.subarray(end + 4);
        const { first, headers } = parseHeaders(headerText);
        const requestMatch = /^GET\s+(\S+)\s+HTTP\/1\.[01]$/i.exec(first);
        if (!requestMatch) {
            log('error', `[tg-ws-proxy] expected WebSocket GET after CONNECT, got: ${first || '?'}`);
            tlsSocket.destroy();
            return;
        }

        const target = parseTelegramTarget(connectHostname, requestMatch[1]);
        if (!target) {
            log('error', `[tg-ws-proxy] rejected CONNECT payload host=${connectHostname} path=${requestMatch[1]}`);
            tlsSocket.destroy();
            return;
        }

        const key = String(headers['sec-websocket-key'] || '');
        const upgrade = String(headers.upgrade || '').toLowerCase();
        if (!key || upgrade !== 'websocket') {
            log('error', `[tg-ws-proxy] invalid WebSocket upgrade for ${target.hostname}`);
            tlsSocket.destroy();
            return;
        }

        const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
        const offeredProtocols = String(headers['sec-websocket-protocol'] || '')
            .split(',').map((x) => x.trim()).filter(Boolean);
        const response = [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${accept}`,
        ];
        if (offeredProtocols.includes('binary')) response.push('Sec-WebSocket-Protocol: binary');
        tlsSocket.write(response.join('\r\n') + '\r\n\r\n');
        log('info', `[tg-ws-proxy] intercepted ${target.hostname}${requestMatch[1]}`);

        let conn = null;
        const peer = new LocalWebSocketPeer(
            tlsSocket,
            (data) => conn?.onWebData(data),
            () => conn?.close(),
        );
        conn = new ProxyConnection(peer, target, config, () => connections.delete(conn));
        connections.add(conn);
        conn.connect();
        if (rest.length) peer.feed(rest);
    };

    tlsSocket.on('data', onData);
}

function parseConnectAuthority(authority) {
    const match = /^([^:]+):(\d+)$/.exec(String(authority || '').trim());
    if (!match) return null;
    const hostname = match[1].toLowerCase();
    const port = Number(match[2]);
    if (port !== 443 || !TELEGRAM_WS_HOST_RE.test(hostname)) return null;
    return { hostname, port };
}

function makePacScript(proxyPort) {
    return `function FindProxyForURL(url, host) {
  host = String(host || '').toLowerCase();
  if (/^(?:zws|kws)[1-5](?:-1)?\\.web\\.telegram\\.org$/.test(host)) {
    return 'PROXY ${LOCAL_HOST}:${proxyPort}';
  }
  return 'DIRECT';
}`;
}

async function startTgWsProxyConnectBridge(electronSession) {
    if (bridgeState) return bridgeState;
    resetLog();

    const config = readProxyConfig();
    const localPort = getAdapterPort();
    if (!config) {
        log('warn', `[tg-ws-proxy] disabled: config missing/invalid (${process.env.TG_WS_PROXY_CONFIG || getStandardConfigPath()})`);
        return null;
    }

    const certPath = path.join(__dirname, 'local-proxy-cert.pem');
    const keyPath = path.join(__dirname, 'local-proxy-key.pem');
    const secureContext = tls.createSecureContext({
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
    });
    const pacScript = makePacScript(localPort);
    const connections = new Set();
    const tlsSockets = new Set();

    const server = http.createServer((req, res) => {
        if (req.url === '/tg-ws-proxy.pac') {
            res.writeHead(200, {
                'Content-Type': 'application/x-ns-proxy-autoconfig',
                'Cache-Control': 'no-store',
            });
            res.end(pacScript);
            return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Telegram Web PAC proxy');
    });

    server.on('connect', (req, socket, head) => {
        const authority = parseConnectAuthority(req.url);
        if (!authority) {
            log('warn', `[tg-ws-proxy] rejected CONNECT ${req.url || '?'}`);
            socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            return;
        }

        log('info', `[tg-ws-proxy] CONNECT ${authority.hostname}:443 reached local adapter`);
        socket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: Telegram-Web-Desktop\r\n\r\n');
        socket.pause();
        if (head && head.length) socket.unshift(head);

        const tlsSocket = new tls.TLSSocket(socket, {
            isServer: true,
            secureContext,
            ALPNProtocols: ['http/1.1'],
        });
        tlsSockets.add(tlsSocket);
        tlsSocket.once('secure', () => {
            log('info', `[tg-ws-proxy] local TLS established for ${authority.hostname}`);
            attachTlsWebSocket(tlsSocket, authority.hostname, config, connections);
        });
        tlsSocket.once('error', (error) => {
            log('error', `[tg-ws-proxy] local TLS failed for ${authority.hostname}: ${error.code || ''} ${error.message}`);
        });
        tlsSocket.once('close', () => tlsSockets.delete(tlsSocket));
        tlsSocket.resume();
    });

    await new Promise((resolve, reject) => {
        const onError = (error) => {
            server.off('listening', onListening);
            reject(error);
        };
        const onListening = () => {
            server.off('error', onError);
            resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(localPort, LOCAL_HOST);
    });

    electronSession.setCertificateVerifyProc((request, callback) => {
        const hostname = String(request.hostname || '').toLowerCase();
        if (TELEGRAM_WS_HOST_RE.test(hostname)) {
            log('info', `[tg-ws-proxy] accepted local certificate for ${hostname}`);
            return callback(0);
        }
        callback(-3);
    });

    const pacUrl = `http://${LOCAL_HOST}:${localPort}/tg-ws-proxy.pac`;
    await electronSession.setProxy({ mode: 'pac_script', pacScript: pacUrl });
    try { await electronSession.forceReloadProxyConfig(); } catch (_) {}
    try { await electronSession.closeAllConnections(); } catch (_) {}

    const telegramResolution = await electronSession.resolveProxy('https://zws1.web.telegram.org/apiws');
    const pageResolution = await electronSession.resolveProxy('https://web.telegram.org/a/');
    log('info', `[tg-ws-proxy] PAC check Telegram DC => ${telegramResolution}`);
    log('info', `[tg-ws-proxy] PAC check web.telegram.org => ${pageResolution}`);
    if (!String(telegramResolution).includes(`${LOCAL_HOST}:${localPort}`)) {
        throw new Error(`PAC did not select local adapter for Telegram DC: ${telegramResolution}`);
    }

    const stop = () => {
        for (const conn of connections) conn.destroy();
        connections.clear();
        for (const socket of tlsSockets) {
            try { socket.destroy(); } catch (_) {}
        }
        tlsSockets.clear();
        try { server.close(); } catch (_) {}
    };
    app.once('before-quit', stop);

    bridgeState = { localPort, configPath: config.configPath, logFile, stop };
    log('info', `[tg-ws-proxy] PAC CONNECT bridge listening on ${LOCAL_HOST}:${localPort}`);
    log('info', `[tg-ws-proxy] using TG WS Proxy config ${config.configPath}`);
    return bridgeState;
}

module.exports = {
    startTgWsProxyConnectBridge,
    readProxyConfig,
    parseTelegramTarget,
};
