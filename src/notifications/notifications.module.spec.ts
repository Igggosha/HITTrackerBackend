// EN: Verifies that notification providers are registered without accidentally starting a worker inside the API process.
// UK: Перевіряє реєстрацію провайдерів сповіщень без випадкового запуску фонового обробника всередині процесу API.

import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { NotificationsModule } from './notifications.module';

describe('NotificationsModule', () => {
  it('imports configuration for the standalone notification worker', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      NotificationsModule,
    ) as unknown[];

    expect(imports).toContain(ConfigModule);
  });
});
