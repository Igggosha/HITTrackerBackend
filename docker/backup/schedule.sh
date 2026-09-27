#!/bin/sh
set -eu
target=${BACKUP_TIME:-03:00}
case "$target" in
  [01][0-9]:[0-5][0-9]|2[0-3]:[0-5][0-9]) ;;
  *) echo "backup: BACKUP_TIME must be HH:MM (00:00..23:59)" >&2; exit 2 ;;
esac
last_file="${BACKUP_ROOT:-/backups}/.last-scheduled-date"
echo "backup: daily schedule active at ${target} UTC"
while :; do
  now=$(date -u +%H:%M)
  today=$(date -u +%Y-%m-%d)
  if [ "$now" = "$target" ] && [ "$(cat "$last_file" 2>/dev/null || true)" != "$today" ]; then
    mkdir -p "$(dirname "$last_file")"
    printf '%s\n' "$today" >"$last_file"
    /bin/sh /scripts/backup.sh || echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: scheduled run FAILED"
  fi
  sleep 30
done
