-- EN: Adds preferred reminder days and time so scheduled workout notifications can be generated consistently.
-- UK: Додає бажані дні й час нагадувань для узгодженого створення запланованих сповіщень про тренування.

ALTER TABLE "notification_preferences"
ADD COLUMN "reminder_days" integer[] DEFAULT ARRAY[1,2,3,4,5]::integer[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences"
ADD CONSTRAINT "notification_preferences_reminder_days_check"
CHECK (
  cardinality("reminder_days") BETWEEN 1 AND 7
  AND "reminder_days" <@ ARRAY[0,1,2,3,4,5,6]::integer[]
);
