#!/bin/sh
set -eu
umask 077
ROOT=${BACKUP_ROOT:-/backups}
BUCKET=${S3_BUCKET:-hit-tracker}
ENDPOINT=${MINIO_ENDPOINT:-http://minio:9000}
started=$(date +%s)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
final="$ROOT/$stamp"
work="$ROOT/.inprogress-$stamp-$$"
log() { printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
failed() {
  status=$?
  trap - 0
  [ ! -d "$work" ] || rm -rf "$work"
  log "FAILED (exit $status)"
  exit "$status"
}
trap failed 0
mkdir -p "$ROOT"
[ ! -e "$final" ] || { log "FAILED: backup set already exists: $stamp"; exit 1; }
mkdir "$work"
mkdir "$work/minio"
log "starting set $stamp"
pg_dump --format=custom --no-owner --no-acl --file="$work/db.dump"
pg_version=$(pg_dump --version | sed 's/^pg_dump (PostgreSQL) //')
pg_server_version=$(psql -X -Atqc 'SHOW server_version')
migration_table=$(psql -X -Atqc "SELECT to_regclass('drizzle.__drizzle_migrations')")
if [ -n "$migration_table" ]; then
  migration_count=$(psql -X -Atqc 'SELECT count(*) FROM drizzle.__drizzle_migrations')
else
  migration_count=0
fi
# Backups only ever read the bucket, so this uses the dedicated read-only
# account provisioned by docker/minio-init.sh, never the MinIO root user.
if [ -z "${BACKUP_S3_ACCESS_KEY_ID:-}" ] || [ -z "${BACKUP_S3_SECRET_ACCESS_KEY:-}" ]; then
  log "FAILED: BACKUP_S3_ACCESS_KEY_ID/BACKUP_S3_SECRET_ACCESS_KEY are unset"
  exit 1
fi
mc alias set backup "$ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" >/dev/null
mc mirror "backup/$BUCKET" "$work/minio" >/dev/null
db_bytes=$(wc -c < "$work/db.dump" | tr -d ' ')
minio_bytes=$(find "$work/minio" -type f -exec wc -c {} \; | awk '{total += $1} END {print total + 0}')
minio_object_count=$(find "$work/minio" -type f | wc -l | tr -d ' ')
db_sha256=$(sha256sum "$work/db.dump" | awk '{print $1}')
finished=$(date +%s)
duration=$((finished - started))
cat >"$work/manifest.json" <<EOF
{
  "timestamp": "$stamp",
  "database": "$PGDATABASE",
  "db_dump_bytes": $db_bytes,
  "db_dump_sha256": "$db_sha256",
  "minio_bytes": $minio_bytes,
  "minio_object_count": $minio_object_count,
  "pg_dump_version": "$pg_version",
  "pg_server_version": "$pg_server_version",
  "migration_count": $migration_count,
  "duration_seconds": $duration
}
EOF
# Belt-and-suspenders: the umask above already restricts new files/dirs, but
# `mc mirror` may create objects with their own explicit mode, so re-assert
# private permissions on the whole set before it is published.
chmod -R go-rwx "$work"
mv "$work" "$final"
work=
trap - 0
log "SUCCESS set=$stamp db_bytes=$db_bytes minio_bytes=$minio_bytes duration_seconds=$duration"
/bin/sh /scripts/rotate.sh
