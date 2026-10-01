# Studio App

Шаблон мобильного веб-приложения (PWA) для бьюти-мастера: услуги и цены, свободное время, ассистент, образы, запись в пару касаний.
Чистый HTML/CSS/JS без сборки — работает прямо на GitHub Pages.

**Демо:** https://moniyy.github.io/studio-app/ · **настоящая запись:** https://moniyy.github.io/studio-app/?m=test-studio (после подключения Supabase)

## Два режима записи

| `bookingEngine` | Что происходит в конце записи |
| --- | --- |
| `"external"` (по умолчанию) | как раньше: ссылка на Booksy / Vagaro / GlossGenius / Square, директ Instagram или SMS (`bookingMode`) |
| `"builtin"` | своя запись: живые свободные окна → данные клиентки → подтверждение. Отмена и перенос по личной ссылке, кабинет мастера, уведомления в реальном времени |

Весь клиентский интерфейс одинаковый, отличается только финал. Для `builtin` нужна база Supabase (ниже).
Демо (`masters/demo.json`, `?m=demo`) работает без базы.

## Как добавить нового мастера

### Вариант A — запись через ссылку мастера (без базы)

1. Скопируйте `masters/demo.json` в `masters/<slug>.json`, где `<slug>` — короткое имя латиницей, например `bella-nails`
   (только буквы, цифры, `-` и `_`).
2. Поменяйте данные: `name`, `tagline`, `city`, `avatar`, `heroPhoto`, `brandAccent`,
   `bookingUrl` (ссылка на Acuity / GlossGenius / Booksy), `instagram`, `phone`, `services`, `gallery`, `hours` и остальное.
   - `"style"` — стиль по умолчанию: `"noir"` (как приложение из App Store), `"maison"` (засечки, champagne) или `"soft"` (3D-иконки).
     Клиентка может сменить стиль сама: More → Appearance → Style.
   - `"bookingMode"` — куда ведёт кнопка в конце записи: `"link"` (открывает `bookingUrl`), `"instagram"` (директ + готовое
     сообщение в буфере), `"sms"` (SMS на `phone`), `"demo"` (сразу экран «Request sent»).
   - `"monogram"`, `"eyebrow"` (необязательно) — инициалы-логотип и строка над именем на главной.
3. `git add . && git commit -m "Add bella-nails" && git push`
4. Ссылка для клиенток: `https://moniyy.github.io/studio-app/?m=<slug>`

### Вариант B — своя запись (builtin, нужна Supabase)

1. Откройте `supabase/new-master.sql`, поменяйте название, email мастера, часовой пояс, услуги и часы.
2. Supabase → **SQL Editor** → вставьте → **Run**. Мастер создан, услуги и часы — в базе.
3. Фото и тексты: либо в поле `settings` того же SQL, либо в `masters/<slug>.json` с полем `"bookingEngine": "builtin"`
   (тогда из JSON берутся фото, галерея, отзывы, политики, а услуги, часы и правила — из базы).
4. Дайте мастеру ссылку `https://moniyy.github.io/studio-app/?m=<slug>&owner=1`. Она входит по своему email
   (письмо со ссылкой и 6-значным кодом) — студия сразу становится её. Дальше часы, отпуск, правила и записи — в кабинете.
5. Услуги потом удобно менять в Supabase → **Table Editor** → `services`.

## Подключение Supabase (один раз)

### В браузере

1. Откройте https://supabase.com → **Start your project** → **Continue with GitHub** → разрешите доступ.
2. Создайте организацию (план **Free**) → **New project**:
   - Name: `studio-app`
   - Database Password: нажмите **Generate**, сохраните пароль (понадобится для CLI)
   - Region: **East US (North Virginia)**
   - **Create new project** → подождите 1–2 минуты.
3. **Project Settings → API Keys** (или кнопка **Connect**): скопируйте **Project URL** и **anon / publishable** ключ.
   Ключ **service_role / secret** никуда не копируйте — он обходит всю защиту и в браузере ему не место.
4. **Authentication → URL Configuration**:
   - Site URL: `https://moniyy.github.io/studio-app/`
   - Redirect URLs: добавьте `https://moniyy.github.io/studio-app/**` и `http://127.0.0.1:5500/**` (для Live Server).
5. **Authentication → Emails → Magic Link**: добавьте в шаблон строку с кодом — он нужен, чтобы войти в установленное
   на iPhone приложение (ссылка из письма откроется в Safari, а не в иконке на экране «Домой»):
   ```html
   <p>Or type this code in the app: <b>{{ .Token }}</b></p>
   ```
   Встроенная почта Supabase отправляет лишь несколько писем в час — для реальной работы подключите свой SMTP
   (**Authentication → Emails → SMTP Settings**, например Resend).

