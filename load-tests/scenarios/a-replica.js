// Measurement A: read-heavy workout-history browsing. The same script runs
// against the default stack (DATABASE_REPLICA_URL set) and the single-node
// arm (compose.single-node.yml); run.sh snapshots pg_stat_database on the
// primary and the replica around it.
import exec from 'k6/execution';
import { DURATION, TREND_STATS, VUS, endpointMetrics, loadReaders } from '../lib/common.js';
import { HISTORY_ENDPOINTS, historyMix } from '../lib/mixes.js';

HISTORY_ENDPOINTS.forEach(endpointMetrics);

export const options = {
  scenarios: {
    history: { executor: 'constant-vus', vus: VUS, duration: DURATION },
  },
  setupTimeout: '180s',
  summaryTrendStats: TREND_STATS,
  // Closed model without think time: every VU sends its next request as soon
  // as the previous one answered, i.e. throughput at saturation for VUS
  // concurrent clients.
};

export function setup() {
  return { readers: loadReaders() };
}

export default function (data) {
  const reader = data.readers[(exec.vu.idInTest - 1) % data.readers.length];
  historyMix(reader);
}
