'use strict';

const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const net = require('net');
const os = require('os');
const path = require('path');

const HANDSHAKE_LEN = 64;
const ABRIDGED_TAG = Buffer.from([0xef, 0xef, 0xef, 0xef]);
const ZERO_64 = Buffer.alloc(64);
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const LOCAL_HOST = '127.0.0.1';

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
    try {
        disk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (_) {}

    const host = process.env.TG_WS_PROXY_HOST || disk.host || '127.0.0.1';
    const port = Number(process.env.TG_WS_PROXY_PORT || disk.port || 1443);
    const secret = normalizeSecret(process.env.TG_WS_PROXY_SECRET || disk.secret);

    if (!secret || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host: String(host), port, secret, configPath };
}

function parseTelegramWsUrl(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch (_) { return null; }
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return null;

    const match = /^(?:zws|kws)(\d+)(-1)?\.web\.telegram\.org$/i.exec(url.hostname);
    if (!match) return null;
    if (!/^\/apiws(?:_|$)/.test(url.pathname)) return null;

    const dc = Number(match[1]);
    if (!Number.isInteger(dc) || dc <= 0 || dc > 32767) return null;
    const isMedia = Boolean(match[2]);
    const isTest = /_test(?:_|$)/.test(url.pathname);
    const routedDc = dc + (isTest ? 10000 : 0);
    if (routedDc > 32767) return null;

    return {
        dc: isMedia ? -routedDc : routedDc,
        dcId: dc,
        isMedia,
        isTest,
        hostname: url.hostname,
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
    constructor(socket, head, onBinary, onClose) {
        this.socket = socket;
        this.buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
        this.onBinary = onBinary;
        this.onClose = onClose;
        this.closed = false;
        this.fragmentParts = [];
        this.fragmentOpcode = null;

        socket.on('data', (chunk) => this.feed(chunk));
        socket.once('error', () => this.finish());
        socket.once('close', () => this.finish());
        if (this.buffer.length) this.parseFrames();
    }

    feed(chunk) {
        if (this.closed) return;
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
                if (fin) {
                    this.onBinary(payload);
                } else {
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
        this.close(1002, message);
    }

    sendFrame(opcode, payload) {
        if (this.closed || this.socket.destroyed) return;
        try { this.socket.write(makeServerFrame(opcode, payload)); } catch (_) { this.finish(); }
    }

    sendBinary(payload) {
        this.sendFrame(0x2, payload);
    }

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
    constructor(peer, target, config) {
        this.peer = peer;
        this.target = target;
        this.config = config;
        this.socket = null;
        this.webHeader = Buffer.alloc(0);
        this.webCrypto = null;
        this.proxyCrypto = null;
        this.closed = false;
    }

    connect() {
        console.log(`[tg-ws-proxy] Web A DC${Math.abs(this.target.dc)}${this.target.dc < 0 ? ' media' : ''} -> ${this.config.host}:${this.config.port}`);
        const socket = net.createConnection({ host: this.config.host, port: this.config.port });
        this.socket = socket;
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 15000);
        socket.once('connect', () => console.log(`[tg-ws-proxy] connected to local proxy for DC${Math.abs(this.target.dc)}`));
        socket.on('data', (chunk) => this.onProxyData(chunk));
        socket.once('error', (error) => {
            console.error('[tg-ws-proxy] local proxy connection failed:', error.message);
            this.peer.close(1011, 'TG WS Proxy unavailable');
            this.destroy();
        });
        socket.once('close', () => {
            if (!this.closed) this.peer.close(1011, 'TG WS Proxy closed');
            this.closed = true;
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
                console.log(`[tg-ws-proxy] MTProto bridge ready for DC${Math.abs(this.target.dc)}`);
                if (rest.length) this.forwardWebCiphertext(rest);
            } catch (error) {
                console.error('[tg-ws-proxy] bridge handshake failed:', error.message);
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
    }

    destroy() {
        this.closed = true;
        try { this.socket?.destroy(); } catch (_) {}
    }
}

let bridgeState = null;

async function startTgWsProxyWebBridge(electronSession) {
    if (bridgeState) return bridgeState;
    const config = readProxyConfig();
    if (!config) {
        console.warn(`[tg-ws-proxy] config not found or invalid: ${process.env.TG_WS_PROXY_CONFIG || getStandardConfigPath()}`);
        return null;
    }

    const certPath = path.join(__dirname, 'local-proxy-cert.pem');
    const keyPath = path.join(__dirname, 'local-proxy-key.pem');
    const server = https.createServer({
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
    }, (_req, res) => {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Telegram Web proxy adapter');
    });
    const connections = new Set();

    server.on('upgrade', (req, socket, head) => {
        let localUrl;
        try { localUrl = new URL(req.url, `http://${LOCAL_HOST}`); } catch (_) {
            socket.destroy();
            return;
        }
        if (localUrl.pathname !== '/tg-ws-proxy') {
            socket.destroy();
            return;
        }

        const dc = Number(localUrl.searchParams.get('dc'));
        if (!Number.isInteger(dc) || dc === 0 || Math.abs(dc) > 32767) {
            socket.destroy();
            return;
        }

        const key = String(req.headers['sec-websocket-key'] || '');
        if (!key) {
            socket.destroy();
            return;
        }
        const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
        const offeredProtocols = String(req.headers['sec-websocket-protocol'] || '')
            .split(',').map((x) => x.trim()).filter(Boolean);
        const headers = [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${accept}`,
        ];
        if (offeredProtocols.includes('binary')) headers.push('Sec-WebSocket-Protocol: binary');
        socket.write(headers.join('\r\n') + '\r\n\r\n');

        const target = { dc };
        let conn;
        const peer = new LocalWebSocketPeer(
            socket,
            head,
            (data) => conn?.onWebData(data),
            () => {
                conn?.close();
                if (conn) connections.delete(conn);
            },
        );
        conn = new ProxyConnection(peer, target, config);
        connections.add(conn);
        conn.connect();
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, LOCAL_HOST, () => {
            server.off('error', reject);
            resolve();
        });
    });

    const address = server.address();
    const localPort = typeof address === 'object' && address ? address.port : 0;
    if (!localPort) {
        server.close();
        throw new Error('Failed to allocate local Telegram Web proxy port');
    }

    electronSession.setCertificateVerifyProc((request, callback) => {
        if (request.hostname === LOCAL_HOST) return callback(0);
        callback(-3);
    });

    const filter = { urls: ['wss://*.web.telegram.org/*', 'ws://*.web.telegram.org/*'] };
    electronSession.webRequest.onBeforeRequest(filter, (details, callback) => {
        if (details.resourceType !== 'webSocket') return callback({});
        const target = parseTelegramWsUrl(details.url);
        if (!target) return callback({});
        const redirectURL = `wss://${LOCAL_HOST}:${localPort}/tg-ws-proxy?dc=${encodeURIComponent(target.dc)}`;
        console.log(`[tg-ws-proxy] redirect ${target.hostname} -> local adapter DC${Math.abs(target.dc)}${target.dc < 0 ? ' media' : ''}`);
        callback({ redirectURL });
    });

    const stop = () => {
        for (const conn of connections) conn.destroy();
        connections.clear();
        try { server.close(); } catch (_) {}
    };
    app.once('before-quit', stop);

    bridgeState = { localPort, configPath: config.configPath, stop };
    console.log(`[tg-ws-proxy] Web A adapter listening on wss://${LOCAL_HOST}:${localPort}`);
    console.log(`[tg-ws-proxy] using config ${config.configPath}`);
    return bridgeState;
}

module.exports = { startTgWsProxyWebBridge, readProxyConfig, parseTelegramWsUrl };
