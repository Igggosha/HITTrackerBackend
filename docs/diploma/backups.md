# Automated backups and restore drill

## What and why

The opt-in Compose `backup` profile saves a PostgreSQL 17 custom-format dump
and a MinIO bucket mirror together. Both are needed: user and exercise rows
store object keys that otherwise point to missing media after a database-only
restore. Every complete set has `db.dump`, `minio/`, and `manifest.json` with
sizes, SHA-256, pg_dump version, migration count, and elapsed seconds.

## Schedule and rotation

The service checks the UTC clock every 30 seconds and runs once daily at
`BACKUP_TIME` (`03:00` by default). GFS keeps the newest 7 daily sets, the
newest 4 sets made on Sunday, and the newest 12 sets made on the first of a
month; overlaps count once. The newest successful set is always protected.
Only complete sets rotate, after a successful database dump and object mirror.

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
`docker compose --profile backup run --rm backup verify-restore`; it restores
the newest set to a scratch database, merges the backed-up bucket objects, and
prints users/workouts/exercises counts. Query the scratch database and fetch
the marker object to show that both returned. The scratch database remains for
inspection; drop it manually after the demo.

To restore another set manually, run
`docker compose --profile backup run --rm backup restore <set>`. This creates
a new scratch database. Targeting the live database requires `--database
<DB_NAME> --force-live` and explicitly drops that database first.

For the acceptance demo, use a unique `COMPOSE_PROJECT_NAME` and port, then
remove only that project with `docker compose --profile backup down -v` when
finished. A later Prometheus textfile collector could read a
`last-successful-backup` timestamp written on success; this version only logs
successful set timestamps.
