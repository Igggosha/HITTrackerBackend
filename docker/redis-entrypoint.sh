#!/bin/sh
set -eu

if [ -z "${REDIS_PASSWORD:-}" ]; then
  echo 'REDIS_PASSWORD is required' >&2
  exit 1
fi

umask 077
cat > /tmp/redis.conf <<EOF
bind 0.0.0.0
protected-mode yes
port 6379
requirepass ${REDIS_PASSWORD}
appendonly yes
dir /data
EOF

exec redis-server /tmp/redis.conf
