import {
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
import { DateRangeQueryDto, WeeklyVolumeQueryDto } from './analytics.dto';
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

  @Get('exercises/:exerciseId/progress')
  exerciseProgress(
    @CurrentUser() user: AuthUser,
    @Param('exerciseId', ParseIntPipe) exerciseId: number,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.queries.exerciseProgress(user.id, exerciseId, query);
  }

  @Get('body-metrics')
  bodyMetrics(
    @CurrentUser() user: AuthUser,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.queries.bodyMetrics(user.id, query);
  }
}
