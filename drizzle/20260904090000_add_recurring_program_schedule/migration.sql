CREATE TABLE IF NOT EXISTS "user_program_schedule_series" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "program_id" integer NOT NULL REFERENCES "workout_programs"("id") ON DELETE CASCADE,
  "starts_on" date NOT NULL,
  "ends_on" date,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "user_program_schedule"
  ADD COLUMN IF NOT EXISTS "series_id" integer REFERENCES "user_program_schedule_series"("id") ON DELETE CASCADE;
