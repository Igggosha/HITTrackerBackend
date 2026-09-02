-- Shared starter content only. This script never deletes users, workouts, or personal programs.
INSERT INTO muscles (common_name, scientific_name) VALUES
  ('Chest', 'Pectoralis Major'), ('Lats', 'Latissimus Dorsi'),
  ('Quadriceps', 'Quadriceps Femoris'), ('Hamstrings', 'Biceps Femoris'),
  ('Deltoids', 'Deltoideus'), ('Triceps', 'Triceps Brachii'),
  ('Biceps', 'Biceps Brachii'), ('Abs', 'Rectus Abdominis'),
  ('Lower Back', 'Erector Spinae')
ON CONFLICT (common_name) DO NOTHING;

INSERT INTO exercises (name, description, difficulty) VALUES
  ('Barbell Bench Press', 'Compound chest press with a barbell.', 3),
  ('Incline Dumbbell Press', 'Upper-chest press with dumbbells.', 3),
  ('Pull-ups', 'Vertical pull using body weight.', 4),
  ('Lat Pulldown', 'Cable vertical pull for the lats.', 2),
  ('Barbell Back Squat', 'Compound squat for legs and glutes.', 4),
  ('Romanian Deadlift', 'Hip-hinge movement for hamstrings.', 3),
  ('Overhead Press', 'Standing barbell shoulder press.', 3),
  ('Conventional Deadlift', 'Full-body barbell pull from the floor.', 4)
ON CONFLICT (name) DO NOTHING;

INSERT INTO exercises_train_muscles (exercise_id, muscle_id)
SELECT e.id, m.id FROM (VALUES
  ('Barbell Bench Press', 'Chest'), ('Barbell Bench Press', 'Triceps'),
  ('Incline Dumbbell Press', 'Chest'), ('Pull-ups', 'Lats'), ('Pull-ups', 'Biceps'),
  ('Lat Pulldown', 'Lats'), ('Barbell Back Squat', 'Quadriceps'),
  ('Romanian Deadlift', 'Hamstrings'), ('Overhead Press', 'Deltoids'),
  ('Conventional Deadlift', 'Lower Back')
) AS links(exercise_name, muscle_name)
JOIN exercises e ON e.name = links.exercise_name
JOIN muscles m ON m.common_name = links.muscle_name
ON CONFLICT DO NOTHING;

INSERT INTO workout_programs (name, description, is_personal)
SELECT seed.name, seed.description, false
FROM (VALUES
  ('HIT Full Body', 'Three full-body sessions per week for building strength and muscle.'),
  ('Upper Body Strength', 'A focused upper-body session with push and pull movements.'),
  ('Lower Body & Core', 'Leg and posterior-chain work with a short core finisher.')
) AS seed(name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM workout_programs p WHERE p.name = seed.name AND p.is_personal = false
);

INSERT INTO program_content (program_id, week_number)
SELECT p.id, 1 FROM workout_programs p
WHERE p.is_personal = false AND p.name IN ('HIT Full Body', 'Upper Body Strength', 'Lower Body & Core')
  AND NOT EXISTS (SELECT 1 FROM program_content pc WHERE pc.program_id = p.id AND pc.week_number = 1);

INSERT INTO exercises_in_programs (program_content_id, exercise_id, sets, first_set_rep_count, weight, week_day)
SELECT pc.id, e.id, plan.sets, plan.reps, plan.weight, plan.week_day
FROM (VALUES
  ('HIT Full Body', 'Barbell Back Squat', 3, 8, 80::real, 0),
  ('HIT Full Body', 'Barbell Bench Press', 3, 8, 60::real, 0),
  ('HIT Full Body', 'Romanian Deadlift', 3, 10, 60::real, 2),
  ('HIT Full Body', 'Pull-ups', 3, 6, 0::real, 4),
  ('HIT Full Body', 'Overhead Press', 3, 8, 35::real, 4),
  ('Upper Body Strength', 'Barbell Bench Press', 4, 6, 70::real, 0),
  ('Upper Body Strength', 'Pull-ups', 4, 6, 0::real, 0),
  ('Upper Body Strength', 'Incline Dumbbell Press', 3, 10, 20::real, 2),
  ('Upper Body Strength', 'Lat Pulldown', 3, 10, 45::real, 2),
  ('Upper Body Strength', 'Overhead Press', 3, 8, 35::real, 4),
  ('Lower Body & Core', 'Barbell Back Squat', 4, 6, 85::real, 1),
  ('Lower Body & Core', 'Romanian Deadlift', 3, 8, 70::real, 1),
  ('Lower Body & Core', 'Conventional Deadlift', 3, 5, 90::real, 4)
) AS plan(program_name, exercise_name, sets, reps, weight, week_day)
JOIN workout_programs p ON p.name = plan.program_name AND p.is_personal = false
JOIN program_content pc ON pc.program_id = p.id AND pc.week_number = 1
JOIN exercises e ON e.name = plan.exercise_name
WHERE NOT EXISTS (
  SELECT 1 FROM exercises_in_programs ep
  WHERE ep.program_content_id = pc.id AND ep.exercise_id = e.id AND ep.week_day = plan.week_day
);
