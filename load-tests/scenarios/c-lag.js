// Measurement C: eventual-consistency lag of the analytics read side under
// load. `background` runs the B read mix; `writer` finishes workouts at a
// steady rate (start + 5 sets + finish, like the app) and then polls
// GET /analytics/me/summary until lastWorkout.workoutId is that workout.
// visibility_lag_ms = time from the finish response (the transaction, and
// its outbox row, are committed by then) to the first poll response that
// shows the workout; resolution is POLL_MS plus one poll round trip.
import http from 'k6/http';
import exec from 'k6/execution';
import { sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import {
  BASE, DURATION, TREND_STATS, VUS, WRITERS, WRITER_FIRST,
  endpointMetrics, getJson, headers, loadReaders, login, record,
} from '../lib/common.js';
import { CQRS_ENDPOINTS, cqrsMix } from '../lib/mixes.js';

CQRS_ENDPOINTS.forEach(endpointMetrics);
['write_start', 'write_set', 'write_finish', 'poll_summary'].forEach(endpointMetrics);
const lag = new Trend('visibility_lag_ms', true);
const lagTimeouts = new Rate('visibility_timeout');
const polls = new Counter('visibility_polls');
const finished = new Counter('workouts_finished');

const RATE_PER_MIN = Number(__ENV.WRITES_PER_MIN || 30);
const WRITER_VUS = Number(__ENV.WRITER_VUS || 8);
const POLL_MS = Number(__ENV.POLL_MS || 50);
const TIMEOUT_MS = Number(__ENV.LAG_TIMEOUT_MS || 30000);

export const options = {
  scenarios: {
    background: { executor: 'constant-vus', vus: VUS, duration: DURATION, exec: 'background' },
    writer: {
      executor: 'constant-arrival-rate',
      rate: RATE_PER_MIN,
      timeUnit: '1m',
      duration: DURATION,
      preAllocatedVUs: WRITER_VUS,
      maxVUs: WRITER_VUS,
      exec: 'writer',
    },
  },
  setupTimeout: '180s',
  summaryTrendStats: TREND_STATS,
};

export function setup() {
  const writers = [];
  for (let i = 0; i < WRITERS; i += 1) writers.push(login(WRITER_FIRST + i));
  return { readers: loadReaders(), writers, startedAt: new Date().toISOString() };
}

export function background(data) {
  const reader = data.readers[(exec.vu.idInTest - 1) % data.readers.length];
  cqrsMix(reader, exec.vu.iterationInScenario + exec.vu.idInTest);
}

const json = (token) => {
  const params = headers(token);
  params.headers['content-type'] = 'application/json';
  return params;
};

export function writer(data) {
  // One writer user per VU (VU ids are unique and < WRITERS), so two
  // iterations never share a user's single open workout.
  const token = data.writers[(exec.vu.idInTest - 1) % data.writers.length];
  const start = http.post(`${BASE}/workouts/start`, JSON.stringify({ type: 'Load test' }), json(token));
  if (!record('write_start', start, 201)) return;
  const workoutId = start.json('workout.id');
  if (start.json('message') !== 'Workout started') {
    console.warn(`writer reused an open workout ${workoutId}`);
  }
  for (let s = 0; s < 5; s += 1) {
    const set = http.post(
      `${BASE}/workouts/${workoutId}/sets`,
      JSON.stringify({ exerciseId: 1 + (s % 8), weight: 60 + s * 2.5, reps: 8, rpe: 8 }),
      json(token),
    );
    record('write_set', set, 201);
  }
  const finish = http.post(`${BASE}/workouts/${workoutId}/finish`, JSON.stringify({}), json(token));
  if (!record('write_finish', finish, 201)) return;
  const finishedAt = Date.now();
  finished.add(1);

  for (;;) {
    const res = getJson('/analytics/me/summary', token);
    record('poll_summary', res);
    polls.add(1);
    if (res.status === 200 && res.json('lastWorkout.workoutId') === workoutId) {
      lag.add(Date.now() - finishedAt);
      lagTimeouts.add(false);
      return;
    }
    if (Date.now() - finishedAt > TIMEOUT_MS) {
      lagTimeouts.add(true);
      console.warn(`workout ${workoutId} not visible after ${TIMEOUT_MS} ms`);
      return;
    }
    sleep(POLL_MS / 1000);
  }
}
