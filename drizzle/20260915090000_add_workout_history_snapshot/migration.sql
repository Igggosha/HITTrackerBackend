-- EN: Stores an immutable JSON snapshot so completed workout history remains readable after programs or exercises change.
-- UK: Зберігає незмінний JSON-знімок, щоб історія завершеного тренування залишалася читабельною після змін програм або вправ.

ALTER TABLE "workouts" ADD COLUMN "history_snapshot" jsonb;
