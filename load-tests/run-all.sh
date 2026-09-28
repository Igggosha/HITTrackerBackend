#!/bin/sh
# The whole study: an idle baseline, then three repetitions of every
# measurement (A arms interleaved so slow drift hits both equally), then
# the markdown summary. About 25 minutes on the reference laptop.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DURATION=60s sh "$here/run.sh" idle replica idle-1
for i in 1 2 3; do
  sh "$here/run.sh" a replica "a-replica-$i"
  sh "$here/run.sh" a single "a-single-$i"
done
for i in 1 2 3; do sh "$here/run.sh" b replica "b-cqrs-$i"; done
for i in 1 2 3; do sh "$here/run.sh" c replica "c-lag-$i"; done
node "$here/summarize.mjs" >/dev/null
echo "summary: load-tests/results/summary.md"
