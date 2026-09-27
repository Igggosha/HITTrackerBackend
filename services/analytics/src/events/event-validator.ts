import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type {
  OutboxEventPayloads,
  OutboxEventType,
} from '../../../../packages/event-contracts/events';

export type KnownEnvelope = {
  [T in OutboxEventType]: {
    id: string;
    type: T;
    version: 1;
    occurredAt: string;
    aggregateType: string;
    aggregateId: string;
    payload: OutboxEventPayloads[T];
  };
}[OutboxEventType];

export type ValidationResult =
  | { kind: 'valid'; envelope: KnownEnvelope }
  | { kind: 'unknown'; type: string; version: string }
  | { kind: 'invalid'; error: string };

const SCHEMA_FILE = /^(.+)\.v(\d+)\.schema\.json$/;

/**
 * Finds `packages/event-contracts/schemas` by walking up from this file. It
 * works from `src/` (tests) and from `dist/services/analytics/src/...`
 * (production image, where the schemas are copied to /app/packages/...).
 * `EVENT_SCHEMAS_DIR` overrides the search.
 */
export function findSchemasDirectory(
  start = __dirname,
  override = process.env.EVENT_SCHEMAS_DIR,
): string {
  if (override) return override;
  let directory = start;
  for (;;) {
    const candidate = path.join(
      directory,
      'packages',
      'event-contracts',
      'schemas',
    );
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory)
      throw new Error('packages/event-contracts/schemas not found');
    directory = parent;
  }
}

/**
 * Validates envelopes against the shared JSON Schemas, one per
 * (type, version). A (type, version) without a schema is `unknown`: a newer
 * producer may already emit it, so the consumer skips it instead of failing
 * (forward compatibility).
 */
export class EventValidator {
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(schemasDirectory = findSchemasDirectory()) {
    const ajv = new Ajv2020({ strict: true, allowUnionTypes: true });
    addFormats(ajv);
    for (const file of fs.readdirSync(schemasDirectory)) {
      const match = SCHEMA_FILE.exec(file);
      if (!match) continue;
      const schema = JSON.parse(
        fs.readFileSync(path.join(schemasDirectory, file), 'utf8'),
      ) as object;
      this.validators.set(`${match[1]}@${match[2]}`, ajv.compile(schema));
    }
    if (!this.validators.size)
      throw new Error(`No event schemas found in ${schemasDirectory}`);
  }

  get knownKeys(): string[] {
    return [...this.validators.keys()].sort();
  }

  validate(raw: unknown): ValidationResult {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      return { kind: 'invalid', error: 'envelope is not a JSON object' };
    const { type, version } = raw as { type?: unknown; version?: unknown };
    if (typeof type !== 'string' || !Number.isInteger(version))
      return {
        kind: 'invalid',
        error: 'envelope has no string type / integer version',
      };
    const validate = this.validators.get(`${type}@${String(version)}`);
    if (!validate) return { kind: 'unknown', type, version: String(version) };
    if (!validate(raw))
      return {
        kind: 'invalid',
        error: (validate.errors ?? [])
          .map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`)
          .join('; ')
          .slice(0, 500),
      };
    return { kind: 'valid', envelope: raw as KnownEnvelope };
  }
}
