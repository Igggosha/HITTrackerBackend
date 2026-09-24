ALTER TABLE "user_body_metrics" ALTER COLUMN "weight" DROP NOT NULL;
ALTER TABLE "user_body_metrics" ADD COLUMN "waist_circumference" real;

ALTER TABLE "user_body_metrics"
  ADD CONSTRAINT "user_body_metrics_at_least_one_metric"
  CHECK (
    "weight" IS NOT NULL OR
    "body_fat_percentage" IS NOT NULL OR
    "muscle_mass" IS NOT NULL OR
    "waist_circumference" IS NOT NULL
  );

CREATE INDEX "user_body_metrics_user_recorded_idx"
  ON "user_body_metrics" USING btree ("user_id", "recorded_at");
