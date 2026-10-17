// EN: Exposes the exact Drizzle transaction-handle type shared by domain services and OutboxService.
// UK: Надає точний тип дескриптора транзакції Drizzle, спільний для доменних сервісів і OutboxService.

import type { db } from '../db/db';

/**
 * The transaction handle drizzle passes to `db.transaction(async (tx) => ...)`.
 *
 * The root `db` object is deliberately NOT assignable to this type (it has no
 * `rollback()`), so code that requires a `DbTransaction` cannot be handed the
 * autocommit connection by mistake.
 */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
