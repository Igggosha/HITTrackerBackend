import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WorkoutProgramsModule } from './workout-programs/workout-programs.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    WorkoutProgramsModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}