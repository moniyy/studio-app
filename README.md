# Studio App

Шаблон мобильного веб-приложения (PWA) для бьюти-мастера: услуги и цены, свободное время, ассистент, образы, запись в пару касаний.
Чистый HTML/CSS/JS без сборки — работает прямо на GitHub Pages.

**Демо:** https://moniyy.github.io/studio-app/

## Как добавить нового мастера

1. Скопируйте `masters/demo.json` в `masters/<slug>.json`, где `<slug>` — короткое имя латиницей, например `bella-nails`
   (только буквы, цифры, `-` и `_`).
2. Поменяйте в новом файле данные мастера: `name`, `tagline`, `city`, `avatar`, `heroPhoto`, `brandAccent`,
   `bookingUrl` (ссылка на Acuity / GlossGenius / Booksy), `instagram`, `phone`, `services`, `gallery`, `hours` и остальное.
3. Сохраните, закоммитьте и отправьте на GitHub (`git add . && git commit -m "Add bella-nails" && git push`).
4. Откройте `https://moniyy.github.io/studio-app/?m=<slug>` — это ссылка, которую мастер даёт клиенткам.

Без `?m=` открывается `demo`. Код менять не нужно: один мастер = один JSON-файл.

## Полезные параметры адреса

| Параметр | Что делает |
| --- | --- |
| `?m=slug` | какой мастер (файл `masters/slug.json`) |
| `&splash=clean` / `&splash=photo` | вариант заставки (важнее поля `splashStyle` в JSON) |
| `&reset=1` | показать заставку и Welcome заново, как при первом запуске |
| `&owner=1` | режим владельца для показа мастеру (все цифры — демо-данные) |
| `&look=<id>` | сразу открыть образ из галереи |

## Файлы

- `index.html`, `app.css`, `app.js` — приложение
- `masters/*.json` — данные мастеров
- `manifest.json`, `sw.js`, `img/` — установка на главный экран и офлайн

## Локальный запуск

Откройте папку в VS Code и запустите через Live Server (или любой статический сервер).
Если после правок видите старую версию — это кэш service worker: обновите страницу ещё раз.
