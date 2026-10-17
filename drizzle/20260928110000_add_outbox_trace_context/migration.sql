-- EN: Carries distributed trace context with outbox events while remaining compatible with events created before tracing.
-- UK: Передає контекст розподіленого трасування разом із подіями outbox і зберігає сумісність із подіями, створеними раніше.

-- Nullable for events written before tracing was enabled. Rollback: DROP COLUMN trace_context.
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "trace_context" jsonb;
