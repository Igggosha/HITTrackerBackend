# Kafka event relay

**What.** Kafka keeps events in named **topics**. A topic has **partitions**,
append-only ordered logs whose positions are **offsets**. A **consumer group**
shares partitions across consumers and stores offsets so it can resume. Broker
**retention** keeps messages for a configured period independently of consumers.

**Why.** Writing a business row and Kafka message separately is a dual write:
a crash between them can lose the message. Business services instead write an
`outbox_events` row in their existing PostgreSQL transaction. The relay publishes
committed rows and then marks them published. A broker outage leaves rows in
PostgreSQL for later delivery.

The envelope is `{ id, type, version, occurredAt, aggregateType, aggregateId,
payload }`. Types and seven JSON Schemas live in `packages/event-contracts`.
`workout.*` goes to `hit.workout.v1`; `user.*`, `program.*`, and
`body_metric.*` go to `hit.user.v1`. Kafka's key is always `payload.userId`:
one user's events go to the same partition within each topic. Kafka has no
ordering across topics; use one relay instance when publication order matters. Three
partitions, replication factor one, and a 512 MB heap suit the local demo.

Delivery is **at least once**: Kafka can accept a send just before the database
transaction fails, causing a retry. Consumers must de-duplicate by envelope
`id` and commit their offset after their own effect succeeds. After ten normal
publish failures, the relay sends the envelope to `hit.events.dlq` with the
last error in a header. It marks the row published only after DLQ acceptance;
a DLQ outage leaves it pending. Inspect and replay DLQ messages operationally.
Additive fields keep the same version. Breaking changes get a new version and
schema; publish both versions while consumers migrate.

## Run and demo

Copy a valid `.env` into this worktree. From PowerShell:

```powershell
$env:COMPOSE_PROJECT_NAME='featkafka'
$env:PORT='3190'
$env:PRIVATE_NETWORK_SUBNET='172.28.41.0/24'
$env:MINIO_CONSOLE_PORT='9191'
$env:KAFKA_UI_PORT='8185'
$env:EXPO_PUBLIC_API_URL='https://example.invalid'
$env:EXPO_PUBLIC_WEB_URL='https://example.invalid'
docker compose --profile events up -d --build
```

Finish a workout through the API, or insert a valid outbox row. Open
`http://127.0.0.1:8185` and inspect `hit.workout.v1`. Read from the CLI with
`docker compose --profile events exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic hit.workout.v1 --from-beginning --max-messages 1`. Query `outbox_events.published_at` in PostgreSQL; it should
be set for the event.

Stop only Kafka (`docker compose --profile events stop kafka`), finish another
workout, then restart Kafka (`docker compose --profile events start kafka`).
The pending outbox row should eventually appear in the topic and gain
`published_at`. Clean up this isolated demo with
`docker compose -p featkafka --profile events down -v`.

For a host-run in-process relay, set `KAFKA_BROKERS` and start the API. For a
standalone relay, run `node dist/src/relay/main.js` with that variable and the
usual database configuration. Compose chooses standalone so the API remains
stateless. `/metrics` exposes `outbox_unpublished_events` on the API; the publish
counters belong to the relay process, whose standalone mode has no HTTP scrape
endpoint yet.
