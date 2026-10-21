-- EN: Keeps duration-based set facts separate from repetition and weight metrics.
-- UK: Зберігає факти часових підходів окремо від метрик повторень і ваги.

ALTER TABLE "finished_sets" ADD COLUMN "duration_seconds" integer;
