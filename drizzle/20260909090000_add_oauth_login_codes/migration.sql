-- EN: Adds short-lived one-time codes that transfer a completed OAuth login back to the client safely.
-- UK: Додає короткочасні одноразові коди для безпечного передавання завершеного OAuth-входу клієнту.

CREATE TABLE "oauth_login_codes" (
  "id" serial PRIMARY KEY,
  "code_hash" text NOT NULL UNIQUE,
  "code_challenge" text NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "oauth_login_codes_expires_at_idx" ON "oauth_login_codes" ("expires_at");
