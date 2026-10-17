-- EN: Adds the last-seen timestamp used to expose recent user activity without storing a continuous session log.
-- UK: Додає час останньої активності для відображення присутності користувача без безперервного журналу сесії.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp;
