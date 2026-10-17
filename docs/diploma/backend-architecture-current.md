# Backend architecture / Архітектура backend

## English

### Runtime shape

The backend is a NestJS system built around one authoritative PostgreSQL database and several optional worker/read-model processes. The normal synchronous request path is:

`mobile/web client → NestJS controller and guards → feature service → Drizzle transaction/query → PostgreSQL → DTO-shaped response`.

Controllers own HTTP concerns such as routes, parameters, uploaded files, cookies, and status codes. DTOs validate and transform untrusted input. Feature services implement domain rules and build Drizzle queries directly; the project intentionally has no additional repository layer. PostgreSQL constraints and transactions protect invariants that must survive concurrent requests.

### Process entry points

- `src/main.ts` starts the public HTTP API and applies shared validation, security, session, CORS, request-ID, metrics, and exception handling.
- `src/relay/main.ts` runs the transactional-outbox relay. It claims committed outbox rows and publishes their events to Kafka.
- `src/search-indexer/main.ts` consumes catalog events and updates the rebuildable Elasticsearch search index.
- `src/notification-worker/main.ts` consumes or schedules notification work and records delivery results.

These processes share schemas and selected NestJS modules, but each has a separate entry point and deployment responsibility.

### Source-of-truth rule

PostgreSQL is authoritative for users, permissions, exercises, programs, workouts, notifications, and the outbox. Elasticsearch only ranks search candidates. Search results are reloaded from PostgreSQL before returning them, so deleted, private, or otherwise invisible records cannot be exposed by a stale index. Kafka transports committed facts; it is not the primary store of application state.

### Feature modules

| Module | Main responsibility |
| --- | --- |
| `auth` | Registration, login, rotating refresh sessions, Google OAuth with mobile PKCE, password reset, MFA, role enforcement, and suspension checks. |
| `users` | Profiles, usernames, presence/activity, body metrics, administrative role changes, suspension, and session revocation. |
| `exercises` | Exercise and muscle catalog, primary/secondary muscle roles, personal selection, likes, and moderator editing. |
| `workout-programs` | Official and personal programs, schedules, sharing, media, library reactions, revisions, and ownership rules. |
| `workouts` | Workout session lifecycle, sets, timing, completion/cancellation, and cursor-based history with snapshots. |
| `catalog-search` | Elasticsearch query construction followed by PostgreSQL visibility rehydration. |
| `notifications` | Preferences, devices, messages, campaigns, reminders, attachments, and delivery records. |
| `outbox` | Atomic event creation inside business transactions and safe concurrent claiming. |
| `analytics-proxy` | Authenticated access to analytics read models without making the mobile client aware of internal topology. |
| `admin-observability` | Allowlisted operational status for privileged administration screens. |

### Cross-cutting infrastructure

`config` validates the environment before external connections are used. `common` standardizes request IDs and public error envelopes. `security` provides shared Redis-backed throttling without storing raw identity values. `storage` validates and normalizes uploaded images before private S3/MinIO storage. `metrics` exposes a protected Prometheus endpoint and bounded-cardinality measurements. `tracing` initializes and flushes OpenTelemetry around all processes.

### How to trace a feature during the defense

Use one concrete flow and move through the layers. For creating an exercise with muscle roles:

1. the mobile editor sends `primaryMuscleIds` and `secondaryMuscleIds`;
2. the controller accepts the validated DTO;
3. the service rejects overlap and performs the exercise and relation writes in one transaction;
4. the relation table stores `primary` or `secondary` under a database check constraint;
5. the same transaction adds an outbox event;
6. the relay publishes the committed change and the search indexer refreshes Elasticsearch;
7. later reads still rehydrate the authoritative PostgreSQL record.

This example demonstrates validation, transactional integrity, asynchronous integration, and source-of-truth boundaries in one flow.

## Українською

### Структура виконання

Backend — це система NestJS з однією авторитетною базою PostgreSQL і кількома необовʼязковими процесами працівників та моделей читання. Звичайний синхронний шлях запиту:

`мобільний або вебклієнт → контролер і guards NestJS → функціональний сервіс → транзакція або запит Drizzle → PostgreSQL → відповідь у формі DTO`.

