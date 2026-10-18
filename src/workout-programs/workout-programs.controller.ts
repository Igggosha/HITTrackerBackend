// EN: Defines authenticated program library, scheduling, sharing, media, reaction, and public token-read endpoints.
// UK: Визначає автентифіковані маршрути API бібліотеки програм, планування, поширення, медіа, реакцій і публічного читання за токеном.

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { WorkoutProgramsService } from './workout-programs.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { MinimumRole } from '../auth/minimum-role.decorator';
import {
  CreateWorkoutProgramDto,
  FindMatchingWorkoutProgramDto,
} from './dto/create-workout-program.dto';
import { UpdateWorkoutProgramDto } from './dto/update-workout-program.dto';
import {
  ListScheduleDto,
  ScheduleProgramDto,
} from './dto/schedule-program.dto';
import type { Request } from 'express';
import { MAX_IMAGE_UPLOAD_BYTES } from '../storage/storage.config';
import type { UploadedFile as UploadedImage } from '../storage/upload-validation';

@UseGuards(JwtGuard, RolesGuard)
@MinimumRole('user')
@Controller('workout-programs')
export class WorkoutProgramsController {
  // EN: Injects the feature service that enforces library, ownership, and visibility rules.
  // UK: Впроваджує сервіс функціональності, який забезпечує правила бібліотеки, власності та видимості.
  constructor(
    private readonly workoutProgramsService: WorkoutProgramsService,
  ) {}

  // EN: Lists programs visible to the authenticated user, using a consistency-aware library read.
  // UK: Повертає програми, доступні автентифікованому користувачу, через узгоджене читання бібліотеки.
  @Get()
  async getAll(@Req() request: Request) {
    return this.workoutProgramsService.getAllPrograms(
      request.user!.id!,
      request.user!.role!,
    );
  }

  // EN: Reads the user's scheduled programs for the requested calendar range.
  // UK: Читає заплановані програми користувача для запитаного календарного діапазону.
  @Get('schedule')
  async getSchedule(@Req() request: Request, @Query() query: ListScheduleDto) {
    return this.workoutProgramsService.getCalendar(request.user!.id!, query);
  }

  // EN: Finds a visible program matching the submitted exercise IDs for guided selection.
  // UK: Знаходить видиму програму за переданими ідентифікаторами вправ для вибору користувачем.
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

  // EN: Returns one program only when its visibility and the caller's access permit the read.
  // UK: Повертає програму лише якщо її видимість і права виклику дозволяють читання.
  @Get(':id')
  async getById(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.workoutProgramsService.getProgramById(
      id,
      request.user!.id!,
      request.user!.role!,
    );
  }

  // EN: Creates a personal program owned by the authenticated user.
  // UK: Створює персональну програму, власником якої є автентифікований користувач.
  @Post()
  async create(@Req() request: Request, @Body() dto: CreateWorkoutProgramDto) {
    return this.workoutProgramsService.createPersonalProgram(
      request.user!.id!,
      dto,
    );
  }

  // EN: Creates an official program; the moderator role is required by the route guard.
  // UK: Створює офіційну програму; роль модератора вимагається захистом маршруту.
  @Post('official')
  @MinimumRole('moderator')
  async createOfficial(
    @Req() request: Request,
    @Body() dto: CreateWorkoutProgramDto,
  ) {
    return this.workoutProgramsService.createOfficialProgram(
      request.user!.id!,
      dto,
    );
  }

  // EN: Adds a program to the caller's schedule while preserving role-aware access checks.
  // UK: Додає програму до розкладу викликача, зберігаючи перевірки доступу за роллю.
  @Post('schedule')
  async schedule(@Req() request: Request, @Body() dto: ScheduleProgramDto) {
    return this.workoutProgramsService.scheduleProgram(
      request.user!.id!,
      request.user!.role!,
      dto,
    );
  }

  // EN: Removes one scheduled program belonging to the authenticated user.
  // UK: Видаляє одну заплановану програму, що належить автентифікованому користувачу.
  @Delete('schedule/:id')
  async removeSchedule(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.workoutProgramsService.removeScheduledProgram(
      request.user!.id!,
      id,
    );
  }

  // EN: Copies an accessible source program into a new personal program for the caller.
  // UK: Копіює доступну програму-джерело в нову персональну програму викликача.
  @Post(':id/copy')
  async copy(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateWorkoutProgramDto,
  ) {
    return this.workoutProgramsService.copyAsPersonalProgram(
      request.user!.id!,
      request.user!.role!,
      id,
      dto,
    );
  }

  // EN: Creates a share token only for a program the caller may share.
  // UK: Створює токен поширення лише для програми, яку викликачу дозволено поширювати.
  @Post(':id/share')
  async share(@Req() request: Request, @Param('id', ParseIntPipe) id: number) {
    return this.workoutProgramsService.createShareToken(
      request.user!.id!,
      request.user!.role!,
      id,
    );
  }

  // EN: Toggles the caller's like and returns the resulting reaction state for optimistic UI updates.
  // UK: Перемикає вподобання викликача й повертає новий стан реакції для оптимістичного інтерфейсу.
  @Post(':id/like')
  async like(@Req() request: Request, @Param('id', ParseIntPipe) id: number) {
    return this.workoutProgramsService.toggleLike(
      request.user!.id!,
      request.user!.role!,
      id,
    );
  }

  // EN: Updates an owned program through the service's revision/conflict rules.
  // UK: Оновлює власну програму за правилами сервісу щодо ревізії та конфліктів.
  @Patch(':id')
  async update(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWorkoutProgramDto,
  ) {
    return this.workoutProgramsService.updateProgram(
      request.user!.id!,
      request.user!.role!,
      id,
      dto,
    );
  }

  // EN: Replaces official program media after moderator authorization and upload validation.
  // UK: Замінює медіа офіційної програми після авторизації модератора та перевірки завантаження.
  @Post(':id/image')
  @MinimumRole('moderator')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES, files: 1, fields: 0 },
    }),
  )
  uploadImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.workoutProgramsService.setImage(id, file);
  }

  // EN: Removes official program media after moderator authorization.
  // UK: Видаляє медіа офіційної програми після авторизації модератора.
  @Delete(':id/image')
  @MinimumRole('moderator')
  removeImage(@Param('id', ParseIntPipe) id: number) {
    return this.workoutProgramsService.removeImage(id);
  }
}

@Controller('shared/programs')
export class SharedWorkoutProgramsController {
  // EN: Injects the service shared by authenticated and token-based program flows.
  // UK: Впроваджує сервіс, спільний для автентифікованих потоків і потоків за токеном.
  constructor(
    private readonly workoutProgramsService: WorkoutProgramsService,
  ) {}

  // EN: Reads a shared program by UUID token without requiring authentication.
  // UK: Читає поширену програму за UUID-токеном без обов'язкової автентифікації.
  @Get(':token')
  getByToken(@Param('token', ParseUUIDPipe) token: string) {
    return this.workoutProgramsService.getSharedProgram(token);
  }

  // EN: Imports the token-resolved program into the authenticated user's personal library.
  // UK: Імпортує програму, знайдену за токеном, до персональної бібліотеки автентифікованого користувача.
  @Post(':token/import')
  @UseGuards(JwtGuard, RolesGuard)
  @MinimumRole('user')
  import(
    @Req() request: Request,
    @Param('token', ParseUUIDPipe) token: string,
  ) {
    return this.workoutProgramsService.importSharedProgram(
      request.user!.id!,
      token,
    );
  }
}
