-- Existing links were stored in clear text. Revoke them before switching to hashes.
UPDATE "users"
SET "reset_password_token" = NULL,
    "reset_password_expires" = NULL
WHERE "reset_password_token" IS NOT NULL;
