CREATE TABLE "push_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" integer NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "installation_id" uuid NOT NULL,
  "platform" text NOT NULL,
  "device_model" text,
  "os_version" text,
  "app_version" text,
  "locale" text,
  "time_zone" text,
  "permission_status" text DEFAULT 'unknown' NOT NULL,
  "token_hash" text,
  "token_ciphertext" text,
  "token_updated_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "push_devices_platform_check" CHECK ("platform" in ('android', 'ios', 'web')),
  CONSTRAINT "push_devices_permission_status_check" CHECK ("permission_status" in ('unknown', 'granted', 'denied')),
  CONSTRAINT "push_devices_token_pair_check" CHECK (("token_hash" is null) = ("token_ciphertext" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_user_installation_unique" ON "push_devices" ("user_id", "installation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_id_user_unique" ON "push_devices" ("id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_active_token_hash_unique" ON "push_devices" ("token_hash") WHERE "token_hash" is not null and "revoked_at" is null;
--> statement-breakpoint
CREATE INDEX "push_devices_installation_id_idx" ON "push_devices" ("installation_id");
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
  "user_id" integer PRIMARY KEY NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "push_enabled" boolean DEFAULT false NOT NULL,
  "general_enabled" boolean DEFAULT false NOT NULL,
  "workout_reminders_enabled" boolean DEFAULT false NOT NULL,
  "measurement_reminders_enabled" boolean DEFAULT false NOT NULL,
  "achievements_enabled" boolean DEFAULT false NOT NULL,
  "news_enabled" boolean DEFAULT false NOT NULL,
  "reminder_time" time,
  "time_zone" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "notification_preferences" ("user_id")
SELECT "id" FROM "users"
ON CONFLICT ("user_id") DO NOTHING;
--> statement-breakpoint
CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" integer NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "category" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "dedupe_key" text,
  "scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notifications_category_check" CHECK ("category" in ('general', 'workout', 'measurements', 'achievements', 'news')),
  CONSTRAINT "notifications_expiry_check" CHECK ("expires_at" is null or "expires_at" > "scheduled_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_id_user_unique" ON "notifications" ("id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedupe_unique" ON "notifications" ("user_id", "dedupe_key") WHERE "dedupe_key" is not null;
--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" ("user_id", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" integer NOT NULL,
  "notification_id" uuid NOT NULL,
  "push_device_id" uuid NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_until" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "last_error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_deliveries_notification_user_fk" FOREIGN KEY ("notification_id", "user_id") REFERENCES "public"."notifications"("id", "user_id") ON DELETE cascade,
  CONSTRAINT "notification_deliveries_device_user_fk" FOREIGN KEY ("push_device_id", "user_id") REFERENCES "public"."push_devices"("id", "user_id") ON DELETE cascade,
  CONSTRAINT "notification_deliveries_status_check" CHECK ("status" in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  CONSTRAINT "notification_deliveries_attempts_check" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_notification_device_unique" ON "notification_deliveries" ("notification_id", "push_device_id");
--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" ("next_attempt_at") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "notification_deliveries_expired_lease_idx" ON "notification_deliveries" ("lease_until") WHERE "status" = 'sending';
