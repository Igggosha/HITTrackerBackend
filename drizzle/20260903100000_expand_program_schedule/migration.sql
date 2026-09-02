ALTER TABLE "user_program_schedule"
  DROP CONSTRAINT IF EXISTS "user_program_schedule_pkey";
--> statement-breakpoint
ALTER TABLE "user_program_schedule"
  ADD COLUMN IF NOT EXISTS "id" serial;
--> statement-breakpoint
ALTER TABLE "user_program_schedule"
  ADD CONSTRAINT "user_program_schedule_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
ALTER TABLE "user_program_schedule"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'planned';
--> statement-breakpoint
ALTER TABLE "user_program_schedule"
  ADD CONSTRAINT "user_program_schedule_status_check"
  CHECK ("status" IN ('planned', 'completed'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_program_schedule_unique_assignment_idx"
  ON "user_program_schedule" ("user_id", "scheduled_for", "program_id");
--> statement-breakpoint
ALTER TABLE "workouts"
  ADD COLUMN IF NOT EXISTS "schedule_id" integer REFERENCES "user_program_schedule"("id") ON DELETE SET NULL;
