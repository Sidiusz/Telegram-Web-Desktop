# tg-ws-proxy integration

Telegram Web Desktop can route Telegram Web A's MTProto transport through Flowseal's `tg-ws-proxy` without changing the upstream Telegram Web bundle.

## Normal setup

1. Install/start `tg-ws-proxy` normally.
2. Configure it in the Flowseal tray app.
3. Restart Telegram Web Desktop.

The client automatically reads Flowseal's tray configuration from:

- Windows: `%APPDATA%/TgWsProxy/config.json`
- macOS: `~/Library/Application Support/TgWsProxy/config.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/TgWsProxy/config.json`

It uses the same `host`, `port`, and 16-byte hex `secret` that Flowseal uses, so there is no second proxy configuration to keep in sync.

If the config is missing or invalid, the integration stays disabled. If the config exists but the local proxy is not listening, Telegram Web falls back to its normal direct WebSocket transport.

## Portable / CLI configuration

For a portable Flowseal installation, point the client at the proxy config explicitly:

```text
TG_WS_PROXY_CONFIG=/path/to/TgWsProxy_data/config.json
```

You can also provide the connection values directly:

```text
TG_WS_PROXY_HOST=127.0.0.1
TG_WS_PROXY_PORT=1443
TG_WS_PROXY_SECRET=0123456789abcdef0123456789abcdef
```

Environment variables override values read from `config.json`.

## How it works

Telegram Web A runs GramJS in a dedicated module worker and normally opens `wss://zwsN.web.telegram.org/apiws...` connections using Telegram's obfuscated abridged transport.

The Electron preload wraps module workers before GramJS starts and substitutes only Telegram DC WebSockets. Binary transport data is passed to the Electron main process, where the bridge:

1. unwraps the standard Telegram Web AES-CTR obfuscated stream;
2. creates the MTProxy-style secret-derived obfuscated handshake expected by `tg-ws-proxy`;
3. inserts the DC number (and media/download DC sign) into that handshake;
4. re-encrypts the abridged MTProto byte stream for the local proxy;
5. performs the inverse transform for responses.

No Telegram authorization keys, MTProto messages, or account credentials are interpreted by the bridge; it only translates the transport-layer obfuscation.
