ALTER TABLE "workout_programs"
  ADD COLUMN "share_token" text,
  ADD COLUMN "source_program_id" integer;
--> statement-breakpoint
ALTER TABLE "workout_programs"
  ADD CONSTRAINT "workout_programs_share_token_unique" UNIQUE ("share_token");
--> statement-breakpoint
ALTER TABLE "workout_programs"
  ADD CONSTRAINT "workout_programs_source_program_id_fkey"
  FOREIGN KEY ("source_program_id") REFERENCES "workout_programs"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "workout_programs_owner_source_unique"
  ON "workout_programs" ("created_by_id", "source_program_id")
  WHERE "source_program_id" IS NOT NULL;
