export const BODY_METRIC_RANGES = {
  weight: { min: 20, max: 400, unit: 'kg' },
  bodyFatPercentage: { min: 2, max: 75, unit: '%' },
  muscleMass: { min: 5, max: 200, unit: 'kg' },
  waistCircumference: { min: 30, max: 250, unit: 'cm' },
} as const;

export type BodyMetricKey = keyof typeof BODY_METRIC_RANGES;
export type BodyMetricValue = number | null;

export type BodyMetricRow = {
  id: number;
  weight: BodyMetricValue;
  bodyFatPercentage: BodyMetricValue;
  muscleMass: BodyMetricValue;
  waistCircumference: BodyMetricValue;
  recordedAt: Date | string;
};

export type BodyMetricRangeDetail = {
  field: BodyMetricKey;
  code: 'OUT_OF_RANGE';
  min: number;
  max: number;
};

export function getBodyMetricRangeDetails(
  values: Partial<Record<BodyMetricKey, unknown>>,
): BodyMetricRangeDetail[] {
  return (Object.keys(BODY_METRIC_RANGES) as BodyMetricKey[]).flatMap(
    (field) => {
      const value = values[field];
      const range = BODY_METRIC_RANGES[field];
      return value !== undefined &&
        value !== null &&
        (typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < range.min ||
          value > range.max)
        ? [{ field, code: 'OUT_OF_RANGE', min: range.min, max: range.max }]
        : [];
    },
  );
}

const METRIC_KEYS = Object.keys(BODY_METRIC_RANGES) as BodyMetricKey[];

type MetricPoint = { id: number; value: number; recordedAt: string };
type MetricSummary = {
  unit: (typeof BODY_METRIC_RANGES)[BodyMetricKey]['unit'];
  latest: { value: number; recordedAt: string } | null;
  first: { value: number; recordedAt: string } | null;
  current: { value: number; recordedAt: string } | null;
  change: number | null;
  points: MetricPoint[];
};

function timestamp(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function iso(value: Date | string) {
  return new Date(value).toISOString();
}

function summaryFor(
  rows: BodyMetricRow[],
  field: BodyMetricKey,
  from: Date,
  to: Date,
): MetricSummary {
  const values = rows
    .filter(
      (row) => row[field] !== null && timestamp(row.recordedAt) <= to.getTime(),
    )
    .sort((left, right) => {
      const byTime = timestamp(left.recordedAt) - timestamp(right.recordedAt);
      return byTime || left.id - right.id;
    });
  const points = values
    .filter((row) => timestamp(row.recordedAt) >= from.getTime())
    .map((row) => ({
      id: row.id,
      value: row[field] as number,
      recordedAt: iso(row.recordedAt),
    }));
  const first = points[0] ?? null;
  const current = points.at(-1) ?? null;
  const latest = values.at(-1);
  const latestValue = latest?.[field];
  const change =
    points.length >= 2
      ? Math.round((current!.value - first.value + Number.EPSILON) * 10) / 10
      : null;

  return {
    unit: BODY_METRIC_RANGES[field].unit,
    latest:
      latest && latestValue !== null && latestValue !== undefined
        ? { value: latestValue, recordedAt: iso(latest.recordedAt) }
        : null,
    first,
    current,
    change: change === 0 ? 0 : change,
    points,
  };
}

export function aggregateBodyMetrics(
  rows: BodyMetricRow[],
  from: Date,
  to: Date,
) {
  return Object.fromEntries(
    METRIC_KEYS.map((field) => [field, summaryFor(rows, field, from, to)]),
  ) as Record<BodyMetricKey, MetricSummary>;
}
