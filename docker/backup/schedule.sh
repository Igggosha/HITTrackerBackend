#!/bin/sh
set -eu
umask 077
target=${BACKUP_TIME:-03:00}
case "$target" in
  [01][0-9]:[0-5][0-9]|2[0-3]:[0-5][0-9]) ;;
  *) echo "backup: BACKUP_TIME must be HH:MM (00:00..23:59)" >&2; exit 2 ;;
esac
ROOT=${BACKUP_ROOT:-/backups}
last_file="$ROOT/.last-scheduled-date"
# A container killed mid-backup leaves a .inprogress-<stamp>-<pid> directory
# behind; backup.sh only cleans up the one it is currently running. Sweep
# anything old enough that it cannot belong to a run still in flight.
stale_minutes=${BACKUP_STALE_INPROGRESS_MINUTES:-360}

sweep_stale() {
  mkdir -p "$ROOT"
  stale=$(find "$ROOT" -maxdepth 1 -mindepth 1 -type d -name '.inprogress-*' -mmin +"$stale_minutes" 2>/dev/null || true)
  [ -n "$stale" ] || return 0
  printf '%s\n' "$stale" | while IFS= read -r path; do
    [ -n "$path" ] || continue
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: sweeping stale in-progress dir $(basename "$path") (older than ${stale_minutes}m)"
    rm -rf "$path"
  done
}

echo "backup: daily schedule active at ${target} UTC"
sweep_stale
while :; do
  now=$(date -u +%H:%M)
  today=$(date -u +%Y-%m-%d)
  # Catch-up check: run once today as soon as the clock has reached the
  # target time, instead of requiring the loop to observe the exact minute.
  # This guard only covers the scheduled loop; a manual `run-now` bypasses
  # schedule.sh entirely and does not touch .last-scheduled-date, so it never
  # suppresses (or is suppressed by) today's scheduled run. See README.md /
  # docs/diploma/backups.md for how rotate.sh's GFS classes treat same-day
  # manual sets.
  if { [ "$now" = "$target" ] || [ "$now" \> "$target" ]; } \
      && [ "$(cat "$last_file" 2>/dev/null || true)" != "$today" ]; then
    mkdir -p "$(dirname "$last_file")"
    printf '%s\n' "$today" >"$last_file"
    /bin/sh /scripts/backup.sh || echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: scheduled run FAILED"
  fi
  sleep 30
done
