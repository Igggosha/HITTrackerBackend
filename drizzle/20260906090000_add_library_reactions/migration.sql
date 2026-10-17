-- EN: Adds likes and ratings for shared workout programs with one reaction of each type per user and program.
-- UK: Додає вподобання й оцінки спільних програм тренувань: по одній реакції кожного типу від користувача на програму.

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
