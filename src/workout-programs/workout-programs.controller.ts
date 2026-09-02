import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { WorkoutProgramsService } from './workout-programs.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { MinimumRole } from '../auth/minimum-role.decorator';
import { CreateWorkoutProgramDto } from './dto/create-workout-program.dto';
import { UpdateWorkoutProgramDto } from './dto/update-workout-program.dto';
import { ListScheduleDto, ScheduleProgramDto } from './dto/schedule-program.dto';
import type { Request } from 'express';

@UseGuards(JwtGuard, RolesGuard)
@MinimumRole('user')
@Controller('workout-programs')
export class WorkoutProgramsController {
  constructor(private readonly workoutProgramsService: WorkoutProgramsService) {}

  @Get()
  async getAll(@Req() request: Request) {
    return this.workoutProgramsService.getAllPrograms(request.user!.id!, request.user!.role!);
  }

  @Get('schedule')
  async getSchedule(@Req() request: Request, @Query() query: ListScheduleDto) {
    return this.workoutProgramsService.getCalendar(request.user!.id!, query);
  }

  @Get(':id')
  async getById(@Req() request: Request, @Param('id', ParseIntPipe) id: number) {
    return this.workoutProgramsService.getProgramById(id, request.user!.id!, request.user!.role!);
  }

  @Post()
  async create(@Req() request: Request, @Body() dto: CreateWorkoutProgramDto) {
    return this.workoutProgramsService.createPersonalProgram(request.user!.id!, dto);
  }

  @Post('official')
  @MinimumRole('moderator')
  async createOfficial(@Req() request: Request, @Body() dto: CreateWorkoutProgramDto) {
    return this.workoutProgramsService.createOfficialProgram(request.user!.id!, dto);
  }

  @Post('schedule')
  async schedule(@Req() request: Request, @Body() dto: ScheduleProgramDto) {
    return this.workoutProgramsService.scheduleProgram(request.user!.id!, request.user!.role!, dto);
  }

  @Delete('schedule/:id')
  async removeSchedule(@Req() request: Request, @Param('id', ParseIntPipe) id: number) {
    await this.workoutProgramsService.removeScheduledProgram(request.user!.id!, id);
  }

  @Post(':id/copy')
  async copy(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateWorkoutProgramDto,
  ) {
    return this.workoutProgramsService.copyAsPersonalProgram(request.user!.id!, request.user!.role!, id, dto);
  }

  @Patch(':id')
  async update(@Req() request: Request, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkoutProgramDto) {
    return this.workoutProgramsService.updateProgram(request.user!.id!, request.user!.role!, id, dto);
  }
}
