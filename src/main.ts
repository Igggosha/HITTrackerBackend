import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './config/configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  configureApp(app);

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
