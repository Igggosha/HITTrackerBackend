import { ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import { db } from '../db/db';
import { WorkoutProgramsService } from './workout-programs.service';
import { UpdateWorkoutProgramDto } from './dto/update-workout-program.dto';

jest.mock('../db/db', () => ({ db: { select: jest.fn() } }));

function query(rows: unknown[]) {
  const chain: any = { then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject) };
  for (const method of ['from', 'where', 'limit']) chain[method] = jest.fn(() => chain);
  return chain;
}

describe('Workout program media', () => {
  it('validates optional video URLs while allowing the explicit empty value', async () => {
    expect(await validate(Object.assign(new UpdateWorkoutProgramDto(), { videoUrl: '' }))).toHaveLength(0);
    expect(await validate(Object.assign(new UpdateWorkoutProgramDto(), { videoUrl: 'not-a-url' }))).not.toHaveLength(0);
    expect(await validate(Object.assign(new UpdateWorkoutProgramDto(), { videoUrl: 'https://youtu.be/example' }))).toHaveLength(0);
  });

  it('projects imageUrl and never leaks imageKey in shared responses', async () => {
    const storage = { getUrl: jest.fn().mockResolvedValue('https://cdn.test/program.webp') };
    const service = new WorkoutProgramsService(storage as any);
    jest.spyOn(service as any, 'findSharedProgram').mockResolvedValue({
      id: 4, name: 'Strength', description: null, isPersonal: false,
      createdAt: new Date(), createdById: 9, ownerUsername: 'mod',
      videoUrl: null, imageKey: 'uploads/programs/4/file.webp',
    });
    jest.spyOn(service as any, 'getSchedule').mockResolvedValue([]);

    await expect(service.getSharedProgram('token')).resolves.toMatchObject({
      id: 4, imageUrl: 'https://cdn.test/program.webp', videoUrl: null,
    });
    const result = await service.getSharedProgram('token');
    expect(result).not.toHaveProperty('imageKey');
  });

  it('rejects media operations for personal programs before storage access', async () => {
    jest.mocked(db.select).mockReturnValueOnce(query([{ id: 3, isPersonal: true }]));
    const storage = { uploadImage: jest.fn(), getUrl: jest.fn() };
    const service = new WorkoutProgramsService(storage as any);
    await expect(service.setImage(3, {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.uploadImage).not.toHaveBeenCalled();
  });

  it('removes a newly uploaded object when the database swap fails', async () => {
    jest.mocked(db.select).mockReturnValueOnce(query([{ id: 3, isPersonal: false }]));
    const storage = {
      limits: { exerciseImageMaxDimension: 1200 },
      uploadImage: jest.fn().mockResolvedValue({ key: 'uploads/programs/3/new.webp' }),
      remove: jest.fn(),
    };
    (db as any).transaction = jest.fn().mockRejectedValue(new Error('db failed'));
    const service = new WorkoutProgramsService(storage as any);
    await expect(service.setImage(3, {} as any)).rejects.toThrow('db failed');
    expect(storage.remove).toHaveBeenCalledWith('uploads/programs/3/new.webp');
  });

  it('replaces an image, clears video, and cleans the old object after commit', async () => {
    jest.mocked(db.select).mockReturnValueOnce(query([{ id: 3, isPersonal: false }]));
    const update = jest.fn().mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }) });
    const tx: any = {
      select: jest.fn().mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ for: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ imageKey: 'uploads/programs/3/old.webp', isPersonal: false }]) }) }) }) }),
      update,
    };
    (db as any).transaction = jest.fn((callback: any) => callback(tx));
    const storage = {
      limits: { exerciseImageMaxDimension: 1200 },
      uploadImage: jest.fn().mockResolvedValue({ key: 'uploads/programs/3/new.webp' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const service = new WorkoutProgramsService(storage as any);
    jest.spyOn(service, 'getProgramById').mockResolvedValue({ id: 3 } as any);
    await service.setImage(3, {} as any);
    expect(update.mock.results[0].value.set).toHaveBeenCalledWith({ imageKey: 'uploads/programs/3/new.webp', videoUrl: null });
    expect(storage.remove).toHaveBeenCalledWith('uploads/programs/3/old.webp');
  });
});
