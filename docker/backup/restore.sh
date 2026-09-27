#!/bin/sh
set -eu

ROOT=${BACKUP_ROOT:-/backups}
BUCKET=${S3_BUCKET:-hit-tracker}
ENDPOINT=${MINIO_ENDPOINT:-http://minio:9000}
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
mc alias set restore "$ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing "restore/$BUCKET" >/dev/null
mc mirror --overwrite "$set_dir/minio" "restore/$BUCKET" >/dev/null
echo "restore: OK database=$target objects=merged bucket=$BUCKET"
