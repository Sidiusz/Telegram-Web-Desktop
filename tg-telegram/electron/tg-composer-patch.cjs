'use strict';
const { transformedJsResponse } = require('./tg-bundle-patch.cjs');

function configureComposerClipboard(editor, useRegularFormatting, fromEditor, toFormatted, fromFormatted, toEditor) {
    const { view, schema } = editor;
    function normalizePaste(document) {
        if (!useRegularFormatting()) return document;
        const rich = fromEditor(document);
        if (toFormatted(rich)) return document;
        const formatted = toFormatted(rich, { isApproximate: true });
        return formatted?.text ? toEditor(fromFormatted(formatted)) : document;
    }

    view.setProps({
        twdNormalizePaste: normalizePaste,
        transformPasted(slice) {
            if (!slice.content.size) return slice;
            const document = { type: schema.topNodeType.name, content: slice.content.toJSON() };
            const normalized = normalizePaste(document);
            if (normalized === document) return slice;
            const { content } = schema.nodeFromJSON(normalized);
            const Slice = slice.constructor;
            const open = Slice.maxOpen(content);
            return new Slice(content, Math.min(slice.openStart, open.openStart), Math.min(slice.openEnd, open.openEnd));
        },
        transformCopied(slice) {
            const { content } = slice;
            // Ctrl+A selects the whole document, which serializes even one paragraph as a closed block.
            if (!slice.openStart && !slice.openEnd && content.childCount === 1 && content.firstChild.type === schema.nodes.paragraph) {
                return new slice.constructor(content, 1, 1);
            }
            return slice;
        },
    });
}

