/**
 * Rebuild every read model from the Kafka log (CQRS demo):
 *
 *   docker compose --profile events stop analytics
 *   docker compose --profile events run --rm --no-deps analytics \
 *     node dist/services/analytics/src/cli/rebuild-projections.js
 *   docker compose --profile events start analytics
 *
 * 1. resets the `analytics` consumer group to the EARLIEST offset of each
 *    source topic (same as `kafka-consumer-groups.sh --reset-offsets
 *    --to-earliest --execute`; Kafka refuses it while the group has live
 *    members, which is why the service is stopped first);
 * 2. truncates the read models, the facts and `processed_events`.
 *
 * Both steps are idempotent, and either order of a partial failure is safe
 * to re-run: offsets reset but tables not truncated -> replay is deduplicated
 * by processed_events; the command is simply run again to finish.
 *
 * No `tracing/register` import here, deliberately: this is a one-shot admin
 * command (reset offsets, truncate tables, exit), not a Nest application and
 * not a message consumer - there is no request/consumer span for it to join,
 * and every replayed message gets its own fresh CONSUMER span from the
 * running `analytics` service once it is restarted afterwards. Adding
 * `initTracing`/`shutdownTracing` here would only add SDK startup/flush
 * latency to a command whose own run is never itself part of a trace. See
 * docs/diploma/tracing.md.
 */
import { sql } from 'drizzle-orm';
import { loadConfig } from '../config/environment';
import { createKafka, SOURCE_TOPICS } from '../consumer/kafka-consumer.service';
import { CONSUMER_GROUP } from '../consumer/message-handler';
import { createDb, createPool } from '../db/database';
import { allAnalyticsTables } from '../db/schema';

async function main() {
  const config = loadConfig();
  if (!config.kafkaBrokers.length) throw new Error('KAFKA_BROKERS is required');

  const admin = createKafka(config.kafkaBrokers).admin();
  await admin.connect();
  try {
    for (const topic of SOURCE_TOPICS) {
      await admin.resetOffsets({
        groupId: CONSUMER_GROUP,
        topic,
        earliest: true,
      });
      console.log(
        JSON.stringify({
          msg: 'consumer group offsets reset',
          groupId: CONSUMER_GROUP,
          topic,
          to: 'earliest',
        }),
      );
    }
  } finally {
    await admin.disconnect();
  }

  const pool = createPool(config.databaseUrl);
  try {
    await createDb(pool).execute(
      sql.raw(
        `truncate table ${allAnalyticsTables.map((t) => `"${t}"`).join(', ')}`,
      ),
    );
    console.log(
      JSON.stringify({
        msg: 'read models truncated',
        tables: allAnalyticsTables,
      }),
    );
  } finally {
    await pool.end();
  }
  console.log(
    JSON.stringify({
      msg: 'rebuild prepared: start the analytics service to replay the log',
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      msg: 'rebuild failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
