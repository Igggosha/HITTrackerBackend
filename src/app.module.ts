import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import type { Request, Response } from 'express';
import { AuthModule } from './auth/auth.module';
import { WorkoutProgramsModule } from './workout-programs/workout-programs.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { ExercisesModule } from './exercises/exercises.module';
import { UsersModule } from './users/users.module';
import { AppController } from './app.controller';
import { validateEnvironment } from './config/environment';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { requestIdMiddleware, requestIds } from './common/request-id';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req) => req.id,
        mixin: () => ({ requestId: requestIds.getStore() ?? 'system' }),
        serializers: {
          req: (req: Request) => ({
            method: req.method,
            url: req.url.split('?')[0],
          }),
          res: (res: Response) => ({ statusCode: res.statusCode }),
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers.set-cookie',
            'password',
            'token',
            'code',
            '*.password',
            '*.token',
            '*.code',
            '*.*.password',
            '*.*.token',
            '*.*.code',
          ],
          censor: '[Redacted]',
        },
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { colorize: true } },
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
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
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(requestIdMiddleware).forRoutes('*');
  }
}
