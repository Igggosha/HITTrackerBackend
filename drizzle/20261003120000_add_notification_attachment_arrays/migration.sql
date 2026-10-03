ALTER TABLE "notification_campaigns"
  ADD COLUMN "media_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "video_urls" jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE "notification_campaigns"
SET "media_ids" = CASE WHEN "media_id" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array("media_id"::text) END,
    "video_urls" = CASE WHEN "video_url" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array("video_url") END;

ALTER TABLE "notifications"
  ADD COLUMN "media_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "video_urls" jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE "notifications"
SET "media_ids" = CASE WHEN "media_id" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array("media_id"::text) END,
    "video_urls" = COALESCE(NULLIF("payload"->'videoUrls', 'null'::jsonb),
      CASE WHEN "payload"->>'videoUrl' IS NULL THEN '[]'::jsonb ELSE jsonb_build_array("payload"->>'videoUrl') END);
