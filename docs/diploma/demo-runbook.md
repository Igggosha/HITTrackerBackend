# Демонстрація та ручна перевірка HitTracker

Усі команди виконуються з кореня backend-репозиторію. Приклади нижче використовують стандартний Compose-проєкт `hittrackerbackend` і локальні порти. На машині з іншими проєктами спочатку перевірте зайняті порти й підмережу; **не запускайте `down -v` для робочого проєкту**. Команди з `curl` у PowerShell означають саме `curl.exe`.

## 1. Чистий запуск

Потрібні Windows 11, Docker Desktop з Linux containers і Compose v2, Git, Node.js/npm для мобільного web-клієнта; для наведених HTTP-команд потрібен `curl` (у Windows — `curl.exe`). Виділіть Docker Desktop принаймні 8 GB RAM; для одночасних Kafka, Grafana, Jaeger, MinIO, двох PostgreSQL і web-клієнта практичніше мати 16 GB RAM на комп'ютері. Перший `--build` завантажує образи та може тривати довго.

За `README.md` створіть локальний `.env` із `.env.example`. Перед першим запуском обов'язково замініть `JWT_SECRET` і `OAUTH_SESSION_SECRET` на **різні** випадкові рядки щонайменше 24 символи; `S3_SECRET_ACCESS_KEY` не може бути `change_me_storage_secret`, `change_me`, `minioadmin` або порожнім за наявності `S3_BUCKET`. Також замініть `DB_PASSWORD`, `REPLICATION_PASSWORD` (інший пароль), `MINIO_ROOT_PASSWORD`, `METRICS_DB_PASSWORD`, `METRICS_TOKEN` (24+ символів), `GRAFANA_ADMIN_PASSWORD`, `S3_SECRET_ACCESS_KEY`, `BACKUP_S3_SECRET_ACCESS_KEY`, `RESTORE_S3_SECRET_ACCESS_KEY`, `ANALYTICS_DB_PASSWORD`. Для показу трас встановіть `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318`: без цього трасування вимкнено навіть за запущеного Jaeger. Якщо потрібні зображення на web, `S3_PUBLIC_ENDPOINT` мусить бути реально доступним клієнту і відповідати хосту підписаного URL; шаблон `https://files.example.com` не працюватиме локально. SMTP/Google потрібні лише для відповідних сценаріїв; тестового користувача нижче створюємо без SMTP.

Генерація одного секрету (повторіть окремо для кожної змінної):

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

```bash
openssl rand -hex 32
```

Compose має `name: hittrackerbackend`, тому назва не залежить від назви каталогу. Без профілю запускаються API, primary PostgreSQL, репліка, MinIO та одноразові bootstrap/migrate/seed; `events` додає Kafka KRaft, topic init, relay, analytics з окремою БД/міграцією та Kafka UI; `observability` додає Prometheus, exporter, Grafana, Jaeger, Loki, Alloy; `backup` окремо вмикає плановий backup. `edge` і `tools` для цієї демонстрації не потрібні.

```text
docker compose --profile events --profile observability up -d --build
docker compose ps
docker compose logs migrate
docker compose logs analytics-migrate
```

У `ps` API і analytics мають бути `healthy`, PostgreSQL/репліка/MinIO/Kafka — запущені, одноразові init/migrate/seed — `Exited (0)`. Для backup: `docker compose --profile backup up -d backup`. При зупинці використовуйте `docker compose --profile events --profile observability --profile backup down` (іменовані томи зберігаються).

**Другий, ізольований стек поруч із робочим.** Щоб не зачепити робочий `hittrackerbackend`, запускайте тестовий стек з власною назвою проєкту `-p <назва>`, окремим `--env-file <файл>` і вільними `PORT`/`*_PORT`/`PRIVATE_NETWORK_SUBNET`. Сервіс `api` читає секрети з жорстко заданого `env_file: .env` у `docker-compose.yml`, тому `--env-file` на його секрети **не впливає**. Щоб API теж узяв тестовий файл, додайте невеликий override-файл і передайте його другим `-f`:

```yaml
# docker-compose.test-override.yml
services:
  api:
    env_file: !override [.env.test]
```

