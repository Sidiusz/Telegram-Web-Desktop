# Telegram Web Desktop

Неофициальный Windows-клиент Telegram на базе Telegram Web A и Electron.

Telegram Web A используется как основной интерфейс. Клиент добавляет desktop-интеграцию и функции, которых нет у обычной вкладки браузера.

## Возможности

- системный трей и сворачивание приложения в фон;
- desktop-уведомления с фильтрацией и настройками приватности;
- отдельная история загрузок;
- пользовательские дополнения;
- автообновление клиента;
- поддержка ссылок `tg://`;
- встроенный Flowseal-прокси, автопереключение и диагностика;
- поддержка собственного Cloudflare Worker и пользовательских прокси-доменов;
- дополнительные разделы настроек в интерфейсе Telegram Web A.

## Установка

Готовый установщик находится в [Releases](https://github.com/Sidiusz/Telegram-Web-Desktop/releases/latest).

Запустите `Telegram.Web.Desktop.Setup.<version>.exe`.

## Сборка

Требуются Node.js 22+ и npm.

```powershell
git clone https://github.com/Sidiusz/Telegram-Web-Desktop.git
cd Telegram-Web-Desktop\tg-telegram
npm ci
npm test
npm run test:smoke
npm run build
```

Готовый установщик появится в `tg-telegram\dist\`.

Для локального запуска без сборки:

```powershell
npm run dev
```

Также можно запустить `tg-telegram\build.bat`: он завершит запущенные экземпляры клиента, очистит `dist\win-unpacked` и соберёт установщик.

## Структура

- `tg-telegram/main.cjs` — точка входа Electron;
- `tg-telegram/electron/` — desktop-интеграция, IPC, уведомления, прокси и внедряемый UI;
- `tg-telegram/tests/` — regression-тесты;
- `tg-telegram/scripts/` — smoke и release-скрипты;
- `.github/release-notes/` — тексты релизов;
- `.github/workflows/release.yml` — сборка и публикация релиза по version-tag.

## Лицензия

MIT
