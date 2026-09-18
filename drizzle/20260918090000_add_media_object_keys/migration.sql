-- Object storage keys for user-uploaded media.
--
-- Both columns are nullable: existing rows simply have no image, and the API
-- treats a null key as "no picture" rather than as an error. Nothing is
-- backfilled, so this migration is safe to roll back by dropping the columns.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_key" text;
ALTER TABLE "exercises" ADD COLUMN IF NOT EXISTS "image_key" text;
