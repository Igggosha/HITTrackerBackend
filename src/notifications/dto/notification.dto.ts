import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';

export const notificationCategories = [
  'general',
  'workout',
  'measurements',
  'achievements',
  'news',
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];
export const reminderFrequencies = [
  'daily',
  'every_other_day',
  'weekly',
  'twice_weekly',
  'hourly',
] as const;

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  generalEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  workoutRemindersEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  measurementRemindersEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  achievementsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  newsEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  reminderTime?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  reminderDays?: number[];

  @IsOptional()
  @IsIn(['scheduled', ...reminderFrequencies])
  workoutReminderFrequency?: 'scheduled' | (typeof reminderFrequencies)[number];

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  workoutReminderTime?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workoutReminderDays?: number[];

  @IsOptional()
  @IsIn(reminderFrequencies)
  measurementReminderFrequency?: (typeof reminderFrequencies)[number];

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  measurementReminderTime?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  measurementReminderDays?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timeZone?: string | null;
}

export class RegisterPushDeviceDto {
  @IsUUID('4')
  installationId!: string;

  @IsIn(['android', 'ios', 'web'])
  platform!: 'android' | 'ios' | 'web';

  @IsIn(['fcm', 'expo'])
  provider!: 'fcm' | 'expo';

  @IsIn(['unknown', 'granted', 'denied'])
  permissionStatus!: 'unknown' | 'granted' | 'denied';

  @ValidateIf(
    (dto: RegisterPushDeviceDto) => dto.permissionStatus === 'granted',
  )
  @IsString()
  @MaxLength(4096)
  token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  osVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  appVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timeZone?: string;
}

export class ListNotificationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}

export class CreateAdminNotificationDto {
  @IsIn(['all', 'users'])
  audience!: 'all' | 'users';

  @ValidateIf((dto: CreateAdminNotificationDto) => dto.audience === 'users')
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  userIds?: number[];

  @IsIn(notificationCategories)
  category!: NotificationCategory;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  body?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  imageUrl?: string;

  @IsOptional()
  @IsUUID('4')
  imageMediaId?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  videoUrl?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  actionUrl?: string;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/)
  scheduledLocalAt?: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  dedupeKey?: string;
}
