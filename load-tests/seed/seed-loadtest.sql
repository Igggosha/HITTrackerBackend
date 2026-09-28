-- Deterministic load-test data, loaded straight into the PRIMARY (the replica
-- receives it through streaming replication). Only for the throwaway
-- `loadtest` Compose project; never run it against real data.
--
--   psql -v users=50 -v workouts=150 -f load-tests/seed/seed-loadtest.sql
--
-- Creates :users users lt001..ltNNN@loadtest.example.com (password
-- `LoadTest!2026`, bcrypt cost 10, so they log in through the real
-- POST /auth/login), each with :workouts completed workouts spread evenly over
-- the last 18 months (5 exercises x 3-4 sets = 15-20 sets per workout,
-- slowly progressing weights) and one body-metric entry per week.
-- Every value is a pure function of (user, workout, exercise, set) indices,
-- so two runs on the same day produce the same data; only the calendar
-- anchor (today) moves. Re-running replaces the previous load-test users.
\if :{?users}
\else
  \set users 50
\endif
\if :{?workouts}
\else
  \set workouts 150
\endif

BEGIN;

-- ON DELETE CASCADE removes their workouts, sets and body metrics.
DELETE FROM users WHERE email LIKE 'lt%@loadtest.example.com';

CREATE TEMP TABLE lt_exercises ON COMMIT DROP AS
SELECT row_number() OVER (ORDER BY e.id) - 1 AS idx, e.id, v.base_kg
FROM (VALUES
  ('Barbell Bench Press', 60.0), ('Incline Dumbbell Press', 22.5),
  ('Pull-ups', 0.0), ('Lat Pulldown', 50.0),
  ('Barbell Back Squat', 80.0), ('Romanian Deadlift', 70.0),
  ('Overhead Press', 40.0), ('Conventional Deadlift', 100.0)
) AS v(name, base_kg)
JOIN exercises e ON e.name = v.name;

DO $$
BEGIN
  IF (SELECT count(*) FROM lt_exercises) <> 8 THEN
    RAISE EXCEPTION 'seed.sql exercises missing; run the stack (seed service) first';
  END IF;
END $$;

CREATE TEMP TABLE lt_users ON COMMIT DROP AS
WITH inserted AS (
  INSERT INTO users (email, display_name, password_hash, role, created_at)
  SELECT format('lt%s@loadtest.example.com', lpad(u::text, 3, '0')),
         format('Load Test %s', u),
         -- bcrypt('LoadTest!2026', cost 10)
         '$2b$10$slM66jej.EpbI7JsL.r6euTW8lfAx2hEsXfvbRSBZMYcielYp9LJa',
         'user',
         (now() AT TIME ZONE 'utc') - interval '19 months'
  FROM generate_series(1, :users) AS u
  RETURNING id, email
)
SELECT id, substring(email FROM 3 FOR 3)::int AS u FROM inserted;

-- Workout k of user u: every 548/:workouts days, finished between 17:00 and
-- 19:59 UTC, 45-75 minutes long; the newest is at least one day old.
CREATE TEMP TABLE lt_workouts ON COMMIT DROP AS
SELECT lu.id AS user_id, lu.u, k,
       (date_trunc('day', now() AT TIME ZONE 'utc') - interval '549 days'
         + make_interval(days => (k * 548) / :workouts)
         + make_interval(mins => 17 * 60 + (lu.u * 37 + k * 53) % 180)) AS finished_at,
       45 * 60 + ((lu.u * 11 + k * 7) % 31) * 60 AS duration_seconds
FROM lt_users lu, generate_series(0, :workouts - 1) AS k;

CREATE TEMP TABLE lt_workout_ids ON COMMIT DROP AS
WITH inserted AS (
  INSERT INTO workouts (user_id, type, status, notes, duration_seconds,
                        finished_at, created_at, last_activity_at, paused_seconds)
  SELECT user_id, 'HIT Session', 'completed', '', duration_seconds,
         finished_at,
         finished_at - make_interval(secs => duration_seconds),
         finished_at, 0
  FROM lt_workouts
  ORDER BY user_id, k
  RETURNING id, user_id, finished_at
)
SELECT i.id, w.u, w.k
FROM inserted i
JOIN lt_workouts w ON w.user_id = i.user_id AND w.finished_at = i.finished_at;

-- 5 of the 8 exercises per workout (rotating), 3 or 4 sets each.
INSERT INTO sets (workout_id, exercise_id, weight, reps, is_failure, is_drop_set, rpe)
SELECT w.id, e.id,
       round(((e.base_kg + (w.u % 5) * 2.5) * (1 + 0.25 * w.k / :workouts)) / 2.5) * 2.5,
       6 + (w.u * 3 + w.k + j + s) % 7,
       s = n_sets - 1,
       false,
       least(10, 7 + s)
FROM lt_workout_ids w
CROSS JOIN generate_series(0, 4) AS j
JOIN lt_exercises e ON e.idx = (w.k + j * 3) % 8
CROSS JOIN LATERAL (SELECT 3 + (w.u + w.k + j) % 2 AS n_sets) n
CROSS JOIN LATERAL generate_series(0, n.n_sets - 1) AS s
ORDER BY w.id, j, s;

-- One body-metric entry per week over the same 18 months.
INSERT INTO user_body_metrics (user_id, weight, body_fat_percentage, muscle_mass,
                               waist_circumference, recorded_at)
SELECT lu.id,
       round((75 + lu.u % 20 - 0.03 * wk)::numeric, 1)::real,
       round((22 - 0.05 * wk + (lu.u % 3))::numeric, 1)::real,
       round((33 + 0.02 * wk)::numeric, 1)::real,
       CASE WHEN wk % 4 = 0 THEN round((90 - 0.04 * wk)::numeric, 1)::real END,
       date_trunc('day', now() AT TIME ZONE 'utc') - interval '548 days'
         + make_interval(days => wk * 7, hours => 7)
FROM lt_users lu, generate_series(0, 77) AS wk;

COMMIT;

ANALYZE users;
ANALYZE workouts;
ANALYZE sets;
ANALYZE user_body_metrics;

SELECT count(DISTINCT u.id) AS users,
       count(DISTINCT w.id) AS workouts,
       count(s.id) AS sets
FROM users u
JOIN workouts w ON w.user_id = u.id
JOIN sets s ON s.workout_id = w.id
WHERE u.email LIKE 'lt%@loadtest.example.com';
