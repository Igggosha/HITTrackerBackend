import * as bcrypt from 'bcrypt';
import * as orm from 'drizzle-orm';
import { AuthService } from '../auth/auth.service';
import * as dbModule from '../db/db';
import * as schema from '../db/schema';
import { WorkoutsService } from '../workouts/workouts.service';
import { OutboxService } from './outbox.service';

// Real races against a disposable database whose schema was created from
// src/db/schema.ts (for example with `drizzle-kit push` on a throwaway
// container; never on shared data):
//   DATABASE_URL=$U CONCURRENCY_IT_DATABASE_URL=$U npx jest src/outbox/concurrency.integration.spec.ts
const url = process.env.CONCURRENCY_IT_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;

describeWithDatabase('concurrent writes against PostgreSQL', () => {
  const workoutsService = new WorkoutsService(new OutboxService());
  const [jwt, mailer, config] = [
    { sign: () => 'token' },
    { sendMail: jest.fn() },
    { get: () => undefined },
  ] as unknown as ConstructorParameters<typeof AuthService>;
  const authService = new AuthService(jwt, mailer, config, new OutboxService());
  let userId: number;

  const events = async (eventType: string, aggregateId: number) =>
    dbModule.db
      .select()
      .from(schema.outboxEvents)
      .where(
        orm.and(
          orm.eq(schema.outboxEvents.eventType, eventType),
          orm.eq(schema.outboxEvents.aggregateId, String(aggregateId)),
        ),
      );

  beforeAll(() => {
    // These tests write rows. Refuse to run when the shared pool was built
    // from some other DATABASE_URL (for example a developer .env).
    const configured = dbModule.pool.options.connectionString;
    if (configured && configured !== url) {
      throw new Error(
        'DATABASE_URL points elsewhere; run with DATABASE_URL equal to CONCURRENCY_IT_DATABASE_URL',
      );
    }
    // Without a connection string, pg falls back to the PG* variables when it
    // opens its first connection.
    const target = new URL(url!);
    process.env.PGHOST = target.hostname;
    process.env.PGPORT = target.port;
    process.env.PGUSER = decodeURIComponent(target.username);
    process.env.PGPASSWORD = decodeURIComponent(target.password);
    process.env.PGDATABASE = target.pathname.slice(1);
  });

  beforeEach(async () => {
    const [user] = await dbModule.db
      .insert(schema.users)
      .values({
        email: `race-${Date.now()}-${Math.random()}@example.test`,
        displayName: 'Race',
      })
      .returning();
    userId = user.id;
  });

  afterAll(async () => {
    await dbModule?.pool.end();
  });

  it('five simultaneous starts create one workout and one event', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        workoutsService.startWorkout(userId, 'user', {}),
      ),
    );

    const ids = new Set(results.map((result) => result.workout.id));
    expect(ids.size).toBe(1);
    expect(
      results.filter((result) => result.message === 'Workout started'),
    ).toHaveLength(1);
    expect(await events('workout.started', [...ids][0])).toHaveLength(1);
  });

  it('five simultaneous finishes complete once and emit one event', async () => {
    const { workout } = await workoutsService.startWorkout(userId, 'user', {});
    await workoutsService.recordSet(workout.id, userId, {
      exerciseId: await exerciseId(),
      weight: 100,
      reps: 5,
      rpe: 8,
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        workoutsService.finishWorkout(workout.id, userId, {}),
      ),
    );

    expect(
      results.filter(
        (result) => result.message === 'Workout finished successfully',
      ),
    ).toHaveLength(1);
    const finished = await events('workout.finished', workout.id);
    expect(finished).toHaveLength(1);
    expect(finished[0].payload).toMatchObject({
      setCount: 1,
      totalVolume: 500,
    });
  });

  it('finish racing cancel leaves exactly one outcome', async () => {
    const { workout } = await workoutsService.startWorkout(userId, 'user', {});

    const [finish, cancel] = await Promise.allSettled([
      workoutsService.finishWorkout(workout.id, userId, {}),
      workoutsService.cancelWorkout(workout.id, userId),
    ]);

    expect(
      [finish, cancel].filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const outcomes =
      (await events('workout.finished', workout.id)).length +
      (await events('workout.cancelled', workout.id)).length;
    expect(outcomes).toBe(1);
  });

  it('sets racing a finish are either in the finished event or rejected', async () => {
    const { workout } = await workoutsService.startWorkout(userId, 'user', {});
    const exercise = await exerciseId();

    const attempts = Array.from({ length: 10 }, () =>
      workoutsService.recordSet(workout.id, userId, {
        exerciseId: exercise,
        weight: 10,
        reps: 10,
        rpe: 7,
      }),
    );
    const finish = workoutsService.finishWorkout(workout.id, userId, {});
    const settled = await Promise.allSettled(attempts);
    await finish;

    const [event] = await events('workout.finished', workout.id);
    const stored = await dbModule.db
      .select()
      .from(schema.sets)
      .where(orm.eq(schema.sets.workoutId, workout.id));
    const accepted = settled.filter((r) => r.status === 'fulfilled').length;
    expect(stored).toHaveLength(accepted);
    expect((event.payload as { setCount: number }).setCount).toBe(accepted);
  });

  it('parallel wrong verification codes cannot exceed the attempt limit', async () => {
    const email = `pending-${Date.now()}@example.test`;
    await dbModule.db.insert(schema.pendingRegistrations).values({
      email,
      displayName: 'Pending',
      passwordHash: 'x',
      verificationCodeHash: await bcrypt.hash('123456', 4),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        authService.verifyRegistration({ email, code: '000000' }),
      ),
    );

    const statuses = results.map(
      (result) =>
        ((result as PromiseRejectedResult).reason as { status: number }).status,
    );
    // Exactly four plain rejections, then the fifth locks the email.
    expect(statuses.filter((status) => status === 400)).toHaveLength(4);
    expect(statuses.filter((status) => status === 429)).toHaveLength(8);
    const [pending] = await dbModule.db
      .select()
      .from(schema.pendingRegistrations)
      .where(orm.eq(schema.pendingRegistrations.email, email));
    expect(pending.attempts).toBe(5);
    expect(pending.lockedUntil).not.toBeNull();
  });

  async function exerciseId() {
    const [exercise] = await dbModule.db
      .insert(schema.exercises)
      .values({ name: `Race exercise ${Date.now()} ${Math.random()}` })
      .returning();
    return exercise.id;
  }
});
