-- Additive B-tree indexes for history and program browsing. Rollback: DROP INDEX
-- for each name below; removing them does not remove data or constraints.
CREATE INDEX IF NOT EXISTS "sets_workout_id_idx" ON "sets" ("workout_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sets_exercise_workout_idx" ON "sets" ("exercise_id", "workout_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workouts_user_finished_id_idx" ON "workouts" ("user_id", "finished_at" DESC NULLS LAST, "id" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workouts_schedule_id_idx" ON "workouts" ("schedule_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_program_schedule_series_user_starts_idx" ON "user_program_schedule_series" ("user_id", "starts_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "program_content_program_week_idx" ON "program_content" ("program_id", "week_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exercises_in_programs_content_id_idx" ON "exercises_in_programs" ("program_content_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "program_likes_program_id_idx" ON "program_likes" ("program_id");
