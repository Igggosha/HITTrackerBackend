import type { Pool, PoolClient } from 'pg';
import { catalogAliases } from './catalog-aliases';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type ProgramSearchDocument = {
  id: number;
  name: string;
  aliases: string[];
  description: string;
  isPersonal: boolean;
  isActive: boolean;
  ownerId: number | null;
  createdAt: string;
  likesCount: number;
  exerciseNames: string[];
  muscleIds: number[];
  muscleNames: string[];
  hasImage: boolean;
  deleted: false;
};

export type ExerciseSearchDocument = {
  id: number;
  name: string;
  aliases: string[];
  description: string;
  createdAt: string;
  likesCount: number;
  muscleIds: number[];
  muscleNames: string[];
  hasImage: boolean;
  deleted: false;
};

export async function programDocuments(
  executor: Queryable,
  ids?: readonly number[],
): Promise<ProgramSearchDocument[]> {
  const result = await executor.query<{
    id: number;
    name: string;
    description: string | null;
    isPersonal: boolean;
    isActive: boolean;
    ownerId: number | null;
    createdAt: Date;
    likesCount: number;
    exerciseNames: string[];
    muscleIds: number[];
    muscleNames: string[];
    hasImage: boolean;
  }>(
    `select p.id, p.name, p.description,
            p.is_personal as "isPersonal", p.is_active as "isActive",
            p.created_by_id as "ownerId", p.created_at as "createdAt",
            (select count(*)::int from program_likes pl where pl.program_id = p.id) as "likesCount",
            coalesce((select array_agg(distinct e.name order by e.name)
              from program_content pc
              join exercises_in_programs eip on eip.program_content_id = pc.id
              join exercises e on e.id = eip.exercise_id
              where pc.program_id = p.id), '{}'::text[]) as "exerciseNames",
            coalesce((select array_agg(distinct etm.muscle_id order by etm.muscle_id)
              from program_content pc
              join exercises_in_programs eip on eip.program_content_id = pc.id
              join exercises_train_muscles etm on etm.exercise_id = eip.exercise_id
              where pc.program_id = p.id), '{}'::int[]) as "muscleIds",
            coalesce((select array_agg(distinct m.common_name order by m.common_name)
              from program_content pc
              join exercises_in_programs eip on eip.program_content_id = pc.id
              join exercises_train_muscles etm on etm.exercise_id = eip.exercise_id
              join muscles m on m.id = etm.muscle_id
              where pc.program_id = p.id), '{}'::text[]) as "muscleNames",
            (p.image_key is not null) as "hasImage"
       from workout_programs p
      where ($1::int[] is null or p.id = any($1::int[]))
      order by p.id`,
    [ids ? [...ids] : null],
  );
  return result.rows.map((row) => ({
    ...row,
    aliases: row.isPersonal ? [row.name] : catalogAliases('program', row.name),
    description: row.description ?? '',
    createdAt: row.createdAt.toISOString(),
    muscleNames: row.muscleNames.flatMap((name) =>
      catalogAliases('muscle', name),
    ),
    deleted: false,
  }));
}

export async function exerciseDocuments(
  executor: Queryable,
  ids?: readonly number[],
): Promise<ExerciseSearchDocument[]> {
  const result = await executor.query<{
    id: number;
    name: string;
    description: string | null;
    createdAt: Date;
    likesCount: number;
    muscleIds: number[];
    muscleNames: string[];
    hasImage: boolean;
  }>(
    `select e.id, e.name, e.description,
            timestamp '1970-01-01' as "createdAt",
            (select count(*)::int from exercise_likes el where el.exercise_id = e.id) as "likesCount",
            coalesce(array_agg(distinct m.id order by m.id) filter (where m.id is not null), '{}'::int[]) as "muscleIds",
            coalesce(array_agg(distinct m.common_name order by m.common_name) filter (where m.id is not null), '{}'::text[]) as "muscleNames",
            (e.image_key is not null) as "hasImage"
       from exercises e
       left join exercises_train_muscles etm on etm.exercise_id = e.id
       left join muscles m on m.id = etm.muscle_id
      where ($1::int[] is null or e.id = any($1::int[]))
      group by e.id
      order by e.id`,
    [ids ? [...ids] : null],
  );
  return result.rows.map((row) => ({
    ...row,
    aliases: catalogAliases('exercise', row.name),
    description: row.description ?? '',
    createdAt: row.createdAt.toISOString(),
    muscleNames: row.muscleNames.flatMap((name) =>
      catalogAliases('muscle', name),
    ),
    deleted: false,
  }));
}

export async function programIdsForExercise(
  executor: Queryable,
  exerciseId: number,
): Promise<number[]> {
  const result = await executor.query<{ id: number }>(
    `select distinct pc.program_id as id
       from program_content pc
       join exercises_in_programs eip on eip.program_content_id = pc.id
      where eip.exercise_id = $1`,
    [exerciseId],
  );
  return result.rows.map(({ id }) => id);
}
