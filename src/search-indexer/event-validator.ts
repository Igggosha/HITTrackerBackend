import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { EventEnvelope } from '../../packages/event-contracts/events';

const schemaFile = /^(.+)\.v(\d+)\.schema\.json$/;

export function findEventSchemas(start = __dirname): string {
  if (process.env.EVENT_SCHEMAS_DIR) return process.env.EVENT_SCHEMAS_DIR;
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
      throw new Error('event schemas directory not found');
    directory = parent;
  }
}

export class SearchEventValidator {
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(directory = findEventSchemas()) {
    const ajv = new Ajv2020({ strict: true, allowUnionTypes: true });
    addFormats(ajv);
    for (const file of fs.readdirSync(directory)) {
      const match = schemaFile.exec(file);
      if (!match) continue;
      const schema = JSON.parse(
        fs.readFileSync(path.join(directory, file), 'utf8'),
      ) as object;
      this.validators.set(`${match[1]}@${match[2]}`, ajv.compile(schema));
    }
  }

  validate(raw: unknown): EventEnvelope | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const { type, version } = raw as { type?: unknown; version?: unknown };
    if (typeof type !== 'string' || !Number.isInteger(version)) return null;
    const validate = this.validators.get(`${type}@${String(version)}`);
    return validate?.(raw) ? (raw as EventEnvelope) : null;
  }
}
