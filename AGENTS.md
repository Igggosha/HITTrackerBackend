# Backend instructions

Scope: the NestJS/TypeScript API in this repository. For product scope read `../docs/PRODUCT_SPEC/README.md`; for the system map read `../docs/ARCHITECTURE.md`; for runtime/database setup read `README.md`. Google OAuth setup is in `GOOGLE_OAUTH_SETUP.md`.

## Architecture and dependencies

- Preserve the current direction: controller → feature service → `src/db/db.ts`/`src/db/schema.ts`. DTOs define input validation. Do not add repository/interface/use-case layers without a real second implementation or demonstrated need.
- Feature boundaries are `auth`, `users`, `exercises`, `workout-programs`, and `workouts`. Shared auth guards/roles stay in `auth`; the shared database schema stays in `db`.
- Controllers own HTTP decorators, guards, params/query/body handling; services own business rules and transactions. Never expose password/token hashes or internal errors.
- Before changing a request or response shape, find all mobile callers under `../hit-tracker-mobile/src` and update the contract coherently.

## API, validation, and errors

- The global `ValidationPipe` uses `transform: true` and `whitelist: true`. Describe new external fields with `class-validator` DTOs; explicitly transform numeric query fields with `@Type(() => Number)` or a pipe.
- Pass ID path params through `ParseIntPipe`. Protect authenticated routes with `JwtGuard`; role-sensitive routes also use `RolesGuard` and `@MinimumRole`.
- Use the appropriate Nest exception (`BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `Gone`, or `HttpException`). Preserve machine-readable error codes when a mobile flow branches on them.
- Auth endpoint limits and global throttling are security behavior. Do not weaken them to make a test pass.
- There is no centralized application logger or exception filter. Prefer Nest `Logger` for new server diagnostics, and never log credentials, JWTs, reset/verification/OAuth codes, or personal payloads.

## Authentication and external integrations

- JWTs expire after one hour; `RolesGuard` re-reads the current database role for privileged operations.
- Email registration remains pending until verification; password-reset and mobile OAuth records store hashes of one-time codes. Preserve expiry, attempt/lockout, and one-time-consumption behavior.
- Treat Google OAuth redirect/session/PKCE as one contract across mobile and web callbacks. Recheck `GOOGLE_OAUTH_SETUP.md`, `.env.example`, CORS, and trusted-proxy assumptions.
- SMTP, PostgreSQL, and Google are external boundaries: client errors must remain safe and failures must be diagnosable without exposing secrets.

## Database and migrations

- `src/db/schema.ts` is the schema source; services use the shared Drizzle `db` and transactions.
- For a schema change create a new migration under `drizzle/`; never rewrite an applied migration. Review SQL, constraints, defaults, foreign keys, recovery/rollback, and compatibility with existing data.
- Follow the workflow in `README.md`: update schema and add/review a versioned migration. `sql/init.sql` is for first-time Docker-volume initialization; `seed.sql` is only for idempotent shared starter data, never user data.
- Never run `db:push` against shared/production data or execute a destructive migration without explicit authorization and a backup/restore plan.

## Validation

- Nearest test: `npx jest path/to/file.spec.ts --runInBand`.
- All unit tests: `npm test -- --runInBand`.
- Read-only lint: `npx eslint "{src,apps,libs,test}/**/*.ts"`. `npm run lint` contains `--fix` and mutates files.
- Typecheck: `npx tsc --noEmit -p tsconfig.json`.
- Production build: `npm run build`.
- Integration smoke: `npm run test:e2e -- --runInBand`; database-backed cases require valid `.env` values and migrated PostgreSQL.

Auth, authorization, migration, deletion, and cross-module API changes require a targeted regression test, the full unit suite, lint/typecheck/build, and applicable integration checks. Report separately when real SMTP/OAuth/PostgreSQL flows or rollback were not reproduced.
