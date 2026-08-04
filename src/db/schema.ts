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

export const exercisesTrainMuscles = pgTable("exercisesTrainMuscles", {
    muscleId: integer("muscle_id").notNull().references(() => muscles.id),
    exerciseId: integer("exercise_id").notNull().references(() => exercises.id),
}, (table) => ({
        pk: primaryKey({
            columns: [table.muscleId, table.exerciseId]
        }),
    }),
);

