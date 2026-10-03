import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const userRoles = [
  'user',
  'helper',
  'moderator',
  'admin',
  'super_admin',
] as const;

export type UserRole = (typeof userRoles)[number];

// ================= USERS =================

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    email: text('email').notNull().unique(),
    username: text('username'),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash'),
    googleId: text('google_id').unique(),
    role: text('role').$type<UserRole>().notNull().default('user'),
    isSystemOwner: boolean('is_system_owner').notNull().default(false),

    // Password Reset
    resetPasswordToken: text('reset_password_token'),
    resetPasswordExpires: timestamp('reset_password_expires'),

    // Profile
    age: integer('age'),
    gender: text('gender'),
    height: real('height'),
    goal: text('goal'),

    // Object storage key of the avatar. The bucket is private, so the API
    // hands clients a short-lived presigned URL built from this key.
    avatarKey: text('avatar_key'),
    lastSeenAt: timestamp('last_seen_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_username_lower_unique')
      .on(sql`lower(${table.username})`)
      .where(sql`${table.username} is not null`),
    uniqueIndex('users_single_system_owner_unique')
      .on(table.isSystemOwner)
      .where(sql`${table.isSystemOwner} = true`),
    check(
      'users_system_owner_role_check',
      sql`not ${table.isSystemOwner} or ${table.role} = 'super_admin'`,
    ),
  ],
);

export type UserActivityMetadata = Record<string, unknown>;

export const userActivityEvents = pgTable(
  'user_activity_events',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actorUserId: integer('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    metadata: jsonb('metadata')
      .$type<UserActivityMetadata>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('user_activity_events_user_created_idx').on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const usernameReservations = pgTable('username_reservations', {
  username: text('username').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  reservedUntil: timestamp('reserved_until').notNull(),
});

export const oauthLoginCodes = pgTable('oauth_login_codes', {
  id: serial('id').primaryKey(),
  codeHash: text('code_hash').notNull().unique(),
  codeChallenge: text('code_challenge').notNull(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
});

// Refresh tokens are opaque credentials; only their SHA-256 hashes are persisted.
export const authRefreshSessions = pgTable(
  'auth_refresh_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('auth_refresh_sessions_user_id_idx').on(table.userId)],
);

// A client-generated installation ID can recur across accounts on one device.
// The push token is encrypted by the API; only its digest is used for lookup.
export const pushDevices = pgTable(
  'push_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    installationId: uuid('installation_id').notNull(),
    platform: text('platform').$type<'android' | 'ios' | 'web'>().notNull(),
    provider: text('provider').$type<'fcm' | 'expo'>().notNull().default('fcm'),
    deviceModel: text('device_model'),
    osVersion: text('os_version'),
    appVersion: text('app_version'),
    locale: text('locale'),
    timeZone: text('time_zone'),
    permissionStatus: text('permission_status')
      .$type<'unknown' | 'granted' | 'denied'>()
      .notNull()
      .default('unknown'),
    tokenHash: text('token_hash'),
    tokenCiphertext: text('token_ciphertext'),
    tokenUpdatedAt: timestamp('token_updated_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('push_devices_user_installation_unique').on(
      table.userId,
      table.installationId,
    ),
    uniqueIndex('push_devices_id_user_unique').on(table.id, table.userId),
    uniqueIndex('push_devices_active_token_hash_unique')
      .on(table.tokenHash)
      .where(
        sql`${table.tokenHash} is not null and ${table.revokedAt} is null`,
      ),
    index('push_devices_installation_id_idx').on(table.installationId),
    check(
      'push_devices_platform_check',
      sql`${table.platform} in ('android', 'ios', 'web')`,
    ),
    check(
      'push_devices_provider_check',
      sql`${table.provider} in ('fcm', 'expo')`,
    ),
    check(
      'push_devices_permission_status_check',
      sql`${table.permissionStatus} in ('unknown', 'granted', 'denied')`,
    ),
    check(
      'push_devices_token_pair_check',
      sql`(${table.tokenHash} is null) = (${table.tokenCiphertext} is null)`,
    ),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: integer('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    pushEnabled: boolean('push_enabled').notNull().default(true),
    generalEnabled: boolean('general_enabled').notNull().default(true),
    workoutRemindersEnabled: boolean('workout_reminders_enabled')
      .notNull()
      .default(true),
    measurementRemindersEnabled: boolean('measurement_reminders_enabled')
      .notNull()
      .default(true),
    achievementsEnabled: boolean('achievements_enabled')
      .notNull()
      .default(true),
    newsEnabled: boolean('news_enabled').notNull().default(true),
    reminderTime: time('reminder_time'),
    reminderDays: integer('reminder_days')
      .array()
      .notNull()
      .default(sql`ARRAY[1,2,3,4,5]::integer[]`),
    workoutReminderFrequency: text('workout_reminder_frequency')
      .$type<
        | 'scheduled'
        | 'daily'
        | 'every_other_day'
        | 'weekly'
        | 'twice_weekly'
        | 'hourly'
      >()
      .notNull()
      .default('scheduled'),
    workoutReminderTime: time('workout_reminder_time')
      .notNull()
      .default('18:00:00'),
    workoutReminderDays: integer('workout_reminder_days')
      .array()
      .notNull()
      .default(sql`ARRAY[1]::integer[]`),
    measurementReminderFrequency: text('measurement_reminder_frequency')
      .$type<
        'daily' | 'every_other_day' | 'weekly' | 'twice_weekly' | 'hourly'
      >()
      .notNull()
      .default('weekly'),
    measurementReminderTime: time('measurement_reminder_time')
      .notNull()
      .default('18:00:00'),
    measurementReminderDays: integer('measurement_reminder_days')
      .array()
      .notNull()
      .default(sql`ARRAY[0]::integer[]`),
    timeZone: text('time_zone'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'notification_preferences_reminder_days_check',
      sql`cardinality(${table.reminderDays}) between 1 and 7 and ${table.reminderDays} <@ ARRAY[0,1,2,3,4,5,6]::integer[]`,
    ),
    check(
      'notification_preferences_workout_frequency_check',
      sql`${table.workoutReminderFrequency} in ('scheduled', 'daily', 'every_other_day', 'weekly', 'twice_weekly', 'hourly')`,
    ),
    check(
      'notification_preferences_measurement_frequency_check',
      sql`${table.measurementReminderFrequency} in ('daily', 'every_other_day', 'weekly', 'twice_weekly', 'hourly')`,
    ),
    check(
      'notification_preferences_workout_days_check',
      sql`cardinality(${table.workoutReminderDays}) between 1 and 7 and ${table.workoutReminderDays} <@ ARRAY[0,1,2,3,4,5,6]::integer[]`,
    ),
    check(
      'notification_preferences_measurement_days_check',
      sql`cardinality(${table.measurementReminderDays}) between 1 and 7 and ${table.measurementReminderDays} <@ ARRAY[0,1,2,3,4,5,6]::integer[]`,
    ),
    check(
      'notification_preferences_workout_cadence_days_check',
      sql`(${table.workoutReminderFrequency} <> 'weekly' or cardinality(${table.workoutReminderDays}) = 1) and (${table.workoutReminderFrequency} <> 'twice_weekly' or cardinality(${table.workoutReminderDays}) = 2)`,
    ),
    check(
      'notification_preferences_measurement_cadence_days_check',
      sql`(${table.measurementReminderFrequency} <> 'weekly' or cardinality(${table.measurementReminderDays}) = 1) and (${table.measurementReminderFrequency} <> 'twice_weekly' or cardinality(${table.measurementReminderDays}) = 2)`,
    ),
  ],
);

export const notificationMedia = pgTable(
  'notification_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uploadedBy: integer('uploaded_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    objectKey: text('object_key').notNull().unique(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('notification_media_created_idx').on(table.createdAt.desc()),
  ],
);

export const notificationCampaigns = pgTable(
  'notification_campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdBy: integer('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    audience: text('audience').$type<'all' | 'users'>().notNull(),
    targetUserIds: jsonb('target_user_ids').$type<number[]>(),
    category: text('category')
      .$type<'general' | 'workout' | 'measurements' | 'achievements' | 'news'>()
      .notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    mediaId: uuid('media_id').references(() => notificationMedia.id, {
      onDelete: 'set null',
    }),
    mediaIds: jsonb('media_ids').$type<string[]>().notNull().default([]),
    videoUrl: text('video_url'),
    videoUrls: jsonb('video_urls').$type<string[]>().notNull().default([]),
    actionUrl: text('action_url'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    scheduledLocalAt: text('scheduled_local_at'),
    recipientCount: integer('recipient_count').notNull().default(0),
    deliveryCount: integer('delivery_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('notification_campaigns_created_idx').on(table.createdAt.desc()),
    check(
      'notification_campaigns_audience_check',
      sql`${table.audience} in ('all', 'users')`,
    ),
    check(
      'notification_campaigns_category_check',
      sql`${table.category} in ('general', 'workout', 'measurements', 'achievements', 'news')`,
    ),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => notificationCampaigns.id, {
      onDelete: 'set null',
    }),
    mediaId: uuid('media_id').references(() => notificationMedia.id, {
      onDelete: 'set null',
    }),
    mediaIds: jsonb('media_ids').$type<string[]>().notNull().default([]),
    videoUrls: jsonb('video_urls').$type<string[]>().notNull().default([]),
    category: text('category')
      .$type<'general' | 'workout' | 'measurements' | 'achievements' | 'news'>()
      .notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    dedupeKey: text('dedupe_key'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('notifications_id_user_unique').on(table.id, table.userId),
    uniqueIndex('notifications_user_dedupe_unique')
      .on(table.userId, table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`),
    index('notifications_user_created_idx').on(
      table.userId,
      table.createdAt.desc(),
    ),
    check(
      'notifications_category_check',
      sql`${table.category} in ('general', 'workout', 'measurements', 'achievements', 'news')`,
    ),
    check(
      'notifications_expiry_check',
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.scheduledAt}`,
    ),
  ],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: integer('user_id').notNull(),
    notificationId: uuid('notification_id').notNull(),
    pushDeviceId: uuid('push_device_id').notNull(),
    status: text('status')
      .$type<'pending' | 'sending' | 'sent' | 'failed' | 'skipped'>()
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.notificationId, table.userId],
      foreignColumns: [notifications.id, notifications.userId],
      name: 'notification_deliveries_notification_user_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pushDeviceId, table.userId],
      foreignColumns: [pushDevices.id, pushDevices.userId],
      name: 'notification_deliveries_device_user_fk',
    }).onDelete('cascade'),
    uniqueIndex('notification_deliveries_notification_device_unique').on(
      table.notificationId,
      table.pushDeviceId,
    ),
    index('notification_deliveries_due_idx')
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
    index('notification_deliveries_expired_lease_idx')
      .on(table.leaseUntil)
      .where(sql`${table.status} = 'sending'`),
    check(
      'notification_deliveries_status_check',
      sql`${table.status} in ('pending', 'sending', 'sent', 'failed', 'skipped')`,
    ),
    check(
      'notification_deliveries_attempts_check',
      sql`${table.attempts} >= 0`,
    ),
  ],
);

// A password is never turned into an account until the email owner proves access.
export const pendingRegistrations = pgTable('pending_registrations', {
  email: text('email').primaryKey(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  verificationCodeHash: text('verification_code_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until'),
});

// ================= BODY TRACKING =================

export const userBodyMetrics = pgTable(
  'user_body_metrics',
  {
    id: serial('id').primaryKey(),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),

    weight: real('weight'),

    bodyFatPercentage: real('body_fat_percentage'),

    muscleMass: real('muscle_mass'),

    waistCircumference: real('waist_circumference'),

    recordedAt: timestamp('recorded_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'user_body_metrics_at_least_one_metric',
      sql`
        ${table.weight} IS NOT NULL OR
        ${table.bodyFatPercentage} IS NOT NULL OR
        ${table.muscleMass} IS NOT NULL OR
        ${table.waistCircumference} IS NOT NULL
      `,
    ),
    index('user_body_metrics_user_recorded_idx').on(
      table.userId,
      table.recordedAt,
    ),
  ],
);

// ================= EXERCISE DATABASE =================

export const muscles = pgTable('muscles', {
  id: serial('id').primaryKey(),

  commonName: text('common_name').notNull().unique(),

  scientificName: text('scientific_name'),
});

export const exercises = pgTable('exercises', {
  id: serial('id').primaryKey(),

  name: text('name').notNull().unique(),

  description: text('description'),

  videoUrl: text('video_url'),
  // Object storage key of the illustration; see `users.avatar_key`.
  imageKey: text('image_key'),
  difficulty: integer('difficulty').default(1).notNull(),
});

export const exerciseLikes = pgTable(
  'exercise_likes',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.userId, table.exerciseId],
    }),
  }),
);

export const exercisesTrainMuscles = pgTable(
  'exercises_train_muscles',
  {
    muscleId: integer('muscle_id')
      .notNull()
      .references(() => muscles.id, {
        onDelete: 'cascade',
      }),

    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id, {
        onDelete: 'cascade',
      }),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.muscleId, table.exerciseId],
    }),
  }),
);

// ================= PROGRAM TEMPLATES =================

export const workoutPrograms = pgTable(
  'workout_programs',
  {
    id: serial('id').primaryKey(),

    name: text('name').notNull(),

    description: text('description'),

    videoUrl: text('video_url'),

    imageKey: text('image_key'),

    isPersonal: boolean('is_personal').notNull().default(false),

    isActive: boolean('is_active').notNull().default(true),

    createdById: integer('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    shareToken: text('share_token').unique(),

    sourceProgramId: integer('source_program_id'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceProgramId],
      foreignColumns: [table.id],
      name: 'workout_programs_source_program_id_fkey',
    }).onDelete('set null'),
    uniqueIndex('workout_programs_owner_source_unique')
      .on(table.createdById, table.sourceProgramId)
      .where(sql`${table.sourceProgramId} is not null`),
    index('workout_programs_personal_owner_idx').on(
      table.isPersonal,
      table.createdById,
    ),
  ],
);

// A replicated weekly snapshot of a program
export const programLikes = pgTable(
  'program_likes',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    programId: integer('program_id')
      .notNull()
      .references(() => workoutPrograms.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.programId] }),
    programIdx: index('program_likes_program_id_idx').on(table.programId),
  }),
);

export const exerciseBookmarks = pgTable(
  'exercise_bookmarks',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.exerciseId] }),
  }),
);

export const programContent = pgTable(
  'program_content',
  {
    id: serial('id').primaryKey(),

    week: integer('week_number').notNull(),

    programId: integer('program_id')
      .notNull()
      .references(() => workoutPrograms.id, {
        onDelete: 'cascade',
      }),
  },
  (table) => [
    index('program_content_program_week_idx').on(table.programId, table.week),
  ],
);

// Exercises inside a planned week

export const exerciseInPrograms = pgTable(
  'exercises_in_programs',
  {
    id: serial('id').primaryKey(),

    programContentId: integer('program_content_id')
      .notNull()
      .references(() => programContent.id, {
        onDelete: 'cascade',
      }),

    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id, {
        onDelete: 'cascade',
      }),

    sets: integer('sets').notNull(),

    // Planned starting values
    firstSetRepCount: integer('first_set_rep_count'),

    weight: real('weight'),

    // 0 = Monday, 6 = Sunday
    weekDay: integer('week_day').notNull(),
  },
  (table) => [
    index('exercises_in_programs_content_id_idx').on(table.programContentId),
  ],
);

// User currently assigned program

export const usersWorkoutPrograms = pgTable('users_current_workout_programs', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, {
      onDelete: 'cascade',
    }),

  programId: integer('program_id')
    .notNull()
    .references(() => workoutPrograms.id, {
      onDelete: 'cascade',
    }),

  dayInProgram: integer('day_in_program').notNull().default(0),
});

// A weekly program plan. Calendar entries are materialized only for dates the user views.
export const userProgramScheduleSeries = pgTable(
  'user_program_schedule_series',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    programId: integer('program_id')
      .notNull()
      .references(() => workoutPrograms.id, { onDelete: 'cascade' }),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('user_program_schedule_series_user_starts_idx').on(
      table.userId,
      table.startsOn,
    ),
  ],
);

