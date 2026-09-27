import { NestFactory } from '@nestjs/core';
import { ConsoleLogger } from '@nestjs/common';
import { RelayModule } from './relay.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(RelayModule, {
    logger: new ConsoleLogger({ json: true }),
  });
  app.enableShutdownHooks();
}
void bootstrap();