```text
docker compose -p demotest --env-file .env.test -f docker-compose.yml -f docker-compose.test-override.yml --profile events --profile observability up -d --build
docker compose -p demotest --profile events --profile observability down -v
```

| Сервіс | Адреса за замовчуванням | Compose-змінна |
| --- | --- | --- |
| API | http://127.0.0.1:3000 | `PORT` |
| Grafana (`admin` + заданий пароль) | http://127.0.0.1:3001 | `GRAFANA_PORT` |
| Prometheus | http://127.0.0.1:9090 | `PROMETHEUS_PORT` |
| Jaeger UI | http://127.0.0.1:16686 | `JAEGER_UI_PORT` |
| Kafka UI | http://127.0.0.1:8085 | `KAFKA_UI_PORT` |
| MinIO Console | http://127.0.0.1:9001 | `MINIO_CONSOLE_PORT` |

Loki, relay metrics, analytics, Kafka та PostgreSQL не мають опублікованих host-портів. Усі наведені UI прив'язані до `127.0.0.1`.

## 2. Тестовий користувач і JWT без SMTP

Реєстрація через `/auth/register` залишає pending-запис до підтвердження email. Лише для локального демо вставте користувача напряму в primary. Схема `users` вимагає `email`, `display_name`; `role` і `created_at` мають defaults. Змініть пароль у команді та не використовуйте цей обліковий запис у production. Приклад створює користувача лише один раз:

```powershell
$hash = docker compose exec -T api node -e "require('bcrypt').hash('DemoPass123!',10).then(console.log)"
docker compose exec -T postgres psql -U postgres -d nestdb -c "INSERT INTO users (email, display_name, password_hash) VALUES ('demo@example.test','Demo Student','$hash') ON CONFLICT (email) DO NOTHING;"
$login = curl.exe -sS -X POST http://127.0.0.1:3000/auth/login -H 'Content-Type: application/json' --data-raw '{"email":"demo@example.test","password":"DemoPass123!","client":"native"}' | ConvertFrom-Json
$jwt = $login.accessToken
$jwt
```

```bash
hash=$(docker compose exec -T api node -e "require('bcrypt').hash('DemoPass123!',10).then(console.log)")
docker compose exec -T postgres psql -U postgres -d nestdb -c "INSERT INTO users (email, display_name, password_hash) VALUES ('demo@example.test','Demo Student','$hash') ON CONFLICT (email) DO NOTHING;"
jwt=$(curl -sS -X POST http://127.0.0.1:3000/auth/login -H 'Content-Type: application/json' --data-raw '{"email":"demo@example.test","password":"DemoPass123!","client":"native"}' | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).accessToken")
```

Якщо змінили `DB_USERNAME` або `DB_NAME`, підставте їх замість `postgres`/`nestdb`. `client: native` повертає `accessToken` у JSON; токен живе 5 хвилин — повторіть login перед наступним блоком. Не вставляйте JWT у скриншоти чи логи.

## 3. Ручні перевірки

### Помилки та requestId

**На захисті:** єдиний envelope дає HTTP-статус, стабільний код, шлях, час і ID запиту навіть для помилки body parser до Nest-маршруту. Безпечне повідомлення не розкриває внутрішню помилку.

```powershell
curl.exe -si http://127.0.0.1:3000/workouts/active
curl.exe -si http://127.0.0.1:3000/no-such-route
$body = '{"padding":"' + ('a' * 110000) + '"}'
$body | curl.exe -si -X POST http://127.0.0.1:3000/auth/register -H 'Content-Type: application/json' --data-binary '@-'
```

```bash
curl -si http://127.0.0.1:3000/workouts/active
curl -si http://127.0.0.1:3000/no-such-route
node -e "process.stdout.write(JSON.stringify({padding:'a'.repeat(110000)}))" | curl -si -X POST http://127.0.0.1:3000/auth/register -H 'Content-Type: application/json' --data-binary @-
```

Очікуйте відповідно `401`, `404`, `413` з однаковим значенням `X-Request-Id` і JSON `requestId` для кожного запиту; у 413 код `PAYLOAD_TOO_LARGE`. Це контрольоване порушення, після нього API продовжує відповідати на `GET /`.

