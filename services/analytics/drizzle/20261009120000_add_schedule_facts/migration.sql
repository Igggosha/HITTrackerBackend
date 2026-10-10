ALTER TABLE "finished_workouts" ADD COLUMN IF NOT EXISTS "schedule_id" integer;
--> statement-breakpoint
ALTER TABLE "finished_workouts" ADD COLUMN IF NOT EXISTS "scheduled_for" date;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_assignments" (
  "schedule_id" integer PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "program_id" integer NOT NULL,
  "scheduled_for" date NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_assignments_user_date_idx"
  ON "scheduled_assignments" ("user_id", "scheduled_for");
