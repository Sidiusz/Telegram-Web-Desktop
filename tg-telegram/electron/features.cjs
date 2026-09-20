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
