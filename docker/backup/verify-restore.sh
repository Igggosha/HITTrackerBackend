#!/bin/sh
set -eu
ROOT=${BACKUP_ROOT:-/backups}
latest=
for path in "$ROOT"/[0-9]*T[0-9]*Z; do
  [ -d "$path" ] && [ -f "$path/manifest.json" ] || continue
  name=$(basename "$path")
  [ -n "$latest" ] || latest=$name
  if [ "$name" \> "$latest" ]; then latest=$name; fi
done
[ -n "$latest" ] || { echo "verify-restore: FAIL no successful backup set" >&2; exit 1; }
suffix=$(date -u +%Y%m%d%H%M%S)
target="restore_verify_$suffix"
if ! /bin/sh /scripts/restore.sh "$latest" --database "$target"; then
  echo "verify-restore: FAIL restore failed for set=$latest" >&2
  exit 1
fi
migrations=$(psql -X -d "$target" -Atqc "SELECT to_regclass('drizzle.__drizzle_migrations')")
[ -n "$migrations" ] || { echo "verify-restore: FAIL migration table missing" >&2; exit 1; }
users=$(psql -X -d "$target" -Atqc 'SELECT count(*) FROM users')
workouts=$(psql -X -d "$target" -Atqc 'SELECT count(*) FROM workouts')
exercises=$(psql -X -d "$target" -Atqc 'SELECT count(*) FROM exercises')
echo "verify-restore: OK set=$latest database=$target users=$users workouts=$workouts exercises=$exercises migrations=present"
