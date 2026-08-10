CREATE TABLE "exercises_in_programs" (
	"id" serial PRIMARY KEY,
	"program_content_id" integer NOT NULL,
	"exercise_id" integer NOT NULL,
	"sets" integer NOT NULL,
	"first_set_rep_count" integer,
	"weight" real,
	"week_day" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL UNIQUE,
	"description" text,
	"video_url" text
);
--> statement-breakpoint
CREATE TABLE "exercises_train_muscles" (
	"muscle_id" integer,
	"exercise_id" integer,
	CONSTRAINT "exercises_train_muscles_pkey" PRIMARY KEY("muscle_id","exercise_id")
);
--> statement-breakpoint
CREATE TABLE "muscles" (
	"id" serial PRIMARY KEY,
	"common_name" text NOT NULL UNIQUE,
	"scientific_name" text
);
--> statement-breakpoint
CREATE TABLE "program_content" (
	"id" serial PRIMARY KEY,
	"week_number" integer NOT NULL,
	"program_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" serial PRIMARY KEY,
	"workout_id" integer NOT NULL,
	"exercise_id" integer NOT NULL,
	"weight" real NOT NULL,
	"reps" integer NOT NULL,
	"is_failure" boolean DEFAULT false NOT NULL,
	"is_drop_set" boolean DEFAULT false NOT NULL,
	"rpe" integer
);
--> statement-breakpoint
CREATE TABLE "user_body_metrics" (
	"id" serial PRIMARY KEY,
	"user_id" integer NOT NULL,
	"weight" real NOT NULL,
	"body_fat_percentage" real,
	"muscle_mass" real,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY,
	"email" text NOT NULL UNIQUE,
	"username" text NOT NULL UNIQUE,
	"password_hash" text,
	"google_id" text UNIQUE,
	"reset_password_token" text,
	"reset_password_expires" timestamp,
	"age" integer,
	"gender" text,
	"height" real,
	"goal" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users_current_workout_programs" (
	"user_id" integer PRIMARY KEY,
	"program_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_programs" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL UNIQUE,
	"created_by_id" integer
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" serial PRIMARY KEY,
	"user_id" integer NOT NULL,
	"program_content_id" integer,
	"type" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercises_in_programs" ADD CONSTRAINT "exercises_in_programs_ul6ASHOUSIsv_fkey" FOREIGN KEY ("program_content_id") REFERENCES "program_content"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "exercises_in_programs" ADD CONSTRAINT "exercises_in_programs_exercise_id_exercises_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "exercises_train_muscles" ADD CONSTRAINT "exercises_train_muscles_muscle_id_muscles_id_fkey" FOREIGN KEY ("muscle_id") REFERENCES "muscles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "exercises_train_muscles" ADD CONSTRAINT "exercises_train_muscles_exercise_id_exercises_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "program_content" ADD CONSTRAINT "program_content_program_id_workout_programs_id_fkey" FOREIGN KEY ("program_id") REFERENCES "workout_programs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_workout_id_workouts_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_exercise_id_exercises_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_body_metrics" ADD CONSTRAINT "user_body_metrics_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "users_current_workout_programs" ADD CONSTRAINT "users_current_workout_programs_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "users_current_workout_programs" ADD CONSTRAINT "users_current_workout_programs_YcNyOgrYNer7_fkey" FOREIGN KEY ("program_id") REFERENCES "workout_programs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workout_programs" ADD CONSTRAINT "workout_programs_created_by_id_users_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_program_content_id_program_content_id_fkey" FOREIGN KEY ("program_content_id") REFERENCES "program_content"("id") ON DELETE SET NULL;