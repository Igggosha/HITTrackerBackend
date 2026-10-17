-- EN: Distinguishes primary and secondary muscles for each exercise while preserving existing links as primary by default.
-- UK: Розрізняє основні й допоміжні м’язи кожної вправи, зберігаючи наявні зв’язки як основні за замовчуванням.

ALTER TABLE "exercises_train_muscles" ADD COLUMN "role" text NOT NULL DEFAULT 'primary';--> statement-breakpoint
ALTER TABLE "exercises_train_muscles" ADD CONSTRAINT "exercises_train_muscles_role_check" CHECK ("exercises_train_muscles"."role" IN ('primary', 'secondary'));
