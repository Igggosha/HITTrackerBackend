// EN: Creates the shared Elasticsearch client and exports its NestJS injection token without embedding index-specific behavior.
// UK: Створює спільний клієнт Elasticsearch і експортує його токен NestJS без логіки, прив'язаної до конкретного індексу.

import { Client } from '@elastic/elasticsearch';

export const SEARCH_CLIENT = Symbol('SEARCH_CLIENT');

export function createSearchClient(
  username = process.env.SEARCH_READER_USERNAME,
  password = process.env.SEARCH_READER_PASSWORD,
): Client | null {
  const node = process.env.SEARCH_URL?.trim();
  if (!node) return null;
  return new Client({
    node,
    ...(username && password ? { auth: { username, password } } : {}),
    requestTimeout: Number(process.env.SEARCH_TIMEOUT_MS ?? 2_000),
    maxRetries: 1,
    enableMetaHeader: false,
  });
}
