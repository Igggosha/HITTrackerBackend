// EN: Exposes authenticated exercise catalog, authoring, liking, bookmarking, image, and public shared-read endpoints.
// UK: Надає автентифіковані маршрути API каталогу вправ, створення, вподобань, закладок, зображень і публічного спільного перегляду.

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ExercisesService } from './exercises.service';
import { JwtGuard } from '../auth/jwt.guard';
import type { Request } from 'express';
import { RolesGuard } from '../auth/roles.guard';
import { MinimumRole } from '../auth/minimum-role.decorator';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { UpdateExerciseDto } from './dto/update-exercise.dto';
import { MAX_IMAGE_UPLOAD_BYTES } from '../storage/storage.config';
import type { UploadedFile as UploadedImage } from '../storage/upload-validation';

@UseGuards(JwtGuard, RolesGuard)
@Controller('exercises')
export class ExercisesController {
  // EN: Injects the exercise service that owns catalog reads, mutations, reactions, and media operations.
  // UK: Впроваджує сервіс вправ, який відповідає за читання каталогу, зміни, реакції та операції з медіа.
  constructor(private readonly exercisesService: ExercisesService) {}

  // EN: Authenticated users receive the complete muscle-group catalog; the service returns the response data.
  // UK: Автентифіковані користувачі отримують повний каталог груп м'язів; сервіс повертає дані відповіді.
  @Get('muscles')
  async getMuscles() {
    return this.exercisesService.getAllMuscles();
  }

  // EN: Authenticated users receive exercises visible to their account; the JWT user id is passed to apply visibility rules.
  // UK: Автентифіковані користувачі отримують вправи, видимі їхньому обліковому запису; ідентифікатор JWT передається для правил видимості.
  @Get()
  async getExercises(@Req() req: Request) {
    const userId = req.user!.id || req.user!.userId!;
    return this.exercisesService.getAllExercises(userId);
  }

  // EN: Returns the authenticated user's exercises, optionally filtered by numeric weekday and week query values.
  // UK: Повертає вправи автентифікованого користувача з необов'язковими числовими фільтрами дня та тижня.
  @Get('foruser')
  async getExercisesForUser(
    @Req() req: Request,
    @Query('weekDay') weekDay?: string,
    @Query('week') week?: string,
  ) {
    const userId = req.user!.id || req.user!.userId!;
    return this.exercisesService.getExercisesForUser(
      userId,
      weekDay !== undefined ? Number(weekDay) : undefined,
      week !== undefined ? Number(week) : undefined,
    );
  }

  // EN: Returns one catalog exercise with the same complete detail shape used by the authenticated catalog.
  // UK: Повертає одну вправу каталогу з тією самою повною деталізацією, що й автентифікований каталог.
  @Get(':id')
  async getExerciseById(@Param('id', ParseIntPipe) id: number) {
    return this.exercisesService.getExerciseById(id);
  }

  // EN: Moderators create an exercise from the validated DTO; the service returns the created exercise or a domain error.
  // UK: Модератори створюють вправу з перевіреного DTO; сервіс повертає створену вправу або доменну помилку.
  @Post()
  @MinimumRole('moderator')
  async createExercise(@Body() body: CreateExerciseDto) {
    return this.exercisesService.createExercise(body);
  }

  // EN: Moderators update the exercise identified by the parsed numeric path id and validated DTO; the updated result is returned.
  // UK: Модератори оновлюють вправу за розібраним числовим id шляху та перевіреним DTO; повертається оновлений результат.
  @Patch(':id')
  @MinimumRole('moderator')
  async updateExercise(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateExerciseDto,
  ) {
    return this.exercisesService.updateExercise(id, body);
  }

  // EN: An authenticated user toggles their like for the parsed exercise id; the service returns the resulting like state.
  // UK: Автентифікований користувач перемикає свій лайк для вправи за розібраним id; сервіс повертає новий стан лайка.
  @Post(':id/like')
  async toggleLike(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    const userId = req.user!.id || req.user!.userId!;
    return this.exercisesService.toggleLike(userId, id);
  }

  // EN: An authenticated user toggles their bookmark for the parsed exercise id; the service returns the resulting bookmark state.
  // UK: Автентифікований користувач перемикає закладку вправи за розібраним id; сервіс повертає новий стан закладки.
  @Post(':id/bookmark')
  async bookmark(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.exercisesService.toggleBookmark(req.user!.id!, id);
  }

  // EN: Moderators upload one validated illustration for an exercise; the interceptor caps buffering and the service stores media safely.
  // UK: Модератори завантажують одну перевірену ілюстрацію вправи; інтерсептор обмежує буфер, а сервіс безпечно зберігає медіа.
  @Post(':id/image')
  @MinimumRole('moderator')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_IMAGE_UPLOAD_BYTES,
        files: 1,
        fields: 0,
      },
    }),
  )
  async uploadImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.exercisesService.setImage(id, file);
  }

  // EN: Moderators remove the exercise image identified by the parsed numeric id; the service returns the updated exercise state.
  // UK: Модератори видаляють зображення вправи за розібраним числовим id; сервіс повертає оновлений стан вправи.
  @Delete(':id/image')
  @MinimumRole('moderator')
  async removeImage(@Param('id', ParseIntPipe) id: number) {
    return this.exercisesService.removeImage(id);
  }
}

@Controller('shared/exercises')
export class SharedExercisesController {
  // EN: Injects the exercise service used to resolve publicly shareable exercise data.
  // UK: Впроваджує сервіс вправ для отримання даних вправ, доступних через публічне посилання.
  constructor(private readonly exercisesService: ExercisesService) {}

  // EN: Publicly returns only the shared-visible exercise for the parsed numeric id; authorization is intentionally not required.
  // UK: Публічно повертає лише вправу, видиму для спільного доступу, за розібраним числовим id; авторизація навмисно не потрібна.
  @Get(':id')
  getById(@Param('id', ParseIntPipe) id: number) {
    return this.exercisesService.getSharedExerciseById(id);
  }
}
