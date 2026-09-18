import { db } from '../db/db';
import { ExercisesService } from './exercises.service';
import type { StorageService } from '../storage/storage.service';

// Storage is switched off in these tests: `getUrl` answers null for every key,
// which is exactly what the service sees when S3_BUCKET is unset.
const storage = {
  getUrl: jest.fn().mockResolvedValue(null),
  remove: jest.fn().mockResolvedValue(undefined),
  uploadImage: jest.fn(),
  limits: { exerciseImageMaxDimension: 1280 },
} as unknown as StorageService;

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
  const service = new ExercisesService(storage);

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
      // The object key never reaches the client; only a signed URL does.
      imageUrl: null,
      difficulty: 2,
      muscles: [
        { id: 1, name: 'Chest', commonName: 'Chest', scientificName: null },
      ],
    });
  });
});
