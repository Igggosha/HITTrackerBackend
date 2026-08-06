<<<<<<< Updated upstream
import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { WorkoutProgramsService } from './workout-programs.service';
import { JwtGuard } from '../auth/jwt.guard';
=======
import { Controller, Get } from '@nestjs/common';
import { AppService } from '../app.service';
import { WorkoutProgramsService } from './workout-programs.service';
>>>>>>> Stashed changes

@UseGuards(JwtGuard)
@Controller('workout-programs')
export class WorkoutProgramsController {
<<<<<<< Updated upstream
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
=======
  constructor(
    private readonly workoutProgramsService: WorkoutProgramsService,
  ) {}

  @Get()
  async getHello(): Promise<string> {
    return await this.workoutProgramsService.getHello();
  }
}
>>>>>>> Stashed changes
