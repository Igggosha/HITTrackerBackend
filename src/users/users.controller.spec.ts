import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { CreateBodyMetricDto } from './dto/body-metrics.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController body metrics', () => {
  let controller: UsersController;
  const usersService = {
    createBodyMetric: jest.fn(),
    getBodyMetrics: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();
    controller = module.get(UsersController);
    jest.clearAllMocks();
  });

  it('passes only the authenticated user id to body-metric operations', async () => {
    const request = { user: { id: 42 } } as unknown as Request;
    const createDto = { weight: 74 } as CreateBodyMetricDto;
    const listDto = {
      from: '2026-08-20T00:00:00.000Z',
      to: '2026-08-28T23:59:59.999Z',
    };
    usersService.createBodyMetric.mockResolvedValue({ id: 1 });
    usersService.getBodyMetrics.mockResolvedValue({ metrics: {} });

    await expect(
      controller.createBodyMetric(request, createDto),
    ).resolves.toEqual({ id: 1 });
    await expect(controller.getBodyMetrics(request, listDto)).resolves.toEqual({
      metrics: {},
    });
    expect(usersService.createBodyMetric).toHaveBeenCalledWith(42, createDto);
    expect(usersService.getBodyMetrics).toHaveBeenCalledWith(42, listDto);
  });
});
