CREATE TABLE "program_likes" (
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "program_id" integer NOT NULL REFERENCES "workout_programs"("id") ON DELETE CASCADE,
  PRIMARY KEY ("user_id", "program_id")
);
--> statement-breakpoint
CREATE TABLE "exercise_bookmarks" (
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "exercise_id" integer NOT NULL REFERENCES "exercises"("id") ON DELETE CASCADE,
  PRIMARY KEY ("user_id", "exercise_id")
);
