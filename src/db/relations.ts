import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
    users: {},

    muscles: {
        exercisesTrainMuscles: r.many.exercisesTrainMuscles(),
    },

    exercises: {
        exercisesTrainMuscles: r.many.exercisesTrainMuscles(),
    },

    exercisesTrainMuscles: {
        muscle: r.one.muscles({
            from: r.exercisesTrainMuscles.muscleId,
            to: r.muscles.id,
        }),

        exercise: r.one.exercises({
            from: r.exercisesTrainMuscles.exerciseId,
            to: r.exercises.id,
        }),
    },
}));