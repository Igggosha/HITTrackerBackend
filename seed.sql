-- Очищення таблиць
TRUNCATE TABLE 
  sets, workouts, users_current_workout_programs, 
  exercises_in_programs, program_content, workout_programs, 
  exercises_train_muscles, exercises, muscles, 
  user_body_metrics, users 
RESTART IDENTITY CASCADE;

-- 1. Користувач
INSERT INTO users (email, username, password_hash, age, gender, height, goal) 
VALUES ('bohdan@example.com', 'bohdan_dev', 'hash123', 25, 'male', 180, 'hypertrophy');

-- 2. М'язи
INSERT INTO muscles (common_name, scientific_name) VALUES
('Chest', 'Pectoralis Major'),
('Lats', 'Latissimus Dorsi'),
('Quadriceps', 'Quadriceps Femoris'),
('Hamstrings', 'Biceps Femoris'),
('Deltoids', 'Deltoideus'),
('Triceps', 'Triceps Brachii'),
('Biceps', 'Biceps Brachii'),
('Abs', 'Rectus Abdominis'),
('Lower Back', 'Erector Spinae');

-- 3. Вправи
INSERT INTO exercises (name) VALUES
('Barbell Bench Press'),
('Incline Dumbbell Press'),
('Pull-ups'),
('Lat Pulldown'),
('Barbell Back Squat'),
('Romanian Deadlift'),
('Overhead Press'),
('Conventional Deadlift');

-- 4. Зв'язок вправ і м'язів
INSERT INTO exercises_train_muscles (exercise_id, muscle_id) VALUES
(1, 1), (1, 6), -- Bench Press -> Chest, Triceps
(2, 1),         -- Incline Press -> Chest
(3, 2), (3, 7), -- Pull-ups -> Lats, Biceps
(4, 2),         -- Lat Pulldown -> Lats
(5, 3),         -- Squat -> Quads
(6, 4),         -- RDL -> Hamstrings
(7, 5),         -- OHP -> Deltoids
(8, 9);         -- Deadlift -> Lower Back

-- 5. Програма тренувань
INSERT INTO workout_programs (name, created_by_id) VALUES ('HIT Classic Full Body', 1);

-- 6. Тиждень 1
INSERT INTO program_content (program_id, week_number) VALUES (1, 1);

-- 7. Вправи у тижні (Пн=0, Ср=2)
INSERT INTO exercises_in_programs (program_content_id, exercise_id, sets, first_set_rep_count, weight, week_day) VALUES
(1, 5, 1, 8, 100, 0), -- Squat
(1, 1, 1, 6, 85, 0),  -- Bench
(1, 8, 1, 5, 120, 2); -- Deadlift