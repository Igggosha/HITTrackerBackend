#!/bin/sh
set -eu

# Runs on every Compose startup, including databases created before replication.
psql -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v replication_password="$POSTGRES_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD %L', :'replication_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replicator') \gexec
SELECT format('ALTER ROLE replicator WITH REPLICATION LOGIN PASSWORD %L', :'replication_password') \gexec
SQL

rule='host replication replicator 0.0.0.0/0 scram-sha-256'
grep -qxF "$rule" "$PGDATA/pg_hba.conf" || printf '%s\n' "$rule" >> "$PGDATA/pg_hba.conf"
psql -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'SELECT pg_reload_conf()'
