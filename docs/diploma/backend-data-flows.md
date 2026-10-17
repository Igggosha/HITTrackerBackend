# Backend data flows / Потоки даних backend

This guide connects the main backend files into end-to-end stories that are convenient to explain during the diploma defense.

Цей посібник поєднує основні файли backend у наскрізні сценарії, які зручно пояснювати під час захисту дипломного проєкту.

## 1. Authenticated API request / Автентифікований API-запит

**EN:** `src/main.ts` starts NestJS and installs request IDs, security middleware, validation, metrics, and the global exception filter. An auth guard verifies the access token, then a feature controller validates route-specific input through a DTO and delegates the domain decision to its service. The service reads or writes PostgreSQL through Drizzle. Public errors keep a stable shape and include the request ID, so a client-visible failure can be correlated with logs and traces.

**UK:** `src/main.ts` запускає NestJS і підключає ідентифікатори запитів, захисні middleware, валідацію, метрики та глобальний фільтр помилок. Guard автентифікації перевіряє токен доступу, після чого контролер функції перевіряє специфічні вхідні дані через DTO та передає доменне рішення сервісу. Сервіс читає або змінює PostgreSQL через Drizzle. Публічні помилки мають стабільну форму й містять ідентифікатор запиту, тому помилку на клієнті можна зіставити з журналами та трасуванням.

## 2. Exercise muscle roles / Ролі м’язів у вправі

```text
mobile editor
  -> exercise DTO (primaryMuscleIds + secondaryMuscleIds)
  -> exercises controller
  -> exercises service transaction
  -> exercises_train_muscles(role)
  -> outbox event
  -> relay -> Kafka -> search indexer
```

**EN:** The service rejects the same muscle appearing in both lists. The relation and its `primary` or `secondary` role are saved atomically with the exercise. Existing relations were migrated to `primary`, preserving the legacy meaning. Workout-history snapshots copy the resolved roles so old completed workouts do not change when the catalog is edited later.

**UK:** Сервіс відхиляє випадок, коли той самий м’яз є в обох списках. Зв’язок і його роль `primary` або `secondary` зберігаються атомарно разом із вправою. Наявні зв’язки під час міграції стали `primary`, що зберегло попереднє значення. Знімки історії тренувань копіюють визначені ролі, тому старі завершені тренування не змінюються після подальшого редагування каталогу.

## 3. Reliable asynchronous event / Надійна асинхронна подія

**EN:** A business service changes domain data and inserts an outbox row in the same PostgreSQL transaction. `src/relay` claims committed rows with locking that allows multiple relay instances to cooperate, publishes versioned contracts from `packages/event-contracts`, and records success or retry state. Kafka consumers can rebuild derived search or analytics data because the authoritative business change remains in PostgreSQL. Stable event IDs make retries idempotent.

**UK:** Бізнес-сервіс змінює доменні дані та додає рядок outbox у тій самій транзакції PostgreSQL. `src/relay` резервує підтверджені рядки з блокуванням, яке дає змогу кільком екземплярам relay працювати спільно, публікує версіоновані контракти з `packages/event-contracts` і фіксує успіх або стан повторної спроби. Споживачі Kafka можуть відновити похідні пошукові чи аналітичні дані, бо авторитетна бізнес-зміна залишається в PostgreSQL. Стабільні ідентифікатори подій роблять повторення ідемпотентними.

## 4. Catalog search / Пошук у каталозі

**EN:** Elasticsearch returns ranked candidate identifiers, not trusted final records. The catalog-search service reloads those identifiers from PostgreSQL, reapplies visibility and ownership rules, and restores the search order. A stale index can therefore reduce freshness, but it cannot make a deleted or private item visible. `scripts/rebuild-search-index.ts` creates versioned indexes from a consistent PostgreSQL snapshot, replays concurrent outbox changes, and swaps aliases atomically.

**UK:** Elasticsearch повертає ранжовані ідентифікатори-кандидати, а не довірені готові записи. Сервіс пошуку повторно завантажує ці ідентифікатори з PostgreSQL, знову застосовує правила видимості та власності й відновлює порядок результатів. Тому застарілий індекс може знизити актуальність, але не може показати видалений або приватний об’єкт. `scripts/rebuild-search-index.ts` створює версіоновані індекси з узгодженого знімка PostgreSQL, повторює паралельні зміни outbox і атомарно перемикає псевдоніми.

## 5. Notification delivery / Доставка сповіщення

**EN:** Notification preferences decide whether a category may be sent. A notification record represents user-visible content; a delivery record represents one attempt through one registered device. The worker encrypts stored provider tokens, claims work safely across concurrent instances, sends through the selected provider, and records a bounded retry or terminal result. Campaign media is stored separately and referenced by ordered attachment identifiers.

**UK:** Налаштування сповіщень визначають, чи дозволено надсилати певну категорію. Запис сповіщення представляє видимий користувачу вміст, а запис доставки — одну спробу через один зареєстрований пристрій. Worker шифрує збережені токени постачальника, безпечно резервує роботу між паралельними екземплярами, надсилає через вибраного постачальника та фіксує обмежену повторну спробу або остаточний результат. Медіафайли кампаній зберігаються окремо й задаються впорядкованими ідентифікаторами вкладень.

## 6. Analytics read path / Шлях читання аналітики

**EN:** The analytics service consumes versioned events into rebuildable read models. The public client does not connect to that internal service directly: the authenticated `analytics-proxy` module validates an allowlisted request and forwards it with controlled headers and timeouts. This keeps topology and service credentials out of the mobile application while preserving user authorization at the public API boundary.

**UK:** Сервіс аналітики споживає версіоновані події та формує відновлювані моделі читання. Публічний клієнт не підключається до внутрішнього сервісу напряму: автентифікований модуль `analytics-proxy` перевіряє запит за дозволеним списком і пересилає його з контрольованими заголовками та часовими обмеженнями. Так внутрішня топологія й службові облікові дані не потрапляють до мобільного застосунку, а авторизація користувача залишається на межі публічного API.

## Defense summary / Коротко для захисту

**EN:** PostgreSQL owns truth and transactions; NestJS owns validation and domain access; the outbox and Kafka move committed facts; Elasticsearch and analytics are rebuildable read models; workers perform retryable background work; request IDs, metrics, logs, and traces make the complete path observable.

**UK:** PostgreSQL відповідає за істину й транзакції; NestJS — за валідацію та доступ до домену; outbox і Kafka передають підтверджені факти; Elasticsearch та аналітика є відновлюваними моделями читання; workers виконують фонову роботу з повторними спробами; ідентифікатори запитів, метрики, журнали й трасування роблять увесь шлях спостережуваним.
