# Query index audit

Audit of `src/db/schema.ts`, the feature services, auth services, and the indexes on the seeded PostgreSQL 17 load-test database. `Yes` means an index existed before this migration; `Added` means `20260928120000_add_query_indexes` supplies it. PostgreSQL does not automatically index a referencing foreign key. Primary-key and unique indexes count when their **leftmost** columns match the predicate.

| Foreign-key column | Query using it | Before | Decision |
| --- | --- | --- | --- |
| `user_activity_events.user_id` | User activity list by user, newest first | Yes `(user_id, created_at)` | Keep |
| `user_activity_events.actor_user_id` | No actor filter; only nullable audit link | No | Leave; no read path |
| `username_reservations.user_id` | User deletion cascade; lookup uses `username` PK | No | Leave; small table, no user lookup |
| `oauth_login_codes.user_id` | Code lookup uses unique `code_hash`; user deletion cascade | No | Leave; short-lived rows, no user lookup |
| `auth_refresh_sessions.user_id` | Revoke all sessions for a user | Yes `(user_id)` | Keep |
| `user_body_metrics.user_id` | Timeline by user and `recorded_at` range/order | Yes `(user_id, recorded_at)` | Keep |
| `exercise_likes.user_id` | Current user's likes / toggle | Yes PK `(user_id, exercise_id)` | Keep |
| `exercise_likes.exercise_id` | Whole-table likes aggregation; exercise deletion cascade | No | Leave; aggregation reads all rows anyway |
| `exercises_train_muscles.muscle_id` | Muscle relation / cascade | Yes PK `(muscle_id, exercise_id)` | Keep |
| `exercises_train_muscles.exercise_id` | Exercise library joins; exercise deletion | No | Leave; tiny catalog, full library read |
| `workout_programs.created_by_id` | Personal program visibility `(is_personal, created_by_id)` | Yes `(is_personal, created_by_id)`; partial unique `(created_by_id, source_program_id)` for copies | Keep; added existing index definition to schema |
| `workout_programs.source_program_id` | Copy lookup by owner and source | Yes partial unique `(created_by_id, source_program_id)` | Keep; source-only deletion may scan small catalog |
| `program_likes.user_id` | Toggle / `isLiked` existence | Yes PK `(user_id, program_id)` | Keep |
| `program_likes.program_id` | `getAllPrograms` count per program | No | Added `(program_id)`; PK starts with user |
| `exercise_bookmarks.user_id` | Current user's bookmarks / toggle | Yes PK `(user_id, exercise_id)` | Keep |
| `exercise_bookmarks.exercise_id` | Exercise deletion cascade only | No | Leave; no exercise-only read |
| `program_content.program_id` | Schedule load, replace, matching, week order | No | Added `(program_id, week_number)` |
| `exercises_in_programs.program_content_id` | Schedule joins | No | Added `(program_content_id)` |
| `exercises_in_programs.exercise_id` | Exercise deletion cascade only | No | Leave; no exercise-only read |
| `users_current_workout_programs.user_id` | Current program lookup | Yes PK `(user_id)` | Keep |
| `users_current_workout_programs.program_id` | Program deletion cascade only | No | Leave; legacy one-row-per-user table |
| `user_program_schedule_series.user_id` | Weekly materialization: user and `starts_on <= to` | No | Added `(user_id, starts_on)`; `ends_on` is a residual predicate |
| `user_program_schedule_series.program_id` | Scheduled-program existence / deletion | No | Leave; existence filters user first, small per-user set |
| `user_program_schedule.user_id` | Calendar `user_id` + date range/order | Yes unique `(user_id, scheduled_for, program_id)` | Keep; added existing unique index definition to schema |
| `user_program_schedule.program_id` | Assignment existence / program deletion | No | Leave; existence filters user first |
| `user_program_schedule.series_id` | Series deletion cascade | No | Leave; materialized date windows are small; revisit if series deletion slows |
| `workouts.user_id` | Active workout, history list/date range, exercise history | No | Added `(user_id, finished_at DESC, id DESC)`; prefix covers active lookup, exact suffix matches history order and cursor tie-break |
| `workouts.program_content_id` | Program-content deletion sets link null | No | Leave; optional legacy link, no lookup |
| `workouts.schedule_id` | Calendar left join on schedule ID | No | Added `(schedule_id)` |
| `sets.workout_id` | Active/detail/list preview, finish/delete, user exercise join | No | Added `(workout_id)` |
| `sets.exercise_id` | Exercise-set history filters exercise and joins workout | No | Added `(exercise_id, workout_id)`; the first column supports the exercise filter and the second supports the join; at this seed size the planner chooses workout-driven lookups instead |

