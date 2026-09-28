# HIT Tracker analytics service

The read side of CQRS: a separate NestJS service that consumes domain events
from Kafka (`hit.workout.v1`, `hit.user.v1`, consumer group `analytics`) and
keeps query-optimised read models in its own PostgreSQL database `analytics`.
Design and demo: [docs/diploma/analytics-cqrs.md](../../docs/diploma/analytics-cqrs.md).

```
src/consumer/      kafkajs consumer, MessageHandler (validate -> project -> DLQ), lag
src/events/        ajv validation against packages/event-contracts/schemas
src/projections/   pure calculations, Projector, PostgreSQL store (+ in-memory for tests)
src/analytics/     read API (controller, DTOs, query service)
src/cli/           rebuild-projections
drizzle/           versioned migrations of this database only
```

## Commands (from this directory)

| Command | What |
| --- | --- |
| `npm ci` | install (own `package-lock.json`) |
| `npm test` | unit + HTTP tests (no database/Kafka needed) |
| `npm run typecheck` / `npm run build` | `tsc --noEmit` / `nest build` -> `dist/services/analytics/src/main.js` |
| `npm run db:generate` / `npm run db:migrate` | drizzle-kit on `ANALYTICS_DATABASE_URL` |
| lint (from the repo root) | `npx eslint -c services/analytics/eslint.config.mjs "services/analytics/{src,test}/**/*.ts"` |

Environment: `ANALYTICS_DATABASE_URL` (required), `JWT_SECRET` (the main
API's, required), `KAFKA_BROKERS` (unset = read API only), `METRICS_TOKEN`,
`PORT` (3000), `ANALYTICS_MAX_ATTEMPTS` (5), `ANALYTICS_RETRY_BASE_MS` (200),
`ANALYTICS_RETRY_MAX_MS` (30000), `LOG_LEVEL`, `EVENT_SCHEMAS_DIR` (optional).
The image is built from the repository root:
`docker build -f services/analytics/Dockerfile .`

## Read API

Clients use the main API's base URL: it proxies `GET /analytics/*` here with
the same `Authorization: Bearer <access token>` and `X-Request-Id`. Every
route answers for the token's user only. Units are in field names (`Kg`,
`Seconds`, `Cm`); dates are UTC (`YYYY-MM-DD`), timestamps ISO 8601. Errors use
the main API's envelope `{ statusCode, error, message, code?, requestId,
timestamp, path }`; `401` without a valid token, `400` for invalid query
parameters, and (from the main API proxy) `503 { code: "ANALYTICS_UNAVAILABLE" }`
when this service is down or not configured. Read models are eventually
consistent: a finished workout normally appears within about a second.

`GET /analytics/me/summary`

```json
{
  "userId": 7,
  "generatedAt": "2026-09-28T10:15:00.000Z",
  "thisWeek": { "isoWeekStart": "2026-09-28", "workouts": 2, "sets": 9, "reps": 61, "volumeKg": 4720, "durationSeconds": 5400 },
  "lastWeek": { "isoWeekStart": "2026-09-21", "workouts": 3, "sets": 14, "reps": 98, "volumeKg": 6100.5, "durationSeconds": 8100 },
  "volumeChangePercent": -22.62,
  "streak": { "currentDays": 2, "longestDays": 5, "lastWorkoutDate": "2026-09-28" },
  "personalRecordCount": 6,
  "lastWorkout": { "workoutId": 812, "finishedAt": "2026-09-28T09:58:12.000Z", "durationSeconds": 2700, "setCount": 5, "volumeKg": 2600 }
}
```

`volumeChangePercent` is `null` when last week's volume is 0; `lastWorkout` is
`null` and every number 0 for a user without finished workouts.
`streak.currentDays` is 0 once a whole UTC day passed without a workout.

`GET /analytics/me/weekly-volume?weeks=12` (`weeks` 1..104, default 12):
`{ "weeks": [ { "isoWeekStart": "2026-07-13", "workouts": 0, "sets": 0, "reps": 0, "volumeKg": 0, "durationSeconds": 0 }, ... ] }`
- exactly `weeks` entries, oldest first, ending with the current ISO week (Monday, UTC); empty weeks are zeros.

`GET /analytics/me/personal-records`

```json
{ "records": [ {
  "exerciseId": 3,
  "bestWeightKg": 105, "bestRepsAtWeight": 3,
  "achievedAt": "2026-09-28T09:58:12.000Z", "workoutId": 812,
  "bestE1rmKg": 116.67, "bestE1rmAchievedAt": "2026-09-22T18:00:00.000Z", "bestE1rmWorkoutId": 790
} ] }
```

The heaviest set (weight, then reps) and the best Epley e1RM
(`weight * (1 + reps / 30)`) are tracked separately; an equal later set does
not replace the earlier achievement. Exercise names come from the main API's
`/exercises`.

`GET /analytics/me/exercises/:exerciseId/progress?from=2026-09-01&to=2026-09-30`

`{ "exerciseId": 3, "points": [ { "date": "2026-09-22", "topSetWeightKg": 100, "topSetReps": 5, "e1rmKg": 116.67, "volumeKg": 1220 } ] }`

`GET /analytics/me/body-metrics?from=2026-09-01&to=2026-09-30`

`{ "points": [ { "recordedAt": "2026-09-20T08:00:00.000Z", "weightKg": 80.2, "bodyFatPercentage": 15.1, "muscleMassKg": null, "waistCircumferenceCm": 84 } ] }`

`from`/`to` are optional ISO 8601 dates or timestamps; a date-only `to`
includes that whole UTC day; at most 1000 points, oldest first.

Service-internal (private network only): `GET /health`, `GET /metrics`
(`Authorization: Bearer $METRICS_TOKEN`).
