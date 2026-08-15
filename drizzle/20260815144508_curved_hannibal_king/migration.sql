CREATE TABLE "exercise_likes" (
	"user_id" integer,
	"exercise_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_likes_pkey" PRIMARY KEY("user_id","exercise_id")
);
--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "difficulty" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users_current_workout_programs" ADD COLUMN "day_in_program" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "finished_at" timestamp;--> statement-breakpoint
ALTER TABLE "exercise_likes" ADD CONSTRAINT "exercise_likes_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "exercise_likes" ADD CONSTRAINT "exercise_likes_exercise_id_exercises_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE;