-- EN: Adds the user role used by authorization guards and constrains it to supported values.
-- UK: Додає роль користувача для перевірок авторизації та обмежує її підтримуваними значеннями.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_role_check"
  CHECK ("role" IN ('user', 'helper', 'moderator', 'admin', 'super_admin'));
