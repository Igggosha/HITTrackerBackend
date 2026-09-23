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
  UseGuards 
} from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { JwtGuard } from '../auth/jwt.guard';
import {
  FinishWorkoutDto,
  ListWorkoutHistoryDto,
  RecordSetDto,
  StartWorkoutDto,
  UpdateSetDto,
  WorkoutHistoryDatesDto,
} from './dto/workout.dto';

@UseGuards(JwtGuard)
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Get('exercise-ids')
  async getUniqueExerciseIds(@Req() req) {
    console.log('req exercise ids')
    return this.workoutsService.getUniqueExerciseIds(req.user.id);
  }
  @Get('exercise/:exerciseId/sets')
  async getUserSetsByExercise(
    @Req() req,
    @Param('exerciseId', ParseIntPipe) exerciseId: number,
  ) {
    return this.workoutsService.getUserSetsByExercise(req.user.id, exerciseId);
  }
  
  @Post('start')
  async startWorkout(@Req() req, @Body() body: StartWorkoutDto) {
    return this.workoutsService.startWorkout(req.user.id, req.user.role, body);
  }

  @Get('active')
  async getActiveWorkout(@Req() req) {
    return this.workoutsService.getActiveWorkout(req.user.id);
  }

  @Post(':id/sets')
  async recordSet(
    @Req() req, 
    @Param('id', ParseIntPipe) workoutId: number, 
    @Body() body: RecordSetDto
  ) {
    return this.workoutsService.recordSet(workoutId, req.user.id, body);
  }

  @Patch(':workoutId/sets/:setId')
  async updateSet(
    @Req() req,
    @Param('workoutId', ParseIntPipe) workoutId: number,
    @Param('setId', ParseIntPipe) setId: number,
    @Body() body: UpdateSetDto,
  ) {
    return this.workoutsService.updateSet(workoutId, setId, req.user.id, body);
  }

  @Post(':id/finish')
  async finishWorkout(
    @Req() req, 
    @Param('id', ParseIntPipe) workoutId: number, 
    @Body() body: FinishWorkoutDto
  ) {
    return this.workoutsService.finishWorkout(workoutId, req.user.id, body);
  }

  @Post(':id/pause')
  async togglePause(@Req() req, @Param('id', ParseIntPipe) workoutId: number) {
    return this.workoutsService.togglePause(workoutId, req.user.id);
  }

  @Post(':id/heartbeat')
  async heartbeat(@Req() req, @Param('id', ParseIntPipe) workoutId: number) {
    return this.workoutsService.heartbeat(workoutId, req.user.id);
  }

  @Post(':id/cancel')
  async cancelWorkout(@Req() req, @Param('id', ParseIntPipe) workoutId: number) {
    return this.workoutsService.cancelWorkout(workoutId, req.user.id);
  }

  @Get('history')
  async getHistory(@Req() req, @Query() query: ListWorkoutHistoryDto) {
    return this.workoutsService.getUserHistory(req.user.id, query);
  }

  @Get('history/dates')
  async getHistoryDates(@Req() req, @Query() query: WorkoutHistoryDatesDto) {
    return this.workoutsService.getHistoryDates(req.user.id, query);
  }

  @Get('history/:id')
  async getHistoryDetails(@Req() req, @Param('id', ParseIntPipe) workoutId: number) {
    return this.workoutsService.getHistoryDetails(req.user.id, req.user.role, workoutId);
  }

  @Delete(':id')
  async deleteWorkout(
    @Req() req,
    @Param('id', ParseIntPipe) workoutId: number,
  ) {
    return this.workoutsService.deleteWorkout(workoutId, req.user.id);
  }
}
