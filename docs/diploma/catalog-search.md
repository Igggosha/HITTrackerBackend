# Пошук каталогу через Elasticsearch

## Підсумок

29 вересня 2026 року пошук програм і вправ у Workshop перенесено з
клієнтської substring-фільтрації до ранжованого й стійкого до помилок пошуку
через Elasticsearch. Мобільний застосунок і web-клієнт не підключаються до
Elasticsearch напряму: вони викликають захищений NestJS endpoint, а backend
використовує Elasticsearch лише як відновлювану пошукову проєкцію.

PostgreSQL залишається єдиним джерелом істини. Elasticsearch повертає
ранжовані ID, після чого backend повторно читає актуальні записи з PostgreSQL,
перевіряє видимість і власника, додає user-specific стани та формує звичну
відповідь API.

## Навіщо це зроблено

Попередній пошук працював лише як локальний `includes()` над уже завантаженим
масивом. Він не давав стабільного ranking, не знаходив опечатки, погано
масштабувався зі збільшенням каталогу й змушував клієнт завантажувати весь
набір даних.

Нова реалізація забезпечує:

- пошук за назвою, описом, вправами програми та м'язами;
- пріоритет точного збігу над фразою, prefix, звичайним і fuzzy-збігом;
- безпечний fuzzy-пошук з обмеженою кількістю edits та expansions;
- підтримку curated EN/UA/RU aliases;
- серверні фільтри за секцією, scope, muscle та sort;
- cursor pagination;
- автоматичне оновлення індексу після змін каталогу;
- відновлення індексу з PostgreSQL без втрати доступності старого індексу;
- контроль доступу в PostgreSQL, а не довіру до search document.

## Загальний потік запиту

```text
HomeScreen
  -> debounce 275 ms і скасування застарілого запиту
  -> libraryStore.searchCatalog()
  -> GET /catalog/search з JWT
  -> Elasticsearch read alias повертає ранжовані ID
  -> PostgreSQL повторно читає актуальні rows
  -> backend повторно застосовує visibility та user-specific state
  -> StorageService формує актуальні image URL
  -> наявні картки програм і вправ показують результат
```

Endpoint `GET /catalog/search` захищено `JwtGuard`, `RolesGuard` та
`@MinimumRole('user')`. DTO приймає:

- `q` — рядок до 120 символів;
- `section` — `programs` або `exercises`;
- `scope` — `all`, `official`, `personal` або `saved`;
- `muscle` — ID м'яза;
- `sort` — `relevance`, `popular`, `newest` або `alphabetical`;
- `locale` — `en` або `uk`;
- `limit` — від 1 до 50;
- `cursor` — непрозорий cursor для `search_after`.

Успішна відповідь має форму `{ items, nextCursor, fallback: false }`. Якщо
Elasticsearch недоступний, backend повертає HTTP 503 з кодом
`SEARCH_UNAVAILABLE`.

## Межа між Elasticsearch і PostgreSQL

Elasticsearch відповідає лише за пошук і ranking. Він не є authorization
boundary і не формує остаточну відповідь користувачу.

Після отримання ID backend повторно перевіряє в PostgreSQL:

- офіційна програма має бути активною;
- персональна програма має належати поточному користувачу;
- `saved` для програм читається з `program_likes`;
- `saved` для вправ читається з `exercise_bookmarks`;
- `isLiked`, `isBookmarked`, `isScheduled` і лічильники беруться з актуальних
  PostgreSQL rows;
- image URL підписується під час відповіді, а не зберігається в індексі.

Завдяки цьому застарілий або помилково сформований search document не може
відкрити чужу персональну програму.

## Структура індексів

Програми та вправи мають окремі versioned physical indices:

- `hit-programs-v1-<timestamp>`;
- `hit-exercises-v1-<timestamp>`.

Стабільні aliases:

- `hit-programs-read` і `hit-programs-write`;
- `hit-exercises-read` і `hit-exercises-write`.

API читає лише read aliases. Indexer і rebuild використовують writer account
та physical indices. Попередня пара physical indices після rebuild не
видаляється автоматично, щоб залишити можливість ручного rollback.

Program document містить назву, опис, aliases, ознаки official/personal,
`ownerId`, active state, popularity, дату створення та назви вправ у програмі.
Exercise document містить назву, опис, aliases, difficulty, popularity, muscle
IDs і muscle names.

Mappings мають `dynamic: strict`, тому випадкове нове поле не потрапляє в
індекс непомітно. Аналізатор переводить текст у lowercase, нормалізує `ё` до
`е` та створює bounded name n-grams.

## Ranking і fuzzy-пошук

Порядок основних сигналів:

1. точна назва;
2. точна фраза;
3. prefix та name n-gram;
4. звичайний multi-match за назвою, aliases, вправами й м'язами;
5. bounded fuzzy-пошук;
6. description з нижчим boost і без fuzzy.

