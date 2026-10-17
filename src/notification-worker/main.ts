// EN: Boots the standalone notification worker, validates its environment, enables graceful shutdown, and starts delivery polling.
// UK: Запускає окремий процес обробки сповіщень, перевіряє середовище, вмикає коректне завершення та починає опитування доставок.

import '../tracing/register';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { validateFirebaseEnvironment } from '../firebase/firebase.config';
import { NotificationWorkerModule } from './notification-worker.module';

async function bootstrap() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  validateFirebaseEnvironment(process.env);
  const app = await NestFactory.createApplicationContext(
    NotificationWorkerModule,
    { logger: new ConsoleLogger({ json: true }) },
  );
  app.enableShutdownHooks();
}
void bootstrap();
