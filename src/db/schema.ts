import {
    boolean,
    integer,
    pgTable,
    primaryKey,
    real,
    serial,
    text,
    timestamp,
} from "drizzle-orm/pg-core";


// ================= USERS =================

export const users = pgTable("users", {
    id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash"),
    googleId: text("google_id").unique(),

    // Profile
    age: integer("age"),
    gender: text("gender"),
    height: real("height"),
    goal: text("goal"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
});


// ================= BODY TRACKING =================

export const userBodyMetrics = pgTable("user_body_metrics", {
    id: serial("id").primaryKey(),

    userId: integer("user_id")
        .notNull()
        .references(() => users.id, {
            onDelete: "cascade",
        }),

    weight: real("weight").notNull(),

    bodyFatPercentage: real("body_fat_percentage"),

    muscleMass: real("muscle_mass"),

    recordedAt: timestamp("recorded_at")
        .defaultNow()
        .notNull(),
});


// ================= EXERCISE DATABASE =================

export const muscles = pgTable("muscles", {
    id: serial("id").primaryKey(),

    commonName: text("common_name")
        .notNull()
        .unique(),

    scientificName: text("scientific_name"),
});


export const exercises = pgTable("exercises", {
    id: serial("id").primaryKey(),

    name: text("name")
        .notNull()
        .unique(),

    description: text("description"), // 👈 Опис та поради з техніки вправи

    videoUrl: text("video_url"), // 👈 Посилання на YouTube / відео інструкцію
});


export const exercisesTrainMuscles = pgTable(
    "exercises_train_muscles",
    {
        muscleId: integer("muscle_id")
            .notNull()
            .references(() => muscles.id, {
                onDelete: "cascade",
            }),

        exerciseId: integer("exercise_id")
            .notNull()
            .references(() => exercises.id, {
                onDelete: "cascade",
            }),
    },
    (table) => ({
        pk: primaryKey({
            columns: [
                table.muscleId,
                table.exerciseId,
            ],
        }),
    })
);


// ================= PROGRAM TEMPLATES =================

export const workoutPrograms = pgTable(
    "workout_programs",
    {
        id: serial("id").primaryKey(),

        name: text("name")
            .notNull()
            .unique(),

        createdById: integer("created_by_id")
            .references(() => users.id, {
                onDelete: "set null",
            }),
    }
);


// A replicated weekly snapshot of a program
export const programContent = pgTable(
    "program_content",
    {
        id: serial("id").primaryKey(),

        week: integer("week_number")
            .notNull(),

        programId: integer("program_id")
            .notNull()
            .references(() => workoutPrograms.id, {
                onDelete: "cascade",
            }),
    }
);


// Exercises inside a planned week

export const exerciseInPrograms = pgTable(
    "exercises_in_programs",
    {
        id: serial("id").primaryKey(),

        programContentId: integer("program_content_id")
            .notNull()
            .references(() => programContent.id, {
                onDelete: "cascade",
            }),

        exerciseId: integer("exercise_id")
            .notNull()
            .references(() => exercises.id, {
                onDelete: "cascade",
            }),


        sets: integer("sets")
            .notNull(),


        // Planned starting values
        firstSetRepCount: integer(
            "first_set_rep_count"
        ),

        weight: real("weight"),


        // 0 = Monday, 6 = Sunday
        weekDay: integer("week_day")
            .notNull(),
    }
);


// User currently assigned program

export const usersWorkoutPrograms = pgTable(
    "users_current_workout_programs",
    {
        userId: integer("user_id")
            .primaryKey()
            .references(() => users.id, {
                onDelete: "cascade",
            }),

        programId: integer("program_id")
            .notNull()
            .references(() => workoutPrograms.id, {
                onDelete: "cascade",
            }),
    }
);


// ================= COMPLETED WORKOUT HISTORY =================


export const workouts = pgTable(
    "workouts",
    {
        id: serial("id").primaryKey(),

        userId: integer("user_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
            }),


        // optional link back to planned program day
        programContentId: integer(
            "program_content_id"
        )
            .references(() => programContent.id, {
                onDelete: "set null",
            }),


        type: text("type")
            .notNull(),

        notes: text("notes"),


        createdAt: timestamp("created_at")
            .defaultNow()
            .notNull(),
    }
);


// Actual performed sets

export const sets = pgTable(
    "sets",
    {
        id: serial("id").primaryKey(),


        workoutId: integer("workout_id")
            .notNull()
            .references(() => workouts.id, {
                onDelete: "cascade",
            }),


        exerciseId: integer("exercise_id")
            .notNull()
            .references(() => exercises.id, {
                onDelete: "cascade",
            }),


        weight: real("weight")
            .notNull(),

        reps: integer("reps")
            .notNull(),


        isFailure: boolean("is_failure")
            .default(false)
            .notNull(),


        isDropSet: boolean("is_drop_set")
            .default(false)
            .notNull(),


        rpe: integer("rpe"),
    }
);
