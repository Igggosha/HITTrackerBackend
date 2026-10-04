# Security operations runbook / Інструкція з безпечної експлуатації

This runbook covers the security-sensitive release steps introduced for the API gateway, shared rate limiting, privileged-account MFA, monitoring, and recovery. Keep production values in the deployment secret store or ignored `.env`; never commit them.

Ця інструкція охоплює безпекові кроки релізу для API-шлюзу, спільного обмеження запитів, MFA привілейованих облікових записів, моніторингу та відновлення. Зберігайте production-значення у сховищі секретів розгортання або в ігнорованому `.env`; ніколи не комітьте їх.

## 1. Required secrets / Обов'язкові секрети

Generate independent values for Redis and TOTP. Do not reuse JWT, OAuth, database, or MinIO credentials.

Створіть незалежні значення для Redis і TOTP. Не використовуйте повторно облікові дані JWT, OAuth, бази даних або MinIO.

PowerShell:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Bash:

```sh
openssl rand -hex 32
openssl rand -base64 32
```

Put the hexadecimal value in `REDIS_PASSWORD` and the base64 value in `TOTP_ENCRYPTION_KEYS`. The TOTP entry must decode to exactly 32 bytes. Compose constructs `REDIS_URL`; when Nest runs outside Compose, set an equivalent URL explicitly. Replace every other `change_me` or `your_*_here` placeholder before deployment.

Запишіть шістнадцяткове значення в `REDIS_PASSWORD`, а base64-значення — у `TOTP_ENCRYPTION_KEYS`. Запис TOTP після декодування має містити рівно 32 байти. Compose формує `REDIS_URL`; якщо Nest працює поза Compose, задайте еквівалентну адресу явно. Перед розгортанням замініть усі інші шаблонні значення `change_me` та `your_*_here`.

## 2. Release order and checks / Порядок релізу та перевірки

1. Make and verify a backup before the release. Follow [`docs/diploma/backups.md`](diploma/backups.md) and run both `run-now` and `verify-restore`.
2. Install locked dependencies, build, and run the migration before routing traffic to the new API.
3. Start Redis, API, and API gateway. The API intentionally refuses production startup without `TOTP_ENCRYPTION_KEYS`; Redis-backed throttling is required by Compose.
4. Confirm `docker compose ps` reports `postgres`, `postgres-replica`, `minio`, `redis`, `api`, and `api-gateway` healthy, while `migrate`, `bootstrap`, `seed`, and `minio-init` have exited successfully.
5. Confirm `GET http://127.0.0.1:${PORT:-3000}/` succeeds through the gateway. The API container itself has no host port.
6. Test password and Google login for one ordinary user and one privileged user. A role of `helper`, `moderator`, `admin`, or `super_admin` must require TOTP enrollment or verification before a session is issued.
7. Save the one-time recovery codes outside the application host. Verify one recovery-code login in a controlled account and confirm the code cannot be reused.

1. Створіть і перевірте резервну копію до релізу. Виконайте `run-now` і `verify-restore` за інструкцією [`docs/diploma/backups.md`](diploma/backups.md).
2. Встановіть зафіксовані залежності, зберіть застосунок і виконайте міграцію до спрямування трафіку на новий API.
3. Запустіть Redis, API та API-шлюз. API навмисно не запускається у production без `TOTP_ENCRYPTION_KEYS`; у Compose обмеження запитів залежить від Redis.
4. Переконайтеся, що `docker compose ps` показує здоровий стан `postgres`, `postgres-replica`, `minio`, `redis`, `api` та `api-gateway`, а `migrate`, `bootstrap`, `seed` і `minio-init` успішно завершили роботу.
5. Перевірте `GET http://127.0.0.1:${PORT:-3000}/` через шлюз. Контейнер API не публікує порт на хості.
6. Перевірте вхід паролем і через Google для звичайного та привілейованого користувача. Ролі `helper`, `moderator`, `admin` і `super_admin` мають вимагати реєстрацію або перевірку TOTP до видачі сесії.
7. Збережіть одноразові коди відновлення поза хостом застосунку. Перевірте вхід одним кодом на контрольному обліковому записі та переконайтеся, що повторне використання неможливе.

For a manual non-Compose deployment, the minimum gate is:

Для ручного розгортання без Compose мінімальний шлюз якості такий:

```sh
npm ci
npm test -- --runInBand
npx eslint "{src,apps,libs,test,scripts}/**/*.ts"
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.scripts.json
npm run build
npm run db:migrate
npm run start:prod
```

## 3. Gateway and tunnel / Шлюз і тунель

Point the public API hostname in Cloudflare Tunnel to `http://api-gateway:8080`, not directly to `api:3000`. Keep the web and object-storage hostnames on their existing services. The gateway overwrites the client-supplied forwarding chain, enforces body, request-rate, connection, and timeout limits, and passes a valid original `X-Forwarded-Proto` value for secure OAuth cookies.

Спрямуйте публічне API-ім'я в Cloudflare Tunnel на `http://api-gateway:8080`, а не безпосередньо на `api:3000`. Залиште web- і object-storage-імена на їхніх поточних сервісах. Шлюз перезаписує переданий клієнтом ланцюжок проксі, застосовує обмеження розміру тіла, частоти запитів, кількості з'єднань і тайм-аути та передає коректний початковий `X-Forwarded-Proto` для захищених OAuth-cookie.

Only add exact HTTPS hosts to `NOTIFICATION_LINK_HOSTS`. The configured frontend host, S3 public endpoint, and YouTube hosts are already covered. Restart the API after changing this allowlist.

