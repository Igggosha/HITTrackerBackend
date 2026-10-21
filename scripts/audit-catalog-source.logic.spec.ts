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
        row('Face Pull', '3149:8616'),
        row('Face Pull', '3149:8777'),
        row('Жим у тренажері', '3149:8529', 'Груди', 'one'),
        row('Жим у тренажері', '3149:8735', 'Плечі', 'two'),
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
    'machine_chest_press',
    'machine_shoulder_press',
  ]);
});

it('covers every real duplicate row and produces 104 normalized exercises', () => {
  const rows = [
    row('Віджимання на брусах', '3149:8508'),
    row('Віджимання на брусах', '3156:8991'),
    row('Жим у тренажері', '3149:8529'),
    row('Жим у тренажері', '3149:8735'),
    row('Станова тяга', '3149:8602'),
    row('Станова тяга', '3165:8737'),
    row('Face Pull', '3149:8616'),
    row('Face Pull', '3149:8777'),
    row('Молоткові згинання', '3149:8890'),
    row('Молоткові згинання', '3156:9064'),
    row('Болгарські присідання', '3165:8591'),
    row('Болгарські присідання', '3165:8685'),
    row('Румунська тяга', '3165:8612'),
    row('Румунська тяга', '3165:8730'),
    row('Step-Up', '3165:8633'),
    row('Step-Up', '3165:8706'),
    ...Array.from({ length: 94 }, (_, index) =>
      row(`Unique ${index}`, `unique:${index}`),
    ),
  ];
  const result = auditSource(source(rows, ''));
  expect(result.rowCount).toBe(110);
  expect(result.distinctNameCount).toBe(102);
  expect(result.normalizedExerciseCount).toBe(104);
});

it('fails ambiguous and unresolved references', () => {
  const result = auditSource(
    source(
      [
        row('Жим у тренажері', '3149:8529'),
        row('Жим у тренажері', '3149:8735'),
      ],
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
