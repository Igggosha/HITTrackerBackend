import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { WorkoutProgramsService } from './workout-programs.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { MinimumRole } from '../auth/minimum-role.decorator';
import { CreateWorkoutProgramDto } from './dto/create-workout-program.dto';
import { UpdateWorkoutProgramDto } from './dto/update-workout-program.dto';
import type { Request } from 'express';

@UseGuards(JwtGuard, RolesGuard)
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

  @Post()
  @MinimumRole('moderator')
  async create(@Req() request: Request, @Body() dto: CreateWorkoutProgramDto) {
    return this.workoutProgramsService.createProgram(request.user!.id!, dto);
  }

  @Patch(':id')
  @MinimumRole('moderator')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkoutProgramDto) {
    return this.workoutProgramsService.updateProgram(id, dto);
  }
}
