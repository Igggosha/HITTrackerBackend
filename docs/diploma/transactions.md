# Transaction audit

**What.** Every multi-statement write in the feature services was reviewed for
races and non-atomic sequences. Real problems were fixed with a transaction plus
a row lock (`SELECT … FOR UPDATE`), an advisory lock, or a conditional
`UPDATE … WHERE <expected state>` whose affected-row count is checked.
**Why.** The mobile client retries on flaky networks and users double-tap, so
"read, decide, write" sequences really do run twice at the same time.
All writes go through `db.transaction(...)`, so they reach the primary even once
reads move to a replica.

## Operations

| Operation | Risk found | Fix / verdict |
| --- | --- | --- |
| `workouts.start` | Two starts both see "no open workout" and create two. | Per-user `pg_advisory_xact_lock(42720, userId)`; check + insert + `workout.started` in one tx. A retry returns the open workout (naturally idempotent). |
| `workouts.finish` | Two finishes both see it open: duration/notes overwritten, schedule updated twice, two events. A cancelled workout could be finished into history. Schedule update was a separate statement. | Tx + `FOR UPDATE` on the workout; re-check under lock; later finishes return "already finished" and write nothing; cancelled → 404; schedule + `workout.finished` in the same tx. |
| `workouts.cancel` | Select-then-update: a finish committing in between got flipped to `cancelled` and vanished from history. | One conditional `UPDATE … WHERE finished_at IS NULL AND status IN (active, paused) RETURNING`; no row → 404. `workout.cancelled` in the same tx. |
| `workouts.recordSet` / `updateSet` | A set could be added/edited after a concurrent finish committed, so history and the finish event disagreed. | Tx + `FOR UPDATE` on the open workout before touching sets; finish takes the same lock, so its set list is final. |
| `workouts.togglePause` | A double tap paused twice; a toggle read before a finish could set a completed workout back to `paused`/`active`. | Tx + `FOR UPDATE` on the open row. |
| `workouts.heartbeat`, auto-pause | — | Already safe: both writes are compare-and-set updates. Wrapped in a tx (no lock) for primary reads. |
| `workouts.delete` | Ownership read outside the tx. | Read moved into the tx with `FOR UPDATE`, so an in-flight finish completes first. |
| `programs.schedule` (one-off / weekly) | — (unique `(user, date, program)` + `ON CONFLICT DO NOTHING`). | Already safe; now one tx with `program.scheduled`. A retried one-off is a no-op and emits no second event. |
| `programs.removeScheduled` | Read and delete in separate statements. | Tx + `FOR UPDATE`; deletes are idempotent. |
| Calendar materialization | A series deleted between the read and the insert → FK error (500). The calendar read that followed was a plain `db.select` outside any tx, so against a read replica it could miss the rows this same request just materialized. | Tx + `FOR SHARE` on the series rows; the calendar read for the response now runs in that same tx, on the primary. |
| `programs.update` (official revision) | Two moderators editing the same revision both fork it → two active copies. | Tx + `FOR UPDATE` on the source; if it was retired meanwhile → `409 PROGRAM_REVISION_CONFLICT`. |
| `programs.update` (personal), media swaps, `createProgram` | — | Already safe: tx + `FOR UPDATE` (existing). |
| `programs.createShareToken`, `importSharedProgram` | — | Already safe: conditional `WHERE share_token IS NULL`; unique index + `23505` retry path. |
| Likes / bookmarks toggles | — | Already safe: PK + `ON CONFLICT DO NOTHING`; a concurrent double toggle converges to a valid state. |
| `exercises.create` | Two identical creates both pass the pre-check → unhandled `23505` (500). | `23505` mapped to `409`. (Case-only duplicates still pass: no `lower(name)` index; see limits.) |
| `exercises.update` | — | Already safe: one tx, `23505` → 409. |
| `users.updateRole` / `deleteUser` | Authorization decided on unlocked reads: an admin could demote someone promoted to `super_admin` a moment earlier; activity "from" role could be stale. | Tx locks actor + target (`ORDER BY id FOR UPDATE`, no deadlock) and decides on the locked roles; activity row / `user.deleted` in the same tx; avatar object removed after commit. |
| `users.updateProfile` | Profile update, weight entry and activity were three autocommits (partial writes). The profile returned to the caller was then a plain `db.select` (`getProfile`) after the tx committed — a replica read that could miss the update it is reporting on. | One tx; previous values read `FOR UPDATE`; weight entry + `body_metric.recorded` + activity inside it; `getProfile` for the response now runs inside the same tx, on the primary. |
| `users.createBodyMetric` | — | Single insert; now in a tx with `body_metric.recorded`. |
| `users.updateUsername` | The profile returned to the caller was a plain `db.select` after the tx committed (same read-after-write gap as `updateProfile`). | Already safe (advisory locks + unique index); activity moved inside the tx; `getProfile` for the response now runs inside the same tx. |
| `users.updateAvatar` / `removeAvatar` | Activity written after the tx. Same read-after-write gap: the profile response came from a `db.select` after commit. | Activity inside the key-swap tx; the profile for the response is now read inside that same tx. |
| `auth.verifyRegistration` | Parallel wrong codes all read `attempts = n`: the 5-attempt lockout could be bypassed (reproduced: 12 parallel guesses were all evaluated). | Tx + `FOR UPDATE` on the pending row; attempts, lockout and cleanup are committed, the HTTP error is thrown after commit. User + `user.registered` in the same tx. |
| `auth.register` | Upsert could reset a lockout set concurrently by a failed verification. | `ON CONFLICT DO UPDATE … WHERE locked_until IS NULL OR locked_until <= now()`; no row → 429. |
| `auth.resetPassword` | Token checked, then consumed by `id`: two concurrent resets with one link both succeeded. | Conditional update on `id + token hash + expiry`; the loser gets 400 and revokes nothing. |
| `auth.refreshSession` | — | Already safe: rotation is a conditional `UPDATE … WHERE revoked_at IS NULL AND expires_at > now() RETURNING` inside a tx. |
| `auth.exchangeMobileOAuthCode`, `revokeRefreshSession` | — | Already safe: single `DELETE/UPDATE … RETURNING`. |
| `auth.loginWithGoogle` | Link + activity were separate. The new-account branch also lacked the `23505` handling its siblings have: two concurrent first-time Google sign-ins for the same account both pass the `googleId`/email lookups and race on the insert, so the loser got a raw 500. | Link + activity in one tx; new account + `user.registered` in one tx. The loser of the insert race catches `23505` and re-reads on the primary: found by `googleId` → same identity, complete the login like the `userByGoogleId` branch; found only by email → link it, like the `userByEmail` branch; otherwise rethrow. |

