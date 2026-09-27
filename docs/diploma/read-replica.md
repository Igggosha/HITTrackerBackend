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
authorization, username availability, and workout/profile reads where users
expect to see a recent write. OAuth session storage uses the primary `pool`.
Without `DATABASE_REPLICA_URL`, all database calls use the primary.

Streaming is asynchronous. A plain select may briefly return stale data after
a write. A configured replica outage makes those selects fail; there is no
automatic failover. Remove `DATABASE_REPLICA_URL` and restart the API to direct
all reads to the primary. Do not point migrations or session storage at the
replica.

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
