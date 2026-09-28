import { db, primaryDb } from './db';

/**
 * Session (read-your-writes) consistency for replica reads.
 *
 * Streaming replication is asynchronous, so a plain replica select can briefly
 * return data that is stale relative to a write the same user just made.
 * Instead of routing every read to the primary (which defeats the point of
 * having a replica), we remember "this user wrote at time T" and route that
 * user's reads back to the primary only for a short window afterwards.
 *
 * This state is an in-memory `Map` local to one API process. It is bounded
 * (old entries are swept once the map grows past `MAX_TRACKED_USERS`) but it
 * is NOT shared across instances: with more than one API instance behind a
 * load balancer, a write handled by instance A and a follow-up read routed to
 * instance B would not see this. A production-grade, instance-count-agnostic
 * alternative is LSN-based waiting: have the write path capture
 * `pg_current_wal_lsn()` on the primary, and have the replica read wait (or
 * fall back to the primary) until `pg_last_wal_replay_lsn()` on the replica
 * has caught up to it. That needs a shared store (Redis, or the LSN threaded
 * through the request) to coordinate across instances; see
 * docs/diploma/read-replica.md for the full explanation.
 */

const READ_YOUR_WRITES_WINDOW_MS = (() => {
  const raw = Number(process.env.READ_YOUR_WRITES_WINDOW_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 5000;
})();

// Bounds worst-case memory: once the map grows past this many distinct users,
// expired entries are swept on the next write.
const MAX_TRACKED_USERS = 10_000;

const lastWriteAtByUserId = new Map<number, number>();

function sweepExpired(now: number): void {
  for (const [userId, writtenAt] of lastWriteAtByUserId) {
    if (now - writtenAt >= READ_YOUR_WRITES_WINDOW_MS) {
      lastWriteAtByUserId.delete(userId);
    }
  }
}

/** Call this right after a write completes for `userId`. */
export function recordWrite(userId: number, now = Date.now()): void {
  lastWriteAtByUserId.set(userId, now);
  if (lastWriteAtByUserId.size > MAX_TRACKED_USERS) {
    sweepExpired(now);
  }
}

/**
 * Returns `primaryDb` if `userId` wrote within the last
 * `READ_YOUR_WRITES_WINDOW_MS`, otherwise `db` (the replica, when configured).
 */
export function readerFor(userId: number, now = Date.now()) {
  const writtenAt = lastWriteAtByUserId.get(userId);
  if (writtenAt !== undefined && now - writtenAt < READ_YOUR_WRITES_WINDOW_MS) {
    return primaryDb;
  }
  return db;
}

/** Test-only: clears tracked write timestamps between specs. */
export function _resetReadConsistencyForTests(): void {
  lastWriteAtByUserId.clear();
}

/** Test-only: number of users currently tracked, to observe the sweep. */
export function _trackedUserCountForTests(): number {
  return lastWriteAtByUserId.size;
}
