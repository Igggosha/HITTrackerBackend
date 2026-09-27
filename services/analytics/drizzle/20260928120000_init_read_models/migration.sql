-- Initial analytics read side (own database `analytics`, owned by the
-- `analytics_app` role). No foreign keys to the main API: ids are copied from
-- events. Purely additive; rollback is dropping these tables (the read models
-- can always be rebuilt from the Kafka log, see docs/diploma/analytics-cqrs.md).
CREATE TABLE "body_metrics_timeline" (
	"metric_id" integer PRIMARY KEY,
	"user_id" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"weight" double precision,
	"body_fat_percentage" double precision,
	"muscle_mass" double precision,
	"waist_circumference" double precision
);
--> statement-breakpoint
CREATE TABLE "erased_users" (
	"user_id" integer PRIMARY KEY,
	"erased_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_progress" (
	"user_id" integer,
	"exercise_id" integer,
	"date" date,
	"top_set_weight_kg" double precision NOT NULL,
	"top_set_reps" integer NOT NULL,
	"e1rm_kg" double precision NOT NULL,
	"volume_kg" double precision NOT NULL,
	CONSTRAINT "exercise_progress_pkey" PRIMARY KEY("user_id","exercise_id","date")
);
--> statement-breakpoint
CREATE TABLE "finished_sets" (
	"set_id" integer PRIMARY KEY,
	"workout_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"exercise_id" integer NOT NULL,
	"weight_kg" double precision NOT NULL,
	"reps" integer NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finished_workouts" (
	"workout_id" integer PRIMARY KEY,
	"user_id" integer NOT NULL,
	"event_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"set_count" integer NOT NULL,
	"reps" integer NOT NULL,
	"volume_kg" double precision NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_records" (
	"user_id" integer,
	"exercise_id" integer,
	"best_weight_kg" double precision NOT NULL,
	"best_reps_at_weight" integer NOT NULL,
	"achieved_at" timestamp with time zone NOT NULL,
	"workout_id" integer NOT NULL,
	"best_e1rm_kg" double precision NOT NULL,
	"best_e1rm_achieved_at" timestamp with time zone NOT NULL,
	"best_e1rm_workout_id" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_records_pkey" PRIMARY KEY("user_id","exercise_id")
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"event_id" uuid PRIMARY KEY,
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"topic" text NOT NULL,
	"partition" integer NOT NULL,
	"offset" bigint NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_streaks" (
	"user_id" integer PRIMARY KEY,
	"current_streak_days" integer NOT NULL,
	"longest_streak_days" integer NOT NULL,
	"last_workout_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_volume" (
	"user_id" integer,
	"iso_week_start" date,
	"workouts" integer NOT NULL,
	"sets" integer NOT NULL,
	"reps" integer NOT NULL,
	"volume_kg" double precision NOT NULL,
	"duration_seconds" integer NOT NULL,
	CONSTRAINT "weekly_volume_pkey" PRIMARY KEY("user_id","iso_week_start")
);
--> statement-breakpoint
CREATE INDEX "body_metrics_timeline_user_recorded_idx" ON "body_metrics_timeline" ("user_id","recorded_at");--> statement-breakpoint
CREATE INDEX "finished_sets_user_exercise_idx" ON "finished_sets" ("user_id","exercise_id","finished_at");--> statement-breakpoint
CREATE INDEX "finished_workouts_user_finished_idx" ON "finished_workouts" ("user_id","finished_at");