import {
  assertAudit,
  auditSource,
  validateSource,
} from './audit-catalog-source.logic';

const row = (name: string, node = '1', category = 'A', extra = 'x') => ({
  sourceNodeId: node,
  category,
  values: [name, 'muscle', extra, 'equipment', 'level', 'details'] as [
    string,
    string,
    string,
    string,
    string,
    string,
  ],
});
const source = (rows: ReturnType<typeof row>[], text: string) =>
  validateSource({
    fileKey: 'f',
    exerciseRows: rows,
    programSource: [{ sourceNodeId: 'p', text }],
  });

it('groups exact duplicates and distinguishes conflicting fields', () => {
  const result = auditSource(
    source(
      [
        row('Same', '1'),
        row('Same', '2'),
        row('Conflict', '3', 'A', 'one'),
        row('Conflict', '4', 'B', 'two'),
      ],
      '',
    ),
  );
  expect(result.duplicateGroups.map((group) => group.classification)).toEqual([
    'likely-identical',
    'conflicting-variants',
  ]);
});

it('resolves explicit aliases and keeps the machine variants separate', () => {
  const result = auditSource(
    source(
      [
        row('Фермерська хода', '3156:9071'),
        row('Жим у тренажері', '3149:8529', 'Груди'),
        row('Жим у тренажері', '3149:8735', 'Плечі'),
      ],
      'Farmer Walk — 1\nMachine Chest Press — 1\nMachine Shoulder Press — 1',
    ),
  );
  expect(result.references.map((reference) => reference.key)).toEqual([
    'Фермерська хода:3156:9071',
    'Жим у тренажері:3149:8529',
    'Жим у тренажері:3149:8735',
  ]);
});

it('fails ambiguous and unresolved references', () => {
  const result = auditSource(
    source(
      [row('Жим у тренажері', '1'), row('Жим у тренажері', '2')],
      'Жим у тренажері — 1\nMissing — 2',
    ),
  );
  expect(result.references.every((reference) => reference.error)).toBe(true);
  expect(() => assertAudit(result)).toThrow('Catalog audit failed');
});

it('counts and attributes numbered programs within one source block', () => {
  const text = Array.from(
    { length: 20 },
    (_, index) =>
      `${index + 1}. Program ${index + 1} — Програма ${index + 1}\nРівень: 🟢 Початківець\nExercise ${index + 1} — 10`,
  ).join('\n');
  const result = auditSource(
    source(
      Array.from({ length: 20 }, (_, index) =>
        row(`Exercise ${index + 1}`, String(index + 1)),
      ),
      text,
    ),
  );

  expect(result.programCount).toBe(20);
  expect(result.references).toHaveLength(20);
  expect(result.references[0]).toMatchObject({
    programIndex: 1,
    programIdentity: 'Program 1 — Програма 1',
  });
  expect(result.references[19]).toMatchObject({
    programIndex: 20,
    programIdentity: 'Program 20 — Програма 20',
  });
});
