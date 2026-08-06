import { Controller, Get, UseGuards } from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { JwtGuard } from '../auth/jwt.guard';

@UseGuards(JwtGuard)
@Controller()
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get('exercises')
  async getExercises() {
    return this.exercisesService.getAllExercises();
  }

  @Get('muscles')
  async getMuscles() {
    return this.exercisesService.getAllMuscles();
  }
}