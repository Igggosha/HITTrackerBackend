ALTER TABLE "notification_preferences"
ALTER COLUMN "push_enabled" SET DEFAULT true,
ALTER COLUMN "general_enabled" SET DEFAULT true,
ALTER COLUMN "workout_reminders_enabled" SET DEFAULT true,
ALTER COLUMN "measurement_reminders_enabled" SET DEFAULT true,
ALTER COLUMN "achievements_enabled" SET DEFAULT true,
ALTER COLUMN "news_enabled" SET DEFAULT true;
--> statement-breakpoint
UPDATE "notification_preferences"
SET
  "push_enabled" = true,
  "general_enabled" = true,
  "workout_reminders_enabled" = true,
  "measurement_reminders_enabled" = true,
  "achievements_enabled" = true,
  "news_enabled" = true,
  "updated_at" = now()
WHERE "push_enabled" = false
  AND "general_enabled" = false
  AND "workout_reminders_enabled" = false
  AND "measurement_reminders_enabled" = false
  AND "achievements_enabled" = false
  AND "news_enabled" = false;
