import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { JwtGuard } from '../auth/jwt.guard';
import type { Request } from "express";

@UseGuards(JwtGuard)
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get('muscles')
  async getMuscles() {
    return this.exercisesService.getAllMuscles();
  }

  @Get()
  async getExercises(@Req() req: Request) {
    const userId = (req.user as any)?.id || (req.user as any)?.userId;
    return this.exercisesService.getAllExercises(userId);
  }

  @Get("foruser")
  async getExercisesForUser(
    @Req() req: Request,
    @Query("weekDay") weekDay?: string,
    @Query("week") week?: string,
  ) {
    const userId = (req.user as any)?.id || (req.user as any)?.userId;
    return this.exercisesService.getExercisesForUser(
      userId,
      weekDay !== undefined ? Number(weekDay) : undefined,
      week !== undefined ? Number(week) : undefined,
    );
  }

  @Post()
  async createExercise(
    @Body() body: { name: string; description?: string; videoUrl?: string; difficulty?: number; muscleIds?: number[] },
  ) {
    return this.exercisesService.createExercise(body);
  }

  /**
   * Додати або видалити лайк для вправи
   */
  @Post(':id/like')
  async toggleLike(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    const userId = (req.user as any)?.id || (req.user as any)?.userId;
    return this.exercisesService.toggleLike(userId, id);
  }
}