### Метрики та логи

**На захисті:** Prometheus збирає HTTP і PostgreSQL показники, Grafana показує API Overview; `/metrics` захищений окремим bearer-токеном. Loki дозволяє знайти JSON-лог за ID клієнтської відповіді.

```powershell
curl.exe -si http://127.0.0.1:3000/metrics
curl.exe -sS http://127.0.0.1:3000/metrics -H "Authorization: Bearer $env:METRICS_TOKEN"
curl.exe -si http://127.0.0.1:3000/no-such-route -H 'X-Request-Id: demo_runbook_1'
```

```bash
curl -si http://127.0.0.1:3000/metrics
curl -sS http://127.0.0.1:3000/metrics -H "Authorization: Bearer $METRICS_TOKEN"
curl -si http://127.0.0.1:3000/no-such-route -H 'X-Request-Id: demo_runbook_1'
```

Очікуйте `401` без токена й Prometheus text з токеном (значення беріть зі своєї конфігурації, не друкуйте в презентації). У Grafana: **Dashboards → API Overview** і **Logs**; в Explore оберіть Loki й запитайте `{service="api"} | requestId="demo_runbook_1"`. Відсутні логи перевіряйте через `docker compose exec alloy printenv ALLOY_COMPOSE_PROJECT`: має бути `hittrackerbackend`. Для стійкості викличте 404 кілька разів і покажіть зміну request counters, не зупиняючи API.

### Траси

**На захисті:** `X-Trace-Id` зв'язує HTTP, SQL і асинхронну обробку події. Використайте finish-запит з наступного блоку, запишіть його `X-Trace-Id`, у Jaeger UI знайдіть service `hit-api` та trace ID: в одному trace мають бути HTTP/pg spans `hit-api` → producer span `hit-relay` → CONSUMER span `hit-analytics` з `event.id`/`event.type` і вкладеними pg spans. У Grafana Explore оберіть Loki й виконайте `{service=~".+"} | traceId="<X-Trace-Id>"`: очікуйте логи `api` та `analytics` (у другому є `eventId`/`eventType`). Натисніть `traceId` у логу для переходу в Jaeger, а **Logs for this span** у Jaeger/Grafana — для повернення в Loki. Якщо вимкнути endpoint OTLP і перезапустити API/relay/analytics, HTTP продовжить працювати, але нових трас не буде.

### Тренування → outbox → Kafka → analytics

**На захисті:** зміна тренування та `workout.finished` записуються однією транзакцією в PostgreSQL; relay згодом доставляє подію в Kafka, а analytics будує окрему модель читання. Спершу знайдіть ID наявної вправи, щоб не припускати seed ID:

```powershell
docker compose exec -T postgres psql -U postgres -d nestdb -c "SELECT id,name FROM exercises ORDER BY id LIMIT 3"
$exerciseId = 1 # замініть на ID із SELECT
$start = curl.exe -sS -X POST http://127.0.0.1:3000/workouts/start -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' --data-raw '{}' | ConvertFrom-Json
$workoutId = $start.workout.id
$set = '{"exerciseId":' + $exerciseId + ',"weight":60,"reps":8,"rpe":7}'
curl.exe -sS -X POST "http://127.0.0.1:3000/workouts/$workoutId/sets" -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' --data-raw $set
curl.exe -si -X POST "http://127.0.0.1:3000/workouts/$workoutId/finish" -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' --data-raw '{}'
```

```bash
docker compose exec -T postgres psql -U postgres -d nestdb -c 'SELECT id,name FROM exercises ORDER BY id LIMIT 3'
exercise_id=1 # замініть на ID із SELECT
workout_id=$(curl -sS -X POST http://127.0.0.1:3000/workouts/start -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' --data-raw '{}' | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).workout.id")
curl -sS -X POST "http://127.0.0.1:3000/workouts/$workout_id/sets" -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' --data-raw "{\"exerciseId\":$exercise_id,\"weight\":60,\"reps\":8,\"rpe\":7}"
curl -si -X POST "http://127.0.0.1:3000/workouts/$workout_id/finish" -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' --data-raw '{}'
```

