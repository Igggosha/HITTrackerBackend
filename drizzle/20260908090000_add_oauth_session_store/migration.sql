-- EN: Adds server-side OAuth sessions for temporary login state, PKCE data, and safe expiration.
-- UK: Додає серверні OAuth-сесії для тимчасового стану входу, даних PKCE та безпечного завершення строку дії.

CREATE TABLE "oauth_sessions" (
  "sid" varchar NOT NULL,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "oauth_sessions_pkey" PRIMARY KEY ("sid")
);
--> statement-breakpoint
CREATE INDEX "oauth_sessions_expire_idx" ON "oauth_sessions" ("expire");
