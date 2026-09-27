<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Run the backend and PostgreSQL with Docker

Docker Compose starts the API and PostgreSQL together. The containers use the
internal `hit-tracker-network`; the API connects to PostgreSQL through the
service name `postgres`, not through a host port. Only the API is published to
the host on port `3000` by default.

1. Copy `.env.example` to `.env` and fill in the required secrets. Keep
   `DB_USERNAME`, `DB_PASSWORD`, and `DB_NAME` are used by both containers.
   `PORT` controls the API port exposed on your computer (default: `3000`).
   Docker Compose builds the API's internal connection URL with the hostname
   `postgres`; it overrides the localhost `DATABASE_URL` only inside the API
   container.
2. Start the stack:

   ```bash
   docker compose up --build
   ```

   To include the separately checked-out mobile frontend and Cloudflare
   connector, use `docker compose --profile edge up --build` instead.

   Production web and Android setup, including the three tunnel hostnames and
   EAS build commands, is documented in
   [`../hit-tracker-mobile/docs/release.md`](../hit-tracker-mobile/docs/release.md).

3. Check the API at `http://localhost:3000/` and stop the stack with
   `docker compose down`.

The PostgreSQL volume persists between restarts. The initial UTF-16 SQL dump is
converted to UTF-8 and loaded only when Docker creates that volume for the
first time. The `migrate` service records the SQL-dump baseline and then runs
the versioned Drizzle migrations before the API starts, including for an
existing volume. The `seed` service then idempotently adds the shared exercise
library and starter programs; it never deletes personal data. Use `docker
compose logs -f api`, `docker compose logs -f postgres`, `docker compose logs
migrate`, or `docker compose logs seed` to inspect startup problems.

To add the shared starter library again without resetting users or workouts,
run `npm run db:seed` from this folder.

### Database workflow for the team

Commit every schema change as a new Drizzle migration. Change
`src/db/schema.ts`, generate and review the migration, then commit both files.
After pulling the branch, each developer runs `docker compose up --build`; the
`migrate` service brings their local schema up to date. Migrations change
schema only. Shared starter data belongs in the versioned seed/dump; personal
users, workouts, and other local test data are not copied through Git.

### Manual deployment migration gate / Обов'язкова міграція для ручного розгортання

For a deployment outside Docker Compose, run the versioned migrations after
installing dependencies and before starting the new API build. Do not start or
restart the API when the migration command fails.

Для розгортання поза Docker Compose запустіть версійні міграції після
встановлення залежностей і до запуску нової збірки API. Не запускайте й не
перезапускайте API, якщо команда міграції завершилася помилкою.

```bash
npm ci
npm run build
npm run db:migrate
npm run start:prod
```

In automated deployments, make `npm run db:migrate` a required release step
that must complete successfully before any new API instance receives traffic.

В автоматизованому розгортанні зробіть `npm run db:migrate` обов'язковим кроком
релізу, який має успішно завершитися до того, як новий екземпляр API почне
приймати трафік.

### Profile identity compatibility / Сумісність ідентифікації профілю

Current clients send `X-Profile-Contract: v2` when reading or editing the
profile. In v2, `displayName` is the visible non-unique name and `username` is
the optional unique public handle. Username availability is checked through
`GET /users/me/username-availability`, and the final atomic change uses
`PATCH /users/me/username`.

A username contains 3–24 lowercase Latin letters, digits, or underscores.
It is normalized to lowercase before the availability check and save.
Exact system names such as `admin`, `moderator`, `support`, and `official` are
reserved. Modified names such as `bohdan_admin123` and `firma_official` remain
available when they are unique.

Поточні клієнти надсилають `X-Profile-Contract: v2` під час читання або
редагування профілю. У v2 `displayName` — це видиме неунікальне ім'я, а
`username` — необов'язковий унікальний публічний ідентифікатор. Доступність
імені користувача перевіряється через `GET /users/me/username-availability`, а
остаточна атомарна зміна виконується через `PATCH /users/me/username`.

Ім'я користувача містить 3–24 малі латинські літери, цифри або символи
нижнього підкреслення. Перед перевіркою доступності та збереженням воно
нормалізується до нижнього регістру.
Точні системні імена на кшталт `admin`, `moderator`, `support` та `official`
зарезервовані. Змінені імена на кшталт `bohdan_admin123` і `firma_official`
залишаються доступними, якщо вони унікальні.

For installed legacy clients without this header, the historical profile
field `username` continues to read and update the display name. This fallback
can be removed only after those client versions are retired.

Для встановлених старих клієнтів без цього заголовка історичне поле профілю
`username` і надалі читає та оновлює видиме ім'я. Цей сумісний режим можна
видалити лише після припинення підтримки таких версій клієнта.

## Object storage (MinIO) / Об'єктне сховище

