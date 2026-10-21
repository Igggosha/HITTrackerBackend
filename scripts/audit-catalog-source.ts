import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertAudit,
  auditSource,
  validateSource,
} from './audit-catalog-source.logic';

async function main() {
  const source = validateSource(
    JSON.parse(
      await readFile(resolve('data/catalog/figma-source.json'), 'utf8'),
    ),
  );
  const result = auditSource(source);
  console.log(
    JSON.stringify(
      {
        counts: {
          rows: result.rowCount,
          distinctNames: result.distinctNameCount,
          normalizedExercises: result.normalizedExerciseCount,
          programs: result.programCount,
        },
        duplicateGroups: result.duplicateGroups,
        references: result.references,
      },
      null,
      2,
    ),
  );
  assertAudit(result);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
