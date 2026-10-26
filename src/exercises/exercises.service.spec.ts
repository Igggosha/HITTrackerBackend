// EN: Verifies exercise visibility, media cleanup, stable conflicts, and the primary/secondary muscle-role contract.
// UK: Перевіряє видимість вправ, очищення медіа, стабільні конфлікти та контракт основних і допоміжних ролей м'язів.

import { db } from '../db/db';
import { ExercisesService } from './exercises.service';
import type { StorageService } from '../storage/storage.service';
import type { OutboxService } from '../outbox/outbox.service';

// Storage is switched off in these tests: `getUrl` answers null for every key,
// which is exactly what the service sees when S3_BUCKET is unset.
const storage = {
  getUrl: jest.fn().mockResolvedValue(null),
  remove: jest.fn().mockResolvedValue(undefined),
  uploadImage: jest.fn(),
  limits: { exerciseImageMaxDimension: 1280 },
} as unknown as StorageService;
const outbox = { enqueue: jest.fn() } as unknown as OutboxService;

jest.mock('../db/db', () => ({
  db: {
    delete: jest.fn(),
    insert: jest.fn(),
    select: jest.fn(),
    transaction: jest.fn(),
  },
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
  const service = new ExercisesService(storage, outbox);

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(db.transaction)
      .mockImplementation((callback: any) => callback(db as any));
  });

  it('adds one exercise like, then removes it on the next click', async () => {
    const returning = jest.fn().mockResolvedValue([]);
    jest
      .mocked(db.delete)
      .mockReturnValue({ where: jest.fn(() => ({ returning })) } as any);
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    jest.mocked(db.insert).mockReturnValue({
      values: jest.fn(() => ({ onConflictDoNothing })),
    } as any);

    await expect(service.toggleLike(7, 2)).resolves.toEqual({ isLiked: true });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);

    returning.mockResolvedValueOnce([{ userId: 7, exerciseId: 2 }]);
    await expect(service.toggleLike(7, 2)).resolves.toEqual({ isLiked: false });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it('returns public exercise details without user reaction data', async () => {
    jest
      .mocked(db.select)
      .mockReturnValueOnce(
        query([
          {
            id: 2,
            catalogKey: 'barbell_bench_press',
            name: 'Bench press',
            description: 'Press safely',
            videoUrl: null,
            imageKey: null,
            difficulty: 2,
            measurementType: 'reps',
            recommendedDurationSeconds: null,
            recommendedSets: 3,
            recommendedReps: 10,
            equipment: ['barbell', 'bench'],
            equipmentStructured: {
              required: ['bench'],
              alternatives: [['barbell']],
            },
            demonstrationImageKey: null,
            demonstrationImageSourceUrl: null,
            demonstrationImageAuthor: null,
            demonstrationImageLicense: null,
            demonstrationImageLicenseUrl: null,
            muscleId: 1,
            muscleRole: 'primary',
            muscleCommonName: 'Chest',
            scientificName: null,
          },
        ]),
      )
      .mockReturnValueOnce(
        query([
          {
            locale: 'uk',
            name: 'Жим штанги лежачи',
            description: 'Контрольовано опускайте штангу.',
            videoUrl: 'https://youtube.com/watch?v=uk',
            aliases: [],
          },
        ]),
      );

    await expect(service.getSharedExerciseById(2)).resolves.toEqual({
      id: 2,
      catalogKey: 'barbell_bench_press',
      name: 'Bench press',
      description: 'Press safely',
      videoUrl: null,
      // The object key never reaches the client; only a signed URL does.
      imageUrl: null,
      demonstrationImageUrl: null,
      demonstrationImageSourceUrl: null,
      demonstrationImageAuthor: null,
      demonstrationImageLicense: null,
      demonstrationImageLicenseUrl: null,
      difficulty: 2,
      measurementType: 'reps',
      recommendedDurationSeconds: null,
      recommendedSets: 3,
      recommendedReps: 10,
      equipment: ['barbell', 'bench'],
      equipmentStructured: {
        required: ['bench'],
        alternatives: [['barbell']],
      },
      translations: [
        {
          locale: 'uk',
          name: 'Жим штанги лежачи',
          description: 'Контрольовано опускайте штангу.',
          videoUrl: 'https://youtube.com/watch?v=uk',
          aliases: [],
        },
      ],
      muscles: [
        {
          id: 1,
          name: 'Chest',
          commonName: 'Chest',
          scientificName: null,
          role: 'primary',
        },
      ],
    });
  });

  it('builds localized media credits from exercises with stored images', async () => {
    jest
      .mocked(db.select)
      .mockReturnValueOnce(
        query([
          {
            id: 2,
            name: 'Push-Up',
            demonstrationImageKey: 'exercises/2/demo.webp',
            sourceUrl: 'https://example.test/push-up',
            author: 'Trainer',
            license: 'CC BY 4.0',
            licenseUrl: 'https://example.test/license',
          },
        ]),
      )
      .mockReturnValueOnce(
        query([
          { exerciseId: 2, locale: 'en', name: 'Push-Up' },
          { exerciseId: 2, locale: 'uk', name: 'Віджимання' },
        ]),
      );
    jest
      .mocked(storage.getUrl)
      .mockResolvedValueOnce('https://minio.test/demo');

    await expect(service.getMediaSources('uk')).resolves.toEqual([
      {
        id: 2,
        name: 'Віджимання',
        sourceUrl: 'https://example.test/push-up',
        author: 'Trainer',
        license: 'CC BY 4.0',
        licenseUrl: 'https://example.test/license',
        imageUrl: 'https://minio.test/demo',
      },
    ]);
  });
});

describe('ExercisesService concurrent creation', () => {
  const service = new ExercisesService(storage, outbox);

  it('maps a unique violation from a concurrent identical create to 409', async () => {
    // Both requests passed the name pre-check; the unique index decides.
    const limit = jest.fn().mockResolvedValue([]);
    jest.mocked(db.select).mockReturnValue({
      from: () => ({ where: () => ({ limit }) }),
    } as any);
    jest.mocked(db.transaction).mockRejectedValue({
      code: '23505',
      constraint: 'exercises_name_unique',
    });

    await expect(
      service.createExercise({ name: 'Squat' } as any),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('ExercisesService muscle roles', () => {
  const service = new ExercisesService(storage, outbox);

  it('rejects the same muscle in both role groups', async () => {
    await expect(
      service.createExercise({
        name: 'Bench press',
        primaryMuscleIds: [1],
        secondaryMuscleIds: [1],
      }),
    ).rejects.toMatchObject({
      response: { code: 'EXERCISE_MUSCLE_ROLE_CONFLICT' },
    });
  });

  it('requires both role groups for an atomic muscle PATCH', async () => {
    await expect(
      service.updateExercise(2, { primaryMuscleIds: [1] }),
    ).rejects.toMatchObject({
      response: { code: 'EXERCISE_MUSCLE_GROUPS_INCOMPLETE' },
    });
  });
});
