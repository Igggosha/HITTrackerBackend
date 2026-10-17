-- EN: Adds a temporary lock timestamp to throttle repeated registration verification attempts.
-- UK: Додає часову позначку тимчасового блокування для обмеження повторних спроб підтвердження реєстрації.

ALTER TABLE "pending_registrations" ADD COLUMN "locked_until" timestamp;
