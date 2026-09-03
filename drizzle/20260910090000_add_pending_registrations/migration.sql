CREATE TABLE "pending_registrations" (
  "email" text PRIMARY KEY,
  "password_hash" text NOT NULL,
  "verification_code_hash" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX "pending_registrations_expires_at_idx" ON "pending_registrations" ("expires_at");
