import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import { Client, type PoolClient, type QueryResultRow } from 'pg';
import { validateCatalog } from './catalog-validate';
import {
  assertMediaReady,
  initialLikesAdjustment,
  parseCatalogImportArgs,
  preservedLikesAdjustment,
  readyVideoUrl,
  sameCatalogShape,
} from './catalog-import.logic';

type Translation = { name: string; description: string; aliases: string[] };
type Exercise = {
  catalogKey: string;
  sourceNames: string[];
  name: { en: string; uk: string };
  description: { en: string; uk: string };
  aliases: { en: string[]; uk: string[] };
  muscles: { primary: { en: string }; secondary: { en: string }[] };
  equipment: { required: string[]; alternatives: string[][] };
  difficulty: number;
  initialLikes: number;
  measurementType: 'reps' | 'duration';
  recommendations: {
    sets: number | null;
    reps: number | null;
    duration: number | null;
  };
  media: {
    status: string;
    demonstrationImage: { localFile: string | null };
    videos: { en: string | null; uk: string | null };
  };
};
type Program = {
  catalogKey: string;
  name: { en: string; uk: string };
  description: { en: string; uk: string };
  initialLikes: number;
  exerciseCatalogKeys: string[];
  media: { status: string; videos: { en: string | null; uk: string | null } };
};
type Catalog = {
  exercises: Exercise[];
  programs: Program[];
  muscles: {
    name: { en: string; uk: string };
    aliases: { en: string[]; uk: string[] };
  }[];
};
type MediaRegistryEntry = {
  catalogKey: string;
  image: {
    status: string;
    objectKey: string | null;
    sourcePage: string | null;
    attribution: string | null;
    license: string | null;
    licenseUrl: string | null;
  };
  videos: {
    en: { status: string; url: string | null };
    uk: { status: string; url: string | null };
  };
};
type Counts = {
  muscles: number;
  exercisesCreated: number;
  exercisesUpdated: number;
  exercisesUnchanged: number;
  programsCreated: number;
  programsRevised: number;
  programsUnchanged: number;
};

const { apply, adoptLegacy, allowMissingMedia } = parseCatalogImportArgs(
  process.argv.slice(2),
);
const normalize = (value: string) => value.trim().toLocaleLowerCase('en-US');

async function queryOne<T extends QueryResultRow>(
  client: PoolClient | Client,
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const result = await client.query<T>(text, values);
  return result.rows[0] ?? null;
}
const same = sameCatalogShape;

async function upsertTranslation(
  client: PoolClient | Client,
  table: 'exercise_translations' | 'workout_program_translations',
  foreignKey: 'exercise_id' | 'workout_program_id',
  id: number,
  locale: 'en' | 'uk',
  value: Translation,
  videoUrl: string | null,
) {
  await client.query(
    `insert into ${table} (${foreignKey},locale,name,description,video_url,aliases) values ($1,$2,$3,$4,$5,$6) on conflict (${foreignKey},locale) do update set name=excluded.name,description=excluded.description,video_url=excluded.video_url,aliases=excluded.aliases`,
    [id, locale, value.name, value.description, videoUrl, value.aliases],
  );
}

async function loadProgramShape(client: PoolClient | Client, id: number) {
  const translations = (
    await client.query(
      `select locale,name,description,video_url as "videoUrl",aliases from workout_program_translations where workout_program_id=$1 order by locale`,
      [id],
    )
  ).rows;
  const exercises = (
    await client.query(
      `select e.catalog_key as "catalogKey",eip.position,eip.sets,eip.first_set_rep_count as reps,eip.target_duration_seconds as duration from program_content pc join exercises_in_programs eip on eip.program_content_id=pc.id join exercises e on e.id=eip.exercise_id where pc.program_id=$1 order by pc.week_number,eip.week_day,eip.position`,
      [id],
    )
  ).rows;
  return { translations, exercises };
}

async function enqueue(
  client: PoolClient | Client,
  type: 'exercise' | 'program',
  id: number,
  change: 'upsert' | 'retire',
) {
  const eventType =
    type === 'exercise'
      ? 'catalog.exercise.changed'
      : 'catalog.program.changed';
  const payload =
    type === 'exercise'
      ? { exerciseId: id, change }
      : { programId: id, ownerId: null, change };
  await client.query(
    `insert into outbox_events (aggregate_type,aggregate_id,event_type,event_version,payload) values ($1,$2,$3,1,$4)`,
    [type, String(id), eventType, payload],
  );
}