Правила fuzzy:

- один символ — лише bounded name n-gram;
- два або три символи — без fuzzy;
- від чотирьох до семи символів — не більше однієї помилки;
- від восьми символів — не більше двох помилок;
- `prefix_length: 1`;
- `max_expansions: 25`;
- transpositions увімкнено;
- description ніколи не бере участі у fuzzy query.

Такі межі захищають Elasticsearch від надто широких дорогих запитів і
зменшують кількість нерелевантних результатів. Під час live-перевірки запит
`жим лежя` знайшов `Barbell Bench Press`, а `squat` — обидві seeded вправи зі
словом Squat.

## Автоматичне оновлення індексу

Зміна каталогу створює versioned event у тому самому PostgreSQL transaction,
що й domain write. Це transactional outbox: committed зміна не губиться через
crash між записом у БД та публікацією в Kafka.

Додані події:

- `catalog.program.changed`;
- `catalog.exercise.changed`.

Relay спрямовує їх до `hit.catalog.v1`. `user.deleted` залишається в
`hit.user.v1`, але його також читає search indexer, щоб прибрати всі персональні
програми видаленого користувача.

Автоматично покриті:

- створення персональної або офіційної програми;
- copy/import програми;
- update і revision програми;
- retirement старої revision;
- зміна program image;
- зміна program like count;
- створення та update вправи;
- revision/image вправи;
- зміна exercise like count;
- видалення користувача та його персональних програм.

Search indexer перевіряє event envelope через JSON Schema/AJV. Кожний документ
зберігає останні `(occurredAt, eventId)`. Painless update script ігнорує старішу
або duplicate event, тому Kafka redelivery чи out-of-order доставка не можуть
відкотити документ до попереднього стану.

Offset commit виконується лише після успішного effect. Тимчасові помилки мають
bounded retry. Після вичерпання спроб event разом із source provenance
потрапляє до DLQ, після чого partition може продовжити роботу.

Live-перевірка підтвердила повний шлях: like програми змінився в PostgreSQL,
outbox/relay/Kafka/search-indexer автоматично оновили `likesCount` в
Elasticsearch з 2 до 3, а повторне перемикання повернуло і БД, і індекс до 2.

## Rebuild і відновлення

Команда:

```bash
docker compose --profile search run --rm search-rebuild
```

Rebuild виконує такі кроки:

1. відкриває repeatable-read PostgreSQL snapshot;
2. записує outbox watermark;
3. створює нові versioned physical indices;
4. bulk-завантажує програми та вправи зі snapshot;
5. програє catalog/user events після watermark;
6. атомарно перемикає read/write aliases;
7. виконує фінальний replay, щоб закрити race біля alias swap.

Повторний запуск безпечний. Перевірка створила нову пару physical indices,
атомарно перевела aliases та залишила попередню пару з тими самими counts.

Elasticsearch має named volume `elasticsearch_data`. Routine restart не
видаляє його. Команда `docker compose down -v` не повинна використовуватися для
звичайного restart. Після Elasticsearch-only restart aliases і документи
залишилися на місці.

Elasticsearch не є backup. Авторитетне відновлення:

```text
PostgreSQL + retained Kafka/outbox events
  -> search-rebuild
  -> atomic alias swap
```

Snapshots Elasticsearch можуть бути додатковим прискоренням, але не заміною
PostgreSQL backup.

## Docker і безпека

Локальний запуск:

```bash
docker compose --profile search up -d --build
docker compose --profile search ps
```

Elasticsearch `9.5.4` працює лише в private Compose network; host port 9200 не
публікується. HTTP TLS вимкнено тільки для цього приватного локального network.
Для production потрібні нормальні TLS certificates, multi-node topology та
capacity planning.

Створено окремі least-privilege accounts:

- reader — `read` і `view_index_metadata` лише для read aliases;
- writer — керування лише `hit-programs-*` та `hit-exercises-*`.

Live permission probe підтвердив: reader читає document count, але отримує 403
на спробу запису.

`.env.example` містить лише placeholders. У локальному ignored `.env`
згенеровано окремі випадкові passwords для admin, reader і writer. Секрети не
передаються до `EXPO_PUBLIC_*`, не потрапляють до документації та не
виводяться в логах.

Глобальний Node не оновлювався. Elasticsearch server `9.5.4` працює з official
JS client `9.4.3`, який сумісний із локальним Node 20 цього репозиторію.

Під час першого Compose run було знайдено formatting defect: YAML зберіг
newline між security endpoint URL і `-d` JSON body, через що Elasticsearch
повертав HTTP 400 на запит без body. Явні shell line continuations виправили
команду; bounded curl retry додатково покриває короткий період ініціалізації
security index під час першого старту.