## Idempotency of retry-prone mobile writes

Chosen: **natural idempotency, no `Idempotency-Key` table.** Start and finish have
an obvious "same result" (the one open workout; the stored finish), so the state
itself is the dedupe key: a retried start returns the open workout, a retried
finish returns `Workout was already finished` with the stored row. This needs no
new header in the mobile client, no TTL table and no cleanup job, and it also
covers retries whose first attempt is still running (they wait on the lock). A key
table would only add value for endpoints that create a new row per call
(`recordSet`); that is left for later.

## Demo

`src/outbox/concurrency.integration.spec.ts` fires real parallel requests at a
disposable PostgreSQL (schema from `drizzle-kit push` on a throwaway container):

```bash
docker run -d --rm --name outbox-it -e POSTGRES_PASSWORD=it -p 127.0.0.1:55433:5432 postgres:17
docker exec outbox-it psql -U postgres -c "create database it"
DATABASE_URL=postgresql://postgres:it@127.0.0.1:55433/it npx drizzle-kit push --force
export U=postgresql://postgres:it@127.0.0.1:55433/it   # the spec refuses any other DATABASE_URL
DATABASE_URL=$U CONCURRENCY_IT_DATABASE_URL=$U npx jest src/outbox/concurrency.integration.spec.ts
docker stop outbox-it
```

Against the old code, 5 parallel finishes all answered "finished successfully";
now exactly one does and one `workout.finished` event exists.

## Known limits

- `exercises.name` is unique case-sensitively only; case-variant duplicates can race.
- `recordSet` is not idempotent (a retried request adds a second set).
- Deleting a workout emits no event yet.
