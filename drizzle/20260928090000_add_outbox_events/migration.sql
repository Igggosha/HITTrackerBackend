-- Transactional outbox. Rows are inserted inside the business transaction and
-- claimed later by a relay with FOR UPDATE SKIP LOCKED. gen_random_uuid() is
-- built into PostgreSQL 13+, so no extension is required.
--
-- No foreign keys: events must survive deletion of the rows they describe, and
-- the table is meant to be range-partitioned by occurred_at later (see
-- docs/diploma/outbox.md). Purely additive; rollback is DROP TABLE.
CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_id" text NOT NULL,
  "event_type" text NOT NULL,
  "event_version" integer NOT NULL,
  "payload" jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  CONSTRAINT "outbox_events_event_version_positive" CHECK ("event_version" > 0),
  CONSTRAINT "outbox_events_attempts_non_negative" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
-- The relay only ever scans unpublished rows in occurrence order; published
-- rows drop out of this index, so it stays small however large the table grows.
CREATE INDEX IF NOT EXISTS "outbox_events_unpublished_idx"
  ON "outbox_events" USING btree ("occurred_at")
  WHERE "published_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_events_aggregate_idx"
  ON "outbox_events" USING btree ("aggregate_type", "aggregate_id", "occurred_at");
