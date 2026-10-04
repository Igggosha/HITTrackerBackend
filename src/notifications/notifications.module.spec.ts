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
