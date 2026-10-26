import 'dotenv/config';

import { rename, readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { StorageService } from '../src/storage/storage.service';
import { readStorageConfig } from '../src/storage/storage.config';
import {
  parseMediaUploadArgs,
  uploadableEntries,
} from './catalog-media-upload.logic';

type RegistryEntry = {
  catalogKey: string;
  image: {
    status: string;
    source: string | null;
    objectKey: string | null;
    [key: string]: unknown;
  };
};
type Registry = { entries: RegistryEntry[]; [key: string]: unknown };

const registryPath = 'data/catalog/media-registry.json';
const { apply } = parseMediaUploadArgs(process.argv.slice(2));

async function saveRegistry(registry: Registry) {
  const temporaryPath = `${registryPath}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(registry, null, 2)}\n`,
    'utf8',
  );
  await rename(temporaryPath, registryPath);
}

async function main() {
  const registry = JSON.parse(await readFile(registryPath, 'utf8')) as Registry;
  const pending = uploadableEntries(registry.entries);
  if (!apply) {
    console.log(
      JSON.stringify({ mode: 'dry-run', uploadable: pending.length }, null, 2),
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const storage = new StorageService(readStorageConfig(process.env));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let uploaded = 0;
  try {
    for (const entry of pending) {
      const result = await client.query<{ id: number }>(
        'select id from exercises where catalog_key=$1',
        [entry.catalogKey],
      );
      const exerciseId = result.rows[0]?.id;
      if (!exerciseId)
        throw new Error(
          `Exercise ${entry.catalogKey} must be imported before its image.`,
        );
      const response = await fetch(entry.image.source!);
      if (!response.ok)
        throw new Error(`${response.status} ${entry.image.source}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const stored = await storage.uploadImage({
        scope: 'exercises',
        ownerId: exerciseId,
        file: {
          originalname: entry.catalogKey,
          mimetype: response.headers.get('content-type') ?? undefined,
          size: buffer.length,
          buffer,
        },
        maxDimension: storage.limits.exerciseImageMaxDimension,
      });
      entry.image.objectKey = stored.key;
      entry.image.status = 'ready';
      try {
        await saveRegistry(registry);
      } catch (error) {
        await storage.remove(stored.key);
        throw error;
      }
      uploaded += 1;
      console.log(`${entry.catalogKey}: ${stored.key}`);
    }
  } finally {
    await client.end();
  }
  console.log(JSON.stringify({ mode: 'apply', uploaded }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
