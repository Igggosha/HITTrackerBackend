-- Nullable for events written before tracing was enabled. Rollback: DROP COLUMN trace_context.
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "trace_context" jsonb;
