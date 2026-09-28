// Shared helpers for the k6 scenarios (see docs/diploma/load-testing.md).
import http from 'k6/http';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';

export const BASE = __ENV.BASE_URL || 'http://api:3000';
export const PASSWORD = 'LoadTest!2026';
// lt001..lt020 read (never write, so readerFor() always picks the replica
// when one is configured); lt021..lt050 are the writers of scenario C.
export const READERS = Number(__ENV.READERS || 20);
export const WRITER_FIRST = 21;
export const WRITERS = Number(__ENV.WRITERS || 30);
export const VUS = Number(__ENV.VUS || 20);
export const DURATION = __ENV.DURATION || '60s';

export const email = (n) =>
  `lt${String(n).padStart(3, '0')}@loadtest.example.com`;

export const TREND_STATS = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'];

/*
 * The API trusts one proxy hop in production (src/config/trust-proxy.ts), so
 * the global throttler (120 requests/min per client IP) keys on the
 * X-Forwarded-For address. k6 sends a distinct address per request: the
 * study measures the server with a large population of clients behind the
 * tunnel, not one IP hitting the rate limiter. The limiter is untouched.
 */
let requestCounter = 0;
export function clientIp() {
  requestCounter += 1;
  const vu = exec.vu.idInTest % 250; // 0 in setup()
  return `10.${vu}.${(requestCounter >> 8) & 255}.${requestCounter & 255}`;
}

export function headers(token) {
  return {
    headers: {
      authorization: `Bearer ${token}`,
      'x-forwarded-for': clientIp(),
    },
  };
}

let setupIp = 0;
export function login(n) {
  setupIp += 1;
  const res = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email: email(n), password: PASSWORD, client: 'native' }),
    {
      headers: {
        'content-type': 'application/json',
        // Login allows 5 tries per IP and minute: one address per login.
        'x-forwarded-for': `10.251.${(setupIp >> 8) & 255}.${setupIp & 255}`,
      },
    },
  );
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`login ${email(n)} -> ${res.status} ${res.body}`);
  }
  return res.json('accessToken');
}

export function getJson(path, token) {
  return http.get(`${BASE}${path}`, headers(token));
}

/** Reader fixtures: token, all completed workout ids, exercise ids. */
export function loadReaders() {
  const readers = [];
  for (let n = 1; n <= READERS; n += 1) {
    const token = login(n);
    const workoutIds = [];
    let cursor = null;
    do {
      const q = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const res = getJson(`/workouts/history?limit=50${q}`, token);
      if (res.status !== 200) throw new Error(`history ${res.status} ${res.body}`);
      const page = res.json();
      for (const item of page.items) workoutIds.push(item.id);
      cursor = page.nextCursor;
    } while (cursor);
    const exercises = getJson('/workouts/exercise-ids', token)
      .json()
      .map((e) => e.exerciseId);
    readers.push({ n, token, workoutIds, exercises });
  }
  return readers;
}

// Per-endpoint metrics; only the measured scenarios record into them, so
// setup() traffic never pollutes the numbers. `lat_all`/`err_all` pool every
// recorded request of a run.
const metrics = {};
const all = { latency: new Trend('lat_all', true), failed: new Rate('err_all') };
export function endpointMetrics(name) {
  if (!metrics[name]) {
    metrics[name] = {
      latency: new Trend(`lat_${name}`, true),
      size: new Trend(`size_${name}`),
      failed: new Rate(`err_${name}`),
      count: new Counter(`reqs_${name}`),
    };
  }
  return metrics[name];
}

export function record(name, res, expected = 200) {
  const m = endpointMetrics(name);
  const ok = res.status === expected;
  m.latency.add(res.timings.duration);
  m.size.add(res.body ? res.body.length : 0);
  m.failed.add(!ok);
  m.count.add(1);
  all.latency.add(res.timings.duration);
  all.failed.add(!ok);
  if (!ok && Math.random() < 0.05) {
    console.warn(`${name} -> ${res.status} ${String(res.body).slice(0, 200)}`);
  }
  return ok;
}

export const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
