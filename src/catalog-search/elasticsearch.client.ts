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