// A personal calendar assignment. One user can plan multiple programs per date.
export const userProgramSchedule = pgTable(
  'user_program_schedule',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scheduledFor: date('scheduled_for').notNull(),
    programId: integer('program_id')
      .notNull()
      .references(() => workoutPrograms.id, { onDelete: 'cascade' }),
    seriesId: integer('series_id').references(
      () => userProgramScheduleSeries.id,
      { onDelete: 'cascade' },
    ),
    status: text('status').notNull().default('planned'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_program_schedule_unique_assignment_idx').on(
      table.userId,
      table.scheduledFor,
      table.programId,
    ),
  ],
);

// ================= COMPLETED WORKOUT HISTORY =================

export type WorkoutHistoryPlanItem = {
  exerciseId: number;
  name: string;
  sets: number;
  reps: number | null;
  weight: number | null;
};

export type WorkoutHistorySnapshot = {
  programId: number | null;
  programName: string | null;
  scheduledFor: string | null;
  plan: WorkoutHistoryPlanItem[];
};

export const workouts = pgTable(
  'workouts',
  {
    id: serial('id').primaryKey(),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),

    // optional link back to planned program day
    programContentId: integer('program_content_id').references(
      () => programContent.id,
      {
        onDelete: 'set null',
      },
    ),

    type: text('type').notNull(),

    // A workout is kept after cancellation so it never appears as completed history.
    status: text('status').notNull().default('active'),
    pausedAt: timestamp('paused_at'),
    pausedSeconds: integer('paused_seconds').notNull().default(0),
    lastActivityAt: timestamp('last_activity_at').notNull().defaultNow(),

    notes: text('notes'),

    durationSeconds: integer('duration_seconds'), // Тривалість тренування в секундах
    finishedAt: timestamp('finished_at'),
    scheduleId: integer('schedule_id').references(
      () => userProgramSchedule.id,
      { onDelete: 'set null' },
    ),

    // Immutable source plan used by completed-workout history.
    historySnapshot: jsonb('history_snapshot').$type<WorkoutHistorySnapshot>(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('workouts_user_finished_id_idx').on(
      table.userId,
      table.finishedAt.desc(),
      table.id.desc(),
    ),
    index('workouts_schedule_id_idx').on(table.scheduleId),
  ],
);

// Actual performed sets

export const sets = pgTable(
  'sets',
  {
    id: serial('id').primaryKey(),

    workoutId: integer('workout_id')
      .notNull()
      .references(() => workouts.id, {
        onDelete: 'cascade',
      }),

    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id, {
        onDelete: 'cascade',
      }),

    weight: real('weight').notNull(),

    reps: integer('reps').notNull(),

    isFailure: boolean('is_failure').default(false).notNull(),

    isDropSet: boolean('is_drop_set').default(false).notNull(),

    rpe: integer('rpe'),
  },
  (table) => [
    index('sets_workout_id_idx').on(table.workoutId),
    index('sets_exercise_workout_idx').on(table.exerciseId, table.workoutId),
  ],
);

// ================= TRANSACTIONAL OUTBOX =================

// Domain events written in the same transaction as the change they describe.
// A relay later claims unpublished rows and forwards them to the broker, so an
// event exists if and only if its business change committed. There are no
// foreign keys on purpose: events must outlive the rows they describe (for
// example `user.deleted`), and the table is meant to be range-partitioned by
// `occurred_at` later.
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    traceContext: jsonb('trace_context').$type<{
      traceparent: string;
      tracestate?: string;
    }>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (table) => [
    check(
      'outbox_events_event_version_positive',
      sql`${table.eventVersion} > 0`,
    ),
    check('outbox_events_attempts_non_negative', sql`${table.attempts} >= 0`),
    index('outbox_events_unpublished_idx')
      .on(table.occurredAt)
      .where(sql`${table.publishedAt} is null`),
    index('outbox_events_aggregate_idx').on(
      table.aggregateType,
      table.aggregateId,
      table.occurredAt,
    ),
  ],
);
