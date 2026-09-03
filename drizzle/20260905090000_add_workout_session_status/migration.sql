ALTER TABLE "workouts"
  ADD COLUMN "status" text NOT NULL DEFAULT 'active',
  ADD COLUMN "paused_at" timestamp,
  ADD COLUMN "paused_seconds" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

UPDATE "workouts" SET "status" = 'completed' WHERE "finished_at" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "workouts"
  ADD CONSTRAINT "workouts_status_check"
  CHECK ("status" IN ('active', 'paused', 'completed', 'cancelled'));