Очікуйте `Workout finished successfully` (або еквівалентний JSON), один рядок `workout.finished` з `published_at`, і повідомлення в Kafka UI → `hit.workout.v1`:

```text
docker compose exec -T postgres psql -U postgres -d nestdb -c "SELECT id,event_type,published_at,attempts FROM outbox_events ORDER BY occurred_at DESC LIMIT 5"
docker compose --profile events exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic hit.workout.v1 --from-beginning --max-messages 1
```

Перевірка стійкості: `docker compose --profile events stop kafka`, створіть і завершіть **нове** тренування тими самими командами; outbox-рядок спершу матиме `published_at IS NULL`, а API відповість успішно. `docker compose --profile events start kafka`; дочекайтесь `published_at` і події в UI. Relay обмежує очікування broker через `RELAY_PUBLISH_TIMEOUT_MS`, `RELAY_CONNECTION_TIMEOUT_MS` (обидва 5000 ms) і `RELAY_DB_TX_TIMEOUT_MS` (10000 ms); короткі помилки під час зупинки очікувані.

### Analytics CQRS та повтори

**На захисті:** нормалізована write-модель не рахує графіки щоразу; окрема read-модель оновлюється після Kafka з малою затримкою. Для нового тренування підсумок може коротко показати старе значення.

```powershell
curl.exe -sS http://127.0.0.1:3000/analytics/me/summary -H "Authorization: Bearer $jwt"
curl.exe -sS 'http://127.0.0.1:3000/analytics/me/weekly-volume?weeks=12' -H "Authorization: Bearer $jwt"
curl.exe -sS http://127.0.0.1:3000/analytics/me/personal-records -H "Authorization: Bearer $jwt"
```

```bash
for path in summary 'weekly-volume?weeks=12' personal-records; do curl -sS "http://127.0.0.1:3000/analytics/me/$path" -H "Authorization: Bearer $jwt"; done
```

Очікуйте `lastWorkout`, тижневий обсяг і рекорд для вправи після обробки події. У Grafana відкрийте **Analytics (CQRS read side)**; Kafka UI покаже consumer group `analytics` і lag. Для деградації `docker compose --profile events stop analytics`, викличте summary: `503` + `ANALYTICS_UNAVAILABLE`; завершіть ще одне тренування, потім `docker compose --profile events start analytics` — lag спаде й підсумок наздожене write-модель. Безпека повторів: consumer записує `processed_events.event_id` з `ON CONFLICT DO NOTHING`, тому повторна доставка не подвоює підсумок; це також покриває тест `services/analytics/src/projections/projector.spec.ts`. Для повного відновлення проєкцій з журналу:

```text
docker compose --profile events stop analytics
docker compose --profile events run --rm --no-deps analytics node dist/services/analytics/src/cli/rebuild-projections.js
docker compose --profile events start analytics
```

Збережіть JSON summary до/після; дані мають збігатися після catch-up. Rebuild змінює read-модель, тому запускайте його після основного показу.

### Репліка та узгодженість сесії

**На захисті:** звичайні browsing reads розвантажують primary, а auth/транзакції читають primary. Після власного запису `readerFor(userId)` протягом стандартних 5 секунд спрямовує історію на primary, щоб користувач одразу побачив зміну.

```text
docker compose exec -T postgres psql -U postgres -d nestdb -c "SELECT pg_is_in_recovery(), application_name,state,pg_wal_lsn_diff(pg_current_wal_lsn(),replay_lsn) AS bytes_behind FROM pg_stat_replication"
docker compose exec -T postgres-replica psql -U postgres -d nestdb -tAc 'SELECT pg_is_in_recovery()'
```

На primary `pg_is_in_recovery=f`, `state=streaming`, на replica `t`; `bytes_behind` може тимчасово бути >0. Після нового finish відразу викличте `GET /workouts/history` з JWT, потім ще раз через 6 секунд: перший читає primary, другий може читати replica. Для порушення зупиніть лише `postgres-replica`: browsing reads після вікна можуть дати помилку, але write/auth через primary залишаться; запустіть `docker compose start postgres-replica`. Не інтерпретуйте вік `pg_last_xact_replay_timestamp()` на бездіяльній БД як lag.

