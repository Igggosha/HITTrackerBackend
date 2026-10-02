ALTER TABLE "push_devices"
ADD COLUMN "provider" text DEFAULT 'fcm' NOT NULL;
--> statement-breakpoint
ALTER TABLE "push_devices"
ADD CONSTRAINT "push_devices_provider_check" CHECK ("provider" in ('fcm', 'expo'));
