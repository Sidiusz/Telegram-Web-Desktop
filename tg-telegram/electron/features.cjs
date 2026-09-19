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

    if (s.appearance_message_layout === 'wide') {
        scripts.push(readFeature('desktop_like_wide.js'));
    } else if (s.appearance_message_layout === 'left') {
        scripts.push(readFeature('desktop_like_standard.js'));
    }

    if (s.appearance_hide_ads !== false) {
        scripts.push(readFeature('hide_ads.js'));
    }

    if (s.messages_show_deleted === true || s.messages_edit_history === true) {
        const cfg = JSON.stringify({
            showDeleted: s.messages_show_deleted === true,
            editHistory: s.messages_edit_history === true,
        });
        scripts.push('window.__twdMessageHistoryConfig=' + cfg + ';\n' + readFeature('message_history.js'));
    }

    return scripts;
}

module.exports = { featuresDir, loadFeatureScripts };
