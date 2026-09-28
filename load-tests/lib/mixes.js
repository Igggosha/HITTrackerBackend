// Request mixes shared by the scenarios. Each function performs ONE logical
// client action for one reader and records it under its endpoint name.
import http from 'k6/http';
import { BASE, getJson, headers, isoDaysAgo, pick, record } from './common.js';

// ---- A: workout history browsing (main API, replica-routed reads) --------
export const HISTORY_ENDPOINTS = ['history_list', 'history_dates', 'history_details'];

export function historyMix(reader) {
  const roll = Math.random();
  if (roll < 0.4) {
    // History screen: first page, 20 cards (each with exercise preview).
    record('history_list', getJson('/workouts/history?limit=20', reader.token));
  } else if (roll < 0.6) {
    // Calendar: finished-workout dates of a random month in the last 18.
    const startDaysAgo = 30 + Math.floor(Math.random() * 520);
    const from = isoDaysAgo(startDaysAgo);
    const to = isoDaysAgo(startDaysAgo - 31);
    record(
      'history_dates',
      getJson(`/workouts/history/dates?from=${from}&to=${to}`, reader.token),
    );
  } else {
    // Detail screen of one past workout.
    record(
      'history_details',
      getJson(`/workouts/history/${pick(reader.workoutIds)}`, reader.token),
    );
  }
}

// ---- B: analytics, computed on request vs read models ---------------------
// Exercise endpoints supply different chart products: old = raw weight/reps
// sets, new = per-day top set / e1RM / volume read model.
// Other pairs:
//   body metrics:      old = main API aggregates the rows on every request
//                      new = precomputed timeline
//   summary / weekly volume: read models only (the old way is the
//                      multi-request composite below)
export const CQRS_ENDPOINTS = [
  'old_exercise_sets',
  'new_exercise_progress',
  'old_body_metrics',
  'new_body_metrics',
  'new_summary',
  'new_weekly_volume',
];

export function cqrsMix(reader, iteration) {
  const exerciseId = pick(reader.exercises);
  const from = isoDaysAgo(365);
  const to = new Date().toISOString();
  switch (iteration % CQRS_ENDPOINTS.length) {
    case 0:
      record('old_exercise_sets', getJson(`/workouts/exercise/${exerciseId}/sets`, reader.token));
      break;
    case 1:
      record(
        'new_exercise_progress',
        getJson(`/analytics/me/exercises/${exerciseId}/progress`, reader.token),
      );
      break;
    case 2:
      record('old_body_metrics', getJson(`/users/me/body-metrics?from=${from}&to=${to}`, reader.token));
      break;
    case 3:
      record('new_body_metrics', getJson(`/analytics/me/body-metrics?from=${from}&to=${to}`, reader.token));
      break;
    case 4:
      record('new_summary', getJson('/analytics/me/summary', reader.token));
      break;
    default:
      record('new_weekly_volume', getJson('/analytics/me/weekly-volume?weeks=12', reader.token));
  }
}

/**
 * The 12-week volume chart WITHOUT the read model: the write API has no
 * aggregate endpoint, so a client lists the last 12 weeks of history and
 * fetches every workout's details (sets) in parallel, then sums volume per
 * ISO week itself. Recorded as one composite latency (list + slowest detail)
 * plus the number of requests and bytes it took.
 */
export const COMPOSITE = 'old_weekly_volume_composite';
export function weeklyVolumeComposite(reader, compositeMetrics) {
  const started = Date.now();
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    - (((now.getUTCDay() + 6) % 7) + 11 * 7) * 86400000).toISOString();
  const list = getJson(`/workouts/history?limit=50&from=${from}`, reader.token);
  let ok = list.status === 200;
  let bytes = list.body ? list.body.length : 0;
  let requests = 1;
  if (ok) {
    const ids = list.json('items').map((item) => item.id);
    const responses = http.batch(
      ids.map((id) => ['GET', `${BASE}/workouts/history/${id}`, null, headers(reader.token)]),
    );
    requests += responses.length;
    for (const res of responses) {
      ok = ok && res.status === 200;
      bytes += res.body ? res.body.length : 0;
    }
  }
  compositeMetrics.latency.add(Date.now() - started);
  compositeMetrics.size.add(bytes);
  compositeMetrics.failed.add(!ok);
  compositeMetrics.count.add(1);
  compositeMetrics.subRequests.add(requests);
}
