#!/bin/sh
set -eu

# Runs on every Compose startup, including databases created before replication.
# REPLICATION_PASSWORD is a dedicated credential, never the superuser password:
# it is what pg_basebackup -R stores in the replica's postgresql.auto.conf, so
# it must be able to rotate independently of POSTGRES_PASSWORD/DB_PASSWORD.
psql -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v replication_password="$REPLICATION_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD %L', :'replication_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replicator') \gexec
SELECT format('ALTER ROLE replicator WITH REPLICATION LOGIN PASSWORD %L', :'replication_password') \gexec
SQL

# Scoped to the `private` Compose network's subnet, not 0.0.0.0/0. The subnet
# is overridable (PRIVATE_NETWORK_SUBNET) and must match docker-compose.yml's
# `networks.private.ipam.config.subnet`; changing it needs `docker compose down`
# to recreate the network (named volumes, and this rule inside them, are kept).
subnet="${PRIVATE_NETWORK_SUBNET:-172.28.40.0/24}"
rule="host replication replicator ${subnet} scram-sha-256"

# Idempotent AND self-healing: drop any previous rule for this role (including
# an older 0.0.0.0/0 rule written before subnet scoping existed, or one for a
# stale subnet) before appending the current one, so a rerun never leaves two
# rules for `replicator` behind.
grep -v -E '^host replication replicator ' "$PGDATA/pg_hba.conf" > "$PGDATA/pg_hba.conf.tmp" || true
mv "$PGDATA/pg_hba.conf.tmp" "$PGDATA/pg_hba.conf"
printf '%s\n' "$rule" >> "$PGDATA/pg_hba.conf"

psql -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'SELECT pg_reload_conf()'
