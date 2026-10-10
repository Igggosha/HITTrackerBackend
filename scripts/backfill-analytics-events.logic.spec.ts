import {
  BACKFILL_NAMESPACE,
  backfillEventId,
  bodyMetricRow,
  programScheduledRow,
  uuidV5,
  workoutFinishedRow,
} from './backfill-analytics-events.logic';

const workout = {
  id: 42,
  userId: 7,
  programId: null,
  scheduleId: 3,
  scheduledFor: '2026-09-01',
  startedAt: '2026-09-01T10:00:00.000Z',
  finishedAt: '2026-09-01T11:00:00.000Z',
  durationSeconds: 3000,
  sets: [
    {
      id: 1,
      exerciseId: 5,
      weight: 100,
      reps: 5,
      rpe: 8,
      isFailure: false,
      isDropSet: false,
    },
  ],
};

describe('analytics backfill', () => {
  it('implements RFC 4122 uuid v5 (known test vector)', () => {
    // uuid5(NAMESPACE_DNS, "www.example.com")
    expect(
      uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
    ).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('derives the same event id on every run, distinct per type and record', () => {
    const id = backfillEventId('workout.finished', 42);
    expect(backfillEventId('workout.finished', 42)).toBe(id);
    expect(id).toBe(uuidV5('workout.finished:42', BACKFILL_NAMESPACE));
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(backfillEventId('workout.finished', 43)).not.toBe(id);
    expect(backfillEventId('body_metric.recorded', 42)).not.toBe(id);
    expect(workoutFinishedRow(workout).id).toBe(
      backfillEventId('workout.finished.analytics-v2', 42),
    );
    expect(workoutFinishedRow(workout)).toEqual(workoutFinishedRow(workout));
  });

  it('builds the live workout.finished payload shape', () => {
    expect(workoutFinishedRow(workout)).toMatchObject({
      aggregateType: 'workout',
      aggregateId: '42',
      eventType: 'workout.finished',
      eventVersion: 1,
      occurredAt: '2026-09-01T11:00:00.000Z',
      payload: {
        workoutId: 42,
        userId: 7,
        durationSeconds: 3000,
        pausedSeconds: 600,
        setCount: 1,
        exerciseIds: [5],
        totalVolume: 500,
        sets: [{ setId: 1, exerciseId: 5, volume: 500 }],
      },
    });
  });

  it('keys body metrics by metric id and partitions them by user', () => {
    const row = bodyMetricRow({
      id: 9,
      userId: 7,
      weight: 80,
      bodyFatPercentage: null,
      muscleMass: null,
      waistCircumference: null,
      recordedAt: '2026-09-01T08:00:00.000Z',
    });
    expect(row.id).toBe(backfillEventId('body_metric.recorded', 9));
    expect(row).toMatchObject({
      aggregateType: 'user',
      aggregateId: '7',
      payload: { metricId: 9, userId: 7, source: 'body_metrics' },
    });
  });

  it('normalizes database Date values for scheduled assignments', () => {
    expect(
      programScheduledRow({
        userId: 7,
        programId: 4,
        scheduleId: 9,
        scheduledFor: new Date('2026-09-02T00:00:00.000Z'),
      }),
    ).toMatchObject({
      occurredAt: '2026-09-02T00:00:00.000Z',
      payload: {
        scheduledFor: '2026-09-02',
        assignments: [{ scheduleId: 9, scheduledFor: '2026-09-02' }],
      },
    });
  });
});
