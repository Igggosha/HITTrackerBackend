#!/bin/sh
# EN: Dispatches the backup container to scheduled, immediate, restore, rotation, or verification modes without an intermediate process.
# UK: Спрямовує контейнер резервного копіювання в режим розкладу, негайного запуску, відновлення, ротації або перевірки без проміжного процесу.

set -eu
case "${1:-schedule}" in
  schedule) exec /bin/sh /scripts/schedule.sh ;;
  run-now) exec /bin/sh /scripts/backup.sh ;;
  rotate) exec /bin/sh /scripts/rotate.sh ;;
  restore) shift; exec /bin/sh /scripts/restore.sh "$@" ;;
  verify-restore) shift; exec /bin/sh /scripts/verify-restore.sh "$@" ;;
  *) echo "backup: expected schedule, run-now, rotate, restore, or verify-restore" >&2; exit 2 ;;
esac
