import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Client, estypes } from '@elastic/elasticsearch';
import { pool } from '../db/db';
import { StorageService } from '../storage/storage.service';
import { MetricsService } from '../metrics/metrics.service';
import { aliasesFor } from './catalog-search.constants';
import { SEARCH_CLIENT } from './elasticsearch.client';
import { buildCatalogQuery, searchSort } from './query-builder';
import type { CatalogSearchDto } from './dto/catalog-search.dto';

const unavailable = () =>
  new ServiceUnavailableException({
    message: 'Search is temporarily unavailable',
    code: 'SEARCH_UNAVAILABLE',
  });

function decodeCursor(cursor?: string): estypes.FieldValue[] | undefined {
  if (!cursor) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString(),
    ) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length > 3 ||
      parsed.some(
        (value) =>
          !['string', 'number', 'boolean'].includes(typeof value) &&
          value !== null,
      )
    )
      throw new Error();
    return parsed as estypes.FieldValue[];
  } catch {
    return undefined;
  }
}

function encodeCursor(sort?: readonly estypes.FieldValue[]): string | null {
  return sort?.length
    ? Buffer.from(JSON.stringify(sort)).toString('base64url')
    : null;
}

@Injectable()
export class CatalogSearchService {
  constructor(
    @Inject(SEARCH_CLIENT) private readonly client: Client | null,
    private readonly storage: StorageService,
    private readonly metrics: MetricsService,
  ) {}

  async search(userId: number, dto: CatalogSearchDto) {
    const started = process.hrtime.bigint();
    if (!this.client) {
      this.record('error', started);
      throw unavailable();
    }
    try {
      const allowedIds =
        dto.scope === 'saved'
          ? await this.savedIds(userId, dto.section)
          : undefined;
      if (allowedIds && !allowedIds.length) {
        this.record('ok', started);
        return { items: [], nextCursor: null, fallback: false };
      }
      const response = await this.client.search({
        index: aliasesFor(dto.section).read,
        size: dto.limit + 1,
        query: buildCatalogQuery({
          q: dto.q,
          section: dto.section,
          userId,
          scope: dto.scope,
          muscle: dto.muscle,
          allowedIds,
        }),
        sort: searchSort(dto.sort, dto.section),
        ...(decodeCursor(dto.cursor)
          ? { search_after: decodeCursor(dto.cursor) }
          : {}),
        track_total_hits: false,
        _source: false,
      });
      const page = response.hits.hits.slice(0, dto.limit);
      const ids = page
        .map((hit) => Number(hit._id))
        .filter((id) => Number.isInteger(id));
      const items =
        dto.section === 'programs'
          ? await this.programs(userId, ids)
          : await this.exercises(userId, ids);
      const nextCursor =
        response.hits.hits.length > dto.limit
          ? encodeCursor(page.at(-1)?.sort)
          : null;
      this.record('ok', started);
      return { items, nextCursor, fallback: false };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.record('error', started);
      throw unavailable();
    }
  }

  private record(result: 'ok' | 'error', started: bigint) {
    this.metrics.searchRequests.inc({ result });
    this.metrics.searchDuration.observe(
      { result },
      Number(process.hrtime.bigint() - started) / 1e9,
    );
  }

  private async savedIds(
    userId: number,
    section: 'programs' | 'exercises',
  ): Promise<number[]> {
    const result = await pool.query<{ id: number }>(
      section === 'programs'
        ? 'select program_id as id from program_likes where user_id = $1'
        : 'select exercise_id as id from exercise_bookmarks where user_id = $1',
      [userId],
    );
    return result.rows.map(({ id }) => id);
  }

  private async programs(userId: number, ids: number[]) {
    if (!ids.length) return [];
    const result = await pool.query<{
      id: number;
      name: string;
      description: string | null;
      videoUrl: string | null;
      imageKey: string | null;
      isPersonal: boolean;
      createdAt: Date;
      ownerUsername: string | null;
      createdById: number | null;
      likesCount: number;
      isLiked: boolean;
      isScheduled: boolean;
      schedule: Array<Record<string, unknown>>;
    }>(
      `select p.id, p.name, p.description, p.video_url as "videoUrl", p.image_key as "imageKey",
              p.is_personal as "isPersonal", p.created_at as "createdAt",
              u.username as "ownerUsername", p.created_by_id as "createdById",
              (select count(*)::int from program_likes pl where pl.program_id = p.id) as "likesCount",
              exists(select 1 from program_likes pl where pl.program_id = p.id and pl.user_id = $2) as "isLiked",
              (exists(select 1 from user_program_schedule s where s.program_id = p.id and s.user_id = $2)
               or exists(select 1 from user_program_schedule_series ss where ss.program_id = p.id and ss.user_id = $2)) as "isScheduled",
              coalesce((select jsonb_agg(jsonb_build_object(
                'programId', pc.program_id, 'week', pc.week_number, 'weekDay', eip.week_day,
                'setsCount', eip.sets, 'targetReps', eip.first_set_rep_count,
                'plannedWeight', eip.weight, 'exercise', jsonb_build_object('id', e.id, 'name', e.name))
                order by pc.week_number, eip.week_day, eip.id)
                from program_content pc
                join exercises_in_programs eip on eip.program_content_id = pc.id
                join exercises e on e.id = eip.exercise_id
                where pc.program_id = p.id), '[]'::jsonb) as schedule
         from workout_programs p
         left join users u on u.id = p.created_by_id
        where p.id = any($1::int[])
          and ((p.is_personal = false and p.is_active = true)
            or (p.is_personal = true and p.created_by_id = $2))
        order by array_position($1::int[], p.id)`,
      [ids, userId],
    );
    return Promise.all(
      result.rows.map(async ({ imageKey, ...row }) => ({
        ...row,
        imageUrl: await this.storage.getUrl(imageKey),
      })),
    );
  }

  private async exercises(userId: number, ids: number[]) {
    if (!ids.length) return [];
    const result = await pool.query<{
      id: number;
      name: string;
      description: string | null;
      videoUrl: string | null;
      imageKey: string | null;
      difficulty: number;
      likesCount: number;
      isLiked: boolean;
      isBookmarked: boolean;
      muscles: Array<Record<string, unknown>>;
    }>(
      `select e.id, e.name, e.description, e.video_url as "videoUrl", e.image_key as "imageKey", e.difficulty,
              (select count(*)::int from exercise_likes el where el.exercise_id = e.id) as "likesCount",
              exists(select 1 from exercise_likes el where el.exercise_id = e.id and el.user_id = $2) as "isLiked",
              exists(select 1 from exercise_bookmarks eb where eb.exercise_id = e.id and eb.user_id = $2) as "isBookmarked",
              coalesce(jsonb_agg(distinct jsonb_build_object('id', m.id, 'name', m.common_name,
                'commonName', m.common_name, 'scientificName', m.scientific_name))
                filter (where m.id is not null), '[]'::jsonb) as muscles
         from exercises e
         left join exercises_train_muscles etm on etm.exercise_id = e.id
         left join muscles m on m.id = etm.muscle_id
        where e.id = any($1::int[])
        group by e.id
        order by array_position($1::int[], e.id)`,
      [ids, userId],
    );
    return Promise.all(
      result.rows.map(async ({ imageKey, ...row }) => ({
        ...row,
        imageUrl: await this.storage.getUrl(imageKey),
      })),
    );
  }
}
