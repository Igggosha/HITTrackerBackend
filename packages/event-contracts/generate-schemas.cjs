const fs = require('node:fs');
const path = require('node:path');
const integer = { type: 'integer' }, number = { type: 'number' }, string = { type: 'string' };
const nullableInt = { type: ['integer', 'null'] }, nullableNum = { type: ['number', 'null'] };
const ints = { type: 'array', items: integer };
const fields = {
  'workout.started': { workoutId: integer, userId: integer, type: string, programId: nullableInt, scheduleId: nullableInt, plannedExerciseIds: ints, startedAt: string },
  'workout.finished': { workoutId: integer, userId: integer, programId: nullableInt, scheduleId: nullableInt, startedAt: string, finishedAt: string, durationSeconds: number, pausedSeconds: number, setCount: integer, exerciseIds: ints, totalVolume: number, sets: { type: 'array', items: { type: 'object', properties: { setId: integer, exerciseId: integer, weight: number, reps: number, rpe: nullableNum, isFailure: { type: 'boolean' }, isDropSet: { type: 'boolean' }, volume: number }, required: ['setId', 'exerciseId', 'weight', 'reps', 'rpe', 'isFailure', 'isDropSet', 'volume'], additionalProperties: false } } },
  'workout.cancelled': { workoutId: integer, userId: integer, startedAt: string, cancelledAt: string, setCount: integer },
  'program.scheduled': { userId: integer, programId: integer, scheduledFor: string, repeat: { enum: ['none', 'weekly'] }, repeatUntil: { type: ['string', 'null'] }, seriesId: nullableInt, scheduleIds: ints },
  'body_metric.recorded': { metricId: integer, userId: integer, weight: nullableNum, bodyFatPercentage: nullableNum, muscleMass: nullableNum, waistCircumference: nullableNum, recordedAt: string, source: { enum: ['body_metrics', 'profile'] } },
  'user.registered': { userId: integer, method: { enum: ['email', 'google'] }, registeredAt: string },
  'user.deleted': { userId: integer, deletedByUserId: integer, deletedAt: string },
};
const directory = path.join(__dirname, 'schemas');
fs.mkdirSync(directory, { recursive: true });
for (const [type, properties] of Object.entries(fields)) {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema', title: `${type} v1`, type: 'object',
    properties: { id: { type: 'string', format: 'uuid' }, type: { const: type }, version: { const: 1 }, occurredAt: { type: 'string', format: 'date-time' }, aggregateType: string, aggregateId: string, payload: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } },
    required: ['id', 'type', 'version', 'occurredAt', 'aggregateType', 'aggregateId', 'payload'], additionalProperties: false,
  };
  fs.writeFileSync(path.join(directory, `${type}.v1.schema.json`), `${JSON.stringify(schema, null, 2)}\n`);
}
