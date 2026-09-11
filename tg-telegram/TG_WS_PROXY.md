# tg-ws-proxy integration

Telegram Web Desktop keeps loading `https://web.telegram.org/a/` normally, but routes Telegram Web A's MTProto WebSocket connections through Flowseal's `tg-ws-proxy`.

## Normal setup

1. Start `TG WS Proxy` and leave it running in the tray.
2. Configure it normally (`127.0.0.1:1443` by default).
3. Start Telegram Web Desktop.

The client automatically reads Flowseal's tray configuration from:

- Windows: `%APPDATA%/TgWsProxy/config.json`
- macOS: `~/Library/Application Support/TgWsProxy/config.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/TgWsProxy/config.json`

It uses the same `host`, `port`, and 16-byte hex `secret` as the tray app. No Telegram proxy link has to be opened in the Web client.

For a portable Flowseal installation, set:

```text
TG_WS_PROXY_CONFIG=/path/to/TgWsProxy_data/config.json
```

Direct overrides are also supported:

```text
TG_WS_PROXY_HOST=127.0.0.1
TG_WS_PROXY_PORT=1443
TG_WS_PROXY_SECRET=0123456789abcdef0123456789abcdef
```

## How it works

Telegram Web A normally opens connections such as `wss://zws2.web.telegram.org/apiws` and sends standard Telegram obfuscated MTProto over those WebSockets.

The Electron main process intercepts only requests whose resource type is `webSocket` and whose destination is a Telegram `zwsN`/`zwsN-1` DC endpoint. Those requests are redirected to a loopback WSS server inside the application. No page scripts, service workers, or Telegram API workers are replaced.

The loopback adapter then:

1. accepts the normal Web A binary WebSocket stream;
2. reads Web A's standard 64-byte obfuscated transport header;
3. creates the secret-derived MTProxy handshake expected by the running `TG WS Proxy` instance;
4. inserts the DC number (negative for media/download DCs);
5. translates the AES-CTR transport stream in both directions;
6. sends the resulting TCP stream to the configured local Flowseal listener.

The bridge does not parse Telegram authorization data or MTProto RPC messages; it only translates the transport layer.

If the Flowseal config is absent, the adapter is not enabled. If the config exists but `TG WS Proxy` is not listening, Telegram's proxied WebSocket connection fails and retries until the local proxy is available.