async function run() {
  const source = JSON.parse(
    await readFile('data/catalog/figma-source.json', 'utf8'),
  );
  const catalog = JSON.parse(
    await readFile('data/catalog/catalog.normalized.json', 'utf8'),
  ) as Catalog;
  const mediaRegistry = JSON.parse(
    await readFile('data/catalog/media-registry.json', 'utf8'),
  ) as { entries: MediaRegistryEntry[] };
  const mediaByCatalogKey = new Map(
    mediaRegistry.entries.map((entry) => [entry.catalogKey, entry]),
  );
  validateCatalog(source, catalog);
  const missingMedia = assertMediaReady(
    [...catalog.exercises, ...catalog.programs],
    apply,
    allowMissingMedia,
  );
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const counts: Counts = {
    muscles: 0,
    exercisesCreated: 0,
    exercisesUpdated: 0,
    exercisesUnchanged: 0,
    programsCreated: 0,
    programsRevised: 0,
    programsUnchanged: 0,
  };
  await client.connect();
  try {
    await client.query('begin');
    await client.query(
      `select pg_advisory_xact_lock(hashtext('hit-tracker-catalog-import'))`,
    );
    if (
      !(
        await queryOne(
          client,
          `select to_regclass('exercise_translations') as table_name`,
        )
      )?.['table_name']
    )
      throw new Error('Catalog migration is not applied.');
    const muscleRows = (
      await client.query<{ id: number; common_name: string }>(
        'select id,common_name from muscles order by id for update',
      )
    ).rows;
    const muscleIds = new Map(
      muscleRows.map((row) => [normalize(row.common_name), row.id]),
    );
    for (const item of catalog.muscles) {
      const candidates = [
        item.name.en,
        ...item.aliases.en,
        ...item.aliases.uk,
      ].map(normalize);
      const matches = [
        ...new Set(
          candidates
            .map((name) => muscleIds.get(name))
            .filter((id): id is number => id !== undefined),
        ),
      ];
      if (matches.length > 1)
        throw new Error(
          `Ambiguous muscle mapping for ${item.name.en}: ${matches.join(', ')}`,
        );
      let id = matches[0];
      if (!id) {
        id = (await queryOne<{ id: number }>(
          client,
          'insert into muscles (common_name) values ($1) returning id',
          [item.name.en],
        ))!.id;
        counts.muscles++;
      }
      for (const candidate of candidates) muscleIds.set(candidate, id);
    }

    const exerciseIds = new Map<string, number>();
    for (const item of catalog.exercises) {
      const media = mediaByCatalogKey.get(item.catalogKey);
      const image = media?.image;
      const englishVideo = readyVideoUrl(
        media?.videos.en,
        item.media.videos.en,
      );
      const ukrainianVideo = readyVideoUrl(
        media?.videos.uk,
        item.media.videos.uk,
      );
      let current = await queryOne<any>(
        client,
        'select * from exercises where catalog_key=$1 for update',
        [item.catalogKey],
      );
      if (!current) {
        const legacy = (
          await client.query<any>(
            'select * from exercises where catalog_key is null and lower(name)=any($1::text[]) for update',
            [[item.name.en, ...item.sourceNames].map(normalize)],
          )
        ).rows;
        if (legacy.length > 1)
          throw new Error(`Multiple legacy exercises match ${item.catalogKey}`);
        if (legacy.length && !adoptLegacy)
          throw new Error(
            `Legacy exercise ${legacy[0].id} matches ${item.catalogKey}; rerun with --adopt-legacy after review.`,
          );
        current = legacy[0] ?? null;
      }
      const adoptedLegacy = Boolean(current && !current.catalog_key);
      const actualLikes = adoptedLegacy
        ? Number(
            (
              await queryOne<{ count: string }>(
                client,
                'select count(*)::text as count from exercise_likes where exercise_id=$1',
                [current.id],
              )
            )?.count ?? 0,
          )
        : 0;
      const legacyEquipment = [
        ...item.equipment.required,
        ...item.equipment.alternatives.flat(),
      ];
      const values = [
        item.name.en,
        item.catalogKey,
        item.description.en,
        legacyEquipment,
        item.equipment,
        englishVideo,
        item.difficulty,
        item.measurementType,
        item.recommendations.duration,
        item.recommendations.sets,
        item.recommendations.reps,
        image?.objectKey ?? null,
        image?.sourcePage ?? null,
        image?.attribution ?? null,
        image?.license ?? null,
        image?.licenseUrl ?? null,
        !current || adoptedLegacy
          ? initialLikesAdjustment(item.initialLikes, actualLikes)
          : current.likes_adjustment,
      ];
      let id: number;
      let coreChanged = !current;
      if (!current) {
        id = (await queryOne<{ id: number }>(
          client,
          `insert into exercises (name,catalog_key,description,equipment,equipment_structured,video_url,difficulty,measurement_type,recommended_duration_seconds,recommended_sets,recommended_reps,demonstration_image_key,demonstration_image_source_url,demonstration_image_author,demonstration_image_license,demonstration_image_license_url,likes_adjustment) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
          values,
        ))!.id;
      } else {
        id = current.id;
        const desired = {
          name: values[0],
          catalog_key: values[1],
          description: values[2],
          equipment: values[3],
          equipment_structured: values[4],
          video_url: values[5],
          difficulty: values[6],
          measurement_type: values[7],
          recommended_duration_seconds: values[8],
          recommended_sets: values[9],
          recommended_reps: values[10],
          demonstration_image_key: values[11],
          demonstration_image_source_url: values[12],
          demonstration_image_author: values[13],
          demonstration_image_license: values[14],
          demonstration_image_license_url: values[15],
          likes_adjustment: values[16],
        };
        coreChanged = Object.entries(desired).some(
          ([key, value]) => !same(current[key], value),
        );
        if (coreChanged)
          await client.query(
            `update exercises set name=$1,catalog_key=$2,description=$3,equipment=$4,equipment_structured=$5,video_url=$6,difficulty=$7,measurement_type=$8,recommended_duration_seconds=$9,recommended_sets=$10,recommended_reps=$11,demonstration_image_key=$12,demonstration_image_source_url=$13,demonstration_image_author=$14,demonstration_image_license=$15,demonstration_image_license_url=$16,likes_adjustment=$17 where id=$18`,
            [...values, id],
          );
      }
      exerciseIds.set(item.catalogKey, id);
      const desiredTranslations = [
        {
          locale: 'en',
          name: item.name.en,
          description: item.description.en,
          videoUrl: englishVideo,
          aliases: item.aliases.en,
        },
        {
          locale: 'uk',
          name: item.name.uk,
          description: item.description.uk,
          videoUrl: ukrainianVideo,
          aliases: item.aliases.uk,
        },
      ];
      const desiredMuscles = (['primary', 'secondary'] as const)
        .flatMap((role) =>
          (role === 'primary'
            ? [item.muscles.primary]
            : item.muscles.secondary
          ).map((m) => ({ role, name: m.en })),
        )
        .sort((a, b) =>
          `${a.role}:${a.name}`.localeCompare(`${b.role}:${b.name}`),
        );
      const storedTranslations = current
        ? (
            await client.query(
              `select locale,name,description,video_url as "videoUrl",aliases from exercise_translations where exercise_id=$1 order by locale`,
              [id],
            )
          ).rows
        : [];
      const storedMuscles = current
        ? (
            await client.query(
              `select etm.role,m.common_name as name from exercises_train_muscles etm join muscles m on m.id=etm.muscle_id where etm.exercise_id=$1 order by etm.role,m.common_name`,
              [id],
            )
          ).rows
        : [];
      const relationsChanged =
        !same(storedTranslations, desiredTranslations) ||
        !same(storedMuscles, desiredMuscles);
      if (!current || relationsChanged) {
        await upsertTranslation(
          client,
          'exercise_translations',
          'exercise_id',
          id,
          'en',
          {
            name: item.name.en,
            description: item.description.en,
            aliases: item.aliases.en,
          },
          englishVideo,
        );
        await upsertTranslation(
          client,
          'exercise_translations',
          'exercise_id',
          id,
          'uk',
          {
            name: item.name.uk,
            description: item.description.uk,
            aliases: item.aliases.uk,
          },
          ukrainianVideo,
        );
        await client.query(
          'delete from exercises_train_muscles where exercise_id=$1',
          [id],
        );
        for (const [role, list] of [
          ['primary', [item.muscles.primary]],
          ['secondary', item.muscles.secondary],
        ] as const) {
          for (const m of list) {
            const muscleId = muscleIds.get(normalize(m.en));
            if (!muscleId) throw new Error(`Unresolved muscle ${m.en}`);
            await client.query(
              'insert into exercises_train_muscles (exercise_id,muscle_id,role) values ($1,$2,$3)',
              [id, muscleId, role],
            );
          }
        }
      }
      if (!current) {
        counts.exercisesCreated++;
        await enqueue(client, 'exercise', id, 'upsert');
      } else if (coreChanged || relationsChanged) {
        counts.exercisesUpdated++;
        await enqueue(client, 'exercise', id, 'upsert');
      } else counts.exercisesUnchanged++;
    }

    for (const item of catalog.programs) {
      const media = mediaByCatalogKey.get(item.catalogKey);
      const englishVideo = readyVideoUrl(
        media?.videos.en,
        item.media.videos.en,
      );
      const ukrainianVideo = readyVideoUrl(
        media?.videos.uk,
        item.media.videos.uk,
      );
      const current = await queryOne<any>(
        client,
        'select * from workout_programs where catalog_key=$1 and is_active=true for update',
        [item.catalogKey],
      );
      const desiredTranslations = [
        {
          locale: 'en',
          name: item.name.en,
          description: item.description.en,
          videoUrl: englishVideo,
          aliases: [],
        },
        {
          locale: 'uk',
          name: item.name.uk,
          description: item.description.uk,
          videoUrl: ukrainianVideo,
          aliases: [],
        },
      ];
      const desiredExercises = item.exerciseCatalogKeys.map(
        (catalogKey, position) => ({
          catalogKey,
          position: position + 1,
          sets: null,
          reps: null,
          duration: null,
        }),
      );
      let changed = true;
      if (current) {
        const shape = await loadProgramShape(client, current.id);
        changed = !same(
          {
            record: {
              name: current.name,
              description: current.description,
              videoUrl: current.video_url,
            },
            ...shape,
          },
          {
            record: {
              name: item.name.en,
              description: item.description.en,
              videoUrl: englishVideo,
            },
            translations: desiredTranslations,
            exercises: desiredExercises,
          },
        );
      }
      if (current && !changed) {
        counts.programsUnchanged++;
        continue;
      }
      if (current) {
        await client.query(
          'update workout_programs set is_active=false,catalog_key=null where id=$1',
          [current.id],
        );
        await enqueue(client, 'program', current.id, 'retire');
        counts.programsRevised++;
      } else counts.programsCreated++;
      const actualLikes = current
        ? Number(
            (
              await queryOne<{ count: string }>(
                client,
                'select count(*)::text as count from program_likes where program_id=$1',
                [current.id],
              )
            )?.count ?? 0,
          )
        : 0;
      const likesAdjustment = current
        ? preservedLikesAdjustment(actualLikes, current.likes_adjustment)
        : initialLikesAdjustment(item.initialLikes, 0);
      const program = (await queryOne<{ id: number }>(
        client,
        `insert into workout_programs (name,description,catalog_key,video_url,is_personal,is_active,source_program_id,likes_adjustment) values ($1,$2,$3,$4,false,true,$5,$6) returning id`,
        [
          item.name.en,
          item.description.en,
          item.catalogKey,
          englishVideo,
          current?.id ?? null,
          likesAdjustment,
        ],
      ))!;
      if (current) {
        await client.query(
          'update program_likes set program_id=$1 where program_id=$2',
          [program.id, current.id],
        );
      }
      await upsertTranslation(
        client,
        'workout_program_translations',
        'workout_program_id',
        program.id,
        'en',
        { name: item.name.en, description: item.description.en, aliases: [] },
        englishVideo,
      );
      await upsertTranslation(
        client,
        'workout_program_translations',
        'workout_program_id',
        program.id,
        'uk',
        { name: item.name.uk, description: item.description.uk, aliases: [] },
        ukrainianVideo,
      );
      const content = (await queryOne<{ id: number }>(
        client,
        'insert into program_content (week_number,program_id) values (1,$1) returning id',
        [program.id],
      ))!;
      for (const [index, key] of item.exerciseCatalogKeys.entries()) {
        const exerciseId = exerciseIds.get(key);
        if (!exerciseId)
          throw new Error(
            `Program ${item.catalogKey} references missing ${key}`,
          );
        await client.query(
          'insert into exercises_in_programs (program_content_id,exercise_id,position,week_day) values ($1,$2,$3,0)',
          [content.id, exerciseId, index + 1],
        );
      }
      await enqueue(client, 'program', program.id, 'upsert');
    }
    await client.query(`select pg_notify('outbox_events','')`);
    if (apply) await client.query('commit');
    else await client.query('rollback');
    console.log(
      JSON.stringify(
        { mode: apply ? 'apply' : 'dry-run', counts, missingMedia },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
