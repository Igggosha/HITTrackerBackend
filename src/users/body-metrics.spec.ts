import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  aggregateBodyMetrics,
  getBodyMetricRangeDetails,
  type BodyMetricRow,
} from './body-metrics';
import {
  CreateBodyMetricDto,
  ListBodyMetricsDto,
} from './dto/body-metrics.dto';

const row = (
  id: number,
  recordedAt: string,
  values: Partial<BodyMetricRow> = {},
) => ({
  id,
  weight: null,
  bodyFatPercentage: null,
  muscleMass: null,
  waistCircumference: null,
  recordedAt: new Date(recordedAt),
  ...values,
});

describe('body metric aggregation', () => {
  const from = new Date('2026-08-20T00:00:00.000Z');
  const to = new Date('2026-08-28T23:59:59.999Z');

  it('returns all metric keys empty when there are no rows', () => {
    const result = aggregateBodyMetrics([], from, to);

    expect(Object.keys(result)).toEqual([
      'weight',
      'bodyFatPercentage',
      'muscleMass',
      'waistCircumference',
    ]);
    expect(result.weight).toMatchObject({
      unit: 'kg',
      latest: null,
      first: null,
      current: null,
      change: null,
      points: [],
    });
  });

  it('sets first/current/latest for one point without a change', () => {
    const point = row(1, '2026-08-24T10:00:00.000Z', { weight: 74.5 });

    expect(aggregateBodyMetrics([point], from, to).weight).toMatchObject({
      latest: { value: 74.5 },
      first: { value: 74.5 },
      current: { value: 74.5 },
      change: null,
      points: [{ id: 1, value: 74.5 }],
    });
  });

  it('skips null metrics, rounds change, and keeps latest outside the period', () => {
    const rows = [
      row(1, '2026-08-19T10:00:00.000Z', { weight: 75 }),
      row(2, '2026-08-21T10:00:00.000Z', {
        weight: 74.55,
        bodyFatPercentage: 20,
      }),
      row(3, '2026-08-23T10:00:00.000Z', { weight: 74.04 }),
      row(4, '2026-08-29T10:00:00.000Z', { weight: 73 }),
      row(5, '2026-08-22T10:00:00.000Z', { muscleMass: 40 }),
    ];

    const result = aggregateBodyMetrics(rows, from, to);

    expect(result.weight).toMatchObject({
      latest: { value: 74.04 },
      first: { value: 74.55 },
      current: { value: 74.04 },
      change: -0.5,
      points: [{ id: 2 }, { id: 3 }],
    });
    expect(result.bodyFatPercentage.points).toHaveLength(1);
    expect(result.muscleMass.latest).toMatchObject({ value: 40 });
    expect(result.waistCircumference.latest).toBeNull();
  });
});

describe('body metric DTOs', () => {
  it('validates metric ranges and accepts transformed numbers', async () => {
    const valid = plainToInstance(CreateBodyMetricDto, {
      weight: '74',
      bodyFatPercentage: '18.5',
      muscleMass: '40.3',
      waistCircumference: '74',
      recordedAt: '2026-08-28T09:15:00.000Z',
    });
    expect(await validate(valid)).toHaveLength(0);

    const invalid = plainToInstance(CreateBodyMetricDto, {
      weight: 19,
      bodyFatPercentage: 76,
      muscleMass: 4,
      waistCircumference: 251,
    });
    expect(await validate(invalid)).toHaveLength(4);
    expect(getBodyMetricRangeDetails(invalid)).toEqual([
      { field: 'weight', code: 'OUT_OF_RANGE', min: 20, max: 400 },
      { field: 'bodyFatPercentage', code: 'OUT_OF_RANGE', min: 2, max: 75 },
      { field: 'muscleMass', code: 'OUT_OF_RANGE', min: 5, max: 200 },
      { field: 'waistCircumference', code: 'OUT_OF_RANGE', min: 30, max: 250 },
    ]);
  });

  it('requires both period datetimes and validates ISO values', async () => {
    expect(
      await validate(plainToInstance(ListBodyMetricsDto, {})),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(ListBodyMetricsDto, {
          from: '2026-08-20T00:00:00.000Z',
          to: '2026-08-28T23:59:59.999Z',
        }),
      ),
    ).toHaveLength(0);
  });
});
