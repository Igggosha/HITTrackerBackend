import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { WorkoutProgramsService } from './workout-programs.service';
import { JwtGuard } from '../auth/jwt.guard';

@UseGuards(JwtGuard)
@Controller('workout-programs')
export class WorkoutProgramsController {
  constructor(private readonly workoutProgramsService: WorkoutProgramsService) {}

  @Get()
  async getAll() {
    return this.workoutProgramsService.getAllPrograms();
  }

  @Get(':id')
  async getById(@Param('id', ParseIntPipe) id: number) {
    return this.workoutProgramsService.getProgramById(id);
  }
}