#!/bin/sh
set -eu
umask 077
ROOT=${BACKUP_ROOT:-/backups}
daily=${BACKUP_KEEP_DAILY:-7}
weekly=${BACKUP_KEEP_WEEKLY:-4}
monthly=${BACKUP_KEEP_MONTHLY:-12}
for count in "$daily" "$weekly" "$monthly"; do
  case "$count" in *[!0-9]*|'') echo "backup: retention counts must be non-negative integers" >&2; exit 2 ;; esac
done
tmp="$ROOT/.rotation-keep-$$"
trap 'rm -f "$tmp"' 0
: >"$tmp"
sets=$(for path in "$ROOT"/[0-9]*T[0-9]*Z; do
  [ -d "$path" ] && [ -f "$path/manifest.json" ] && basename "$path"
done | sort -r)
newest=$(printf '%s\n' "$sets" | sed -n '1p')
keep_class() {
  class=$1
  limit=$2
  seen=0
  for name in $sets; do
    datepart=$(printf '%s' "$name" | cut -c1-8)
    year=$(printf '%s' "$datepart" | cut -c1-4)
    month=$(printf '%s' "$datepart" | cut -c5-6)
    day=$(printf '%s' "$datepart" | cut -c7-8)
    weekday=$(date -u -d "$year-$month-$day" +%u 2>/dev/null || echo 0)
    selected=no
    case "$class" in
      daily) selected=yes ;;
      weekly) [ "$weekday" = 7 ] && selected=yes ;;
      monthly) [ "$day" = 01 ] && selected=yes ;;
    esac
    if [ "$selected" = yes ]; then
      seen=$((seen + 1))
      if [ "$seen" -le "$limit" ]; then printf '%s\n' "$name" >>"$tmp"; fi
    fi
  done
}
keep_class daily "$daily"
keep_class weekly "$weekly"
keep_class monthly "$monthly"
[ -z "$newest" ] || printf '%s\n' "$newest" >>"$tmp"
for path in "$ROOT"/[0-9]*T[0-9]*Z; do
  [ -d "$path" ] || continue
  [ -f "$path/manifest.json" ] || continue
  name=$(basename "$path")
  if ! grep -F -x "$name" "$tmp" >/dev/null; then
    rm -rf "$path"
    echo "backup: rotated set=$name"
  fi
done
echo "backup: rotation complete; newest=${newest:-none} daily=$daily weekly=$weekly monthly=$monthly"
