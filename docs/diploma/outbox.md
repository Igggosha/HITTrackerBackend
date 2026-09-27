# Transactional outbox

**What.** Domain events (`workout.finished`, `user.registered`, …) are written to
the `outbox_events` table **inside the same database transaction** as the change
they describe. A Kafka relay claims unpublished rows, publishes
them and marks them published.

**Why.** Writing to the database and then calling a broker is a dual write: a
crash between the two loses the event, or publishes one for a change that rolled
back. With the outbox, an event exists if and only if its change committed;
publishing becomes a retryable background job (at-least-once delivery, consumers
de-duplicate by event `id`).

## How it is built

- `outbox_events` (migration `20260928090000_add_outbox_events`): `id uuid`,
  `aggregate_type`, `aggregate_id`, `event_type`, `event_version`, `payload jsonb`,
  `occurred_at timestamptz`, `published_at`, `attempts`, `last_error`. A partial
  index on `occurred_at WHERE published_at IS NULL` keeps the relay query small
  however large the table grows. No foreign keys: `user.deleted` must survive the
  user row, and the table must stay partitionable.
- `OutboxService.enqueue(tx, event)` only accepts a `DbTransaction`; the root
  `db` does not type-check (it has no `rollback()`) and is rejected at runtime.
- `src/outbox/events.ts`: typed, versioned payloads. Breaking change → new
  `…V2` type + bumped `version`; consumers branch on `event_version`.

| Event | Aggregate | Payload (ids + facts, never emails/tokens) |
| --- | --- | --- |
| `workout.started` | workout | user, type, program/schedule ids, planned exercise ids, `startedAt` |
| `workout.finished` | workout | per-set exercise id, weight, reps, rpe, failure/drop flags, volume; total volume, set count, active + paused seconds |
| `workout.cancelled` | workout | user, `startedAt`, `cancelledAt`, set count |
| `program.scheduled` | user | program, date, repeat/series, created schedule ids |
| `body_metric.recorded` | user | metric id, weight/body fat/muscle/waist, `recordedAt`, source |
| `user.registered` | user | user id, method (`email`/`google`), `registeredAt` |
| `user.deleted` | user | user id, deleting admin id, `deletedAt` |

`payload.userId` is the Kafka partition key, so a user's events share a
partition within each topic.

## Relay interface

`OutboxService.claimBatch(tx, { limit, maxAttempts })` selects the oldest
unpublished rows `FOR UPDATE SKIP LOCKED`: parallel relays get disjoint batches
instead of blocking or double-publishing. `markPublished` / `recordFailure`
(`attempts + 1`, truncated `last_error`) finish the job, and `processBatch(publish)`
wraps one iteration in a transaction. It stops at the first failure; after
`maxAttempts` (default 10), `processDeadLetters` sends the row to the DLQ and
marks it published only after Kafka accepts it. A failed DLQ send records the
error in `last_error` (via `recordFailure`), the same as a normal publish
failure, instead of leaving the row's failure invisible until the next
attempt. Each iteration's transaction also carries a `SET LOCAL
statement_timeout`/`idle_in_transaction_session_timeout`
(`RELAY_DB_TX_TIMEOUT_MS`, default 10s) as a backstop independent of whatever
bound the caller's own `publish` puts on its broker calls.

## Activity log in the same transaction

`recordUserActivity(values, tx?)` writes inside the business transaction whenever
one exists, so the admin timeline, the change and its outbox row commit together
and errors propagate. Without a transaction there is nothing left to protect (the
change already committed on its own), so it keeps "log and never fail the
request"; every current caller passes a transaction.

## Future partitioning by `occurred_at`

A partitioned table's primary key must include the partition key, so the switch
is: create `outbox_events_p (… PRIMARY KEY (id, occurred_at)) PARTITION BY RANGE
(occurred_at)` with monthly partitions, move unpublished rows, swap names. Old,
fully published months are then dropped with `DROP TABLE` instead of a slow
`DELETE`. Nothing references the table and nothing relies on `id` alone being
unique across the table, so this is a storage change only. Not done now: the
volume does not need it yet.

## Demo

```bash
npx jest src/outbox                      # unit: enqueue, rollback, claim, failure
OUTBOX_IT_DATABASE_URL=postgresql://… npx jest src/outbox/outbox.integration.spec.ts
```

The integration spec (throwaway schema) proves on real PostgreSQL that a rolled
back transaction leaves no event and that two relays holding locks at the same
time receive disjoint batches. By hand: finish a workout, then
`select event_type, payload from outbox_events order by occurred_at desc limit 1;`.
