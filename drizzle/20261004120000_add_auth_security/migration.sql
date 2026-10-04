ALTER TABLE "auth_refresh_sessions"
  ADD COLUMN IF NOT EXISTS "family_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN IF NOT EXISTS "parent_session_id" integer,
  ADD COLUMN IF NOT EXISTS "used_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "mfa_verified_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "revocation_reason" text;

CREATE INDEX IF NOT EXISTS "auth_refresh_sessions_family_id_idx"
  ON "auth_refresh_sessions" ("family_id");

CREATE TABLE IF NOT EXISTS "auth_mfa_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "auth_mfa_challenges_user_id_idx"
  ON "auth_mfa_challenges" ("user_id");

CREATE TABLE IF NOT EXISTS "auth_totp_credentials" (
  "user_id" integer PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "secret_ciphertext" text NOT NULL,
  "enabled_at" timestamp with time zone,
  "last_used_time_step" integer,
  "recovery_code_hashes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "recovery_codes_generated_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "notification_campaigns"
  ADD COLUMN IF NOT EXISTS "idempotency_key" uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "notification_campaigns_actor_idempotency_idx"
  ON "notification_campaigns" ("created_by", "idempotency_key");