## Поведінка mobile

`HomeScreen` запускає пошук після debounce 275 ms. Новий запит скасовує
попередній через `AbortController`, а generation guard не дозволяє старій
відповіді перезаписати новішу.

Параметри query, section, scope, muscle, sort і locale зберігають поточну
навігаційну поведінку. Backend response локалізується в `LibraryContext`, після
чого рендериться наявними картками.

Якщо backend повертає `SEARCH_UNAVAILABLE`, mobile не показує порожній каталог.
Він залишає вже завантажені дані, застосовує локальні visibility/saved/muscle
filters і показує повідомлення про тимчасову недоступність search. Інші network
errors також не стирають локальні результати.

## Workshop, admin і history

Workshop використовує Elasticsearch для програм і вправ. Нова програма або
вправа з'являється в пошуку після проходження outbox/Kafka/indexer. Персональна
програма індексується з `ownerId` і повертається лише власнику.

Admin content management зараз не викликає `/catalog/search`. Він завантажує
role-aware список і локально фільтрує його за назвою. Новий контент з'являється
там після refresh і доступний для пошуку, але сам search виконується не через
Elasticsearch. Це важлива межа: moderator/admin може бачити чужі активні
personal programs, тоді як звичайний catalog endpoint навмисно їх приховує.
Для переведення адмінки на Elasticsearch потрібен окремий role-aware contract,
а не повторне використання user endpoint.

Пошук workout history залишається в PostgreSQL. Він per-user, має date/cursor
filters і вже шукає type тренування, snapshot program name та exercise names.
Index `(user_id, finished_at DESC, id DESC)` підтримує list order. Виміряний
history workload після query indexes досяг приблизно 723 requests/s.

Копіювання приватної історії до Elasticsearch додало б окремі правила finish,
delete, user deletion, privacy та eventual consistency без доказу bottleneck.
Рішення варто переглянути лише для десятків тисяч workouts на користувача,
виміряного p95 regression або явної вимоги typo-tolerant relevance.

## Спостережуваність

Search indexer має `/health` і bearer-protected `/metrics`. Prometheus збирає:

- API search rate і duration;
- успішні та помилкові search requests;
- кількість documents;
- стан indexer/Elasticsearch;
- Kafka consumer lag;
- retries;
- DLQ count.

Raw query text не потрапляє до metrics або logs.

Додано Grafana dashboard `Hit Tracker Catalog Search` з UID `hit-search` та
Prometheus alerts для недоступності search, lag і DLQ. Admin observability
allowlists розширено сервісами `search` і `search-indexer`.

`promtool` підтвердив коректність Prometheus config і восьми alert rules.
Після restart Prometheus target `search` має стан `up`, а Grafana успішно
provisioned dashboard `hit-search`.

## Перевірки 29 вересня 2026 року

### ПЕРЕВІРЕНО

- backend unit: 53 suites і 267 tests passed; 2 suites / 10 tests skipped;
- backend e2e: 3 suites і 12 tests passed;
- read-only ESLint: passed;
- application TypeScript: passed;
- scripts TypeScript: passed;
- Nest build: passed;
- mobile Node tests: 91 passed;
- Expo web export: passed;
- Docker image build: passed;
- `docker compose --profile search config --quiet`: passed;
- Elasticsearch, API та search-indexer: healthy;
- `search-init` і `search-rebuild`: exit 0;
- live indices: 28 programs і 12 exercises;
- захищений endpoint без JWT: 401;
- authenticated exact і fuzzy search: passed;
- reader write probe: 403;
- persistence після Elasticsearch-only restart: passed;
- повторний rebuild і atomic alias swap: passed;
- live outbox/Kafka/indexer update та rollback like count: passed;
- Prometheus config/rules, target і Grafana dashboard: passed.

### ПЕРЕГЛЯНУТО

- усі create/update/revision/image/like publication paths;
- user deletion tombstone path;
- SQL rehydration та visibility predicates;
- mobile debounce, cancellation, stale-response guard і fallback;
- retry, DLQ, offset commit та out-of-order protection;
- відсутність Elasticsearch credentials у frontend environment.

### ВИВЕДЕНО З ПЕРЕВІРЕНИХ ДАНИХ

- production throughput і storage sizing потребують вимірювань на реальному
  каталозі та hardware;
- multi-node failover працюватиме лише після окремого production deployment.

### НЕ ПЕРЕВІРЕНО

- production TLS/certificates;
- production multi-node recovery;
- повний UI E2E на фізичних Android/iOS devices.

## Стан доставки

Зміни підготовлено в окремих гілках `feat/elasticsearch-catalog-search` у
backend і mobile repositories. Локальні секрети залишаються лише в ignored
`.env`; `.env.example` містить безпечні placeholders.
