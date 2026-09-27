# Automated backups and restore drill

## What and why

The opt-in Compose `backup` profile saves a PostgreSQL 17 custom-format dump
and a MinIO bucket mirror together. Both are needed: user and exercise rows
store object keys that otherwise point to missing media after a database-only
restore. Every complete set has `db.dump`, `minio/`, and `manifest.json` with
sizes, object count, SHA-256, pg_dump client version, PostgreSQL server
version, migration count, and elapsed seconds. Set directories and files are
created under `umask 077` (700/600), so only the container's own user can
read a backup set.

Backup and restore each authenticate with a dedicated, bucket-scoped MinIO
account instead of the root user: a **read-only** account
(`BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY`) for the always-on
scheduled service, and a separate **write-capable** account
(`RESTORE_S3_ACCESS_KEY_ID` / `RESTORE_S3_SECRET_ACCESS_KEY`) supplied only at
the moment a human runs `restore` or `verify-restore` — it is deliberately
left out of the always-on service's environment in `docker-compose.yml`.
Both accounts are provisioned by `docker/minio-init.sh`, mirroring how the
API's own service account is created, and both are optional: unset, that
account is simply skipped rather than falling back to root.

Before restoring, `restore.sh` parses the recorded `db_dump_sha256` out of
`manifest.json` with `sed`/`grep` (the image has no `jq`) and recomputes
`sha256sum db.dump`, aborting with a clear message if they differ or if the
manifest has no recorded checksum. It does the same cheap comparison against
the manifest's recorded MinIO object count and byte total before mirroring,
which catches a truncated or partially copied backup set even without a
per-object checksum.

## Schedule and rotation

The service checks the UTC clock every 30 seconds and runs once per UTC day,
as a catch-up check (`now >= BACKUP_TIME`, `03:00` by default) rather than an
exact-minute match, so one missed 30-second tick cannot skip the whole day. A
`.last-scheduled-date` marker still guards against running twice in the same
day. On startup the scheduler also sweeps (and logs) any `.inprogress-*`
working directory older than six hours, left behind by a container that was
killed mid-backup.

GFS keeps the newest 7 daily sets, the
newest 4 sets made on Sunday, and the newest 12 sets made on the first of a
month; overlaps count once. The newest successful set is always protected.
Only complete sets rotate, after a successful database dump and object mirror.
A manual `run-now` does not touch `.last-scheduled-date`, so it neither
consumes nor is blocked by the scheduled run's daily slot; if both run on the
same UTC day, rotation still counts each successful set — scheduled or
manual — toward the same daily/weekly/monthly limits.

The default `backups_data` volume is separate from database and MinIO data.
`BACKUP_HOST_PATH` can point at a host directory. Copy complete sets to
separate off-site or removable storage to meet the 3-2-1 rule: three copies,
on two kinds of storage, with one copy off-site. Protect exported copies and
their credentials. For example, with `BACKUP_HOST_PATH=/srv/hit-tracker/backups`,
copy one set off-host with
`scp -r /srv/hit-tracker/backups/<set> backupuser@backup-host:/srv/offsite/hit-tracker/`.

## RPO and RTO

With one daily run, the nominal recovery point objective is up to 24 hours of
changes (plus a missed-run delay). The recovery time objective depends on the
database and bucket sizes, network/storage speed, and PostgreSQL startup; this
setup has no fixed RTO guarantee. The manifest records observed duration for
each backup, and the restore drill provides a practical restore-time measure.

## Demo

Start PostgreSQL and MinIO plus their bootstrap, then run the opt-in backup
service. The API and migration/seed services are not required for the drill.
Insert a marker row and upload a marker object, then:

```sh
docker compose --profile backup run --rm backup run-now
```

Delete the marker row and object. Run
`docker compose --profile backup run --rm -e RESTORE_S3_ACCESS_KEY_ID=... -e
RESTORE_S3_SECRET_ACCESS_KEY=... backup verify-restore`; it restores the
newest set to a scratch database, merges the backed-up bucket objects, and
prints users/workouts/exercises counts. Query the scratch database and fetch
the marker object to show that both returned. On success the scratch
database is dropped automatically; on failure it is left in place, and its
name is printed, for inspection.

To restore another set manually, run
`docker compose --profile backup run --rm -e RESTORE_S3_ACCESS_KEY_ID=... -e
RESTORE_S3_SECRET_ACCESS_KEY=... backup restore <set>`. This creates a new
scratch database. Targeting the live database requires `--database <DB_NAME>
--force-live` and explicitly drops that database first.

For the acceptance demo, use a unique `COMPOSE_PROJECT_NAME` and port, then
remove only that project with `docker compose --profile backup down -v` when
finished. A later Prometheus textfile collector could read a
`last-successful-backup` timestamp written on success; this version only logs
successful set timestamps.
