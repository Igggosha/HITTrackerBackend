-- EN: Adds localized catalog data and ordering additively; existing rows are preserved.
-- UK: Адитивно додає локалізовані дані каталогу й порядок; наявні рядки зберігаються.

ALTER TABLE "exercises" ADD COLUMN "equipment_structured" jsonb NOT NULL DEFAULT jsonb_build_object('required', jsonb_build_array(), 'alternatives', jsonb_build_array());--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "recommended_sets" integer;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "recommended_reps" integer;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "demonstration_image_key" text;--> statement-breakpoint
ALTER TABLE "workout_programs" ADD COLUMN "catalog_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "workout_programs_catalog_key_unique" ON "workout_programs" USING btree ("catalog_key") WHERE "catalog_key" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "exercise_translations" (
  "id" serial PRIMARY KEY,
  "exercise_id" integer NOT NULL REFERENCES "exercises"("id") ON DELETE CASCADE,
  "locale" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "video_url" text,
  "aliases" text[] NOT NULL DEFAULT ARRAY[]::text[],
  CONSTRAINT "exercise_translations_locale_format_check" CHECK ("locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  CONSTRAINT "exercise_translations_name_nonblank_check" CHECK (btrim("name") <> '')
);--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_translations_exercise_locale_unique" ON "exercise_translations" ("exercise_id", "locale");--> statement-breakpoint

CREATE TABLE "workout_program_translations" (
  "id" serial PRIMARY KEY,
  "workout_program_id" integer NOT NULL REFERENCES "workout_programs"("id") ON DELETE CASCADE,
  "locale" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "video_url" text,
  "aliases" text[] NOT NULL DEFAULT ARRAY[]::text[],
  CONSTRAINT "workout_program_translations_locale_format_check" CHECK ("locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  CONSTRAINT "workout_program_translations_name_nonblank_check" CHECK (btrim("name") <> '')
);--> statement-breakpoint
CREATE UNIQUE INDEX "workout_program_translations_program_locale_unique" ON "workout_program_translations" ("workout_program_id", "locale");--> statement-breakpoint

ALTER TABLE "exercises" DROP CONSTRAINT IF EXISTS "exercises_duration_recommendation_check";--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_duration_recommendation_check" CHECK (("measurement_type" = 'reps' AND "recommended_duration_seconds" IS NULL) OR ("measurement_type" = 'duration' AND ("recommended_duration_seconds" IS NULL OR "recommended_duration_seconds" > 0)));--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_recommendation_values_check" CHECK (("recommended_sets" IS NULL OR "recommended_sets" > 0) AND ("recommended_reps" IS NULL OR "recommended_reps" > 0) AND (("measurement_type" = 'reps' AND "recommended_duration_seconds" IS NULL) OR ("measurement_type" = 'duration' AND "recommended_reps" IS NULL)));--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_catalog_key_nonblank_check" CHECK ("catalog_key" IS NULL OR btrim("catalog_key") <> '');--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_equipment_structured_shape_check" CHECK (jsonb_typeof("equipment_structured") = 'object' AND jsonb_typeof("equipment_structured"->'required') = 'array' AND jsonb_typeof("equipment_structured"->'alternatives') = 'array');--> statement-breakpoint
ALTER TABLE "workout_programs" ADD CONSTRAINT "workout_programs_catalog_key_nonblank_check" CHECK ("catalog_key" IS NULL OR btrim("catalog_key") <> '');--> statement-breakpoint

ALTER TABLE "exercises_in_programs" ADD COLUMN "position" integer;--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "program_content_id", "week_day" ORDER BY "id") AS "position"
  FROM "exercises_in_programs"
)
UPDATE "exercises_in_programs" AS eip SET "position" = ranked."position" FROM ranked WHERE eip."id" = ranked."id";--> statement-breakpoint
ALTER TABLE "exercises_in_programs" ALTER COLUMN "sets" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises_in_programs" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises_in_programs" ADD CONSTRAINT "exercises_in_programs_optional_plan_check" CHECK (("sets" IS NULL OR "sets" > 0) AND "position" > 0);--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_in_programs_content_day_position_unique" ON "exercises_in_programs" ("program_content_id", "week_day", "position");