No FK exists on `outbox_events`: events outlive aggregate rows. Its existing partial `(occurred_at) WHERE published_at IS NULL` serves relay claims; `(aggregate_type, aggregate_id, occurred_at)` serves aggregate lookups. Auth's `users.email`, `users.google_id`, lowercased username, `pending_registrations.email`, `oauth_login_codes.code_hash`, and `auth_refresh_sessions.token_hash` have unique/PK indexes. Expiry cleanup has existing indexes on `pending_registrations.expires_at`, `oauth_login_codes.expires_at`, and `oauth_sessions.expire`. `users.reset_password_token` has no index for the rare password-reset lookup; it is a candidate if the users table becomes large, but this load test does not exercise that flow. `users.created_at` has no index for the admin list sort; that path is outside this measured workload. The user activity and body-metric time-order indexes already cover their list queries. The query-based SQL session store is not represented by a foreign key in `schema.ts`.

Other frequent ordering/filter patterns: workout history filters `user_id`, `status='completed'`, non-null `finished_at`, optional date range/cursor and optional keyword search, then orders `(finished_at DESC, id DESC)`. Active workout filters `user_id`, null `finished_at`, and open statuses; the new user-prefix index can find that user's rows, so a second status index is unwarranted at 150 workouts/user. History dates use the same user/date range. History details and preview filter `sets.workout_id`; details order by `sets.id` over about 17 rows, so a wider `(workout_id, id)` index has little payoff. Exercise-set history filters `sets.exercise_id` and `workouts.user_id`, then orders by workout finish time. Program catalog sorts by `(is_personal, name)` after visibility; it is small and no index was added solely for its sort. Calendar uses the existing unique assignment index's `(user_id, scheduled_for)` prefix. Keyword `LIKE '%...%'` cannot use these B-tree keys; a text-search index needs evidence from a larger catalog.

## Plans on the seeded database

`EXPLAIN (ANALYZE, BUFFERS)` on primary, 7,528 workouts and 131,270 sets, after `ANALYZE` from the seed. Same predicates before and after. User 18 has 150 completed workouts; workout 225 has 17 sets; exercise 6 returns 282 sets for that user. Timings are single warmed executions, not application latency. `history_list_sets` is the second SQL statement of the history-list endpoint. The exercises table is only 11 rows, so its own sequential scan is expected.

| SQL statement | Before, trimmed plan | After, trimmed plan |
| --- | --- | --- |
| History list, 51 workouts | `Seq Scan on workouts` (7,378 removed); sort; 107 hit buffers; **0.519 ms** | `Index Scan using workouts_user_finished_id_idx`; 1 hit + 2 read buffers; **0.092 ms** |
| History list set previews, 51 workout IDs | `Seq Scan on sets` (131,270 rows), hash semi join; 1,068 hit buffers; **13.495 ms** | 51 `Index Scan using sets_workout_id_idx` probes, 892 rows; 162 hit + 2 read buffers; **0.363 ms** |
| History dates, one-year range | `Seq Scan on workouts` (7,428 removed); 101 hit buffers; **0.421 ms** | `Bitmap Index Scan on workouts_user_finished_id_idx` + heap, 100 rows; 4 hit buffers; **0.031 ms** |
| History detail, workout 225 | `Seq Scan on sets` (131,253 removed); 967 hit buffers; **3.647 ms** | `Index Scan using sets_workout_id_idx`, 17 rows; 7 hit buffers; **0.054 ms** |
| Exercise sets, user 18 / exercise 6 | `Seq Scan on sets` (114,820 removed), `Seq Scan on workouts` (7,378 removed); 1,068 hit buffers; **5.281 ms** | `Bitmap Index Scan on workouts_user_finished_id_idx` then 150 `Index Scan using sets_workout_id_idx` probes, 282 output rows; 477 hit buffers; **0.524 ms** |

The exercise-first composite is available for exercise-selective plans, but this seeded query is cheaper when PostgreSQL starts from one user's workouts. The two sets indexes are not redundant: neither `(workout_id)` nor `(exercise_id, workout_id)` has the other's leading column. The `workouts` index supports the history order without a second `(user_id, status)` index; status remains a filter. Query-builder SQL has exactly these conditions and joins in `WorkoutsService.getUserHistory`, `getHistoryDates`, `getHistoryDetails`, and `getUserSetsByExercise`.

## Migration and deployment

`20260928120000_add_query_indexes` is additive, with `CREATE INDEX IF NOT EXISTS` for all eight indexes. It applied to the seeded, already-migrated load-test volume after `db:baseline`; the same migration is designed to apply after the dump bootstrap on a fresh volume because `sql/init.sql` does not contain these names. No `sql/init.sql` refresh or new baseline fingerprint is needed: the migration is idempotent and the dump has not jumped ahead. The two older indexes noted above were already present in existing migrations and were added only to the schema declarations.

Drizzle runs migrations inside a transaction, so `CREATE INDEX CONCURRENTLY` cannot be used here. Ordinary `CREATE INDEX` blocks writes to each affected table while building. For a large production table, build each index `CONCURRENTLY` in a separately managed, non-transactional deployment step, check completion, then record/ship the corresponding schema migration. Rollback for this additive change is `DROP INDEX` of the eight new names; no rows or constraints are removed. No rollback was executed on the load-test volume.