### Дві гонки транзакцій

**На захисті:** `finish` блокує рядок `FOR UPDATE`, тому два конкурентні запити створюють лише одну finish-подію; перевірка кодів блокує pending-рядок, тому паралельні помилки досягають ліміту п'яти спроб.

Створіть нове тренування як вище і **не** завершуйте його. PowerShell:

```powershell
1..5 | ForEach-Object { Start-Job -ScriptBlock { param($id,$token) curl.exe -sS -X POST "http://127.0.0.1:3000/workouts/$id/finish" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data-raw '{}' } -ArgumentList $workoutId,$jwt } | Receive-Job -Wait
```

Bash:

```bash
for i in 1 2 3 4 5; do curl -sS -X POST "http://127.0.0.1:3000/workouts/$workout_id/finish" -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' --data-raw '{}' & done; wait
```

Один результат має означати успішне завершення, решта — `Workout was already finished`; запитайте `SELECT count(*) FROM outbox_events WHERE event_type='workout.finished' AND aggregate_id='<ID>';` — має бути 1. Для другої гонки створіть disposable pending-запис через локальний psql (не надсилайте `/auth/register`: потрібен SMTP):

```text
docker compose exec -T postgres psql -U postgres -d nestdb -c "INSERT INTO pending_registrations(email,display_name,password_hash,verification_code_hash,expires_at) VALUES ('race@example.test','Race','unused','$hash',now()+interval '1 hour') ON CONFLICT (email) DO UPDATE SET attempts=0,locked_until=NULL,expires_at=excluded.expires_at"
```

Виконайте 12 запитів `/auth/register/verify` з `{"email":"race@example.test","code":"000000"}` паралельно. PowerShell (працює і у Windows PowerShell 5.1):

```powershell
1..12 | ForEach-Object { Start-Job -ScriptBlock { curl.exe -sS -o NUL -w '%{http_code}\n' -X POST http://127.0.0.1:3000/auth/register/verify -H 'Content-Type: application/json' --data-raw '{"email":"race@example.test","code":"000000"}' } } | Receive-Job -Wait
```

Bash:

```bash
for i in {1..12}; do curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/auth/register/verify -H 'Content-Type: application/json' --data-raw '{"email":"race@example.test","code":"000000"}' & done; wait
```

Endpoint має також IP throttle `5/хв` і block 30 хв, тому на live-API частину запитів відхилить HTTP guard до транзакції. Строгий результат `4×400, 8×429`, `attempts=5` доводить інтеграційний тест `src/outbox/concurrency.integration.spec.ts`, а live-показ перевіряє lockout лише з урахуванням throttle; перед ним дочекайтесь завершення хвилинного вікна після login. Перевірте `SELECT attempts,locked_until FROM pending_registrations WHERE email='race@example.test';`. Використовуйте окремий email, щоб не блокувати демо-користувача.

### Backup, перевірка відновлення, GFS

**На захисті:** один backup set містить PostgreSQL dump, дзеркало приватного bucket і manifest. GFS залишає останні 7 денних, 4 недільних та 12 перших днів місяця; complete set має бути скопійований поза цей комп'ютер для захисту від втрати диска.

```text
docker compose --profile backup up -d backup
docker compose exec -T postgres psql -U postgres -d nestdb -c "CREATE TABLE IF NOT EXISTS runbook_restore_marker (id integer PRIMARY KEY); INSERT INTO runbook_restore_marker(id) VALUES (1) ON CONFLICT DO NOTHING"
docker compose --profile backup run --rm backup run-now
docker compose --profile backup run --rm -e RESTORE_S3_ACCESS_KEY_ID -e RESTORE_S3_SECRET_ACCESS_KEY backup verify-restore
```

