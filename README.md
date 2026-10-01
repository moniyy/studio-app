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
3. Файл установки на экран «Домой»: `node tools/make-manifest.js bella-nails` → `manifests/bella-nails.webmanifest`
   (иначе иконка на iPhone откроет последнего открытого мастера или demo).
4. `git add . && git commit -m "Add bella-nails" && git push`
5. Ссылка для клиенток: `https://moniyy.github.io/studio-app/?m=<slug>`

### Вариант B — своя запись (builtin, нужна Supabase)

1. Откройте `supabase/new-master.sql`, поменяйте название, email мастера, часовой пояс, услуги и часы.
2. Supabase → **SQL Editor** → вставьте → **Run**. Мастер создан, услуги и часы — в базе.
   Файл установки на экран «Домой»: `node tools/make-manifest.js bella-nails` (название и стиль берутся из базы через `config.js`).
3. Фото и тексты: либо в поле `settings` того же SQL, либо в `masters/<slug>.json` с полем `"bookingEngine": "builtin"`
   (тогда из JSON берутся фото, галерея, отзывы, политики, а услуги, часы и правила — из базы).
4. Аккаунт мастера: Supabase → **Authentication → Users → Add user → Create new user** — email мастера,
   временный пароль, галочка **Auto Confirm User**.
5. Привяжите аккаунт к студии (SQL Editor, вторая часть `new-master.sql`):
   ```sql
   update public.masters set owner_id = (select id from auth.users where email = 'bella@example.com')
    where slug = 'bella-nails';
   ```
6. Дайте мастеру ссылку `https://moniyy.github.io/studio-app/?m=<slug>&owner=1` и временный пароль.
   Она входит (email + пароль) и сразу меняет пароль: значок аккаунта вверху → **Change password**.
   Дальше часы, отпуск, правила и записи — в кабинете.
   **На iPhone:** у приложения на экране «Домой» своё хранилище, отдельное от Safari — поэтому вход нужно сделать
   ещё раз уже **внутри установленного приложения** (долгое нажатие на монограмму / аватар → вход). После этого
   приложение сразу открывается в кабинете, а сверху переключатель **Studio · Client view** — посмотреть, как видят клиентки.
7. Услуги потом удобно менять в Supabase → **Table Editor** → `services`.

Студия привязывается только по `owner_id`: регистрация с чужим email студию не отдаёт.

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
5. **Authentication → Sign In / Providers → Email**: вход мастера — email + пароль, писем пока нет,
   поэтому **Confirm email** выключен. Рекомендуется выключить и **Allow new users to sign up**:
   аккаунты мастеров создаются вручную (Add user), публичная регистрация не нужна.
   Письма (подтверждения, напоминания, сброс пароля) — в части 2 через свой SMTP.

### В терминале (Windows, PowerShell, в папке проекта)

```powershell
npx supabase login                          # откроется браузер — подтвердите вход
npx supabase link --project-ref <ref>       # <ref> — это часть Project URL: https://<ref>.supabase.co; спросит пароль БД
npx supabase db push --include-seed         # создаёт таблицы, защиту, функции и тестовые данные (test-studio)
```

Потом создайте себе аккаунт и привяжите к `test-studio` — как в шагах 4–5 варианта B.

Миграции лежат в `supabase/migrations/`, тестовые данные — в `supabase/seed.sql`. Следующие изменения схемы — новыми файлами
миграций (`npx supabase migration new <имя>`) и снова `npx supabase db push`.

### Ключи

- **Локально:** скопируйте `config.example.js` в `config.js` и впишите URL и anon-ключ. `config.js` в `.gitignore`.
- **На GitHub Pages:** **Settings → Secrets and variables → Actions → New repository secret**:
  `SUPABASE_URL` и `SUPABASE_ANON_KEY` (или `gh secret set SUPABASE_URL` / `gh secret set SUPABASE_ANON_KEY`).
  Сайт собирает workflow `.github/workflows/pages.yml` и сам кладёт `config.js` с этими значениями
  (**Settings → Pages → Source: GitHub Actions**).

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
- Повторное нажатие «Confirm» (двойной тап, повтор после обрыва связи) не создаёт вторую запись: у каждого выбора
  свой `request id`, сервер возвращает ту же запись. Запрос, висящий дольше 15 секунд, отменяется с «Connection problem — try again».
- Кабинет мастера (`cabinet.js`, грузится только по требованию): **Today** (с запросами — свайп принять / отклонить),
  **Calendar** (день / неделя, свайп), **Clients**, **Insights**, **Studio**.
  Новые записи и отмены приходят мгновенно через Supabase Realtime (если он недоступен — проверка каждые 15 секунд).

## Мастер управляет студией сама

Для мастеров в базе клиентская часть берёт всё из Supabase; JSON в `masters/` нужен только демо-мастерам.
После каждого сохранения в кабинете открытое приложение клиентки перезагружает данные студии.

- **Studio → Profile & photos** — обложка Home, своё фото, название, подзаголовок, город, адрес, парковка, телефон,
  Instagram, ссылка на отзывы (Google / Instagram).
- **Look & feel** — стиль (Soft / Maison / Noir) и акцент с живым превью.
- **Services** — добавить, изменить, скрыть, удалить, перетащить ≡ для порядка; категории Lashes / Brows / Nails / Other
  или своя; длительность, буфер после, цена (или «from $»), депозит, фото, напоминание о коррекции через N недель.
