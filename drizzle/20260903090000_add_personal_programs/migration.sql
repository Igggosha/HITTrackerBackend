ALTER TABLE "workout_programs"
  ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "workout_programs"
  ADD COLUMN IF NOT EXISTS "is_personal" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "workout_programs"
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "workout_programs"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE "workout_programs"
  DROP CONSTRAINT IF EXISTS "workout_programs_name_key";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workout_programs_personal_owner_idx"
  ON "workout_programs" ("is_personal", "created_by_id");
