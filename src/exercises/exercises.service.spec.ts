import { db } from '../db/db';
import { ExercisesService } from './exercises.service';

jest.mock('../db/db', () => ({
  db: { delete: jest.fn(), insert: jest.fn(), select: jest.fn() },
}));

function query(rows: unknown[]) {
  const chain: any = {
    then: (resolve: any, reject: any) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  for (const method of ['from', 'where', 'leftJoin'])
    chain[method] = jest.fn(() => chain);
  return chain;
}

describe('ExercisesService likes', () => {
  const service = new ExercisesService();

  beforeEach(() => jest.clearAllMocks());

  it('adds one exercise like, then removes it on the next click', async () => {
    const returning = jest.fn().mockResolvedValue([]);
    jest
      .mocked(db.delete)
      .mockReturnValue({ where: jest.fn(() => ({ returning })) } as any);
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    jest
      .mocked(db.insert)
      .mockReturnValue({
        values: jest.fn(() => ({ onConflictDoNothing })),
      } as any);

    await expect(service.toggleLike(7, 2)).resolves.toEqual({ isLiked: true });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);

    returning.mockResolvedValueOnce([{ userId: 7, exerciseId: 2 }]);
    await expect(service.toggleLike(7, 2)).resolves.toEqual({ isLiked: false });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it('returns public exercise details without user reaction data', async () => {
    jest.mocked(db.select).mockReturnValue(
      query([
        {
          id: 2,
          name: 'Bench press',
          description: 'Press safely',
          videoUrl: null,
          difficulty: 2,
          muscleId: 1,
          muscleCommonName: 'Chest',
          scientificName: null,
        },
      ]),
    );

    await expect(service.getSharedExerciseById(2)).resolves.toEqual({
      id: 2,
      name: 'Bench press',
      description: 'Press safely',
      videoUrl: null,
      difficulty: 2,
      muscles: [
        { id: 1, name: 'Chest', commonName: 'Chest', scientificName: null },
      ],
    });
  });
});
