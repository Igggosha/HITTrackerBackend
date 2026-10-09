import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  JwtAuthGuard,
  type AuthUser,
} from '../auth/jwt-auth.guard';
import {
  DateRangeQueryDto,
  IntensityDayQueryDto,
  MuscleGroupsQueryDto,
  RequiredDateRangeQueryDto,
  WeeklyVolumeQueryDto,
} from './analytics.dto';
import { AnalyticsQueryService } from './analytics-query.service';

/** Read API. Every route answers for the caller only (`sub` of the JWT). */
@UseGuards(JwtAuthGuard)
@Controller('analytics/me')
export class AnalyticsController {
  constructor(private readonly queries: AnalyticsQueryService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.queries.summary(user.id, new Date());
  }

  @Get('weekly-volume')
  weeklyVolume(
    @CurrentUser() user: AuthUser,
    @Query() query: WeeklyVolumeQueryDto,
  ) {
    return this.queries.weeklyVolume(user.id, query.weeks, new Date());
  }

  @Get('personal-records')
  personalRecords(@CurrentUser() user: AuthUser) {
    return this.queries.personalRecords(user.id);
  }

  @Get('overview')
  overview(
    @CurrentUser() user: AuthUser,
    @Query() query: RequiredDateRangeQueryDto,
  ) {
    return this.queries.overview(user.id, query);
  }

  @Get('intensity')
  intensity(
    @CurrentUser() user: AuthUser,
    @Query() query: IntensityDayQueryDto,
  ) {
    return this.queries.intensity(user.id, query.date);
  }

  @Get('muscle-groups')
  muscleGroups(
    @CurrentUser() user: AuthUser,
    @Query() query: MuscleGroupsQueryDto,
  ) {
    return this.queries.muscleGroups(user.id, query);
  }

  @Get('exercises/:exerciseId/progress')
  exerciseProgress(
    @CurrentUser() user: AuthUser,
    @Param('exerciseId', ParseIntPipe) exerciseId: number,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.queries.exerciseProgress(user.id, exerciseId, query);
  }

  @Get('exercises/:exerciseId/sets')
  exerciseSets(
    @CurrentUser() user: AuthUser,
    @Param('exerciseId', ParseIntPipe) exerciseId: number,
    @Query() query: RequiredDateRangeQueryDto,
  ) {
    if (exerciseId < 1)
      throw new BadRequestException('exerciseId must be a positive integer');
    return this.queries.exerciseSets(user.id, exerciseId, query);
  }

  @Get('body-metrics')
  bodyMetrics(
    @CurrentUser() user: AuthUser,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.queries.bodyMetrics(user.id, query);
  }
}
