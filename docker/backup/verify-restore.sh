#!/bin/sh
set -eu
umask 077
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
  echo "verify-restore: FAIL restore failed for set=$latest scratch_database=$target (kept, if it was created, for inspection)" >&2
  exit 1
fi
migrations=$(psql -X -d "$target" -Atqc "SELECT to_regclass('drizzle.__drizzle_migrations')")
if [ -z "$migrations" ]; then
  echo "verify-restore: FAIL migration table missing set=$latest scratch_database=$target (kept for inspection)" >&2
  exit 1
fi
users=$(psql -X -d "$target" -Atqc 'SELECT count(*) FROM users')
workouts=$(psql -X -d "$target" -Atqc 'SELECT count(*) FROM workouts')
exercises=$(psql -X -d "$target" -Atqc 'SELECT count(*) FROM exercises')
# The drill only needs the scratch database while it is being inspected; on
# success there is nothing left to look at, so drop it instead of leaving an
# ever-growing pile of restore_verify_* databases behind. A failure above
# returns before this point, so a failed run's database is always kept.
dropdb --if-exists --maintenance-db=postgres "$target"
echo "verify-restore: OK set=$latest database=$target (dropped after verification) users=$users workouts=$workouts exercises=$exercises migrations=present"
