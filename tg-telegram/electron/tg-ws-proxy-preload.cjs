'use strict';

const { ipcRenderer, webFrame } = require('electron');

const CHANNEL_NAME = '__telegram_web_desktop_tg_ws_proxy_v1__';

function installWorkerPatch(channelName) {
    if (globalThis.__tgWsProxyWorkerPatchInstalled) return;
    globalThis.__tgWsProxyWorkerPatchInstalled = true;

    const NativeWorker = globalThis.Worker;
    if (typeof NativeWorker !== 'function') return;

    function makeWrapperSource(originalUrl) {
        return `
const __TG_PROXY_CHANNEL = ${JSON.stringify(channelName)};
const __NativeWebSocket = globalThis.WebSocket;
const __NativeCloseEvent = globalThis.CloseEvent;
let __socketCounter = 0;

function __isTelegramDc(url) {
  try {
    const u = new URL(String(url));
    return /^(?:zws|kws)\\d+(?:-1)?\\.web\\.telegram\\.org$/i.test(u.hostname)
      && /^\\/apiws(?:_|$)/.test(u.pathname);
  } catch (_) { return false; }
}

class __ProxyWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url, protocols) {
    super();
    this.url = String(url);
    this.readyState = __ProxyWebSocket.CONNECTING;
    this.bufferedAmount = 0;
    this.extensions = '';
    this.protocol = Array.isArray(protocols) ? (protocols[0] || '') : (protocols || '');
    this.binaryType = 'blob';
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.__native = null;
    this.__id = self.name + ':' + Date.now().toString(36) + ':' + (++__socketCounter).toString(36) + ':' + Math.random().toString(36).slice(2);
    this.__channel = new BroadcastChannel(__TG_PROXY_CHANNEL);
    this.__channel.onmessage = (event) => this.__onBridgeMessage(event.data);
    this.__channel.postMessage({ direction: 'to-main', type: 'connect', id: this.__id, url: this.url });
  }

  __emit(type, event) {
    const handler = this['on' + type];
    if (typeof handler === 'function') {
      try { handler.call(this, event); } catch (error) { queueMicrotask(() => { throw error; }); }
    }
    try { this.dispatchEvent(event); } catch (_) {}
  }

  __onBridgeMessage(message) {
    if (!message || message.direction !== 'from-main' || message.id !== this.__id || this.__native) return;
    if (message.type === 'open') {
      this.readyState = __ProxyWebSocket.OPEN;
      this.__emit('open', new Event('open'));
      return;
    }
    if (message.type === 'data') {
      const bytes = message.data instanceof ArrayBuffer
        ? new Uint8Array(message.data)
        : new Uint8Array(message.data.buffer, message.data.byteOffset || 0, message.data.byteLength ?? message.data.length);
      const data = this.binaryType === 'arraybuffer'
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        : new Blob([bytes]);
      this.__emit('message', new MessageEvent('message', { data }));
      return;
    }
    if (message.type === 'fallback') {
      this.__startNativeFallback();
      return;
    }
    if (message.type === 'error') {
      this.__emit('error', new Event('error'));
      return;
    }
    if (message.type === 'close') {
      this.readyState = __ProxyWebSocket.CLOSED;
      const event = typeof __NativeCloseEvent === 'function'
        ? new __NativeCloseEvent('close', { code: message.code || 1000, reason: message.reason || '', wasClean: Boolean(message.wasClean) })
        : new Event('close');
      this.__emit('close', event);
      this.__channel.close();
    }
  }

  __startNativeFallback() {
    if (this.__native || this.readyState === __ProxyWebSocket.CLOSED) return;
    this.__channel.postMessage({ direction: 'to-main', type: 'close', id: this.__id });
    this.__channel.close();

    const ws = this.protocol
      ? new __NativeWebSocket(this.url, this.protocol)
      : new __NativeWebSocket(this.url);
    this.__native = ws;
    ws.binaryType = this.binaryType;
    ws.onopen = (event) => {
      this.readyState = ws.readyState;
      this.protocol = ws.protocol;
      this.extensions = ws.extensions;
      this.__emit('open', event);
    };
    ws.onmessage = (event) => this.__emit('message', event);
    ws.onerror = (event) => this.__emit('error', event);
    ws.onclose = (event) => {
      this.readyState = ws.readyState;
      this.__emit('close', event);
    };
  }

  send(data) {
    if (this.__native) {
      this.__native.send(data);
      return;
    }
    if (this.readyState !== __ProxyWebSocket.OPEN) {
      throw new DOMException("Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.", 'InvalidStateError');
    }
    if (data instanceof Blob) {
      data.arrayBuffer().then((buffer) => this.__channel.postMessage({ direction: 'to-main', type: 'data', id: this.__id, data: buffer }));
      return;
    }
    let bytes;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else throw new TypeError('tg-ws-proxy transport only accepts binary WebSocket frames');
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.__channel.postMessage({ direction: 'to-main', type: 'data', id: this.__id, data: copy });
  }

  close(code, reason) {
    if (this.__native) {
      this.__native.close(code, reason);
      return;
    }
    if (this.readyState === __ProxyWebSocket.CLOSED) return;
    this.readyState = __ProxyWebSocket.CLOSING;
    this.__channel.postMessage({ direction: 'to-main', type: 'close', id: this.__id, code, reason });
    this.readyState = __ProxyWebSocket.CLOSED;
    this.__channel.close();
  }
}

Object.defineProperties(__ProxyWebSocket.prototype, {
  CONNECTING: { value: 0 }, OPEN: { value: 1 }, CLOSING: { value: 2 }, CLOSED: { value: 3 },
});

function __PatchedWebSocket(url, protocols) {
  if (__isTelegramDc(url)) return new __ProxyWebSocket(url, protocols);
  return protocols === undefined ? new __NativeWebSocket(url) : new __NativeWebSocket(url, protocols);
}
__PatchedWebSocket.prototype = __NativeWebSocket.prototype;
Object.setPrototypeOf(__PatchedWebSocket, __NativeWebSocket);
Object.defineProperties(__PatchedWebSocket, {
  CONNECTING: { value: 0 }, OPEN: { value: 1 }, CLOSING: { value: 2 }, CLOSED: { value: 3 },
});
globalThis.WebSocket = __PatchedWebSocket;

await import(${JSON.stringify(originalUrl)});
`;
    }

    function PatchedWorker(scriptURL, options) {
        const rawUrl = String(scriptURL);
        if (!options || options.type !== 'module' || !/^https?:/i.test(rawUrl)) {
            return new NativeWorker(scriptURL, options);
        }

        const source = makeWrapperSource(rawUrl);
        const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new NativeWorker(blobUrl, options);
        const revoke = () => { try { URL.revokeObjectURL(blobUrl); } catch (_) {} };
        worker.addEventListener('error', revoke, { once: true });
        setTimeout(revoke, 30000);
        return worker;
    }

    PatchedWorker.prototype = NativeWorker.prototype;
    Object.setPrototypeOf(PatchedWorker, NativeWorker);
    globalThis.Worker = PatchedWorker;
}

let channel;
try {
    const enabled = ipcRenderer.sendSync('tg-ws-proxy:is-enabled');
    if (enabled) {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = (event) => {
            const message = event.data;
            if (!message || message.direction !== 'to-main') return;
            ipcRenderer.send('tg-ws-proxy:command', message);
        };
        ipcRenderer.on('tg-ws-proxy:event', (_event, message) => {
            channel?.postMessage({ direction: 'from-main', ...message });
        });
        webFrame.executeJavaScript(`(${installWorkerPatch.toString()})(${JSON.stringify(CHANNEL_NAME)})`, true)
            .catch((error) => console.error('[tg-ws-proxy] worker patch failed:', error));
    }
} catch (error) {
    console.error('[tg-ws-proxy] preload init failed:', error);
}
