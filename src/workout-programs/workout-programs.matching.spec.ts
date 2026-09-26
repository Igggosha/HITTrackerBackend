import { WorkoutProgramsService } from './workout-programs.service';

describe('WorkoutProgramsService matching', () => {
  it('checks the current workout exercise multiset against personal and official programs', async () => {
    const service = new WorkoutProgramsService({ getUrl: jest.fn().mockResolvedValue(null), getUrls: jest.fn().mockResolvedValue([]) } as any);
    const find = jest.spyOn(service as any, 'findMatchingProgram')
      .mockResolvedValue(42);

    await expect(service.findMatchingProgramByExerciseIds(7, [8, 3, 8]))
      .resolves.toEqual({ programId: 42 });
    expect(find).toHaveBeenCalledWith(7, [
      { exerciseId: 8 },
      { exerciseId: 3 },
      { exerciseId: 8 },
    ], true);
  });

  it('reports no match without retaining any request-specific state', async () => {
    const service = new WorkoutProgramsService({ getUrl: jest.fn().mockResolvedValue(null), getUrls: jest.fn().mockResolvedValue([]) } as any);
    jest.spyOn(service as any, 'findMatchingProgram').mockResolvedValue(null);

    await expect(service.findMatchingProgramByExerciseIds(7, [3, 8]))
      .resolves.toEqual({ programId: null });
  });
});
