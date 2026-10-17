-- EN: Replaces clear-text password-reset tokens with hashes and revokes legacy links before the storage change.
-- UK: Замінює відкриті токени скидання пароля хешами та відкликає старі посилання перед зміною формату зберігання.

-- Existing links were stored in clear text. Revoke them before switching to hashes.
UPDATE "users"
SET "reset_password_token" = NULL,
    "reset_password_expires" = NULL
WHERE "reset_password_token" IS NOT NULL;