User-uploaded media — profile avatars today, exercise illustrations and
anything added later — lives in MinIO rather than in PostgreSQL or on the API
container's disk. MinIO speaks the S3 API, so the same configuration works
against AWS S3 or any other S3-compatible service without code changes.

### How a file travels

1. The client `POST`s `multipart/form-data` with a single `file` part to the
   API. It never talks to MinIO directly.
2. The API checks the real container bytes (not the declared `Content-Type`),
   re-encodes the image to WebP with `sharp`, and resizes it. Re-encoding also
   drops every metadata block, including EXIF GPS coordinates.
3. The object is written under `uploads/<scope>/<owner id>/<uuid>.webp` and only
   that key is stored in PostgreSQL.
4. Read paths return `avatarUrl` / `imageUrl`: a presigned `GET` URL valid for
   `S3_PRESIGNED_URL_TTL_SECONDS`. The bucket stays private and anonymous
   access is explicitly disabled.

Because each upload gets a fresh UUID, a replaced avatar has a new URL, so no
client or CDN can serve the stale image. The object it replaced is deleted only
after the database row stops pointing at it.

### Running it

`docker compose up --build` starts `minio` alongside PostgreSQL, then
`minio-init` creates the bucket, the temporary-object lifecycle rule, and a
**bucket-scoped** service account for the API. MinIO's server-side stale-upload
sweep cleans abandoned multipart uploads. The API never uses the MinIO root
credentials.
The patched MinIO release is built from its official source and verified
against `MINIO_SOURCE_COMMIT`, because upstream no longer publishes that server
release as an official container image. The `mc` bootstrap image remains
registry-pinned.

MinIO publishes no ports on the host. The API reaches the S3 endpoint at
`http://minio:9000` over the private Docker network. For browser and phone
downloads, route a dedicated files hostname through Cloudflare Tunnel to
`http://minio:9000` and keep the MinIO console private.

### Configuration

Storage is optional. With `S3_BUCKET` empty the API still boots; the media
endpoints answer `503` with `code: "STORAGE_UNAVAILABLE"` and `avatarUrl` is
`null`. A *partially* filled configuration fails at boot instead of failing on
the first upload.

Two endpoints matter and they are not interchangeable:

- `S3_ENDPOINT` — where the API itself reaches MinIO. Compose overrides it with
  `http://minio:9000`.
- `S3_PUBLIC_ENDPOINT` — the host the presigned URL is signed for. A SigV4
  signature is bound to that host, so it must be exactly what the client calls.
  Behind the Cloudflare tunnel, publish MinIO under its own hostname and put
  that hostname here; otherwise every download returns `SignatureDoesNotMatch`.

See the `Object Storage` block in `.env.example` for the remaining settings
(size limit, image dimensions, WebP quality, URL lifetime, key prefixes).

### API

| Method   | Route                  | Role        | Body             |
| -------- | ---------------------- | ----------- | ---------------- |
| `POST`   | `/users/me/avatar`     | any user    | `file` (image)   |
| `DELETE` | `/users/me/avatar`     | any user    | —                |
| `POST`   | `/exercises/:id/image` | `moderator` | `file` (image)   |
| `DELETE` | `/exercises/:id/image` | `moderator` | —                |

Accepted input: JPEG, PNG, WebP or GIF, up to `MAX_UPLOAD_BYTES` (10 MB by
default; the hard request cap is 50 MB). Avatars are cropped to a centred
square, exercise images are fitted inside the maximum dimension. Rejections use
machine-readable codes: `FILE_REQUIRED`, `FILE_TOO_LARGE`,
`UNSUPPORTED_IMAGE_TYPE`, `STORAGE_UNAVAILABLE`.

```bash
curl -X POST http://localhost:3000/users/me/avatar \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "file=@avatar.jpg"
```

### Adding a new kind of file

1. Add the scope to `STORAGE_SCOPES` in `src/storage/object-key.ts`.
2. Add a nullable `*_key` column in `src/db/schema.ts` plus a migration.
3. Call `storageService.uploadImage({ scope, ownerId, file, maxDimension })`
   from the owning feature service, and `storageService.getUrl(key)` on the
   read path. Delete the replaced key with `storageService.remove(...)` only
   after the row no longer references it.

Keep the object key server-side. Responses expose a URL, never a key.

### Backups

The optional `backup` Compose profile makes a daily PostgreSQL custom-format
dump and mirrors the full MinIO bucket into the same timestamped backup set.
This matters because database rows can reference avatars and exercise images
stored in MinIO. Each complete set contains `db.dump`, `minio/`, and a
`manifest.json` with sizes, object count, the dump SHA-256, the pg_dump client
version, the PostgreSQL server version, migration count, and duration.
Incomplete runs are discarded and do not trigger rotation. Backup set files
and directories are created with `umask 077` (600/700): only the container's
user can read them.

