CREATE TABLE "exercise_bookmarks" (
	"user_id" integer,
	"exercise_id" integer,
	CONSTRAINT "exercise_bookmarks_pkey" PRIMARY KEY("user_id","exercise_id")
);
--> statement-breakpoint
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
CREATE TABLE "exercise_likes" (
	"user_id" integer,
	"exercise_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_likes_pkey" PRIMARY KEY("user_id","exercise_id")
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL UNIQUE,
	"description" text,
	"video_url" text,
	"difficulty" integer DEFAULT 1 NOT NULL
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
CREATE TABLE "oauth_login_codes" (
	"id" serial PRIMARY KEY,
	"code_hash" text NOT NULL UNIQUE,
	"code_challenge" text NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_registrations" (
	"email" text PRIMARY KEY,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"verification_code_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp
);
--> statement-breakpoint
CREATE TABLE "program_content" (
	"id" serial PRIMARY KEY,
	"week_number" integer NOT NULL,
	"program_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_likes" (
	"user_id" integer,
	"program_id" integer,
	CONSTRAINT "program_likes_pkey" PRIMARY KEY("user_id","program_id")
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
CREATE TABLE "user_program_schedule" (
	"id" serial PRIMARY KEY,
	"user_id" integer NOT NULL,
	"scheduled_for" date NOT NULL,
	"program_id" integer NOT NULL,
	"series_id" integer,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_program_schedule_series" (
	"id" serial PRIMARY KEY,
	"user_id" integer NOT NULL,
	"program_id" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "username_reservations" (
	"username" text PRIMARY KEY,
	"user_id" integer NOT NULL,
	"reserved_until" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY,
	"email" text NOT NULL UNIQUE,
	"username" text,
	"display_name" text DEFAULT '',
	"password_hash" text,
	"google_id" text UNIQUE,
	"role" text DEFAULT 'user' NOT NULL,
	"reset_password_token" text,
	"reset_password_expires" timestamp,
	"age" integer,
	"gender" text,
	"height" real,
	"goal" text,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users_current_workout_programs" (
	"user_id" integer PRIMARY KEY,
	"program_id" integer NOT NULL,
	"day_in_program" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_programs" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"description" text,
	"is_personal" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" serial PRIMARY KEY,
	"user_id" integer NOT NULL,
	"program_content_id" integer,
	"type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"paused_at" timestamp,
	"paused_seconds" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"duration_seconds" integer,
	"finished_at" timestamp,
	"schedule_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_unique" ON "users" (lower("username")) WHERE "username" is not null;--> statement-breakpoint
ALTER TABLE "exercise_bookmarks" ADD CONSTRAINT "exercise_bookmarks_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "exercise_bookmarks" ADD CONSTRAINT "exercise_bookmarks_exercise_id_exercises_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "exercises_in_programs" ADD CONSTRAINT "exercises_in_programs_ul6ASHOUSIsv_fkey" FOREIGN KEY ("program_content_id") REFERENCES "program_content"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "exercises_in_programs" ADD CONSTRAINT "exercises_in_programs_exercise_id_exercises_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "exercise_likes" ADD CONSTRAINT "exercise_likes_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "exercise_likes" ADD CONSTRAINT "exercise_likes_exercise_id_exercises_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "exercises_train_muscles" ADD CONSTRAINT "exercises_train_muscles_muscle_id_muscles_id_fkey" FOREIGN KEY ("muscle_id") REFERENCES "muscles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "exercises_train_muscles" ADD CONSTRAINT "exercises_train_muscles_exercise_id_exercises_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_login_codes" ADD CONSTRAINT "oauth_login_codes_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "program_content" ADD CONSTRAINT "program_content_program_id_workout_programs_id_fkey" FOREIGN KEY ("program_id") REFERENCES "workout_programs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "program_likes" ADD CONSTRAINT "program_likes_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "program_likes" ADD CONSTRAINT "program_likes_program_id_workout_programs_id_fkey" FOREIGN KEY ("program_id") REFERENCES "workout_programs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_workout_id_workouts_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_exercise_id_exercises_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_body_metrics" ADD CONSTRAINT "user_body_metrics_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_program_schedule" ADD CONSTRAINT "user_program_schedule_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_program_schedule" ADD CONSTRAINT "user_program_schedule_program_id_workout_programs_id_fkey" FOREIGN KEY ("program_id") REFERENCES "workout_programs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_program_schedule" ADD CONSTRAINT "user_program_schedule_PR25IWZJ6T5H_fkey" FOREIGN KEY ("series_id") REFERENCES "user_program_schedule_series"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_program_schedule_series" ADD CONSTRAINT "user_program_schedule_series_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_program_schedule_series" ADD CONSTRAINT "user_program_schedule_series_Sxea9ACgenQZ_fkey" FOREIGN KEY ("program_id") REFERENCES "workout_programs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "username_reservations" ADD CONSTRAINT "username_reservations_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "users_current_workout_programs" ADD CONSTRAINT "users_current_workout_programs_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "users_current_workout_programs" ADD CONSTRAINT "users_current_workout_programs_YcNyOgrYNer7_fkey" FOREIGN KEY ("program_id") REFERENCES "workout_programs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workout_programs" ADD CONSTRAINT "workout_programs_created_by_id_users_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_program_content_id_program_content_id_fkey" FOREIGN KEY ("program_content_id") REFERENCES "program_content"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_schedule_id_user_program_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "user_program_schedule"("id") ON DELETE SET NULL;