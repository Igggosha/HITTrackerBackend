# Read replica validation (2026-09-27)

Branch: `feat-read-replica`.

## Automated checks

| Check | Result |
| --- | --- |
| `npx jest src/db/db.spec.ts src/auth/auth.service.spec.ts src/users/users.service.spec.ts src/config/environment.spec.ts --runInBand` | 4 suites, 34 tests passed |
| `npm test -- --runInBand` | 33 suites, 137 tests passed |
| `npx tsc --noEmit -p tsconfig.json` | Passed |
| `npm run build` | Passed |
| `npm run test:e2e -- --runInBand` | 1 test passed |
| `npx eslint "{src,apps,libs,test}/**/*.ts"` | Failed: 1117 errors across the repository, mostly existing formatting and strict type diagnostics; the new `src/db/db.ts`, `src/db/db.spec.ts`, and environment files lint clean |

## Isolated Compose smoke

PowerShell environment used: `COMPOSE_PROJECT_NAME=feat-read-replica`,
`PORT=3157`, `MINIO_CONSOLE_PORT=9157`, and dummy public Expo URLs for Compose
interpolation. The local `.env` was copied from the existing backend checkout;
it was not committed. Commands below use `docker compose` with that environment.

```text
docker compose up --build -d api
=> postgres and postgres-replica healthy; replication-init exited 0
=> migrate exited 1: column "waist_circumference" of relation "user_body_metrics" already exists

docker compose exec -T postgres-replica psql -U postgres -d nestdb -tAc 'SELECT pg_is_in_recovery()'
=> t
docker compose exec -T postgres psql -U postgres -d nestdb -c 'CREATE TABLE replica_smoke_2d21527b (id integer PRIMARY KEY)'
=> CREATE TABLE
docker compose exec -T postgres psql -U postgres -d nestdb -c 'INSERT INTO replica_smoke_2d21527b VALUES (42)'
=> INSERT 0 1
docker compose exec -T postgres-replica psql -U postgres -d nestdb -tAc 'SELECT id FROM replica_smoke_2d21527b'
=> 42
docker compose exec -T postgres psql -U postgres -d nestdb -tAc 'SELECT state FROM pg_stat_replication'
=> streaming
docker compose exec -T postgres psql -U postgres -d nestdb -c 'DROP TABLE replica_smoke_2d21527b'
=> DROP TABLE

docker compose up -d --force-recreate replication-init
docker compose exec -T postgres sh -c "grep -c '^host replication replicator 0.0.0.0/0 scram-sha-256$' /var/lib/postgresql/data/pg_hba.conf"
=> 1
docker compose exec -T postgres psql -U postgres -d nestdb -tAc "SELECT count(*) FROM pg_roles WHERE rolname = 'replicator'"
=> 1

docker compose run --rm --no-deps --service-ports api
curl.exe -sS -o NUL -w '%{http_code}' http://127.0.0.1:3157/
=> 200
docker compose down -v
=> own containers, volumes, and networks removed
```

The API launch intentionally bypassed only the Compose migration dependency to
check startup and health. The baseline SQL dump already contains the body
metrics column that the pending migration adds, so database backed API reads
cannot be validated until that separate migration gate is fixed. Real SMTP and
OAuth flows and migration rollback were not reproduced. Review the primary
volume idempotence in `docker/enable-replication.sh` and the auth/authorization
read routing closely; automatic read fallback is not provided when the replica
is down, as explained in `read-replica.md`.
