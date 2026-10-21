-- EN: Adds stable catalog identity and explicit rep/duration measurements while preserving every existing exercise and performed set.
-- UK: Додає сталу ідентичність каталогу та явні вимірювання повторень/тривалості, зберігаючи всі наявні вправи й виконані підходи.

ALTER TABLE "exercises" ADD COLUMN "catalog_key" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "measurement_type" text NOT NULL DEFAULT 'reps';--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "recommended_duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "equipment" text[] NOT NULL DEFAULT ARRAY[]::text[];--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_catalog_key_unique" ON "exercises" USING btree ("catalog_key") WHERE "exercises"."catalog_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_measurement_type_check" CHECK ("exercises"."measurement_type" IN ('reps', 'duration'));--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_duration_recommendation_check" CHECK (("exercises"."measurement_type" = 'reps' AND "exercises"."recommended_duration_seconds" IS NULL) OR ("exercises"."measurement_type" = 'duration' AND ("exercises"."recommended_duration_seconds" IS NULL OR "exercises"."recommended_duration_seconds" > 0)));--> statement-breakpoint

ALTER TABLE "exercises_in_programs" ADD COLUMN "target_duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "exercises_in_programs" ADD CONSTRAINT "exercises_in_programs_measurement_target_check" CHECK (("first_set_rep_count" IS NULL OR "first_set_rep_count" > 0) AND ("target_duration_seconds" IS NULL OR "target_duration_seconds" > 0) AND NOT ("first_set_rep_count" IS NOT NULL AND "target_duration_seconds" IS NOT NULL));--> statement-breakpoint

ALTER TABLE "sets" ALTER COLUMN "reps" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_measurement_value_check" CHECK (("sets"."reps" IS NOT NULL AND "sets"."reps" > 0 AND "sets"."duration_seconds" IS NULL) OR ("sets"."reps" IS NULL AND "sets"."duration_seconds" IS NOT NULL AND "sets"."duration_seconds" > 0));
