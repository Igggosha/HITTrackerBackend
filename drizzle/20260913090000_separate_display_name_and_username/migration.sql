ALTER TABLE "users" ADD COLUMN "display_name" text;
--> statement-breakpoint
UPDATE "users" SET "display_name" = "username" WHERE "display_name" IS NULL;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "display_name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" DROP NOT NULL;
--> statement-breakpoint
UPDATE "users" SET "username" = NULL;
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_username_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_unique"
  ON "users" (lower("username"))
  WHERE "username" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "username_reservations" (
  "username" text PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reserved_until" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_registrations" ADD COLUMN "display_name" text;
--> statement-breakpoint
UPDATE "pending_registrations"
SET "display_name" = "username";
--> statement-breakpoint
ALTER TABLE "pending_registrations" ALTER COLUMN "display_name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "pending_registrations" DROP COLUMN "username";
