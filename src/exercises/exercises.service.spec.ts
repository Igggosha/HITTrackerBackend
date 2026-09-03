import { db } from '../db/db';
import { ExercisesService } from './exercises.service';

jest.mock('../db/db', () => ({ db: { delete: jest.fn(), insert: jest.fn() } }));

describe('ExercisesService likes', () => {
  const service = new ExercisesService();

  beforeEach(() => jest.clearAllMocks());

  it('adds one exercise like, then removes it on the next click', async () => {
    const returning = jest.fn().mockResolvedValue([]);
    jest.mocked(db.delete).mockReturnValue({ where: jest.fn(() => ({ returning })) } as any);
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    jest.mocked(db.insert).mockReturnValue({ values: jest.fn(() => ({ onConflictDoNothing })) } as any);

    await expect(service.toggleLike(7, 2)).resolves.toEqual({ isLiked: true });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);

    returning.mockResolvedValueOnce([{ userId: 7, exerciseId: 2 }]);
    await expect(service.toggleLike(7, 2)).resolves.toEqual({ isLiked: false });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });
});
