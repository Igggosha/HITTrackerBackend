-- EN: Stores the requested username during pending registration so it survives the verification step.
-- UK: Зберігає вибране ім’я користувача в очікуваній реєстрації, щоб воно не втратилося під час підтвердження.

ALTER TABLE "pending_registrations" ADD COLUMN "username" text;
--> statement-breakpoint
UPDATE "pending_registrations" SET "username" = split_part("email", '@', 1) WHERE "username" IS NULL;
--> statement-breakpoint
ALTER TABLE "pending_registrations" ALTER COLUMN "username" SET NOT NULL;
