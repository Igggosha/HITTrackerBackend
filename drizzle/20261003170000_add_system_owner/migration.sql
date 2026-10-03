ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_system_owner" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_system_owner_role_check"
  CHECK (NOT "is_system_owner" OR "role" = 'super_admin');
--> statement-breakpoint
CREATE UNIQUE INDEX "users_single_system_owner_unique"
  ON "users" ("is_system_owner")
  WHERE "is_system_owner" = true;
