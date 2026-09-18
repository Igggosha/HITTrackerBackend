#!/bin/sh
set -eu

set -- --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
if [ -n "${POSTGRES_HOST:-}" ]; then
  set -- "$@" --host "$POSTGRES_HOST"
fi

# Docker does not rerun init scripts after a failed first boot. The bootstrap
# service calls this script again and this guard keeps that recovery idempotent.
if [ "$(psql "$@" --tuples-only --no-align --command "select to_regclass('public.exercises')")" = "exercises" ]; then
  exit 0
fi

# The committed database dump is UTF-16 LE with a BOM. PostgreSQL expects
# UTF-8 input, so convert it while loading the initial database volume.
tail -c +3 /docker-entrypoint-initdb.d/init.sql.utf16 \
  | iconv -f UTF-16LE -t UTF-8 \
  | psql "$@"
