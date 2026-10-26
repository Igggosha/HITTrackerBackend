ALTER TABLE "exercises"
ADD COLUMN "likes_adjustment" integer DEFAULT 0 NOT NULL;

ALTER TABLE "workout_programs"
ADD COLUMN "likes_adjustment" integer DEFAULT 0 NOT NULL;
