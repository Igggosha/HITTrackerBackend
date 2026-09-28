#!/bin/sh
# Runs one measured k6 run inside the `loadtest` Compose project and stores
#   load-tests/results/<label>.json       k6 --summary-export
#   load-tests/results/<label>.meta.json  arm, VUs, pg_stat_database deltas of
#                                         primary and replica, other containers
#   load-tests/results/<label>.lag.csv    (scenario c) outbox/consumer timestamps
#
#   sh load-tests/run.sh a replica a-replica-1
#   sh load-tests/run.sh a single  a-single-1   # API without DATABASE_REPLICA_URL
#   sh load-tests/run.sh b replica b-cqrs-1
#   sh load-tests/run.sh c replica c-lag-1
#
# Env: VUS (default 20; 15 background VUs for c), DURATION (60s), WARMUP (15s).
# The stack must be up (see docs/diploma/load-testing.md). Git Bash on Windows
# works; MSYS path conversion is disabled for the container paths below.
set -eu
export MSYS_NO_PATHCONV=1

scenario=$1
arm=$2
label=$3
case "$scenario" in
  a) script=scenarios/a-replica.js ;;
  b) script=scenarios/b-cqrs.js ;;
  c) script=scenarios/c-lag.js ;;
  idle) script="" ;;  # no load: background activity (relay polling, exporter) only
  *) echo "scenario must be a, b, c or idle" >&2; exit 2 ;;
esac
case "$scenario" in c) default_vus=15 ;; *) default_vus=20 ;; esac
VUS=${VUS:-$default_vus}
DURATION=${DURATION:-60s}
WARMUP=${WARMUP:-15s}

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$here/.."
mkdir -p load-tests/results

compose() {
  extra=""
  [ "$arm" = single ] && extra="-f load-tests/compose.single-node.yml"
  # shellcheck disable=SC2086
  docker compose -p loadtest --env-file load-tests/.env.loadtest \
    -f docker-compose.yml -f load-tests/compose.loadtest.yml $extra \
    --profile events --profile observability --profile loadtest "$@"
}

# 1. Wait until no container of another Compose project (except the
#    developer's own `hittrackerbackend`, which is expected) is running.
others() {
  docker ps --format '{{.Names}}' | grep -v -e '^loadtest-' -e '^hittrackerbackend-' || true
}
tries=0
while [ -z "${SKIP_WAIT:-}" ] && [ -n "$(others)" ]; do
  tries=$((tries + 1))
  if [ "$tries" -gt 45 ]; then echo "other containers still running:" >&2; others >&2; exit 3; fi
  echo "waiting for other projects to stop: $(others | tr '\n' ' ')"
  sleep 60
done
background=$(docker ps --format '{{.Names}}' | grep -v '^loadtest-' | tr '\n' ' ')

# 2. Recreate the API for this arm (fresh process: empty read-your-writes map
#    and throttler storage in every run) and wait until it is healthy.
compose up -d --no-build --no-deps --force-recreate api >/dev/null 2>&1
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' loadtest-api-1)" = healthy ] && break
  sleep 2
done
replica_env=$(docker exec loadtest-api-1 printenv DATABASE_REPLICA_URL || true)
[ "$arm" = single ] && [ -n "$replica_env" ] && { echo "single arm but replica URL set" >&2; exit 4; }
[ "$arm" = replica ] && [ -z "$replica_env" ] && { echo "replica arm without replica URL" >&2; exit 4; }

# 3. Warm-up (not recorded): JIT, connection pools, PostgreSQL buffers.
[ -n "$script" ] && compose run --rm -T -e VUS="$VUS" -e DURATION="$WARMUP" k6 run --quiet "$script" >/dev/null 2>&1

stats_sql="select json_build_object('xact_commit', xact_commit, 'xact_rollback', xact_rollback,
  'tup_returned', tup_returned, 'tup_fetched', tup_fetched, 'blks_hit', blks_hit,
  'blks_read', blks_read, 'at', now())
  from pg_stat_database where datname = current_database()"
snap() { compose run --rm -T psql -h "$1" -tAc "$stats_sql" 2>/dev/null | tail -n 1; }
db_now=$(compose run --rm -T psql -h postgres -tAc "select now()" 2>/dev/null | tail -n 1)

primary_before=$(snap postgres)
replica_before=$(snap postgres-replica)

# Memory of every container once, half-way through the run.
( sleep 30; docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' \
    > "load-tests/results/$label.docker-stats.txt" 2>/dev/null ) &

# 4. The measured run.
if [ -z "$script" ]; then
  sleep "${DURATION%s}"
else
  compose run --rm -T -e VUS="$VUS" -e DURATION="$DURATION" k6 run --quiet \
    --summary-export "results/$label.json" "$script" > "load-tests/results/$label.log" 2>&1 || {
    echo "k6 failed, see load-tests/results/$label.log" >&2; exit 5; }
fi
wait

primary_after=$(snap postgres)
# Containers of other projects that appeared DURING the run (from the
# mid-run docker stats and a check right after it): such a run is flagged.
intruders=$( { others; grep -v -e "^loadtest-" -e "^hittrackerbackend-" "load-tests/results/$label.docker-stats.txt" 2>/dev/null | cut -d" " -f1; } | sort -u | tr "\n" " ")
replica_after=$(snap postgres-replica)

# 5. Scenario C: pipeline timestamps from both databases (joined by
#    load-tests/summarize.mjs on the event id).
if [ "$scenario" = c ]; then
  sleep 5
  {
    echo "source,event_id,workout_id,occurred_at,published_at,processed_at"
    compose run --rm -T psql -h postgres -tA -F, -c \
      "select 'outbox', id, aggregate_id, occurred_at, published_at, ''
         from outbox_events where event_type = 'workout.finished'
          and occurred_at >= '$db_now'::timestamptz order by occurred_at" 2>/dev/null
    compose run --rm -T psql -h postgres -d analytics -tA -F, -c \
      "select 'analytics', event_id, '', '', '', processed_at
         from processed_events where event_type = 'workout.finished'
          and processed_at >= '$db_now'::timestamptz order by processed_at" 2>/dev/null
  } > "load-tests/results/$label.lag.csv"
fi

cat > "load-tests/results/$label.meta.json" <<EOF
{
  "label": "$label",
  "scenario": "$scenario",
  "arm": "$arm",
  "vus": $VUS,
  "duration": "$DURATION",
  "warmup": "$WARMUP",
  "dbStartedAt": "$db_now",
  "otherRunningContainers": "$background",
  "otherProjectsDuringRun": "$intruders",
  "primary": { "before": $primary_before, "after": $primary_after },
  "replica": { "before": $replica_before, "after": $replica_after }
}
EOF
echo "done: load-tests/results/$label.json"
