#!/bin/sh
set -eu
umask 077

ROOT=${BACKUP_ROOT:-/backups}
BUCKET=${S3_BUCKET:-hit-tracker}
ENDPOINT=${MINIO_ENDPOINT:-http://minio:9000}

# Reads one "key": value (or "key": "value") field out of a manifest.json
# without jq (busybox has none). Prints nothing if the key is absent.
manifest_get() {
  key=$1
  file=$2
  grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"\{0,1\}[^\",}]*\"\{0,1\}" "$file" 2>/dev/null \
    | head -n1 \
    | sed -e "s/^\"$key\"[[:space:]]*:[[:space:]]*//" -e 's/^"//' -e 's/"$//'
}

set_arg=${1:-}
[ -n "$set_arg" ] || { echo "usage: restore <set> [--database name] [--force-live]" >&2; exit 2; }
shift
target=
force_live=no
while [ "$#" -gt 0 ]; do
  case "$1" in
    --database) [ "$#" -ge 2 ] || { echo "restore: --database needs a name" >&2; exit 2; }; target=$2; shift 2 ;;
    --force-live) force_live=yes; shift ;;
    *) echo "restore: unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$set_arg" in
  /*) set_dir=$set_arg ;;
  *) set_dir="$ROOT/$set_arg" ;;
esac
[ -f "$set_dir/manifest.json" ] && [ -f "$set_dir/db.dump" ] && [ -d "$set_dir/minio" ] || {
  echo "restore: backup set must contain manifest.json, db.dump, and minio/" >&2; exit 1;
}

# Verify the dump has not been truncated or tampered with before trusting it
# to pg_restore. A missing recorded checksum is treated the same as a
# mismatch: the set cannot be verified, so it must not be restored silently.
recorded_sha=$(manifest_get db_dump_sha256 "$set_dir/manifest.json")
[ -n "$recorded_sha" ] || {
  echo "restore: manifest.json has no db_dump_sha256; refusing to restore an unverifiable set" >&2
  exit 1
}
actual_sha=$(sha256sum "$set_dir/db.dump" | awk '{print $1}')
if [ "$actual_sha" != "$recorded_sha" ]; then
  echo "restore: db.dump checksum mismatch for set $(basename "$set_dir")" >&2
  echo "restore: manifest recorded sha256=$recorded_sha actual sha256=$actual_sha" >&2
  echo "restore: refusing to restore a set that fails integrity verification" >&2
  exit 1
fi

# Cheap integrity check on the bucket mirror: compare the recorded object
# count/bytes against what is actually on disk. This is not a per-object
# checksum, but it catches a truncated or partially-copied mirror before it
# is merged into the live bucket. Older manifests without these fields skip
# the check rather than fail closed on a format they predate.
recorded_minio_bytes=$(manifest_get minio_bytes "$set_dir/manifest.json")
recorded_minio_count=$(manifest_get minio_object_count "$set_dir/manifest.json")
actual_minio_bytes=$(find "$set_dir/minio" -type f -exec wc -c {} \; | awk '{total += $1} END {print total + 0}')
actual_minio_count=$(find "$set_dir/minio" -type f | wc -l | tr -d ' ')
if [ -n "$recorded_minio_bytes" ] && [ "$recorded_minio_bytes" != "$actual_minio_bytes" ]; then
  echo "restore: minio mirror byte count mismatch for set $(basename "$set_dir")" >&2
  echo "restore: manifest recorded minio_bytes=$recorded_minio_bytes actual=$actual_minio_bytes" >&2
  exit 1
fi
if [ -n "$recorded_minio_count" ] && [ "$recorded_minio_count" != "$actual_minio_count" ]; then
  echo "restore: minio object count mismatch for set $(basename "$set_dir")" >&2
  echo "restore: manifest recorded minio_object_count=$recorded_minio_count actual=$actual_minio_count" >&2
  exit 1
fi

pg_restore --list "$set_dir/db.dump" >/dev/null
if [ -z "$target" ]; then
  suffix=$(basename "$set_dir" | tr -cd 'A-Za-z0-9_')
  target="restore_$suffix"
fi
case "$target" in
  ''|[!A-Za-z_]*|*[!A-Za-z0-9_]*) echo "restore: database name must be a PostgreSQL identifier" >&2; exit 2 ;;
esac
if [ "$target" = "$PGDATABASE" ] && [ "$force_live" != yes ]; then
  echo "restore: refusing to overwrite live database '$PGDATABASE'; pass --force-live explicitly" >&2
  exit 1
fi
if [ "$target" = "$PGDATABASE" ]; then
  echo "WARNING: --force-live will drop and replace live database '$PGDATABASE'."
  dropdb --if-exists --force --maintenance-db=postgres "$target"
elif psql -X -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$target'" | grep -q 1; then
  echo "restore: target database '$target' already exists; refusing to overwrite it" >&2
  exit 1
fi
createdb --maintenance-db=postgres "$target"
pg_restore --exit-on-error --no-owner --no-acl --dbname="$target" "$set_dir/db.dump"

# Restoring writes objects, so it needs a write-capable account. It is kept
# separate from the always-on backup service's read-only account and from
# the MinIO root user: restore is a human-invoked, one-off command, and this
# credential is only ever supplied at invocation time (see README.md).
if [ -z "${RESTORE_S3_ACCESS_KEY_ID:-}" ] || [ -z "${RESTORE_S3_SECRET_ACCESS_KEY:-}" ]; then
  echo "restore: RESTORE_S3_ACCESS_KEY_ID/RESTORE_S3_SECRET_ACCESS_KEY are unset" >&2
  echo "restore: pass them at invocation time, e.g." >&2
  echo "  docker compose --profile backup run --rm -e RESTORE_S3_ACCESS_KEY_ID=... -e RESTORE_S3_SECRET_ACCESS_KEY=... backup restore <set>" >&2
  exit 1
fi
mc alias set restore "$ENDPOINT" "$RESTORE_S3_ACCESS_KEY_ID" "$RESTORE_S3_SECRET_ACCESS_KEY" >/dev/null
# No `mc mb --ignore-existing` here: the scoped restore account cannot create
# buckets (least privilege), and the bucket always already exists by the time
# a restore is possible, since docker/minio-init.sh provisions it and a
# backup set can only have been produced against an existing bucket.
mc mirror --overwrite "$set_dir/minio" "restore/$BUCKET" >/dev/null
echo "restore: OK database=$target objects=merged bucket=$BUCKET"
