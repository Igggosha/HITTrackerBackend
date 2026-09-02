import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { AuthModule } from './auth/auth.module';
import { WorkoutProgramsModule } from './workout-programs/workout-programs.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { ExercisesModule } from './exercises/exercises.module';
import { UsersModule } from './users/users.module';
import { AppController } from './app.controller';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get<string>('MAIL_HOST'),
          port: Number(config.get('MAIL_PORT')),
          secure: false,
          auth: {
            user: config.get<string>('MAIL_USER'),
            pass: config.get<string>('MAIL_PASS'),
          },
        },
        defaults: {
          from: config.get<string>('MAIL_FROM'),
        },
      }),
    }),
    AuthModule,
    WorkoutProgramsModule,
    WorkoutsModule,
    ExercisesModule,
    UsersModule,
  ],
})
export class AppModule {}
