import {integer, pgTable, primaryKey, serial, text, timestamp} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
    id: serial("id").primaryKey(),

    email: text("email").notNull().unique(),

    username: text("username").notNull().unique(),

    passwordHash: text("password_hash").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),

});

export const muscles = pgTable("muscles", {
    id: serial("id").primaryKey(),

    commonName: text("commonName").notNull().unique(),

    scientificName: text("scientificName"),
});

export const exercises = pgTable("exercises", {
    id: serial("id").primaryKey(),

    name: text("name").notNull().unique(),
});

export const exercisesTrainMuscles = pgTable("exercises_train_muscles", {
    muscleId: integer("muscle_id").notNull().references(() => muscles.id),
    exerciseId: integer("exercise_id").notNull().references(() => exercises.id),
}, (table) => ({
        pk: primaryKey({
            columns: [table.muscleId, table.exerciseId]
        }),
    }),
);

export const workoutPrograms = pgTable("workout_programs", {
    id: serial("id").primaryKey(),

    name: text("name").notNull().unique(),

    createdById: integer("created_by_id").references(() => users.id),


});

// many-to-many homunculus table BUT needs to be used as a 1-to-many (many users use 1 program, a user can only have 1 program)
// because drizzle SUCKS!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// and cannot have a 1-to-many and a many-to-1 linking the same 2 tables
export const usersWorkoutPrograms = pgTable("users_current_workout_programs", {
    userId: integer("user_id").notNull().primaryKey().references(() => users.id),
    programId: integer("program_id").notNull().references(() => workoutPrograms.id),
});