- **Looks** — работы для галереи: фото, «до», название, тег, услуга для записи, метка New.
- **Payments & deposits** — Cash App, Zelle, Venmo, PayPal.me, ссылка Square; сколько часов на оплату депозита;
  депозит для клиенток с 2+ неявками.
- **Hours, time off & rules**, **Policies & texts** (депозит, отмены, опоздания, неявки, «Before your visit», уход),
  **Assistant answers** (вопрос → ответ; ключевые слова для ассистента подбираются сами).
- **Фото** с телефона сжимаются в браузере до ~1600 px WebP и хранятся в Supabase Storage (`studio-media/<id студии>/…`,
  писать может только владелец студии). Заменённые и несохранённые фото удаляются.
- **Clients** — теги VIP / New / Allergy / Patch test (с датой), контакты, заметки, история, отмены, неявки;
  **Lash map** на каждый визит (изгиб, длины, толщина, тип, клей, заметка, фото «после»).
  На карточке следующей клиентки и в записи: «Last time: C · 10–13 · 0.07 Hybrid».

### Депозиты (без своих платежей)

Если у услуги есть депозит и у мастера указан хотя бы один способ оплаты, после записи клиентка видит
«Pay $30 deposit to hold your spot» с кнопками Cash App / Venmo / PayPal / Square (сумма уже подставлена) и «Copy» для Zelle,
статус — **Awaiting deposit**. Мастер видит «Deposit pending» и нажимает **Mark deposit received**.
Не оплачено за отведённые часы (но не позже чем за час до визита) — задача `pg_cron` (каждые 5 минут)
отменяет запись, освобождает время и присылает мастеру push «Spot released». Клиентке с 2+ неявками депозит
выставляется на любую запись.

### После визита

- Подтверждённая запись становится **Completed** через 2 часа после окончания (задача `pg_cron` каждые 15 минут),
  если мастер не отметила иначе; в записи остаётся кнопка «It was a no-show».
- Клиентка видит на Home «How was your visit?» со ссылкой на отзыв, а когда подходит срок коррекции услуги —
  «Time for your fill 💕» с записью на ту же услугу.

### Insights

Owner → **Insights** считает по настоящим записям (функция `owner_insights`): выручка и записи по неделям / месяцам
(график, тап по столбцу — детали), отмены и поздние отмены, освобождённые без депозита, доля неявок, топ услуг,
новые и вернувшиеся клиентки, загрузка по дням недели. Цифры-примеры остаются только у демо-мастера.

## Push-уведомления мастеру

Новая запись, новый запрос, отмена клиенткой (поздняя — отдельно), перенос и запись, отменённая из‑за неоплаченного депозита, приходят мастеру системным уведомлением —
даже когда приложение закрыто. Работает на iPhone (iOS 16.4+, только в установленном приложении), Android и компьютерах.

- **Включение:** кабинет → Today → карточка «Get notified about bookings» → **Turn on notifications**.
  Разрешение спрашивается только по нажатию. Там же статус (On / Off / Blocked с подсказкой), **Send test notification** и Turn off.
- **Как устроено:** `push_subscriptions` (по строке на устройство, RLS) → триггер на `bookings` через `pg_net` вызывает
  Edge Function `send-push` (`supabase/functions/send-push`) → Web Push (VAPID, шифрование aes128gcm на WebCrypto).
  Подписки, ответившие 404/410, удаляются. Тап по уведомлению открывает кабинет сразу на этой записи.
- **Ключи:** публичный VAPID-ключ — в `config.js` (`vapidPublicKey`, на Pages — секрет `VAPID_PUBLIC_KEY`).
  Приватный — только в секретах Supabase: `npx supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=… PUSH_HOOK_SECRET=…`.
  Триггер берёт адрес функции и общий секрет из Supabase Vault (`push_function_url`, `push_hook_secret`).
- **Деплой функции:** `npx supabase functions deploy send-push --use-api --no-verify-jwt`
  (функция сама проверяет вызывающего: секрет триггера или вход мастера).

### Проверка на iPhone

1. Откройте `https://moniyy.github.io/studio-app/?m=test-studio&owner=1` в **Safari** → карточка покажет, как добавить
   приложение на экран «Домой»: **Поделиться → На экран «Домой»**.
2. Откройте **приложение с экрана «Домой»** (не Safari), войдите → Today → **Turn on notifications** → **Разрешить**.
3. **Send test notification** — уведомление «Notifications are on ✓» придёт сразу.
4. Закройте приложение (свайп вверх). С другого телефона или компьютера запишитесь на `?m=test-studio` —
   через пару секунд придёт «New booking ✨ …». Отмените — «Cancelled …» (или «Late cancel …», если до визита меньше 24 ч).
5. Тап по уведомлению откроет кабинет на этой записи.
6. Если выбрали «Не разрешать»: **Настройки → Уведомления → Test Studio → Допуск уведомлений**.
   Фокус-режим «Не беспокоить» может скрывать уведомления.

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
- `manifests/<slug>.webmanifest`, `sw.js`, `img/` — установка на главный экран (у каждого мастера свой файл) и офлайн

## Локальный запуск

Откройте папку в VS Code и запустите через Live Server (или любой статический сервер).
Без `config.js` браузер покажет 404 на этот файл — это нормально, приложение работает без базы.
Если после правок видите старую версию — это кэш service worker: обновите страницу ещё раз.
