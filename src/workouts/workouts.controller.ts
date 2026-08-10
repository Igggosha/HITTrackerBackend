import { 
  Body, 
  Controller, 
  Delete, 
  Get, 
  Param, 
  ParseIntPipe, 
  Post, 
  Req, 
  UseGuards 
} from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { JwtGuard } from '../auth/jwt.guard';

@UseGuards(JwtGuard)
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Post('start')
  async startWorkout(@Req() req, @Body() body: any) {
    return this.workoutsService.startWorkout(req.user.id, body);
  }

  @Get('active')
  async getActiveWorkout(@Req() req) {
    return this.workoutsService.getActiveWorkout(req.user.id);
  }

  @Post(':id/sets')
  async recordSet(
    @Req() req, 
    @Param('id', ParseIntPipe) workoutId: number, 
    @Body() body: any
  ) {
    return this.workoutsService.recordSet(workoutId, req.user.id, body);
  }

  @Post(':id/finish')
  async finishWorkout(
    @Req() req, 
    @Param('id', ParseIntPipe) workoutId: number, 
    @Body() body: any
  ) {
    return this.workoutsService.finishWorkout(workoutId, req.user.id, body);
  }

  @Get('history')
  async getHistory(@Req() req) {
    return this.workoutsService.getUserHistory(req.user.id);
  }

  @Delete(':id')
  async deleteWorkout(
    @Req() req,
    @Param('id', ParseIntPipe) workoutId: number,
  ) {
    return this.workoutsService.deleteWorkout(workoutId, req.user.id);
  }
}