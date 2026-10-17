-- EN: Adds video and image references to workout programs for richer library presentation.
-- UK: Додає посилання на відео та зображення до програм тренувань для повнішого представлення в бібліотеці.

ALTER TABLE "workout_programs" ADD COLUMN IF NOT EXISTS "video_url" text;
ALTER TABLE "workout_programs" ADD COLUMN IF NOT EXISTS "image_key" text;
