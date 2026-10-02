CREATE TABLE "notification_media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "uploaded_by" integer REFERENCES "public"."users"("id") ON DELETE set null,
  "object_key" text NOT NULL UNIQUE,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notification_media_created_idx" ON "notification_media" ("created_at" DESC);
--> statement-breakpoint
CREATE TABLE "notification_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_by" integer REFERENCES "public"."users"("id") ON DELETE set null,
  "audience" text NOT NULL,
  "target_user_ids" jsonb,
  "category" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "media_id" uuid REFERENCES "public"."notification_media"("id") ON DELETE set null,
  "video_url" text,
  "action_url" text,
  "scheduled_at" timestamp with time zone,
  "scheduled_local_at" text,
  "recipient_count" integer DEFAULT 0 NOT NULL,
  "delivery_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_campaigns_audience_check" CHECK ("audience" in ('all', 'users')),
  CONSTRAINT "notification_campaigns_category_check" CHECK ("category" in ('general', 'workout', 'measurements', 'achievements', 'news'))
);
--> statement-breakpoint
CREATE INDEX "notification_campaigns_created_idx" ON "notification_campaigns" ("created_at" DESC);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "campaign_id" uuid REFERENCES "public"."notification_campaigns"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "media_id" uuid REFERENCES "public"."notification_media"("id") ON DELETE set null;
