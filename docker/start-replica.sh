#!/bin/sh
set -eu

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  gosu postgres pg_basebackup -h postgres -U replicator -D "$PGDATA" -Fp -Xs -R
fi

exec docker-entrypoint.sh postgres -c hot_standby=on
