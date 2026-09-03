import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { db } from '../db/db';
import { WorkoutProgramsService } from './workout-programs.service';
import { UpdateExerciseDto } from '../exercises/dto/update-exercise.dto';

jest.mock('../db/db', () => ({ db: { select: jest.fn(), delete: jest.fn(), insert: jest.fn() } }));

function query(rows: unknown[]) {
  const chain: any = { then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject) };
  for (const method of ['from', 'where', 'limit', 'leftJoin', 'innerJoin', 'orderBy']) chain[method] = jest.fn(() => chain);
  return chain;
}

describe('Library access and program cards', () => {
  const service = new WorkoutProgramsService();
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it.each(['moderator', 'admin', 'super_admin'] as const)('keeps another user personal program read-only for %s', async (role) => {
    jest.mocked(db.select).mockReturnValueOnce(query([{ id: 1, isPersonal: true, createdById: 7 }]));
    await expect(service.updateProgram(8, role, 1, { name: 'Changed' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not expose private program details or accept likes from another regular user', async () => {
    jest.mocked(db.select).mockReturnValueOnce(query([{ id: 1, isPersonal: true, createdById: 7 }]));
    await expect(service.toggleLike(8, 'user', 1)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('adds a program like once, then removes it on the next click', async () => {
    jest.spyOn(service, 'getProgramById').mockResolvedValue({ id: 1, schedule: [] } as any);
    const returning = jest.fn().mockResolvedValue([]);
    jest.mocked(db.delete).mockReturnValue({ where: jest.fn(() => ({ returning })) } as any);
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    jest.mocked(db.insert).mockReturnValue({ values: jest.fn(() => ({ onConflictDoNothing })) } as any);

    await expect(service.toggleLike(7, 'user', 1)).resolves.toEqual({ isLiked: true });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);

    returning.mockResolvedValueOnce([{ userId: 7, programId: 1 }]);
    await expect(service.toggleLike(7, 'user', 1)).resolves.toEqual({ isLiked: false });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it('allows assigned users to open their older official revision', async () => {
    jest.mocked(db.select)
      .mockReturnValueOnce(query([{ id: 1, isPersonal: false, isActive: false }]))
      .mockReturnValueOnce(query([{ id: 4 }]))
      .mockReturnValueOnce(query([{ exercise: { id: 2, name: 'Squat' } }]));
    await expect(service.getProgramById(1, 7, 'user')).resolves.toMatchObject({ id: 1, schedule: [{ exercise: { id: 2 } }] });
  });

  it('hides inactive revisions from unassigned users', async () => {
    jest.mocked(db.select).mockReturnValueOnce(query([{ id: 1, isPersonal: false, isActive: false }])).mockReturnValueOnce(query([]));
    await expect(service.getProgramById(1, 7, 'user')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('loads previews in one batch and keeps schedules with their own cards', async () => {
    jest.mocked(db.select)
      .mockReturnValueOnce(query([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]))
      .mockReturnValueOnce(query([{ programId: 2, exercise: { id: 9, name: 'Row' } }]));
    const programs = await service.getAllPrograms(7, 'user');
    expect(programs[0].schedule).toEqual([]);
    expect(programs[1].schedule).toEqual([{ programId: 2, exercise: { id: 9, name: 'Row' } }]);
    expect(jest.mocked(db.select).mock.calls[0][0]).toHaveProperty('isScheduled');
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('allows clearing a video link but rejects invalid nonempty URLs', async () => {
    expect(await validate(Object.assign(new UpdateExerciseDto(), { videoUrl: '' }))).toHaveLength(0);
    expect(await validate(Object.assign(new UpdateExerciseDto(), { videoUrl: 'invalid' }))).not.toHaveLength(0);
  });
});
