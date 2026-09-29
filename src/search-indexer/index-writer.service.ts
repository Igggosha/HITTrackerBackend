import { Inject, Injectable } from '@nestjs/common';
import type { Client } from '@elastic/elasticsearch';
import { pool } from '../db/db';
import type {
  CatalogExerciseChangedV1,
  CatalogProgramChangedV1,
  EventEnvelope,
  UserDeletedV1,
} from '../../packages/event-contracts/events';
import {
  exerciseDocuments,
  programIdsForExercise,
  programDocuments,
} from '../catalog-search/catalog-documents';
import {
  EXERCISES_WRITE_ALIAS,
  PROGRAMS_WRITE_ALIAS,
} from '../catalog-search/catalog-search.constants';
import { SEARCH_CLIENT } from '../catalog-search/elasticsearch.client';

const newerOnly = `
  if (ctx._source.lastEventAt == null || params.at.compareTo(ctx._source.lastEventAt) > 0 ||
      (params.at == ctx._source.lastEventAt && params.id.compareTo(ctx._source.lastEventId) >= 0)) {
    ctx._source = params.doc;
  } else { ctx.op = 'none'; }
`;

@Injectable()
export class IndexWriterService {
  constructor(@Inject(SEARCH_CLIENT) private readonly client: Client) {}

  async health() {
    const health = await this.client.cluster.health();
    const counts = await Promise.all(
      [PROGRAMS_WRITE_ALIAS, EXERCISES_WRITE_ALIAS].map((index) =>
        this.client
          .count({ index, query: { term: { deleted: false } } })
          .then(({ count }) => count)
          .catch(() => 0),
      ),
    );
    return {
      healthy: health.status !== 'red',
      programs: counts[0],
      exercises: counts[1],
    };
  }

  async apply(
    envelope: EventEnvelope,
    targets: { programs?: string; exercises?: string } = {},
  ): Promise<'applied' | 'ignored'> {
    switch (envelope.type) {
      case 'catalog.program.changed':
        await this.program(
          envelope,
          envelope.payload as CatalogProgramChangedV1,
          targets.programs ?? PROGRAMS_WRITE_ALIAS,
        );
        return 'applied';
      case 'catalog.exercise.changed':
        await this.exercise(
          envelope,
          envelope.payload as CatalogExerciseChangedV1,
          targets.exercises ?? EXERCISES_WRITE_ALIAS,
          targets.programs ?? PROGRAMS_WRITE_ALIAS,
        );
        return 'applied';
      case 'user.deleted':
        await this.userDeleted(
          envelope,
          envelope.payload as UserDeletedV1,
          targets.programs ?? PROGRAMS_WRITE_ALIAS,
        );
        return 'applied';
      default:
        return 'ignored';
    }
  }

  private async program(
    envelope: EventEnvelope,
    payload: CatalogProgramChangedV1,
    index: string,
  ) {
    const [document] = await programDocuments(pool, [payload.programId]);
    await this.upsert(index, payload.programId, document, envelope);
  }

  private async exercise(
    envelope: EventEnvelope,
    payload: CatalogExerciseChangedV1,
    index: string,
    programsIndex: string,
  ) {
    const [document] = await exerciseDocuments(pool, [payload.exerciseId]);
    await this.upsert(index, payload.exerciseId, document, envelope);
    const dependentPrograms = document
      ? await programDocuments(
          pool,
          await programIdsForExercise(pool, payload.exerciseId),
        )
      : await programDocuments(pool);
    for (const program of dependentPrograms) {
      await this.upsert(programsIndex, program.id, program, envelope);
    }
  }

  private async upsert(
    index: string,
    id: number,
    document: Record<string, unknown> | undefined,
    envelope: EventEnvelope,
  ) {
    const doc = document
      ? {
          ...document,
          lastEventAt: envelope.occurredAt,
          lastEventId: envelope.id,
        }
      : {
          id,
          deleted: true,
          lastEventAt: envelope.occurredAt,
          lastEventId: envelope.id,
        };
    await this.client.update({
      index,
      id: String(id),
      scripted_upsert: true,
      script: {
        lang: 'painless',
        source: newerOnly,
        params: { at: envelope.occurredAt, id: envelope.id, doc },
      },
      upsert: doc,
      refresh: false,
    });
  }

  private async userDeleted(
    envelope: EventEnvelope,
    payload: UserDeletedV1,
    index: string,
  ) {
    await this.client.updateByQuery({
      index,
      conflicts: 'proceed',
      refresh: false,
      query: { term: { ownerId: payload.userId } },
      script: {
        lang: 'painless',
        source: `
          if (ctx._source.lastEventAt == null || params.at.compareTo(ctx._source.lastEventAt) > 0 ||
              (params.at == ctx._source.lastEventAt && params.id.compareTo(ctx._source.lastEventId) >= 0)) {
            ctx._source.deleted = true;
            ctx._source.lastEventAt = params.at;
            ctx._source.lastEventId = params.id;
          } else { ctx.op = 'noop'; }
        `,
        params: { at: envelope.occurredAt, id: envelope.id },
      },
    });
  }
}
