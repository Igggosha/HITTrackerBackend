ALTER TABLE "workouts" ADD COLUMN "last_activity_at" timestamp;

UPDATE "workouts"
SET "last_activity_at" = CASE
  WHEN "status" = 'active' THEN now()
  ELSE COALESCE("paused_at", "created_at", now())
END
WHERE "last_activity_at" IS NULL;

ALTER TABLE "workouts"
  ALTER COLUMN "last_activity_at" SET DEFAULT now(),
  ALTER COLUMN "last_activity_at" SET NOT NULL;