Контролери відповідають за HTTP-деталі: маршрути, параметри, завантажені файли, cookie та коди стану. DTO перевіряють і перетворюють недовірені вхідні дані. Функціональні сервіси реалізують доменні правила й безпосередньо будують запити Drizzle; додаткового repository-рівня в проєкті навмисно немає. Обмеження й транзакції PostgreSQL захищають незмінні умови під час паралельних запитів.

### Точки входу процесів

- `src/main.ts` запускає публічний HTTP API та застосовує спільну валідацію, захист, сесії, CORS, ідентифікатори запитів, метрики й обробку помилок.
- `src/relay/main.ts` запускає relay транзакційного outbox. Він резервує зафіксовані рядки outbox і публікує події в Kafka.
- `src/search-indexer/main.ts` споживає події каталогу й оновлює відновлюваний пошуковий індекс Elasticsearch.
- `src/notification-worker/main.ts` виконує або планує роботу зі сповіщеннями та записує результати доставки.

Ці процеси спільно використовують схеми й окремі модулі NestJS, але мають різні точки входу та відповідальність під час розгортання.

### Правило джерела істини

PostgreSQL є авторитетним джерелом для користувачів, дозволів, вправ, програм, тренувань, сповіщень та outbox. Elasticsearch лише ранжує кандидатів пошуку. Перед поверненням результатів записи повторно завантажуються з PostgreSQL, тому застарілий індекс не може відкрити видалені, приватні або іншим чином невидимі дані. Kafka переносить зафіксовані факти, але не є основним сховищем стану застосунку.

### Функціональні модулі

| Модуль | Основна відповідальність |
| --- | --- |
| `auth` | Реєстрація, вхід, ротаційні refresh-сесії, Google OAuth з mobile PKCE, скидання пароля, MFA, контроль ролей і перевірка блокування. |
| `users` | Профілі, імена користувачів, присутність і активність, показники тіла, адміністративна зміна ролей, блокування та відкликання сесій. |
| `exercises` | Каталог вправ і мʼязів, основні й допоміжні ролі мʼязів, персональний вибір, вподобання та редагування модератором. |
| `workout-programs` | Офіційні й персональні програми, розклад, поширення, медіа, реакції бібліотеки, версії та правила власності. |
| `workouts` | Життєвий цикл сесії тренування, підходи, час, завершення або скасування та курсорна історія зі знімками. |
| `catalog-search` | Побудова запиту Elasticsearch із подальшим відновленням і перевіркою видимості через PostgreSQL. |
| `notifications` | Налаштування, пристрої, повідомлення, кампанії, нагадування, вкладення та записи доставки. |
| `outbox` | Атомарне створення подій у бізнес-транзакціях і безпечне паралельне резервування. |
| `analytics-proxy` | Автентифікований доступ до аналітичних моделей читання без розкриття внутрішньої топології мобільному клієнту. |
| `admin-observability` | Дозволений набір операційних даних для привілейованих адміністративних екранів. |

### Наскрізна інфраструктура

`config` перевіряє середовище до використання зовнішніх зʼєднань. `common` стандартизує ідентифікатори запитів і публічний формат помилок. `security` забезпечує спільне обмеження запитів через Redis без зберігання сирих ідентифікаторів. `storage` перевіряє й нормалізує завантажені зображення перед записом до приватного S3/MinIO. `metrics` надає захищений endpoint Prometheus і метрики з обмеженою кількістю міток. `tracing` запускає та коректно завершує OpenTelemetry навколо всіх процесів.

### Як простежити функцію під час захисту

Оберіть один конкретний сценарій і пройдіть через усі рівні. Для створення вправи з ролями мʼязів:

1. мобільний редактор надсилає `primaryMuscleIds` і `secondaryMuscleIds`;
2. контролер приймає перевірений DTO;
3. сервіс відхиляє перетин груп і записує вправу та звʼязки в одній транзакції;
4. таблиця звʼязків зберігає `primary` або `secondary` під контролем обмеження бази даних;
5. та сама транзакція додає подію outbox;
6. relay публікує зафіксовану зміну, а search indexer оновлює Elasticsearch;
7. наступні читання все одно відновлюють авторитетний запис із PostgreSQL.

Цей приклад одночасно демонструє валідацію, транзакційну цілісність, асинхронну інтеграцію та межі джерела істини.
