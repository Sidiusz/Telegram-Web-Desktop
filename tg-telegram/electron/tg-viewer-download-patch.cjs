'use strict';
const { transformedJsResponse } = require('./tg-bundle-patch.cjs');

function patchTelegramViewerDownload(source) {
    const toolbarEnd = source.indexOf('className:`MediaViewerActions-mobile`');
    if (toolbarEnd < 0) return source;
    const toolbarStart = source.lastIndexOf('downloadMedia:', toolbarEnd);
    if (toolbarStart < 0 || toolbarEnd - toolbarStart > 7000) return source;
    let toolbar = source.slice(toolbarStart, toolbarEnd);

    const action = /([\w$]+)&&\([\w$]+\?[\w$]+\(\{media:\1\}\):[\w$]+\(\{media:\1,originMessage:[\w$]+\}\)\)/.exec(toolbar);
    const desktop = /if\(!\(([\w$]+)\|\|([\w$]+)\?\.type===`standalone`\)\)return \2\?\.type!==`sponsoredMessage`&&\(([\w$]+)\?/.exec(toolbar);
    if (!action || !desktop) return source;

    // Reuse the viewer's media download action so streamed videos save from the original media.
    const [, media] = action;
    const [, protectedMedia, item, video] = desktop;
    const mobilePrefix = `${protectedMedia}||(${video}?`;
    const mobileAt = toolbar.indexOf(mobilePrefix, desktop.index + desktop[0].length);
    if (mobileAt >= 0) {
        toolbar = toolbar.slice(0, mobileAt) + `(${video}?${media}:!${protectedMedia})&&(${video}?` +
            toolbar.slice(mobileAt + mobilePrefix.length);
    }
    const desktopGuard = `if(${video}?${media}:!(${protectedMedia}||${item}?.type===\`standalone\`||${item}?.type===\`sponsoredMessage\`))return(${video}?`;
    toolbar = toolbar.slice(0, desktop.index) + desktopGuard + toolbar.slice(desktop.index + desktop[0].length);
    return source.slice(0, toolbarStart) + toolbar + source.slice(toolbarEnd);
}

async function injectTelegramViewerDownload(response, urlString) {
    const url = new URL(urlString);
    if (url.hostname !== 'web.telegram.org' || !/^\/a\/assets\/extra-[^/]+\.js$/i.test(url.pathname) || !response.ok) return response;
    const source = await response.clone().text();
    const body = patchTelegramViewerDownload(source);
    return body === source ? response : transformedJsResponse(response, body);
}

module.exports = { injectTelegramViewerDownload, patchTelegramViewerDownload };
