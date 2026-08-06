import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { WorkoutProgramsModule } from './workout-programs/workout-programs.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { ExercisesModule } from './exercises/exercises.module';

@Module({
  imports: [
<<<<<<< Updated upstream
    AuthModule,
    WorkoutProgramsModule,
    WorkoutsModule,
    ExercisesModule,
=======
    // TypeOrmModule.forRoot({
    //     type: 'mysql',
    //     host: 'localhost',
    //     port: 3306,
    //     username: 'root',
    //     password: 'root',
    //     database: 'test',
    //     entities: [],
    //     synchronize: true,
    // }),
    WorkoutProgramsModule,
    AuthModule,
>>>>>>> Stashed changes
  ],
  controllers: [AppController],
  providers: [AppService],
})
<<<<<<< Updated upstream
export class AppModule {}
=======
export class AppModule {
  constructor() {}
}
>>>>>>> Stashed changes
