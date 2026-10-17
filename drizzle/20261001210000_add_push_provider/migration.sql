-- EN: Records the push provider per device so delivery can route tokens through the correct external service.
-- UK: Зберігає постачальника push-сповіщень для кожного пристрою, щоб надсилати токени через правильний зовнішній сервіс.

ALTER TABLE "push_devices"
ADD COLUMN "provider" text DEFAULT 'fcm' NOT NULL;
--> statement-breakpoint
ALTER TABLE "push_devices"
ADD CONSTRAINT "push_devices_provider_check" CHECK ("provider" in ('fcm', 'expo'));
