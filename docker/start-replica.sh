#!/bin/sh
set -eu

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  # PGPASSWORD (set by Compose to REPLICATION_PASSWORD) authenticates this.
  # -R writes primary_conninfo, including this password, into
  # postgresql.auto.conf below $PGDATA.
  gosu postgres pg_basebackup -h postgres -U replicator -D "$PGDATA" -Fp -Xs -R
fi

# pg_basebackup -R stored the replication password inside primary_conninfo in
# postgresql.auto.conf at bootstrap time. If REPLICATION_PASSWORD has been
# rotated since then, rewrite the stored password so streaming keeps working
# without re-running pg_basebackup. This is a best-effort textual rewrite for
# the demo/diploma setup; a hardened deployment would run
# `ALTER SYSTEM SET primary_conninfo = ...` from a running replica instead.
if [ -f "$PGDATA/postgresql.auto.conf" ] && [ -n "${REPLICATION_PASSWORD:-}" ]; then
  escaped_password=$(printf '%s' "$REPLICATION_PASSWORD" | sed -e 's/[\/&]/\\&/g')
  sed -i -E "s/(primary_conninfo = '.*password=)[^ ']*/\\1${escaped_password}/" \
    "$PGDATA/postgresql.auto.conf"
fi

exec docker-entrypoint.sh postgres -c hot_standby=on
