import { EventValidator, findSchemasDirectory } from './event-validator';
import { workoutFinished } from '../projections/testing/fixtures';

describe('EventValidator', () => {
  const validator = new EventValidator();

  it('loads one schema per shared (type, version)', () => {
    expect(findSchemasDirectory()).toMatch(
      /packages[\\/]event-contracts[\\/]schemas$/,
    );
    expect(validator.knownKeys).toEqual(
      expect.arrayContaining([
        'workout.finished@1',
        'user.deleted@1',
        'body_metric.recorded@1',
      ]),
    );
  });

  it('accepts a valid envelope', () => {
    const event = workoutFinished({
      workoutId: 1,
      finishedAt: '2026-09-28T10:00:00.000Z',
      sets: [{ exerciseId: 1, weight: 100, reps: 5 }],
    });
    expect(validator.validate(JSON.parse(JSON.stringify(event)))).toEqual({
      kind: 'valid',
      envelope: event,
    });
  });

  it('reports an unknown version as unknown (forward compatible), not invalid', () => {
    const event = {
      ...workoutFinished({
        workoutId: 1,
        finishedAt: '2026-09-28T10:00:00Z',
        sets: [],
      }),
      version: 2,
    };
    expect(validator.validate(event)).toEqual({
      kind: 'unknown',
      type: 'workout.finished',
      version: '2',
    });
    expect(
      validator.validate({ ...event, type: 'workout.rated', version: 1 }),
    ).toMatchObject({
      kind: 'unknown',
    });
  });

  it('rejects a payload that breaks the schema', () => {
    const event = workoutFinished({
      workoutId: 1,
      finishedAt: '2026-09-28T10:00:00Z',
      sets: [],
    });
    const broken = { ...event, payload: { ...event.payload, userId: 'seven' } };
    const result = validator.validate(broken);
    expect(result.kind).toBe('invalid');
    expect(result.kind === 'invalid' && result.error).toContain(
      '/payload/userId',
    );
    expect(validator.validate('not an object').kind).toBe('invalid');
    expect(validator.validate({ type: 'workout.finished' }).kind).toBe(
      'invalid',
    );
  });
});
