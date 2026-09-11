'use strict';

const { app, ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const IPC_COMMAND = 'tg-ws-proxy:command';
const IPC_EVENT = 'tg-ws-proxy:event';
const IPC_ENABLED = 'tg-ws-proxy:is-enabled';
const HANDSHAKE_LEN = 64;
const ABRIDGED_TAG = Buffer.from([0xef, 0xef, 0xef, 0xef]);
const ZERO_64 = Buffer.alloc(64);

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
    // Accept mtproto:// links' dd/ee prefix when supplied through env manually.
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
    } catch (_) {
        // Env-only configuration is supported below. If neither source is
        // complete, the integration simply stays disabled.
    }

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

    // Telegram Web A currently uses zwsN.web.telegram.org and zwsN-1 for media/download DCs.
    // Keep kwsN support too because the upstream proxy itself uses that naming scheme.
    const match = /^(?:zws|kws)(\d+)(-1)?\.web\.telegram\.org$/i.exec(url.hostname);
    if (!match) return null;

    const dc = Number(match[1]);
    if (!Number.isInteger(dc) || dc <= 0 || dc > 32767) return null;
    const isMedia = Boolean(match[2]);
    const isTest = /_test(?:_|$)/.test(url.pathname);
    const routedDc = dc + (isTest ? 10000 : 0);
    if (routedDc > 32767) return null;

    return { dc: isMedia ? -routedDc : routedDc, hostname: url.hostname };
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
    if (new Set(['48454144', '504f5354', '47455420', 'eeeeeeee', 'dddddddd', '16030102']).has(first4)) return true;
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
    const encrypted = toProxy.update(plain); // Also advances CTR by the 64-byte init.

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
    // Telegram Web's CTR encryptor consumes the complete 64-byte random init, while
    // only bytes 56..63 are put on the wire encrypted. Advance to the same position.
    const keyStream = fromWeb.update(ZERO_64);
    const plainTail = xorBuffers(header.subarray(56, 64), keyStream.subarray(56, 64));
    if (!plainTail.subarray(0, 4).equals(ABRIDGED_TAG)) {
        throw new Error('Unsupported Telegram Web transport (expected abridged obfuscation)');
    }

    const reversed = Buffer.from(preKeyIv).reverse();
    const toWeb = makeCipher(reversed.subarray(0, 32), reversed.subarray(32, 48));
    return { fromWeb, toWeb };
}

class ProxyConnection {
    constructor(webContents, id, rawUrl, config) {
        this.webContents = webContents;
        this.id = id;
        this.rawUrl = rawUrl;
        this.config = config;
        this.socket = null;
        this.webHeader = Buffer.alloc(0);
        this.webCrypto = null;
        this.proxyCrypto = null;
        this.closed = false;
    }

    emit(type, extra = {}) {
        if (this.webContents.isDestroyed()) return;
        this.webContents.send(IPC_EVENT, { id: this.id, type, ...extra });
    }

    connect() {
        const target = parseTelegramWsUrl(this.rawUrl);
        if (!target) {
            this.emit('fallback', { reason: 'not-telegram-dc' });
            return;
        }
        this.target = target;

        const socket = net.createConnection({ host: this.config.host, port: this.config.port });
        this.socket = socket;
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 15000);

        socket.once('connect', () => this.emit('open'));
        socket.on('data', (chunk) => this.onProxyData(chunk));
        socket.once('error', (error) => {
            if (!this.webCrypto) {
                this.emit('fallback', { reason: error.code || 'proxy-unavailable' });
            } else {
                this.emit('error', { message: error.message });
                this.emit('close', { code: 1006, reason: 'tg-ws-proxy connection failed', wasClean: false });
            }
            this.destroy();
        });
        socket.once('close', (hadError) => {
            if (!this.closed && this.webCrypto) {
                this.emit('close', { code: hadError ? 1006 : 1000, reason: '', wasClean: !hadError });
            }
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
                if (rest.length) this.forwardWebCiphertext(rest);
            } catch (error) {
                this.emit('error', { message: error.message });
                this.emit('close', { code: 1002, reason: error.message, wasClean: false });
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
        if (!encryptedForWeb.length) return;
        // Uint8Array is structured-clone friendly across Electron IPC.
        this.emit('data', { data: new Uint8Array(encryptedForWeb) });
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

let registered = false;
const connections = new Map();

function connectionKey(webContents, id) {
    return `${webContents.id}:${id}`;
}

function registerTgWsProxyIpc() {
    if (registered) return;
    registered = true;

    ipcMain.on(IPC_ENABLED, (event) => {
        event.returnValue = Boolean(readProxyConfig());
    });

    ipcMain.on(IPC_COMMAND, (event, message) => {
        if (!message || typeof message !== 'object' || typeof message.id !== 'string') return;
        const key = connectionKey(event.sender, message.id);

        if (message.type === 'connect') {
            const existing = connections.get(key);
            existing?.close();
            connections.delete(key);

            const config = readProxyConfig();
            if (!config) {
                event.sender.send(IPC_EVENT, { id: message.id, type: 'fallback', reason: 'no-config' });
                return;
            }
            const conn = new ProxyConnection(event.sender, message.id, message.url, config);
            connections.set(key, conn);
            conn.connect();
            return;
        }

        const conn = connections.get(key);
        if (!conn) return;
        if (message.type === 'data') conn.onWebData(message.data);
        if (message.type === 'close') {
            conn.close();
            connections.delete(key);
        }
    });

    app.on('web-contents-created', (_event, contents) => {
        contents.once('destroyed', () => {
            const prefix = `${contents.id}:`;
            for (const [key, conn] of connections) {
                if (!key.startsWith(prefix)) continue;
                conn.destroy();
                connections.delete(key);
            }
        });
    });
}

module.exports = { registerTgWsProxyIpc, readProxyConfig };
