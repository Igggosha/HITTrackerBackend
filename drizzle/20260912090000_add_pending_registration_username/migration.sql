ALTER TABLE "pending_registrations" ADD COLUMN "username" text;
--> statement-breakpoint
UPDATE "pending_registrations" SET "username" = split_part("email", '@', 1) WHERE "username" IS NULL;
--> statement-breakpoint
ALTER TABLE "pending_registrations" ALTER COLUMN "username" SET NOT NULL;
