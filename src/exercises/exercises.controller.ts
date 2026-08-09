import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { JwtGuard } from '../auth/jwt.guard';

@UseGuards(JwtGuard)
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  async getExercises() {
    return this.exercisesService.getAllExercises();
  }

  @Post()
  async createExercise(
    @Body() body: { name: string; videoUrl?: string; muscleIds?: number[] },
  ) {
    return this.exercisesService.createExercise(body);
  }

  @Get('muscles')
  async getMuscles() {
    return this.exercisesService.getAllMuscles();
  }
}