'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tgBridge', {
    invoke: (cmd, args) => ipcRenderer.invoke(cmd, args || {}),
    onDownloadEvent: (cb) => ipcRenderer.on('download-event', (_e, data) => cb(data)),
    // Уведомления теперь показываются прямо в окне приложения
    onNotification: (cb) => ipcRenderer.on('show-notification', (_e, data) => cb(data)),
    // Обновления
    onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, data) => cb(data)),
    onUpdateProgress: (cb) => ipcRenderer.on('update-download-progress', (_e, data) => cb(data)),
    onUpdateDone: (cb) => ipcRenderer.on('update-download-done', (_e, data) => cb(data)),
});

// Подмена window.Notification — конвертируем blob: → base64 перед отправкой
function injectFakeNotification() {
    try {
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                function sendNotif(title, opts, iconData) {
                    if (window.tgBridge) {
                        window.tgBridge.invoke('show_notification', {
                            title: String(title || ''),
                            body:  String((opts && opts.body)  || ''),
                            icon:  String(iconData || ''),
                        }).catch(e => console.warn('[NOTIF] ошибка:', e));
                    }
                }

                function FakeNotification(title, opts) {
                    var icon = (opts && opts.icon) || '';
                    if (icon && icon.startsWith('blob:')) {
                        fetch(icon)
                            .then(function(r){ return r.blob(); })
                            .then(function(blob){
                                return new Promise(function(res, rej){
                                    var reader = new FileReader();
                                    reader.onload = function(){ res(reader.result); };
                                    reader.onerror = rej;
                                    reader.readAsDataURL(blob);
                                });
                            })
                            .then(function(dataUrl){ sendNotif(title, opts, dataUrl); })
                            .catch(function(){ sendNotif(title, opts, ''); });
                    } else {
                        sendNotif(title, opts, icon);
                    }
                }

                FakeNotification.permission = 'granted';
                FakeNotification.requestPermission = function() { return Promise.resolve('granted'); };
                window.Notification = FakeNotification;
                console.log('[NOTIF MAIN WORLD] Notification подменён');
            })();
        `;
        const target = document.head || document.documentElement;
        target.appendChild(script);
        script.remove();
    } catch (e) {
        console.error('[PRELOAD] Ошибка инъекции Notification:', e);
    }
}

if (document.head || document.documentElement) {
    injectFakeNotification();
} else {
    const observer = new MutationObserver(() => {
        if (document.head || document.documentElement) {
            observer.disconnect();
            injectFakeNotification();
        }
    });
    observer.observe(document, { childList: true, subtree: true });
}
