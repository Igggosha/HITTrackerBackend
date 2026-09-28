#!/bin/sh
set -eu

# Database-per-service on the shared PostgreSQL server: creates (or fixes up)
# the `analytics_app` role and the `analytics` database it owns. Runs on every
# start of the `events` profile - not from docker-entrypoint-initdb.d - so it
# works on fresh AND existing volumes, and keeps the role's password in sync
# with ANALYTICS_DB_PASSWORD. Every statement is idempotent.
#
# Least privilege: analytics_app is NOSUPERUSER/NOCREATEDB/NOCREATEROLE and
# owns only the `analytics` database (so its own migrations can create
# tables). It holds no privileges on the main API's database objects, and
# PUBLIC may not connect to `analytics`, so other roles (e.g. metrics_reader,
# the API's own role if it were not superuser) cannot read the read models.
: "${ANALYTICS_DB_PASSWORD:?ANALYTICS_DB_PASSWORD is required}"

set -- --set ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-nestdb}"
if [ -n "${POSTGRES_HOST:-}" ]; then
  set -- "$@" --host "$POSTGRES_HOST"
fi

psql "$@" --set analytics_password="$ANALYTICS_DB_PASSWORD" <<'SQL'
DO $do$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analytics_app') THEN
    CREATE ROLE analytics_app WITH LOGIN;
  END IF;
END
$do$;

ALTER ROLE analytics_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'analytics_password';

-- CREATE DATABASE cannot run inside a DO block / transaction: \gexec runs
-- the generated statement only when the database is missing.
SELECT 'CREATE DATABASE analytics OWNER analytics_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'analytics') \gexec

ALTER DATABASE analytics OWNER TO analytics_app;
REVOKE ALL ON DATABASE analytics FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE analytics TO analytics_app;
SQL

# PostgreSQL 15+ already denies CREATE on the public schema to PUBLIC; make
# the analytics role the owner of its database's public schema explicitly.
psql --set ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname analytics ${POSTGRES_HOST:+--host "$POSTGRES_HOST"} \
  --command 'ALTER SCHEMA public OWNER TO analytics_app'