Перед двома останніми командами експортуйте `RESTORE_S3_ACCESS_KEY_ID` і `RESTORE_S3_SECRET_ACCESS_KEY` у shell із ваших локальних значень (PowerShell: `$env:RESTORE_S3_ACCESS_KEY_ID='hit-tracker-restore'`; bash: `export RESTORE_S3_ACCESS_KEY_ID=hit-tracker-restore`; секрет так само, не показуйте його в історії команд). `verify-restore` вибирає найновіший set, створює scratch БД, перевіряє таблиці/міграції та видаляє scratch БД після успіху; очікуйте `verify-restore: OK` і лічильники. Для показу «видалив → відновив» видаліть **лише демонстраційний marker** з live БД, візьміть назву set з `run-now`/`docker compose --profile backup run --rm --no-deps --entrypoint sh backup -c 'ls -1 /backups'`, відновіть у нову scratch БД і прочитайте marker:

```text
docker compose exec -T postgres psql -U postgres -d nestdb -c "DELETE FROM runbook_restore_marker WHERE id=1"
docker compose --profile backup run --rm -e RESTORE_S3_ACCESS_KEY_ID -e RESTORE_S3_SECRET_ACCESS_KEY backup restore <SET> --database runbook_restored
docker compose exec -T postgres psql -U postgres -d runbook_restored -c "SELECT * FROM runbook_restore_marker"
docker compose exec -T postgres dropdb -U postgres --maintenance-db=postgres runbook_restored
```

Очікуйте `id=1` у scratch, хоча live marker видалений. Для MinIO можна перед backup завантажити disposable об'єкт через Console, після backup видалити лише його й після restore перевірити появу; `restore` **зливає** bucket, не стирає сторонні ключі. Прибирання live marker: `docker compose exec -T postgres psql -U postgres -d nestdb -c 'DROP TABLE runbook_restore_marker'`. Ніколи не використовуйте `--force-live` у цій вправі.

### Навантаження

Якщо у вашій інтеграційній гілці є `docs/diploma/load-testing.md`, виконуйте наведений там профіль і фіксуйте latency/RPS у Grafana. Інакше перевірте каталог `load-tests/` після злиття цієї роботи: у поточній гілці його немає, тому тут немає вигаданого запуску.

## 4. Мобільний web-клієнт

У окремому checkout `C:\Users\zakhar\orca\workspaces\hit-tracker-mobile\diploma-platform` виконайте `npm install`, тоді для PowerShell `$env:EXPO_PUBLIC_API_URL='http://localhost:3000'; npm run web`, для bash `EXPO_PUBLIC_API_URL=http://localhost:3000 npm run web`. `src/constants/config.js` читає цю змінну і прибирає кінцевий `/`; web-скрипт Expo відкриває порт 5173. Переконайтесь, що backend `CORS_ORIGINS` містить `http://localhost:5173`. Увійдіть `demo@example.test` / тестовим паролем, завершіть тренування у вкладці **Training**, відкрийте вкладку **Analytics / Аналітика**: підсумок, weekly volume, PR і progress для вправи. Після finish екран може коротко показувати **Оновлюємо статистику…**, доки подія пройде outbox/Kafka. Зупиніть analytics (`docker compose --profile events stop analytics`), оновіть екран: **Статистика тимчасово недоступна**, але тренування працюють; після `start analytics` екран наздожене події. Для фізичного телефона `localhost` означає телефон — потрібна доступна й дозволена адреса backend; локальний web-демо працює на тому самому ПК.

## 5. Сценарій захисту на 10 хвилин

| Час | Дія | Що сказати |
| --- | --- | --- |
| 0:00–1:00 | `docker compose ps`, Grafana API Overview | Compose збирає write API, replica, події й спостережуваність; health видно окремо. |
| 1:00–2:00 | 401/404 з `X-Request-Id`, знайти лог у Logs | Одна форма помилки та шлях від клієнта до логу. |
| 2:00–4:00 | Web-клієнт: finish тренування, відкрити Analytics | Запис і подія атомарні; графіки з окремої read-моделі з'являються асинхронно. |
| 4:00–5:00 | Kafka UI `hit.workout.v1`, SQL outbox | Доставка at-least-once, pending-рядок переживає падіння broker. |
| 5:00–6:00 | Jaeger trace за `X-Trace-Id`, перехід до Loki | HTTP → pg → relay → analytics CONSUMER в одному trace; Loki повертає логи API й analytics. |
| 6:00–7:00 | Зупинити analytics, показати 503 і робоче тренування, запустити | Read-side відмовляє ізольовано та наздоганяє Kafka. |
| 7:00–8:00 | SQL `pg_is_in_recovery`, lag | Читання з репліки, write/read-your-writes з primary. |
| 8:00–9:00 | Показати `verify-restore: OK` або готовий manifest | Dump + bucket та реальний restore drill, GFS. |
| 9:00–10:00 | Паралельний finish і один outbox event | Row lock робить повторний finish ідемпотентним. |

