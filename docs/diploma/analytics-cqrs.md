# Analytics service: CQRS read models from Kafka

**What.** `services/analytics/` is a separately deployable NestJS service (own
package, Dockerfile, database, migrations). It consumes the domain events the
outbox relay publishes (`hit.workout.v1`, `hit.user.v1`) and keeps read models
for charts: completed workout/set facts, scheduled assignments, weekly volume,
personal records, exercise progress, and body metrics. The mobile app reads them via the
main API (`GET /analytics/*` is a thin proxy), so it keeps one base URL. The
endpoint contract is in `services/analytics/README.md`.

**Why (CQRS).** The main API is the *write model*: normalized tables, rules and
transactions (`workouts`, `sets`). Charts want different shapes (sums per ISO
week, best set per exercise) and recomputing them on every screen open would
scan a user's whole history. The *read model* is precomputed once per event,
in a store shaped for the query. The price is **eventual consistency**: a
finished workout reaches the read side after outbox -> relay -> Kafka ->
consumer, measured at ~15 ms end to end (plus up to one 500 ms relay poll).
The UI copes by showing the workout it just finished from the write API's
response and, when it needs fresh charts, polling `summary` until
`lastWorkout.workoutId` is that workout. If the analytics service is down, only
charts are stale or `503 ANALYTICS_UNAVAILABLE`; training itself is untouched.

**Database per service.** The service owns database `analytics` and role
`analytics_app` (NOSUPERUSER, owns only that database; `PUBLIC` may not
connect). It never reads the API's tables: ids come from events and there are
no cross-database foreign keys. `analytics-db-init` (idempotent, runs every
start, fresh or existing volume) creates both on the *existing* PostgreSQL
server: a second PostgreSQL container would cost RAM on a 16 GB dev machine and
another backup target. The trade-off: they share CPU/IO and a failure domain.
Splitting later is a `pg_dump analytics` plus a URL change.

**Idempotent consumer, exactly-once effect.** Delivery is at least once (relay
retries; consumer restarts). For each message, `MessageHandler` validates it,
then `Projector.apply` runs ONE transaction: `insert into processed_events
(event_id) on conflict do nothing`. It applies the projection only if that
insert happened. The consumer runs with `autoCommit: false` and commits the
Kafka offset only after the transaction has committed. If it crashes between
the two, the event is redelivered and dropped as a duplicate. Projections never
increment: they insert a *fact* (`finished_workouts`, `finished_sets`), then
recompute the affected week, streak, PRs and day from the facts in the same
transaction. Late, out-of-order or backfilled copies (another event id, same
workout id) cannot corrupt aggregates. A per-user advisory lock serialises one
user's projections across topics and instances. `user.deleted` deletes every
row of the user and leaves a tombstone (`erased_users`), because Kafka does not
order across topics and a late `workout.finished` must not bring the data back.

**Schemas and versioning.** Each message is checked with ajv against
`packages/event-contracts/schemas/<type>.v<version>.schema.json`. An unknown
(type, version) is logged and skipped (forward compatible: producers may ship
v2 first). A breaking change is a new version with a new schema. An invalid
message is retried `ANALYTICS_MAX_ATTEMPTS` (5) times, then sent to
`hit.events.dlq` with `dlq-reason/error/attempts/source-topic/partition/offset`
headers. Database/network errors are *transient*: they are retried forever
with capped backoff and heartbeats, so an outage never dead-letters good events.

**Rules.** Stored instants are UTC; period grouping receives a validated IANA
time zone. Week = ISO week starting Monday. The period overview's adherence is
completed assignments divided by assignments whose local scheduled day has
ended. Its streak is a sequence of successful scheduled days, skipping days
without assignments; every assignment must finish on that same local day, an
unfinished current day does not break the run, and a late completion never
repairs it. PRs use the heaviest set (weight, then reps) and best Epley e1RM
`w*(1+reps/30)`; each first-achievement wins ties.

**Rebuild from the log.** Domain topics have `retention.ms=-1` (kafka-init
re-applies it every start), so the log can rebuild every read model; the DLQ
keeps 30 days. Stop the service (Kafka refuses offset resets for a group with
live members), run the command, start it:
`docker compose --profile events stop analytics`, then
`docker compose --profile events run --rm --no-deps analytics node dist/services/analytics/src/cli/rebuild-projections.js`,
then `docker compose --profile events start analytics`. It resets group
`analytics` to earliest (like `kafka-consumer-groups.sh --reset-offsets
--to-earliest --execute`) and truncates read models, facts and
`processed_events`. Infinite retention conflicts with erasure: replay also
replays `user.deleted`, which removes the data again. Crypto-shredding or
compaction are the production answers.

**Backfill.** History from before the outbox is not in Kafka.
`scripts/backfill-analytics-events.ts` enqueues enriched `workout.finished`,
`body_metric.recorded`, and current `program.scheduled` outbox rows. Ids are
deterministic uuid v5 values, inserted `on conflict (id) do nothing`, so a
second run inserts 0. Run it with the migration image:
`docker compose run --rm --no-deps -v "$PWD/packages:/app/packages:ro" -v "$PWD/scripts:/app/scripts:ro" migrate npx tsx scripts/backfill-analytics-events.ts`.

**Observability.** `/metrics` (Bearer `METRICS_TOKEN`):
`analytics_events_processed_total{type,result}`,
`analytics_event_processing_seconds`, `analytics_consumer_lag{topic,partition}`
(admin offsets every 15 s), `analytics_dlq_messages_total`. It also has a
Prometheus job `analytics`, the alert `AnalyticsConsumerLagging` and the
Grafana dashboard "Analytics (CQRS read side)". Logs are pino JSON:
`requestId` on HTTP lines, `eventId`/`eventType` on every consumer line
(never payloads), plus `traceId`/`spanId` on every line when tracing is
enabled. Tracing: `@opentelemetry/instrumentation-kafkajs` already wraps
`consumer.run`'s `eachMessage`, extracts `traceparent` from the message
headers and opens a CONSUMER span around the whole callback (so
`MessageHandler.handle` and its `pg` writes run, and nest, inside it with no
code change here); `packages/tracing/tracing.ts`'s `consumerHook` tags that
span with `event.id`/`event.type`. See docs/diploma/tracing.md ("The
analytics consumer").

**Demo** (`--profile events --profile observability`): log in, start/finish a
workout with sets -> `GET /analytics/me/summary` shows it within ~1 s. Stop
`analytics`, finish two more workouts: `kafka-consumer-groups.sh --describe
--group analytics` shows LAG 4 and the proxy answers 503. Start it: the lag
drains and the totals include both. Run the rebuild: every endpoint returns
byte-identical JSON. Re-publish an event with `kafka-console-producer.sh`:
the consumer logs `result: duplicate` and the totals do not change. Watch the
Grafana dashboard.

**Known limits.** Deleting a workout in the API emits no event, so analytics
keeps it. One consumer instance processes serially, which is ample here.
Weights are assumed to be kg, as in the app.
