// EN: Boots the NestJS HTTP process, installs shared configuration, and starts listening on the configured port.
// UK: Запускає HTTP-процес NestJS, застосовує спільну конфігурацію та починає слухати налаштований порт.

import './tracing/register';
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
  app.enableShutdownHooks();
  configureApp(app);

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