Додавайте до `NOTIFICATION_LINK_HOSTS` лише точні HTTPS-хости. Налаштований frontend-хост, публічний S3 endpoint і хости YouTube вже дозволені. Після зміни списку перезапустіть API.

## 4. TOTP key rotation / Ротація ключа TOTP

1. Generate a new 32-byte base64 key.
2. Set `TOTP_ENCRYPTION_KEYS=new_key,old_key` and restart every API instance.
3. A successful TOTP or recovery-code verification lazily re-encrypts that credential with the first key. Enrollment confirmation also writes with the first key.
4. Track remaining key identifiers without exposing secrets:

```sql
SELECT split_part(secret_ciphertext, '.', 2) AS key_id, count(*)
FROM auth_totp_credentials
GROUP BY key_id
ORDER BY key_id;
```

5. Remove the old key only after no credential row uses its identifier and all API instances have the same key ring. Keep an encrypted backup from before rotation until the restore drill succeeds with the new configuration.

1. Створіть новий 32-байтовий ключ у base64.
2. Задайте `TOTP_ENCRYPTION_KEYS=новий_ключ,старий_ключ` і перезапустіть усі екземпляри API.
3. Успішна перевірка TOTP або коду відновлення ліниво перешифровує облікові дані першим ключем. Підтвердження реєстрації також записує дані першим ключем.
4. Відстежуйте залишкові ідентифікатори ключів наведеним SQL, не розкриваючи секрети.
5. Видаляйте старий ключ лише коли жоден рядок не використовує його ідентифікатор і всі екземпляри API мають однаковий набір ключів. Зберігайте зашифровану резервну копію стану до ротації, доки перевірка відновлення з новою конфігурацією не завершиться успішно.

If all keys capable of decrypting a credential are lost, recovery codes still permit a login but cannot reconstruct the TOTP seed. After independently verifying the account owner, use a controlled database session to revoke that user's refresh sessions and delete only that user's `auth_totp_credentials` row; the next privileged login will require fresh enrollment. Record the incident and database change outside the application. Never perform a broad delete.

Якщо втрачено всі ключі, здатні розшифрувати конкретні облікові дані, код відновлення все ще дозволяє вхід, але не відновлює seed TOTP. Після незалежної перевірки власника облікового запису в контрольованій сесії бази даних відкличте refresh-сесії лише цього користувача та видаліть лише його рядок `auth_totp_credentials`; наступний привілейований вхід вимагатиме нової реєстрації. Зафіксуйте інцидент і зміну бази даних поза застосунком. Ніколи не виконуйте масове видалення.

## 5. Monitoring and incident response / Моніторинг та реагування

Run the `observability` profile and keep its UI ports bound to localhost. Review alerts for sustained 401/403/429 responses, elevated 5xx or latency, API CPU/RAM pressure, PostgreSQL pool waiters, Redis availability/memory, notification queue age/failures, and unusually large campaigns. Correlate an alert with structured logs by request ID; sensitive headers, tokens, passwords, MFA factors, and notification bodies are redacted.

Запускайте профіль `observability` і залишайте його UI-порти прив'язаними до localhost. Перевіряйте попередження про тривалі 401/403/429, підвищені 5xx або затримку, навантаження CPU/RAM API, очікування в пулі PostgreSQL, доступність/пам'ять Redis, вік і помилки черги сповіщень та незвично великі кампанії. Зіставляйте попередження зі структурованими логами за request ID; чутливі заголовки, токени, паролі, MFA-фактори та тексти сповіщень редагуються.

For suspected credential or refresh-token compromise: disable external traffic at the gateway/tunnel, preserve logs, rotate the affected secret, revoke active refresh sessions, verify privileged MFA state, and only then restore traffic. Rotating `JWT_SECRET` invalidates all access tokens immediately; revoking refresh sessions prevents renewal. Validate a fresh login after recovery.

Якщо підозрюється компрометація облікових даних або refresh-токена: вимкніть зовнішній трафік на шлюзі/тунелі, збережіть логи, змініть уражений секрет, відкличте активні refresh-сесії, перевірте стан MFA привілейованих користувачів і лише потім відновіть трафік. Ротація `JWT_SECRET` негайно робить усі access-токени недійсними; відкликання refresh-сесій блокує їх поновлення. Після відновлення перевірте новий вхід.

## 6. Rollback / Відкат

Application rollback is safe only while the new migration remains in place: it is additive, and older application builds ignore the new tables and campaign idempotency column. Do not reverse the migration during an ordinary rollback. Restore the prior application images, keep Redis available, and verify ordinary login and core read/write flows. A database rollback requires a separately approved maintenance window and a verified backup because dropping the security tables destroys MFA/session history.

Відкат застосунку безпечний лише зі збереженням нової міграції: вона адитивна, а старі збірки ігнорують нові таблиці та колонку ідемпотентності кампаній. Не скасовуйте міграцію під час звичайного відкату. Поверніть попередні образи застосунку, залиште Redis доступним і перевірте звичайний вхід та основні операції читання/запису. Відкат бази даних потребує окремо погодженого вікна обслуговування та перевіреної резервної копії, оскільки видалення безпекових таблиць знищує історію MFA/сесій.

After either a release or rollback, record the deployed commit, migration result, container health, backup set, restore-drill result, and the operator/time. Do not record secret values.

Після релізу або відкату зафіксуйте розгорнутий коміт, результат міграції, стан контейнерів, набір резервної копії, результат перевірки відновлення, оператора й час. Не записуйте значення секретів.
