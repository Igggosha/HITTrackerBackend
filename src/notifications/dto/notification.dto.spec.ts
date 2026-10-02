import 'reflect-metadata';
import { validate } from 'class-validator';
import {
  CreateAdminNotificationDto,
  RegisterPushDeviceDto,
  UpdateNotificationPreferencesDto,
} from './notification.dto';

describe('notification DTOs', () => {
  it('requires a token when push permission is granted', async () => {
    const dto = Object.assign(new RegisterPushDeviceDto(), {
      installationId: '399cc332-6c6c-4aa6-a165-af966d6b84f7',
      platform: 'web',
      provider: 'fcm',
      permissionStatus: 'granted',
    });

    expect(await validate(dto)).not.toHaveLength(0);
    dto.token = 'token';
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts only a valid reminder time', async () => {
    const valid = Object.assign(new UpdateNotificationPreferencesDto(), {
      workoutReminderFrequency: 'scheduled',
      workoutReminderDays: [1],
      workoutReminderTime: '07:30',
      measurementReminderFrequency: 'weekly',
      measurementReminderDays: [0],
      measurementReminderTime: '18:00',
    });
    const invalid = Object.assign(new UpdateNotificationPreferencesDto(), {
      workoutReminderFrequency: 'sometimes',
      workoutReminderDays: [7],
      workoutReminderTime: '25:00',
    });

    expect(await validate(valid)).toHaveLength(0);
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('requires positive user ids for a targeted notification', async () => {
    const dto = Object.assign(new CreateAdminNotificationDto(), {
      audience: 'users',
      userIds: [0],
      category: 'general',
      title: 'Title',
      body: 'Body',
    });

    expect(await validate(dto)).not.toHaveLength(0);
    dto.userIds = [1];
    expect(await validate(dto)).toHaveLength(0);
  });

  it('allows only HTTPS notification images and links', async () => {
    const dto = Object.assign(new CreateAdminNotificationDto(), {
      audience: 'all',
      category: 'news',
      title: 'Title',
      body: 'Body',
      imageUrl: 'https://example.com/image.jpg',
      actionUrl: 'https://example.com/news',
    });

    expect(await validate(dto)).toHaveLength(0);
    dto.actionUrl = 'javascript:alert(1)';
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