Перед виступом заздалегідь створіть тестового користувача, перевірте JWT, підготуйте **незавершене** тренування, backup set і відкриті вкладки Grafana/Jaeger/Kafka UI. Не витрачайте 10 хвилин на перший Docker build або `run-now`.

Якщо щось зламається наживо: (1) `docker compose ps` і `docker compose logs --tail=100 api relay analytics`; (2) старий JWT — login ще раз; (3) Grafana порожня — перевірте `ALLOY_COMPOSE_PROJECT`, діапазон часу та `OTEL_EXPORTER_OTLP_ENDPOINT`; (4) Kafka недоступна — покажіть pending outbox і запустіть broker; (5) analytics недоступна — покажіть 503 та успішний write API; (6) Jaeger порожній після рестарту — зробіть новий запит, бо сховище Jaeger у пам'яті; (7) backup триває довго — покажіть попередній manifest/`verify-restore: OK`.

## 6. Усунення типових проблем

| Симптом | Перевірка та дія |
| --- | --- |
| API crash-loop при першому запуску | Замініть placeholder `S3_SECRET_ACCESS_KEY` при непорожньому `S3_BUCKET`; також перевірте 24+ символи `JWT_SECRET`/`OAUTH_SESSION_SECRET`. `docker compose logs api`. |
| Свіжий том не має таблиць | Перевірте `bootstrap`, `migrate`, `seed` через `docker compose logs`; `sql/init.sql` завантажується тільки при ініціалізації тому, а Drizzle baseline/migrations виконуються далі. Не використовуйте `db:push` для робочих даних. |
| Перший `up --build -d` на свіжому томі завершується помилкою `postgres-replica is unhealthy` | Репліка ще виконує `pg_basebackup`, а Compose передчасно вважає залежність невдалою. Через кілька секунд вона вже `healthy`: просто повторіть `docker compose ... up -d` без `--build`. |
| `Pool overlaps with other one on this address space` | Встановіть вільний `PRIVATE_NETWORK_SUBNET`, виконайте `docker compose down`, потім `up`; `down` без `-v` зберігає томи. |
| Антивірус Check Point/DLP повідомляє про `package-lock.json` | Порівняйте файл з Git та повторіть встановлення в чистому checkout; це відомий false positive, не видаляйте lockfile й не обходьте корпоративні правила. |
| Logs порожні | Alloy фільтрує **точну** назву Compose-проєкту; для `-p`/`COMPOSE_PROJECT_NAME` передайте таке саме значення в env для `ALLOY_COMPOSE_PROJECT`. Типово це `hittrackerbackend`. |
| Grafana provisioning показує буквальний або порожній пароль/змінну | У Compose-конфігурації `$` для внутрішньої Grafana-підстановки екранується як `$$`; при редагуванні YAML не прибирайте це екранування. |
| Пауза або «сіра» відмова Kafka | Relay чекає до 5 секунд на publish/connect і має 10-секундний DB tx backstop; перевірте pending outbox, `last_error`, logs relay, запустіть Kafka і дочекайтесь повтору. |
| MinIO-зображення не відкривається локально | `S3_PUBLIC_ENDPOINT` підписує URL для свого hostname; шаблонний `files.example.com` не доступний. Змініть на реально маршрутизований files-host згідно з `GOOGLE_OAUTH_SETUP.md`/storage частиною `README.md`. |

## Known issues

- Видалення тренування з write-моделі не породжує події видалення; analytics може зберегти його в агрегатах (`docs/diploma/analytics-cqrs.md`).
