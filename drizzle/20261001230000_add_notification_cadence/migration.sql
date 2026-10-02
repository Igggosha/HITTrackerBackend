ALTER TABLE "notification_preferences"
ADD COLUMN "workout_reminder_frequency" text DEFAULT 'scheduled' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences"
ADD COLUMN "workout_reminder_time" time DEFAULT '18:00:00' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences"
ADD COLUMN "workout_reminder_days" integer[] DEFAULT ARRAY[1]::integer[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences"
ADD COLUMN "measurement_reminder_frequency" text DEFAULT 'weekly' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences"
ADD COLUMN "measurement_reminder_time" time DEFAULT '18:00:00' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences"
ADD COLUMN "measurement_reminder_days" integer[] DEFAULT ARRAY[0]::integer[] NOT NULL;
--> statement-breakpoint
UPDATE "notification_preferences"
SET
  "workout_reminder_time" = COALESCE("reminder_time", '18:00:00'::time),
  "measurement_reminder_time" = COALESCE("reminder_time", '18:00:00'::time),
  "measurement_reminder_days" = ARRAY["reminder_days"[1]]::integer[];
--> statement-breakpoint
ALTER TABLE "notification_preferences"
ADD CONSTRAINT "notification_preferences_workout_frequency_check"
CHECK ("workout_reminder_frequency" in ('scheduled', 'daily', 'every_other_day', 'weekly', 'twice_weekly', 'hourly'));
--> statement-breakpoint
ALTER TABLE "notification_preferences"
ADD CONSTRAINT "notification_preferences_measurement_frequency_check"
CHECK ("measurement_reminder_frequency" in ('daily', 'every_other_day', 'weekly', 'twice_weekly', 'hourly'));
--> statement-breakpoint
ALTER TABLE "notification_preferences"
ADD CONSTRAINT "notification_preferences_workout_days_check"
CHECK (cardinality("workout_reminder_days") BETWEEN 1 AND 7 AND "workout_reminder_days" <@ ARRAY[0,1,2,3,4,5,6]::integer[]);
--> statement-breakpoint
ALTER TABLE "notification_preferences"
ADD CONSTRAINT "notification_preferences_measurement_days_check"
CHECK (cardinality("measurement_reminder_days") BETWEEN 1 AND 7 AND "measurement_reminder_days" <@ ARRAY[0,1,2,3,4,5,6]::integer[]);
--> statement-breakpoint
ALTER TABLE "notification_preferences"
ADD CONSTRAINT "notification_preferences_workout_cadence_days_check"
CHECK (("workout_reminder_frequency" <> 'weekly' OR cardinality("workout_reminder_days") = 1) AND ("workout_reminder_frequency" <> 'twice_weekly' OR cardinality("workout_reminder_days") = 2));
--> statement-breakpoint
ALTER TABLE "notification_preferences"
ADD CONSTRAINT "notification_preferences_measurement_cadence_days_check"
CHECK (("measurement_reminder_frequency" <> 'weekly' OR cardinality("measurement_reminder_days") = 1) AND ("measurement_reminder_frequency" <> 'twice_weekly' OR cardinality("measurement_reminder_days") = 2));
