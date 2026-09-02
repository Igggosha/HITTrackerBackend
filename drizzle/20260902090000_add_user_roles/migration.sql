ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_role_check"
  CHECK ("role" IN ('user', 'helper', 'moderator', 'admin', 'super_admin'));
