'use strict';

// Must run before Telegram Web creates its GramJS API worker.
require('./tg-ws-proxy-preload.cjs');
require('./preload.js');
