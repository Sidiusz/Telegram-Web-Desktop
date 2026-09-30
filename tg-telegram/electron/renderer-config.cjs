'use strict';

// Shapes of settings handed to injected page code; kept in one place so every sender agrees.
function historyConfig(s) {
    return {
        showDeleted: s.messages_show_deleted === true,
        showDisappearing: s.messages_show_disappearing === true,
        saveDeleted: s.messages_save_deleted === true,
        saveDisappearing: s.messages_save_disappearing === true,
        editHistory: s.messages_edit_history === true,
        savePublic: s.messages_save_public === true,
        scope: s.messages_history_scope || 'client',
    };
}

function privacyConfig(s) {
    return {
        noReadReceipts: s.privacy_no_read_receipts === true,
        noTyping: s.privacy_no_typing === true,
        noReadForceOn: s.privacy_no_read_force_on || [],
        noReadForceOff: s.privacy_no_read_force_off || [],
        noTypingForceOn: s.privacy_no_typing_force_on || [],
        noTypingForceOff: s.privacy_no_typing_force_off || [],
    };
}

module.exports = { historyConfig, privacyConfig };
