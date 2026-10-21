export type ExerciseRow = {
  sourceNodeId: string;
  category: string;
  values: [string, string, string, string, string, string];
};

export type ProgramSource = { sourceNodeId: string; text: string };
export type CatalogSource = {
  fileKey: string;
  exerciseRows: ExerciseRow[];
  programSource: ProgramSource[];
};

export type DuplicateGroup = {
  name: string;
  rows: {
    sourceNodeId: string;
    category: string;
    details: ExerciseRow['values'];
  }[];
  classification: 'likely-identical' | 'conflicting-variants';
};

export type AuditResult = {
  rowCount: number;
  distinctNameCount: number;
  programCount: number;
  duplicateGroups: DuplicateGroup[];
  references: {
    reference: string;
    programIndex: number;
    programIdentity: string;
    key?: string;
    error?: string;
  }[];
};

const stableKey = (name: string, nodeId: string) => `${name}:${nodeId}`;

// EN: These aliases are deliberately explicit; this audit does not infer translations or exercise identity.
// UK: Ці псевдоніми навмисно явні; аудит не виводить переклади чи тотожність вправ.
export const NORMALIZATION_MAP: Record<string, string | string[]> = {
  'Farmer Walk': 'Фермерська хода:3156:9071',
  'Machine Chest Press': 'Жим у тренажері:3149:8529',
  'Machine Shoulder Press': 'Жим у тренажері:3149:8735',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function validateSource(value: unknown): CatalogSource {
  if (
    !isRecord(value) ||
    typeof value.fileKey !== 'string' ||
    !Array.isArray(value.exerciseRows) ||
    !Array.isArray(value.programSource)
  ) {
    throw new Error(
      'Source must contain fileKey, exerciseRows, and programSource arrays.',
    );
  }
  const rows = value.exerciseRows.map((row, index) => {
    if (
      !isRecord(row) ||
      typeof row.sourceNodeId !== 'string' ||
      typeof row.category !== 'string' ||
      !Array.isArray(row.values) ||
      row.values.length !== 6 ||
      row.values.some((v) => typeof v !== 'string')
    ) {
      throw new Error(`Invalid exercise row at index ${index}.`);
    }
    return row as unknown as ExerciseRow;
  });
  const programs = value.programSource.map((program, index) => {
    if (
      !isRecord(program) ||
      typeof program.sourceNodeId !== 'string' ||
      typeof program.text !== 'string'
    ) {
      throw new Error(`Invalid program source at index ${index}.`);
    }
    return program as unknown as ProgramSource;
  });
  return {
    fileKey: value.fileKey,
    exerciseRows: rows,
    programSource: programs,
  };
}

type ParsedReference = {
  reference: string;
  programIndex: number;
  programIdentity: string;
};

function references(program: string): ParsedReference[] {
  let current: { index: number; identity: string } = { index: 1, identity: '' };
  const result: ParsedReference[] = [];
  for (const rawLine of program.split('\n')) {
    const line = rawLine.trim();
    const heading = line.match(/^(\d+)\.\s*(.+)$/);
    if (heading) {
      current = { index: Number(heading[1]), identity: heading[2].trim() };
      continue;
    }
    if (!line || line.startsWith('Рівень:')) continue;
    result.push({
      reference: line.replace(/\s+—\s+.*$/, '').trim(),
      programIndex: current.index,
      programIdentity: current.identity,
    });
  }
  return result;
}

export function auditSource(source: CatalogSource): AuditResult {
  const byName = new Map<string, ExerciseRow[]>();
  for (const row of source.exerciseRows)
    byName.set(row.values[0], [...(byName.get(row.values[0]) || []), row]);
  const duplicateGroups = [...byName.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([name, rows]) => ({
      name,
      rows: rows.map((row) => ({
        sourceNodeId: row.sourceNodeId,
        category: row.category,
        details: row.values,
      })),
      classification:
        new Set(rows.map((row) => JSON.stringify(row.values))).size === 1
          ? ('likely-identical' as const)
          : ('conflicting-variants' as const),
    }));
  const exact = new Map(
    [...byName]
      .filter(([, rows]) => rows.length === 1)
      .map(([name, rows]) => [name, stableKey(name, rows[0].sourceNodeId)]),
  );
  for (const [alias, key] of Object.entries(NORMALIZATION_MAP))
    exact.set(alias, key as string);
  const parsedPrograms = source.programSource.flatMap((program) =>
    references(program.text),
  );
  const refs = parsedPrograms.map((reference) => {
    const mapped = exact.get(reference.reference);
    if (!mapped)
      return {
        ...reference,
        error: byName.has(reference.reference)
          ? `Ambiguous source name: ${reference.reference}`
          : `Unresolved reference: ${reference.reference}`,
      };
    return { ...reference, key: mapped };
  });
  const programCount = source.programSource.reduce(
    (count, program) =>
      count +
      program.text.split('\n').filter((line) => /^\s*\d+\.\s*.+$/.test(line))
        .length,
    0,
  );
  return {
    rowCount: source.exerciseRows.length,
    distinctNameCount: byName.size,
    programCount,
    duplicateGroups,
    references: refs,
  };
}

export function assertAudit(result: AuditResult): void {
  const failures = result.references.filter((reference) => reference.error);
  if (failures.length)
    throw new Error(
      `Catalog audit failed:\n${failures.map((failure) => `${failure.reference}: ${failure.error}`).join('\n')}`,
    );
}
