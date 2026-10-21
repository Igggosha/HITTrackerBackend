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
  normalizedExerciseCount: number;
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

type DuplicateDecision = {
  records: { key: string; sourceNodeIds: string[] }[];
};

export const DUPLICATE_DECISIONS: Record<string, DuplicateDecision> = {
  'Віджимання на брусах': {
    records: [
      { key: 'chest_dip', sourceNodeIds: ['3149:8508'] },
      { key: 'triceps_dip', sourceNodeIds: ['3156:8991'] },
    ],
  },
  'Жим у тренажері': {
    records: [
      { key: 'machine_chest_press', sourceNodeIds: ['3149:8529'] },
      { key: 'machine_shoulder_press', sourceNodeIds: ['3149:8735'] },
    ],
  },
  'Станова тяга': {
    records: [
      {
        key: 'conventional_deadlift',
        sourceNodeIds: ['3149:8602', '3165:8737'],
      },
    ],
  },
  'Face Pull': {
    records: [{ key: 'face_pull', sourceNodeIds: ['3149:8616', '3149:8777'] }],
  },
  'Молоткові згинання': {
    records: [
      { key: 'hammer_curl', sourceNodeIds: ['3149:8890', '3156:9064'] },
    ],
  },
  'Болгарські присідання': {
    records: [
      {
        key: 'bulgarian_split_squat',
        sourceNodeIds: ['3165:8591', '3165:8685'],
      },
    ],
  },
  'Румунська тяга': {
    records: [
      {
        key: 'romanian_deadlift',
        sourceNodeIds: ['3165:8612', '3165:8730'],
      },
    ],
  },
  'Step-Up': {
    records: [{ key: 'step_up', sourceNodeIds: ['3165:8633', '3165:8706'] }],
  },
};

// EN: These aliases are deliberately explicit; this audit does not infer translations or exercise identity.
// UK: Ці псевдоніми навмисно явні; аудит не виводить переклади чи тотожність вправ.
export const NORMALIZATION_MAP: Record<string, string> = {
  'Farmer Walk': 'Фермерська хода:3156:9071',
  'Machine Chest Press': 'machine_chest_press',
  'Machine Shoulder Press': 'machine_shoulder_press',
  'Румунська тяга': 'romanian_deadlift',
  'Болгарські присідання': 'bulgarian_split_squat',
  'Face Pull': 'face_pull',
  'Молоткові згинання': 'hammer_curl',
  'Підйом гантелей на біцепс': 'Підйом гантелей:3149:8883',
  'Розгинання рук на блоці': 'Розгинання на верхньому блоці:3156:8956',
  'Підйом EZ-штанги на біцепс': 'Підйом EZ-штанги:3149:8925',
  'Розгинання рук з канатом': 'Розгинання з канатом:3156:8963',
  'Підйом на носки': 'Підйом на носки стоячи:3165:8810',
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
  for (const group of duplicateGroups) {
    const decision = DUPLICATE_DECISIONS[group.name];
    if (!decision) throw new Error(`Missing duplicate decision: ${group.name}`);
    const expectedNodes = group.rows.map((row) => row.sourceNodeId).sort();
    const decidedNodes = decision.records
      .flatMap((record) => record.sourceNodeIds)
      .sort();
    if (JSON.stringify(expectedNodes) !== JSON.stringify(decidedNodes))
      throw new Error(`Duplicate decision does not cover: ${group.name}`);
  }
  const exact = new Map(
    [...byName]
      .filter(([, rows]) => rows.length === 1)
      .map(([name, rows]) => [name, stableKey(name, rows[0].sourceNodeId)]),
  );
  for (const [alias, key] of Object.entries(NORMALIZATION_MAP))
    exact.set(alias, key);
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
    normalizedExerciseCount:
      byName.size -
      duplicateGroups.length +
      duplicateGroups.reduce(
        (count, group) =>
          count + DUPLICATE_DECISIONS[group.name].records.length,
        0,
      ),
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
