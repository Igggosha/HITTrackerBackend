import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { WorkoutProgramsService } from './workout-programs.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { MinimumRole } from '../auth/minimum-role.decorator';
import { CreateWorkoutProgramDto, FindMatchingWorkoutProgramDto } from './dto/create-workout-program.dto';
import { UpdateWorkoutProgramDto } from './dto/update-workout-program.dto';
import { ListScheduleDto, ScheduleProgramDto } from './dto/schedule-program.dto';
import type { Request } from 'express';
import { MAX_IMAGE_UPLOAD_BYTES } from '../storage/storage.config';
import type { UploadedFile as UploadedImage } from '../storage/upload-validation';

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

  @Post('match')
  async findMatchingProgram(
    @Req() request: Request,
    @Body() dto: FindMatchingWorkoutProgramDto,
  ) {
    return this.workoutProgramsService.findMatchingProgramByExerciseIds(
      request.user!.id!,
      dto.exerciseIds,
    );
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

  @Post(':id/share')
  async share(@Req() request: Request, @Param('id', ParseIntPipe) id: number) {
    return this.workoutProgramsService.createShareToken(request.user!.id!, request.user!.role!, id);
  }

  @Post(':id/like')
  async like(@Req() request: Request, @Param('id', ParseIntPipe) id: number) {
    return this.workoutProgramsService.toggleLike(request.user!.id!, request.user!.role!, id);
  }

  @Patch(':id')
  async update(@Req() request: Request, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkoutProgramDto) {
    return this.workoutProgramsService.updateProgram(request.user!.id!, request.user!.role!, id, dto);
  }

  @Post(':id/image')
  @MinimumRole('moderator')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES, files: 1, fields: 0 },
  }))
  uploadImage(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: UploadedImage | undefined) {
    return this.workoutProgramsService.setImage(id, file);
  }

  @Delete(':id/image')
  @MinimumRole('moderator')
  removeImage(@Param('id', ParseIntPipe) id: number) {
    return this.workoutProgramsService.removeImage(id);
  }
}

@Controller('shared/programs')
export class SharedWorkoutProgramsController {
  constructor(private readonly workoutProgramsService: WorkoutProgramsService) {}

  @Get(':token')
  getByToken(@Param('token', ParseUUIDPipe) token: string) {
    return this.workoutProgramsService.getSharedProgram(token);
  }

  @Post(':token/import')
  @UseGuards(JwtGuard, RolesGuard)
  @MinimumRole('user')
  import(@Req() request: Request, @Param('token', ParseUUIDPipe) token: string) {
    return this.workoutProgramsService.importSharedProgram(request.user!.id!, token);
  }
}
