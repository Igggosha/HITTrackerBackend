ALTER TABLE "notification_preferences"
ADD COLUMN "reminder_days" integer[] DEFAULT ARRAY[1,2,3,4,5]::integer[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences"
ADD CONSTRAINT "notification_preferences_reminder_days_check"
CHECK (
  cardinality("reminder_days") BETWEEN 1 AND 7
  AND "reminder_days" <@ ARRAY[0,1,2,3,4,5,6]::integer[]
);
