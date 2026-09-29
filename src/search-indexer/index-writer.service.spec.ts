import {
  exerciseDocuments,
  programDocuments,
  programIdsForExercise,
} from '../catalog-search/catalog-documents';
import type { EventEnvelope } from '../../packages/event-contracts/events';
import { IndexWriterService } from './index-writer.service';

jest.mock('../catalog-search/catalog-documents', () => ({
  exerciseDocuments: jest.fn(),
  programDocuments: jest.fn(),
  programIdsForExercise: jest.fn(),
}));

const programEvent = (id: string, occurredAt: string): EventEnvelope => ({
  id,
  type: 'catalog.program.changed',
  version: 1,
  occurredAt,
  aggregateType: 'program',
  aggregateId: '4',
  payload: { programId: 4, ownerId: null, change: 'upsert' },
});

describe('IndexWriterService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('upserts a full document with deterministic timestamp/id ordering', async () => {
    jest
      .mocked(programDocuments)
      .mockResolvedValue([{ id: 4, name: 'Strength', deleted: false } as any]);
    const client = { update: jest.fn().mockResolvedValue({}) };
    const service = new IndexWriterService(client as any);
    const event = programEvent(
      '00000000-0000-0000-0000-000000000002',
      '2026-09-29T10:00:00.000Z',
    );

    await service.apply(event);
    const request = client.update.mock.calls[0][0];
    expect(request.script.source).toContain('params.id.compareTo');
    expect(request.script.params).toMatchObject({
      at: event.occurredAt,
      id: event.id,
      doc: { id: 4, name: 'Strength', deleted: false },
    });
  });

  it('writes a tombstone when the authoritative row no longer exists', async () => {
    jest.mocked(exerciseDocuments).mockResolvedValue([]);
    jest.mocked(programDocuments).mockResolvedValue([]);
    const client = { update: jest.fn().mockResolvedValue({}) };
    const service = new IndexWriterService(client as any);
    await service.apply({
      ...programEvent('event-3', '2026-09-29T11:00:00.000Z'),
      type: 'catalog.exercise.changed',
      aggregateType: 'exercise',
      aggregateId: '9',
      payload: { exerciseId: 9, change: 'delete' },
    });
    expect(client.update.mock.calls[0][0].upsert).toMatchObject({
      id: 9,
      deleted: true,
    });
  });

  it('refreshes programs that embed a changed exercise', async () => {
    jest
      .mocked(exerciseDocuments)
      .mockResolvedValue([
        { id: 9, name: 'Updated exercise', deleted: false } as any,
      ]);
    jest.mocked(programIdsForExercise).mockResolvedValue([4]);
    jest
      .mocked(programDocuments)
      .mockResolvedValue([{ id: 4, name: 'Program', deleted: false } as any]);
    const client = { update: jest.fn().mockResolvedValue({}) };
    const service = new IndexWriterService(client as any);

    await service.apply({
      ...programEvent('event-4', '2026-09-29T12:00:00.000Z'),
      type: 'catalog.exercise.changed',
      aggregateType: 'exercise',
      aggregateId: '9',
      payload: { exerciseId: 9, change: 'upsert' },
    });

    expect(programIdsForExercise).toHaveBeenCalledWith(expect.anything(), 9);
    expect(client.update).toHaveBeenCalledTimes(2);
    expect(client.update.mock.calls[1][0]).toMatchObject({
      index: 'hit-programs-write',
      id: '4',
    });
  });
});
