CREATE TABLE "oauth_sessions" (
  "sid" varchar NOT NULL,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "oauth_sessions_pkey" PRIMARY KEY ("sid")
);
--> statement-breakpoint
CREATE INDEX "oauth_sessions_expire_idx" ON "oauth_sessions" ("expire");
