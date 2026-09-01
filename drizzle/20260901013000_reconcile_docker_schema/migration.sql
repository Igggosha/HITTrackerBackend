ALTER TABLE "exercises"
  ADD COLUMN IF NOT EXISTS "difficulty" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exercise_likes" (
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "exercise_id" integer NOT NULL REFERENCES "exercises"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "exercise_id")
);
--> statement-breakpoint
ALTER TABLE "users_current_workout_programs"
  ADD COLUMN IF NOT EXISTS "day_in_program" integer NOT NULL DEFAULT 0;
