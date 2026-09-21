CREATE TABLE "user_activity_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "actor_user_id" integer,
  "type" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "user_activity_events_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade,
  CONSTRAINT "user_activity_events_actor_user_id_users_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id")
    ON DELETE set null
);

CREATE INDEX "user_activity_events_user_created_idx"
  ON "user_activity_events" USING btree ("user_id", "created_at");
