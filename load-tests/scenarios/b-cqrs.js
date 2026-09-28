// Measurement B: analytics computed on request (main API over the write
// model) vs precomputed read models (analytics service via the API proxy).
// The mix VUs rotate through the six single-request endpoints so each gets
// the same share of iterations under the same concurrent load; two more VUs
// loop the multi-request "weekly volume without a read model" composite.
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { DURATION, TREND_STATS, VUS, endpointMetrics, loadReaders } from '../lib/common.js';
import { COMPOSITE, CQRS_ENDPOINTS, cqrsMix, weeklyVolumeComposite } from '../lib/mixes.js';

CQRS_ENDPOINTS.forEach(endpointMetrics);
const compositeMetrics = {
  ...endpointMetrics(COMPOSITE),
  subRequests: new Counter(`subreqs_${COMPOSITE}`),
};
const COMPOSITE_VUS = Number(__ENV.COMPOSITE_VUS || 2);

export const options = {
  scenarios: {
    mix: { executor: 'constant-vus', vus: VUS - COMPOSITE_VUS, duration: DURATION, exec: 'mix' },
    composite: { executor: 'constant-vus', vus: COMPOSITE_VUS, duration: DURATION, exec: 'composite' },
  },
  setupTimeout: '180s',
  summaryTrendStats: TREND_STATS,
};

export function setup() {
  return { readers: loadReaders() };
}

const readerOf = (data) => data.readers[(exec.vu.idInTest - 1) % data.readers.length];

export function mix(data) {
  cqrsMix(readerOf(data), exec.vu.iterationInScenario + exec.vu.idInTest);
}

export function composite(data) {
  weeklyVolumeComposite(readerOf(data), compositeMetrics);
}