### В терминале (Windows, PowerShell, в папке проекта)

```powershell
npx supabase login                          # откроется браузер — подтвердите вход
npx supabase link --project-ref <ref>       # <ref> — это часть Project URL: https://<ref>.supabase.co; спросит пароль БД
node tools/make-seed.js you@example.com     # тестовый мастер test-studio, владелец — ваш email
npx supabase db push --include-seed         # создаёт таблицы, защиту, функции и тестовые данные
```

Миграции лежат в `supabase/migrations/`, тестовые данные — в `supabase/seed.sql`. Следующие изменения схемы — новыми файлами
миграций (`npx supabase migration new <имя>`) и снова `npx supabase db push`.

### Ключи

- **Локально:** скопируйте `config.example.js` в `config.js` и впишите URL и anon-ключ. `config.js` в `.gitignore`.
- **На GitHub Pages:** **Settings → Secrets and variables → Actions → New repository secret**:
  `SUPABASE_URL` и `SUPABASE_ANON_KEY` (или `gh secret set SUPABASE_URL` / `gh secret set SUPABASE_ANON_KEY`).
  Сайт собирает workflow `.github/workflows/pages.yml` и сам кладёт `config.js` с этими значениями.
  Включение (один раз): `gh auth refresh -h github.com -s workflow` → перенести `tools/pages.yml` в
  `.github/workflows/pages.yml` → push → **Settings → Pages → Source: GitHub Actions**.

## Как устроена запись

- Таблицы: `masters`, `services`, `working_hours` (несколько интервалов в день — перерывы), `time_off`, `clients`, `bookings`.
- Двойная запись невозможна: exclusion constraint по `(master_id, время + буфер)` для активных записей —
  даже если две клиентки нажмут «Confirm» одновременно. Вторая увидит «This time was just taken» и обновлённые окна.
- Защита (RLS): мастер видит и меняет только свои данные; анонимная клиентка не читает таблицы вовсе —
  только через функции `get_public_profile`, `get_available_slots`, `get_openings`, `create_booking`,
  `get_booking`, `cancel_booking`, `reschedule_booking`.
- Своя запись клиентки хранится по секретному `manage_token`: на устройстве (More → My bookings, карточка на главной)
  и в ссылке `?m=<slug>&manage=<token>` — открывает запись на любом телефоне.
- Отмена позже окна `cancel_window_hours` помечается `late_cancel`, клиентка видит предупреждение заранее.
- Кабинет мастера (`cabinet.js`, грузится только по требованию): Today, Calendar (день / неделя, свайп), Requests
  (свайп — принять / отклонить), Clients (история, суммы, отмены, заметки), Hours (часы с перерывами, отпуск, правила).
  Новые записи и отмены приходят мгновенно через Supabase Realtime (если он недоступен — проверка каждые 15 секунд).

## Иконка на экране «Домой»

Иконка — та же 3D-иллюстрация, что на заставке, на тёмном фоне со свечением цвета мастера (для стиля noir — нейтрально-чёрный).

```
cd tools && npm install && cd ..
node tools/make-icon.js                      # для demo → img/
node tools/make-icon.js --master bella-nails # для мастера → img/bella-nails/
```

Для своего мастера добавьте в его JSON строку, которую напечатает скрипт: `"iconDir": "img/bella-nails/"`.

## Полезные параметры адреса

| Параметр | Что делает |
| --- | --- |
| `?m=slug` | какой мастер (`masters/slug.json` и/или студия в базе) |
| `&owner=1` | кабинет мастера (вход по email); для демо-мастеров — демо-кабинет |
| `&manage=<token>` | открыть свою запись (ссылка из подтверждения) |
| `&style=noir` / `maison` / `soft` | стиль приложения (запоминается) |
| `&splash=clean` / `&splash=photo` | вариант заставки |
| `&reset=1` | показать заставку и Welcome заново |
| `&look=<id>` | сразу открыть образ из галереи |

## Файлы

- `index.html`, `app.css`, `app.js` — приложение; `backend.js` — работа с Supabase; `cabinet.js` — кабинет мастера
- `config.example.js` → `config.js` — ключи Supabase (не в репозитории)
- `masters/*.json` — данные мастеров
- `supabase/` — миграции, тестовые данные, шаблон нового мастера
- `tools/` — генерация иконок и тестовых данных
- `manifest.json`, `sw.js`, `img/` — установка на главный экран и офлайн

## Локальный запуск

Откройте папку в VS Code и запустите через Live Server (или любой статический сервер).
Без `config.js` браузер покажет 404 на этот файл — это нормально, приложение работает без базы.
Если после правок видите старую версию — это кэш service worker: обновите страницу ещё раз.
