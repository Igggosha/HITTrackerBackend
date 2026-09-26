import { ForbiddenException } from '@nestjs/common';
import { db } from '../db/db';
import { WorkoutProgramsService } from './workout-programs.service';
import { hasSameExerciseMultiset } from './sharing.utils';

jest.mock('../db/db', () => ({
  db: {
    select: jest.fn(),
    update: jest.fn(),
  },
}));

function query(rows: unknown[]) {
  const chain: any = {
    then: (resolve: any, reject: any) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  for (const method of [
    'from',
    'where',
    'limit',
    'leftJoin',
    'innerJoin',
    'orderBy',
  ])
    chain[method] = jest.fn(() => chain);
  return chain;
}

describe('Shared workout programs', () => {
  const service = new WorkoutProgramsService({ getUrl: jest.fn().mockResolvedValue(null), getUrls: jest.fn().mockResolvedValue([]) } as any);

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it('does not let a moderator create a share token for another user personal program', async () => {
    jest.spyOn(service, 'getProgramById').mockResolvedValue({
      id: 4,
      isPersonal: true,
      createdById: 7,
      schedule: [],
    } as any);

    await expect(
      service.createShareToken(8, 'moderator', 4),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('removes the creator id from a public shared response', async () => {
    jest
      .mocked(db.select)
      .mockReturnValueOnce(
        query([
          {
            id: 4,
            name: 'Private plan',
            description: null,
            isPersonal: true,
            createdAt: new Date('2026-09-10T00:00:00Z'),
            createdById: 7,
            ownerUsername: 'owner',
          },
        ]),
      )
      .mockReturnValueOnce(query([]));

    const result = await service.getSharedProgram(
      '6eb8f447-2940-4c70-ae18-355c75ff56ed',
    );

    expect(result).toMatchObject({
      id: 4,
      ownerUsername: 'owner',
      schedule: [],
    });
    expect(result).not.toHaveProperty('createdById');
  });

  it('returns the existing personal copy instead of importing the same source twice', async () => {
    jest.spyOn(service as any, 'findSharedProgram').mockResolvedValue({
      id: 4,
      name: 'Private plan',
      description: null,
      isPersonal: true,
      createdById: 7,
    });
    jest.mocked(db.select).mockReturnValueOnce(query([{ id: 12 }]));

    await expect(
      service.importSharedProgram(8, '6eb8f447-2940-4c70-ae18-355c75ff56ed'),
    ).resolves.toEqual({
      programId: 12,
      imported: false,
      alreadyImported: true,
    });
  });

  it('returns an equivalent personal program instead of importing a duplicate composition', async () => {
    jest.spyOn(service as any, 'findSharedProgram').mockResolvedValue({
      id: 4,
      name: 'Private plan',
      description: null,
      isPersonal: true,
      createdById: 7,
    });
    jest.mocked(db.select).mockReturnValueOnce(query([]));
    jest.spyOn(service as any, 'getScheduleExercises').mockResolvedValue([
      { exerciseId: 2, sets: 3 }, { exerciseId: 4, sets: 3 }, { exerciseId: 4, sets: 3 },
    ]);
    jest.spyOn(service as any, 'findMatchingPersonalProgram').mockResolvedValue(12);

    await expect(
      service.importSharedProgram(8, '6eb8f447-2940-4c70-ae18-355c75ff56ed'),
    ).resolves.toEqual({ programId: 12, imported: false, alreadyImported: true });
  });

  it('matches exercise compositions only when every exercise and duplicate count agrees', () => {
    expect(hasSameExerciseMultiset(
      [{ exerciseId: 4 }, { exerciseId: 2 }, { exerciseId: 4 }],
      [{ exerciseId: 2 }, { exerciseId: 4 }, { exerciseId: 4 }],
    )).toBe(true);
    expect(hasSameExerciseMultiset(
      [{ exerciseId: 4 }, { exerciseId: 2 }, { exerciseId: 4 }],
      [{ exerciseId: 2 }, { exerciseId: 4 }],
    )).toBe(false);
  });
});
