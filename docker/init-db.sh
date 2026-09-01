#!/bin/sh
set -eu

# The committed database dump is UTF-16 LE with a BOM. PostgreSQL expects
# UTF-8 input, so convert it while loading the initial database volume.
tail -c +3 /docker-entrypoint-initdb.d/init.sql.utf16 \
  | iconv -f UTF-16LE -t UTF-8 \
  | psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
