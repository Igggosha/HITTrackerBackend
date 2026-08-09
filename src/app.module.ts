import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { WorkoutProgramsModule } from './workout-programs/workout-programs.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { ExercisesModule } from './exercises/exercises.module';

@Module({
  imports: [
    AuthModule,
    WorkoutProgramsModule,
    WorkoutsModule,
    ExercisesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}