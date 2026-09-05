ALTER TABLE "users" ADD COLUMN "full_name" text;
--> statement-breakpoint
CREATE TABLE "pending_registrations" (
  "email" text PRIMARY KEY,
  "full_name" text NOT NULL,
  "password_hash" text NOT NULL,
  "verification_code_hash" text NOT NULL,
  "verification_code_expires" timestamp NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
