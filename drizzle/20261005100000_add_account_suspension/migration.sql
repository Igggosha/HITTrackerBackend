ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "suspended_until" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "suspension_reason" text,
  ADD COLUMN IF NOT EXISTS "sessions_invalid_before" timestamp with time zone;

ALTER TABLE "users"
  ADD CONSTRAINT "users_suspension_fields_check"
  CHECK (
    ("suspended_until" IS NULL AND "suspension_reason" IS NULL)
    OR (
      "suspended_until" IS NOT NULL
      AND "suspension_reason" IS NOT NULL
      AND char_length("suspension_reason") BETWEEN 3 AND 500
    )
  );