Backup and restore never use the MinIO root credentials. The always-on
`backup` service authenticates with a dedicated **read-only** bucket-scoped
account (`BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY`), created
by `docker/minio-init.sh` the same way as the API account. `restore` and
`verify-restore` write objects, so they use a separate **write-capable**
bucket-scoped account (`RESTORE_S3_ACCESS_KEY_ID` /
`RESTORE_S3_SECRET_ACCESS_KEY`). That credential is intentionally left out of
the always-on service's environment in `docker-compose.yml`; supply it only
when you invoke `restore`/`verify-restore`:

```sh
docker compose --profile backup run --rm \
  -e RESTORE_S3_ACCESS_KEY_ID=hit-tracker-restore \
  -e RESTORE_S3_SECRET_ACCESS_KEY=change_me_restore_readwrite_secret \
  backup restore 20260927T030000Z
```

Both accounts are optional: leaving either pair unset in `.env` makes
`docker/minio-init.sh` skip provisioning that account (the API account
remains required, as before).

Copy `.env.example` to `.env`, then set `DB_PASSWORD`, `MINIO_ROOT_PASSWORD`,
`BACKUP_S3_ACCESS_KEY_ID`/`BACKUP_S3_SECRET_ACCESS_KEY`,
`RESTORE_S3_ACCESS_KEY_ID`/`RESTORE_S3_SECRET_ACCESS_KEY`, and the other local
secrets as usual. Enable the scheduled service with:

```sh
docker compose --profile backup up -d backup
```

It runs once per UTC day, as soon as the clock reaches `BACKUP_TIME` (`03:00`
by default) — a catch-up check on every 30-second tick, not an exact-minute
match, so a delayed tick cannot cause a whole day to be skipped. A
`.last-scheduled-date` marker guards against running twice in the same day.
Set `BACKUP_TIME=HH:MM` to change the time and `BACKUP_KEEP_DAILY`,
`BACKUP_KEEP_WEEKLY`, or `BACKUP_KEEP_MONTHLY` to change GFS retention
(defaults 7, 4, and 12). The default `backups_data` named volume is
independent from `postgres_data` and `minio_data`. To use a host directory
instead, set `BACKUP_HOST_PATH` to an absolute path before starting the
service. On startup the scheduler also sweeps (and logs) any `.inprogress-*`
working directory older than six hours, left behind by a container that was
killed mid-backup.

Run a backup immediately, without waiting for the schedule:

```sh
docker compose --profile backup run --rm backup run-now
```

A manual `run-now` does not touch `.last-scheduled-date`, so it neither
consumes nor blocks that day's scheduled run; if both happen on the same UTC
day, `rotate.sh`'s GFS classes still count each successful set as its own
daily (and, if applicable, weekly/monthly) slot, up to the configured limits.

Restore a set into a new scratch database by default; use `--database NAME` to
choose a different new database. Restoring over `DB_NAME` requires the explicit
`--force-live` option and prints a warning. MinIO restore merges and overwrites
matching keys in the configured bucket; it leaves unrelated existing keys.
Before touching the database or bucket, `restore` parses `manifest.json` and
recomputes `sha256sum db.dump`; it aborts with a clear error if the checksum
does not match or the manifest has no recorded checksum, and it does the same
cheap check against the manifest's recorded MinIO object count/bytes.

```sh
docker compose --profile backup run --rm \
  -e RESTORE_S3_ACCESS_KEY_ID=hit-tracker-restore \
  -e RESTORE_S3_SECRET_ACCESS_KEY=change_me_restore_readwrite_secret \
  backup restore 20260927T030000Z
docker compose --profile backup run --rm \
  -e RESTORE_S3_ACCESS_KEY_ID=hit-tracker-restore \
  -e RESTORE_S3_SECRET_ACCESS_KEY=change_me_restore_readwrite_secret \
  backup verify-restore
```

The restore drill picks the newest successful set, creates a scratch database,
restores the bucket, checks that users/workouts/exercises and the Drizzle
migration table can be queried, then prints row counts. On success
`verify-restore` drops its own scratch database automatically; on failure it
leaves the database in place (and prints its name) for inspection.

Backups on the same machine protect against mistakes, not machine loss. Copy
complete timestamped directories from `backups_data` (or `BACKUP_HOST_PATH`)
to separate storage, such as an encrypted off-site bucket or removable disk;
for a simple off-host copy, configure `BACKUP_HOST_PATH` to a host directory
and run `scp -r /srv/hit-tracker/backups/<set> backupuser@backup-host:/srv/offsite/hit-tracker/`.
Keep access credentials outside the backup archive. See
[`docs/diploma/backups.md`](docs/diploma/backups.md) for the demo and recovery
targets.

## Google OAuth

Детальне налаштування Google Cloud Console, змінних середовища, міграції та
фронтенду: [GOOGLE_OAUTH_SETUP.md](GOOGLE_OAUTH_SETUP.md).

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
