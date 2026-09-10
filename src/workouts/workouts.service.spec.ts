import { db } from '../db/db';
import { WorkoutsService } from './workouts.service';

jest.mock('../db/db', () => ({ db: { select: jest.fn() } }));

describe('WorkoutsService getUserSetsByExercise', () => {
  const service = new WorkoutsService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns all of one user’s logged sets for the requested exercise', async () => {
    const query = {
      from: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockResolvedValue([
        {
          set: { id: 1, workoutId: 41, exerciseId: 10, weight: 100, reps: 5, isFailure: false, isDropSet: false, rpe: 8 },
          exercise: { id: 10, name: 'Squat' },
          workout: { id: 41, userId: 3 },
        },
      ]),
    };

    jest.mocked(db.select).mockReturnValue(query as any);

    await expect(service.getUserSetsByExercise(3, 10)).resolves.toEqual([
      {
        id: 1,
        workoutId: 41,
        exerciseId: 10,
        weight: 100,
        reps: 5,
        isFailure: false,
        isDropSet: false,
        rpe: 8,
        exerciseName: 'Squat',
      },
    ]);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledTimes(1);
    expect(query.orderBy).toHaveBeenCalledTimes(1);
  });

  it('returns every distinct exercise id from that user’s logged sets', async () => {
    const query = {
      from: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([
        { exerciseId: 10 },
        { exerciseId: 10 },
        { exerciseId: 11 },
      ]),
    };

    jest.mocked(db.select).mockReturnValue(query as any);

    await expect(service.getUniqueExerciseIds(3)).resolves.toEqual([10, 11]);
  });
});
