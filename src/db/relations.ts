import { defineRelations } from 'drizzle-orm';
import * as schema from './schema';

export const relations = defineRelations(schema, (r) => ({
<<<<<<< Updated upstream
    users: {
        // Programs created by this user
        createdWorkoutPrograms: r.many.workoutPrograms(),

        // Programs this user is using
        usersWorkoutPrograms: r.many.usersWorkoutPrograms(),
    },
=======
  users: {},
>>>>>>> Stashed changes

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

<<<<<<< Updated upstream
        exercise: r.one.exercises({
            from: r.exercisesTrainMuscles.exerciseId,
            to: r.exercises.id,
        }),
    },

    workoutPrograms: {
        // Creator of the program
        createdBy: r.one.users({
            from: r.workoutPrograms.createdById,
            to: r.users.id,
        }),

        // Users currently using this program
        usersWorkoutPrograms: r.many.usersWorkoutPrograms(),
    },

    usersWorkoutPrograms: {
        user: r.one.users({
            from: r.usersWorkoutPrograms.userId,
            to: r.users.id,
        }),

        workoutProgram: r.one.workoutPrograms({
            from: r.usersWorkoutPrograms.programId,
            to: r.workoutPrograms.id,
        }),
    },
}));
=======
    exercise: r.one.exercises({
      from: r.exercisesTrainMuscles.exerciseId,
      to: r.exercises.id,
    }),
  },
}));
>>>>>>> Stashed changes
