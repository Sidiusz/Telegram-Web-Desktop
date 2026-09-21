'use strict';

const fs = require('fs');
const path = require('path');

function featuresDir() {
    return path.join(__dirname, 'features');
}

function readFeature(name) {
    return fs.readFileSync(path.join(featuresDir(), name), 'utf8');
}

function loadFeatureScripts(settings) {
    const s = settings || {};
    const scripts = [];

    if (s.appearance_message_layout === 'wide' || s.appearance_message_layout === 'left') {
        scripts.push(readFeature('desktop_like_base.js'));
        scripts.push(readFeature('desktop_like_common.js'));
        scripts.push(readFeature(s.appearance_message_layout === 'wide' ? 'desktop_like_wide.js' : 'desktop_like_standard.js'));
    }

    scripts.push('window.__twdHideAdsEnabled=' + JSON.stringify(s.appearance_hide_ads !== false) + ';\n' + readFeature('hide_ads.js'));

    const messageFilterCfg = JSON.stringify({
        enabled: s.message_filter_enabled === true,
        standard: s.message_filter_standard !== false,
        hashtags: s.message_filter_hashtags !== false,
        shortLinks: s.message_filter_short_links !== false,
        refLinks: s.message_filter_ref_links !== false,
        includePrivate: s.message_filter_private === true,
        markOnly: s.message_filter_mark_only === true,
        ignoreSymbols: s.message_filter_ignore_symbols === true,
        shortDisabled: Array.isArray(s.message_filter_short_disabled) ? s.message_filter_short_disabled : [],
        refDisabled: Array.isArray(s.message_filter_ref_disabled) ? s.message_filter_ref_disabled : [],
        custom: Array.isArray(s.message_filter_custom) ? s.message_filter_custom : [],
    });
    scripts.push('window.__twdMessageFilterConfig=' + messageFilterCfg + ';\n' + readFeature('message_filter.js'));

    const cfg = JSON.stringify({
        showDeleted: s.messages_show_deleted === true,
        showDisappearing: s.messages_show_disappearing === true,
        saveDeleted: s.messages_save_deleted === true,
        saveDisappearing: s.messages_save_disappearing === true,
        editHistory: s.messages_edit_history === true,
        scope: s.messages_history_scope || 'client',
    });
    scripts.push('window.__twdMessageHistoryConfig=' + cfg + ';\n' + readFeature('message_history.js'));

    return scripts;
}

module.exports = { featuresDir, loadFeatureScripts };
