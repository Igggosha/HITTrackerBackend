CREATE TABLE "auth_refresh_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "auth_refresh_sessions_token_hash_unique" UNIQUE("token_hash")
);

ALTER TABLE "auth_refresh_sessions"
  ADD CONSTRAINT "auth_refresh_sessions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;

CREATE INDEX "auth_refresh_sessions_user_id_idx"
  ON "auth_refresh_sessions" USING btree ("user_id");