function patchComposer(source) {
    const edit = /!([\w$]+)&&!([\w$]+)\(([\w$]+)\)([\s\S]{0,140}?)\b([\w$]+)\(\1\)(?=[&|)]{1,3}\([\w$]+\(\{messageList:)/.exec(source);
    const props = /\beditingMessage:([\w$]+),chatId:[\w$]+,[^{}]{0,1600}?\bisCurrentUserPremium:([\w$]+),[^{}]{0,1400}?\bcaptionLimit:([\w$]+),/.exec(source);
    if (!edit || !props) return source;
    const [, text, hasMedia, message, between, checkLength] = edit;
    const [, editingMessage, premium, captionLimit] = props;
    const isCaption = `(${editingMessage}&&${hasMedia}(${editingMessage}))`;
    let body = source.replace(edit[0], `!${text}&&!${hasMedia}(${message})${between}${checkLength}(${text},${hasMedia}(${message}))`);
    const input = /(isRichOnlyContent:([\w$]+),maxLength:)([\w$]+\|\|[\w$]+\?[\w$]+:[\w$]+)/.exec(body);
    if (input) {
        body = body.replace(input[0], `${input[1]}${isCaption}?${captionLimit}:${input[3]}`);
        const richOnly = escapeRegex(input[2]);
        const premiumOverflow = new RegExp(`(${richOnly}=!!\\([\\w$]+&&\\(![\\w$]+\\|\\|${escapeRegex(premium)}&&[\\w$]+)(\\)\\))`);
        body = body.replace(premiumOverflow, `$1&&!${isCaption}$2`);
    }
    body = body.replace(/(className:[\w$]+\()([\w$]+)\.root,(![\w$]+&&\2\.interactive\),ref:[\w$]+,children:[\w$]+\(`div`,\{className:\2\.inner,children:\[[\w$]+\(`div`,\{className:\2\.leftIcon)/,
        '$1$2.root,`twd-composer-link-preview`,$3');

    const richEditor = /\{createRichEditor:[\w$]+,isRichEditorEmpty:[\w$]+\}=[\w$]+;[^;]*;let ([\w$]+)=[\w$]+\(\{element:[^,]+,[^{}]*?\bcontent:([\w$]+)\([^,]+,[^{}]*?\bonUpdate:([\w$]+)=>\{let (?:[\w$]+=\3\.getJSON\(\),)?([\w$]+)=(?:([\w$]+)\(\3\.getJSON\(\)\)|([\w$]+)\([\w$]+,[\w$]+\.current\))/.exec(source);
    if (!richEditor) return body;
    const stateStart = source.lastIndexOf('?.getRichEditorCanUndo(', richEditor.index);
    if (stateStart < 0) return body;
    const hookHead = source.slice(stateStart - 400, stateStart);
    const root = [...hookHead.matchAll(/function ([\w$]+)\(([^)]*)\)\{let /g)].at(-1);
    const hookState = source.slice(stateStart, richEditor.index);
    const editorSetup = source.slice(richEditor.index, richEditor.index + 1500);
    const converter = /\.getJSON\(\)[^;]{0,125};return ([\w$]+)\([\w$]+\)\},getValue:/.exec(editorSetup);
    const fromFormatted = /\.content\.richMessage\|\|([\w$]+)\([\w$]+\.content\.text\)/.exec(source);
    const end = /onDateClick:[\w$]+\.onDateClick(?:,onMediaEdit:[\w$]+\.onMediaEdit,onMediaFiles:[\w$]+\.onMediaFiles)?\}\);(?=if\([\w$]+\)\{|[\w$]+\?[\w$]+\.destroy\(\))/.exec(editorSetup);
    if (!root || !converter || !fromFormatted || !end) return body;
    const [, hook, parameters] = root;
    const [, editor, toEditor, , , legacyFromEditor, fromEditor] = richEditor;
    const call = new RegExp(`=${escapeRegex(hook)}\\(([^()]*)\\)(?=,)`).exec(source.slice(props.index));
    const callback = /let [\w$]+=([\w$]+)\([\w$]+=>\([\w$]+\.current=[\w$]+,[\w$]+\([\w$]+\),\(\)=>\{[\w$]+\.current===/.exec(hookState);
    if (!call || !callback) return body;
    const [, args] = call;
    body = body.replace(root[0], `function ${hook}(${parameters ? `${parameters},` : ''}twdRegularPaste){let `);
    body = body.replace(call[0], `=${hook}(${args ? `${args},` : ''}()=>!${premium}||${isCaption})`);
    // Use Telegram's latest-callback hook to read account and edit mode during paste.
    body = body.replace(callback[0], `let twdUseRegularPaste=${callback[1]}(()=>twdRegularPaste()),${callback[0].slice(4)}`);
    body = body.replace(end[0], `${end[0]}${configureComposerClipboard.name}(${editor},twdUseRegularPaste,${legacyFromEditor || fromEditor},${converter[1]},${fromFormatted[1]},${toEditor});`);
    return `${body}\n${configureComposerClipboard.toString()}\n`;
}

function escapeRegex(identifier) {
    return identifier.replace(/\$/g, '\\$&');
}

function patchMarkdownPaste(source) {
    return source.replace(/(catch\{return!1\}return )([\w$]+)\.commands\.insertContent\(([\w$]+)\)(?=\}\}\}\)\]\}\}\),[\w$]+=[\w$]+\.create\(\{name:`richEditorReverseMarkdown`)/,
        '$1$2.commands.insertContent($2.view.props.twdNormalizePaste?.($3)??$3)')
        .replace(/([\w$]+)\.commands\.insertContent\(([\w$]+\([\w$]+\)),\{contentType:`markdown`\}\)(?=\}\}\}\)\]\}\}\);function)/,
            (_, editor, markdown) => `(${editor}.view.props.twdNormalizePaste?${editor}.commands.insertContent(${editor}.view.props.twdNormalizePaste(${editor}.markdown.parse(${markdown}))):${editor}.commands.insertContent(${markdown},{contentType:\`markdown\`}))`);
}

function patchTelegramComposer(source) {
    if (source.includes('RemoveRichFormattingTitle') && source.includes('ComposerEmbeddedMessage')) return patchComposer(source);
    if (source.includes('richEditorBotApiHtml')) return patchMarkdownPaste(source);
    return source;
}

async function injectTelegramComposer(response, urlString) {
    const url = new URL(urlString);
    if (url.hostname !== 'web.telegram.org' || !/^\/a\/assets\/(?:useConnectionStatus|editor|messageCopy)-[^/]+\.js$/i.test(url.pathname)) return response;
    if (!response.ok) return response;
    const source = await response.clone().text();
    const body = patchTelegramComposer(source);
    return body === source ? response : transformedJsResponse(response, body);
}

module.exports = { injectTelegramComposer, patchTelegramComposer };
