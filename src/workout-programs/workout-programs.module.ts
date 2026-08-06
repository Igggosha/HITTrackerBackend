import { Module } from '@nestjs/common';
import { WorkoutProgramsController } from './workout-programs.controller';
import { WorkoutProgramsService } from './workout-programs.service';

@Module({
<<<<<<< Updated upstream
  controllers: [WorkoutProgramsController],
  providers: [WorkoutProgramsService],
  exports: [WorkoutProgramsService],
=======
  imports: [
    // TypeOrmModule.forFeature([
    //     Muscle
    // ]),
  ],
>>>>>>> Stashed changes
})
export class WorkoutProgramsModule {}