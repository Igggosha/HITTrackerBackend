import { SearchEventValidator } from './event-validator';

describe('SearchEventValidator', () => {
  const validator = new SearchEventValidator();

  it('accepts catalog v1 and rejects invalid payloads', () => {
    const event = {
      id: '00000000-0000-0000-0000-000000000001',
      type: 'catalog.program.changed',
      version: 1,
      occurredAt: '2026-09-29T10:00:00.000Z',
      aggregateType: 'program',
      aggregateId: '4',
      payload: { programId: 4, ownerId: null, change: 'upsert' },
    };
    expect(validator.validate(event)).toEqual(event);
    expect(
      validator.validate({
        ...event,
        payload: { ...event.payload, programId: '4' },
      }),
    ).toBeNull();
  });
});
