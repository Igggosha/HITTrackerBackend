# PostgreSQL streaming read replica

## What and why

Compose runs one PostgreSQL 17 primary and one physical hot standby. PostgreSQL
streams WAL changes to the standby, letting ordinary API selects use a separate
database process while writes remain on the primary. This can reduce primary
read load without changing tables or migrations.

`replication-init` creates or refreshes a login role with `REPLICATION` and
ensures its `pg_hba.conf` entry on every start. This also handles primary volumes
created before replication was added. On an empty replica volume,
`pg_basebackup -R` copies the primary and writes standby connection settings.
The replica has a separate volume and no published port. Migrations, dump
bootstrap, and seed continue to target the primary.

The API uses Drizzle `withReplicas`: `db.select` routes to the standby; writes
and transactions route to the primary. `primaryDb` is used for auth,
authorization, username availability, and profile reads where users expect to
see a recent write. OAuth session storage uses the primary `pool`. Without
`DATABASE_REPLICA_URL`, all database calls use the primary.

Streaming is asynchronous. A plain select may briefly return stale data after
a write. A configured replica outage makes those selects fail; there is no
automatic failover. Remove `DATABASE_REPLICA_URL` and restart the API to direct
all reads to the primary. Do not point migrations or session storage at the
replica.

## Replication access scope and credential

The `replicator` role is dedicated to streaming replication: it has its own
`REPLICATION_PASSWORD`, never `POSTGRES_PASSWORD`/`DB_PASSWORD`. The API's own
replica connection (`DATABASE_REPLICA_URL`) still authenticates as the normal
app user, not as `replicator` — it is an ordinary read connection, not
database replication, so it never needs `REPLICATION` privileges.

`replication-init`'s `pg_hba.conf` rule for `replicator` is scoped to the
`private` Compose network's subnet (`PRIVATE_NETWORK_SUBNET`, default
`172.28.40.0/24`) instead of `0.0.0.0/0`. On every start it removes any
previous rule for the role — including an older `0.0.0.0/0` rule from before
subnet scoping existed — before appending the current one, so a rerun never
accumulates rules. Changing the subnet also recreates the Docker network, so
run `docker compose down` (keeps the named volumes) before `docker compose up
--build` with the new value.

`pg_basebackup -R` (in `docker/start-replica.sh`) writes `primary_conninfo`,
including the replication password, into the replica's
`postgresql.auto.conf`. After rotating `REPLICATION_PASSWORD`:

1. Update `.env` and restart `replication-init` (updates the role's password
   and, if needed, the `pg_hba.conf` rule), then `postgres-replica`.
2. On an already-bootstrapped replica volume, `start-replica.sh` rewrites the
   password inside the stored `primary_conninfo` on every start (a textual
   `sed` rewrite of `postgresql.auto.conf`), so streaming resumes with the new
   password without a full `pg_basebackup`. Verify with the `pg_hba_file_rules`
   query below and by checking replication resumes (see Lag queries).

Verify the scoped rule and the dedicated role:

```sql
SELECT database, user_name, address, auth_method
FROM pg_hba_file_rules WHERE 'replication' = ANY(database);
```

## Session consistency for replica reads

Routing every read through `primaryDb` (as the workouts module briefly did)
gives up the replica's read-offload benefit for the busiest module. Instead,
`src/db/read-consistency.ts` implements read-your-writes session consistency:

- Every write path in `WorkoutsService` (start/finish/cancel a workout,
  record/update a set, pause/resume, the auto-pause side effect) calls
  `recordWrite(userId)` right after the write.
- A pure browsing read (history list/detail, history dates, unique exercise
  ids, sets by exercise) calls `readerFor(userId)` instead of always using
  `primaryDb`: it returns `primaryDb` if that user wrote within the last
  `READ_YOUR_WRITES_WINDOW_MS` (default 5000ms, env-configurable), otherwise
  the replica (`db`).
- Guard reads immediately before a write in the same request, and
  `getActiveWorkout`, stay on `primaryDb` unconditionally — they are either
  about to be invalidated by that same request's write or are the "what's
  happening right now" view a user is actively acting on.

This state is an in-memory `Map` local to one API process: bounded (a sweep
runs once it grows past 10,000 tracked users) and not shared across
instances. With more than one API instance behind a load balancer, a write
handled by instance A and a follow-up read routed to instance B by the load
balancer would not see this — it would need a shared store (e.g. Redis) or
be replaced by LSN-based waiting: the write path captures
`pg_current_wal_lsn()` on the primary, and the read waits for (or falls back
to the primary until) the replica's `pg_last_wal_replay_lsn()` reaches it.
That approach is instance-count-agnostic but needs the LSN threaded through
the request or a shared store to coordinate; it is the production-grade
alternative to the in-memory map used here.

Demo (single instance): call an authenticated workout write endpoint (e.g.
`POST /workouts/:id/pause`), then immediately call a history read endpoint
(e.g. `GET /workouts/history/dates`) for the same user — both requests reach
the primary. Wait past `READ_YOUR_WRITES_WINDOW_MS` and repeat the read; it
now reaches the replica. `src/db/read-consistency.spec.ts` covers the window,
its expiry, per-user isolation, and the bounded-size sweep directly.

## Demo

1. Set secrets in `.env` and run `docker compose up --build -d`.
2. Run `docker compose exec postgres-replica psql -U "$DB_USERNAME" -d "$DB_NAME" -tAc 'SELECT pg_is_in_recovery()'`; expect `t`.
3. Create a row in a disposable table on the primary, then query it on the replica:

   ```sh
   docker compose exec postgres psql -U "$DB_USERNAME" -d "$DB_NAME" -c 'CREATE TABLE IF NOT EXISTS replica_demo (id text PRIMARY KEY)'
   docker compose exec postgres psql -U "$DB_USERNAME" -d "$DB_NAME" -c "INSERT INTO replica_demo VALUES ('demo') ON CONFLICT DO NOTHING"
   docker compose exec postgres-replica psql -U "$DB_USERNAME" -d "$DB_NAME" -c 'SELECT * FROM replica_demo'
   ```

4. Check `curl http://localhost:3000/`; remove the disposable table on the primary.

## Lag queries

Primary: `SELECT application_name, state, write_lag, flush_lag, replay_lag, pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS bytes_behind FROM pg_stat_replication;`

Replica: `SELECT pg_is_in_recovery(), now() - pg_last_xact_replay_timestamp() AS replay_age;`

The replay timestamp is the last replayed transaction, so its age can grow on
an idle primary without indicating broken replication. Check WAL byte lag and
streaming state together for monitoring.
