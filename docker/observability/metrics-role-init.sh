#!/bin/sh
set -eu

# Grants postgres-exporter a dedicated, least-privilege login instead of the
# application superuser. Runs every time the `observability` profile starts
# (not only against a fresh volume, unlike docker-entrypoint-initdb.d
# scripts), so it also fixes up an EXISTING volume that predates this role,
# and keeps the role's password in sync with METRICS_DB_PASSWORD across
# restarts/rotations. `pg_monitor` is the built-in role that grants exactly
# the read access the exporter's default collectors need (pg_stat_activity,
# pg_stat_database, pg_database, replication status, ...) without superuser.
: "${METRICS_DB_PASSWORD:?METRICS_DB_PASSWORD is required}"

set -- --set ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-nestdb}"
if [ -n "${POSTGRES_HOST:-}" ]; then
  set -- "$@" --host "$POSTGRES_HOST"
fi

psql "$@" --set metrics_password="$METRICS_DB_PASSWORD" <<'SQL'
DO $do$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'metrics_reader') THEN
    CREATE ROLE metrics_reader WITH LOGIN;
  END IF;
END
$do$;

ALTER ROLE metrics_reader WITH LOGIN PASSWORD :'metrics_password';
GRANT pg_monitor TO metrics_reader;
SQL
