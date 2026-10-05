# Security operations runbook / Інструкція з безпечної експлуатації

This runbook covers the security-sensitive release steps introduced for the API gateway, shared rate limiting, privileged-account MFA, monitoring, and recovery. Keep production values in the deployment secret store or ignored `.env`; never commit them.

Ця інструкція охоплює безпекові кроки релізу для API-шлюзу, спільного обмеження запитів, MFA привілейованих облікових записів, моніторингу та відновлення. Зберігайте production-значення у сховищі секретів розгортання або в ігнорованому `.env`; ніколи не комітьте їх.

## 1. Required secrets / Обов'язкові секрети

Generate independent values for Redis, TOTP, and the application database role. Do not reuse JWT, OAuth, administrative database, or MinIO credentials.

Створіть незалежні значення для Redis, TOTP і прикладної ролі бази даних. Не використовуйте повторно облікові дані JWT, OAuth, адміністративної ролі бази даних або MinIO.

Put the hexadecimal value in `REDIS_PASSWORD`, the base64 value in `TOTP_ENCRYPTION_KEYS`, and a separate high-entropy value in `APP_DB_PASSWORD`. The TOTP entry must decode to exactly 32 bytes. Compose constructs `REDIS_URL`; when Nest runs outside Compose, set an equivalent URL explicitly. `DB_USERNAME`/`DB_PASSWORD` are administrative credentials used only by migrations, backup, seed, and maintenance jobs; API and background application services use `APP_DB_USERNAME`/`APP_DB_PASSWORD`. Replace every other `change_me` or `your_*_here` placeholder before deployment.

Запишіть шістнадцяткове значення в `REDIS_PASSWORD`, base64-значення — у `TOTP_ENCRYPTION_KEYS`, а окреме високоентропійне значення — у `APP_DB_PASSWORD`. Запис TOTP після декодування має містити рівно 32 байти. Compose формує `REDIS_URL`; якщо Nest працює поза Compose, задайте еквівалентну адресу явно. `DB_USERNAME`/`DB_PASSWORD` — адміністративні облікові дані лише для міграцій, резервування, seed і технічних робіт; API та фонові прикладні сервіси використовують `APP_DB_USERNAME`/`APP_DB_PASSWORD`. Перед розгортанням замініть усі інші шаблонні значення `change_me` та `your_*_here`.

## 2. Release order and checks / Порядок релізу та перевірки

1. Make and verify a backup before the release. Follow [`docs/diploma/backups.md`](diploma/backups.md) and run both `run-now` and `verify-restore`.
2. Install locked dependencies, build, and run the migration before routing traffic to the new API.
3. Run `app-role-init` after migrations and before application services. It is idempotent and grants only connect, schema usage, table DML, and sequence usage; it does not grant DDL or role administration.
4. Start Redis, API, and API gateway. The API intentionally refuses production startup without `TOTP_ENCRYPTION_KEYS`; Redis-backed throttling is required by Compose.
5. Confirm `docker compose ps` reports `postgres`, `postgres-replica`, `minio`, `redis`, `api`, and `api-gateway` healthy, while `migrate`, `app-role-init`, `bootstrap`, `seed`, and `minio-init` have exited successfully.
6. Confirm `GET http://127.0.0.1:${PORT:-3000}/` succeeds through the gateway. The API container itself has no host port.
7. Test password and Google login for one ordinary user and one privileged user. A role of `helper`, `moderator`, `admin`, or `super_admin` must require TOTP enrollment or verification before a session is issued.
8. Save the one-time recovery codes outside the application host. Verify one recovery-code login in a controlled account and confirm the code cannot be reused.

1. Створіть і перевірте резервну копію до релізу. Виконайте `run-now` і `verify-restore` за інструкцією [`docs/diploma/backups.md`](diploma/backups.md).
2. Встановіть зафіксовані залежності, зберіть застосунок і виконайте міграцію до спрямування трафіку на новий API.
3. Запустіть `app-role-init` після міграцій і до прикладних сервісів. Він повторюваний і надає лише підключення, доступ до схеми, DML таблиць та використання послідовностей; DDL і керування ролями не надаються.
4. Запустіть Redis, API та API-шлюз. API навмисно не запускається у production без `TOTP_ENCRYPTION_KEYS`; у Compose обмеження запитів залежить від Redis.
5. Переконайтеся, що `docker compose ps` показує здоровий стан `postgres`, `postgres-replica`, `minio`, `redis`, `api` та `api-gateway`, а `migrate`, `app-role-init`, `bootstrap`, `seed` і `minio-init` успішно завершили роботу.
6. Перевірте `GET http://127.0.0.1:${PORT:-3000}/` через шлюз. Контейнер API не публікує порт на хості.
7. Перевірте вхід паролем і через Google для звичайного та привілейованого користувача. Ролі `helper`, `moderator`, `admin` і `super_admin` мають вимагати реєстрацію або перевірку TOTP до видачі сесії.
8. Збережіть одноразові коди відновлення поза хостом застосунку. Перевірте вхід одним кодом на контрольному обліковому записі та переконайтеся, що повторне використання неможливе.

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

The Compose gateway also listens on the compatibility route `api:3000`, so an older remotely managed tunnel route still terminates at the gateway rather than bypassing it. Treat this as a recovery path, not the preferred Cloudflare configuration. If Cloudflare shows `502 Host Error`, first verify that `api-gateway` is healthy, then inspect recent `cloudflared` logs. `lookup api ... no such host` or `connect ... refused` means the tunnel-to-gateway route is broken; do not reconnect the application container to the public `edge` network.

Compose-шлюз також слухає сумісний маршрут `api:3000`, тому старий віддалено керований маршрут тунелю все одно завершується на шлюзі й не обходить його. Вважайте це аварійним шляхом, а не бажаною конфігурацією Cloudflare. Якщо Cloudflare показує `502 Host Error`, спочатку перевірте здоров'я `api-gateway`, потім перегляньте свіжі логи `cloudflared`. Повідомлення `lookup api ... no such host` або `connect ... refused` означає розрив маршруту від тунелю до шлюзу; не повертайте контейнер застосунку в публічну мережу `edge`.

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

## 5. Compromised account controls / Дії при компрометації акаунта

Open **Admin → Users → user profile → Account security**. The available actions are enforced by the API as well as hidden in the client:

Відкрийте **Admin → Users → профіль користувача → Account security**. Доступність дій перевіряє не лише клієнт, а й API:

| Operator / Оператор | May manage / Може керувати |
| --- | --- |
| `super_admin` | `user`, `helper`, `moderator`, `admin` |
| system owner / системний власник | all roles including `super_admin`, except the owner's own account / усі ролі, включно із `super_admin`, крім власного акаунта |

No administrator can suspend or remotely terminate the system owner's sessions. A non-owner `super_admin` cannot perform these actions on another `super_admin`. Administrative self-service uses the ordinary Settings logout controls instead.

Жоден адміністратор не може заблокувати системного власника або віддалено завершити його сесії. `super_admin`, який не є власником, не може виконувати ці дії щодо іншого `super_admin`. Для власного акаунта слід використовувати звичайні кнопки виходу в Settings.

### End all sessions / Завершити всі сесії

1. Select **End all sessions** and confirm the warning.
2. The API revokes every refresh-token family and advances the user's `sessions_invalid_before` boundary in one transaction.
3. Existing access tokens are rejected on the next protected API request, even if their normal expiry time has not arrived. The user must authenticate again on every device.

1. Натисніть **End all sessions** і підтвердьте попередження.
2. API в одній транзакції відкликає всі сімейства refresh-токенів і пересуває межу `sessions_invalid_before` користувача.
3. Наявні access-токени відхиляються під час наступного захищеного API-запиту, навіть якщо їхній звичайний строк дії ще не завершився. Користувач має повторно ввійти на всіх пристроях.

### Suspend and restore an account / Блокування та відновлення акаунта

1. Select **Suspend account**.
2. Enter a future local date/time in `YYYY-MM-DD HH:mm` format and a reason of 3–500 characters. The client converts the local time to an absolute timestamp; the API validates it again.
3. Confirm the action. The API stores the suspension, revokes refresh families, invalidates access sessions, records an activity, and creates a system notification in the same database transaction.
4. The user is rejected on the next protected request and sees the expiry and reason. Password login, Google login, token refresh, and mobile OAuth exchange all enforce the same suspension.
5. Use **Remove suspension** to restore access early. Otherwise access resumes automatically after the recorded expiry; the historical fields remain available to operators until a later update.

1. Натисніть **Suspend account**.
2. Укажіть майбутню локальну дату й час у форматі `YYYY-MM-DD HH:mm` та причину довжиною 3–500 символів. Клієнт перетворює локальний час на абсолютну часову мітку, а API повторно її перевіряє.
3. Підтвердьте дію. API в одній транзакції зберігає блокування, відкликає refresh-сімейства, анулює access-сесії, записує подію та створює системне сповіщення.
4. Наступний захищений запит користувача відхиляється, а застосунок показує строк і причину. Вхід паролем, вхід через Google, оновлення токена та mobile OAuth exchange однаково перевіряють блокування.
5. Для дострокового відновлення натисніть **Remove suspension**. Інакше доступ відновиться автоматично після зазначеного строку; історичні поля залишаться доступними операторам до наступної зміни.

The account row is retained, so the same normalized email or linked Google identity cannot be registered as a new account to bypass a suspension. The system deliberately does **not** ban by public IP or Wi-Fi because unrelated users may share a café, gym, office, carrier NAT, or VPN address. Rate limits may still use IP as one short-lived signal, but account suspension is identity-based. A person using a completely unrelated new identity cannot be reliably linked without a stronger verified factor such as a phone number, identity verification, or platform attestation; that is not claimed by this release.

Рядок акаунта не видаляється, тому ту саму нормалізовану email-адресу або прив'язану Google-ідентичність не можна повторно зареєструвати для обходу блокування. Система навмисно **не** блокує за публічною IP-адресою або Wi-Fi, адже різні користувачі можуть спільно використовувати адресу кафе, спортзалу, офісу, carrier NAT або VPN. Rate limit може короткочасно враховувати IP як один із сигналів, але блокування акаунта прив'язане до ідентичності. Неможливо надійно пов'язати людину з цілком новою сторонньою ідентичністю без сильнішого підтвердженого фактора, наприклад номера телефону, перевірки особи або platform attestation; цей реліз не заявляє такої можливості.

After deployment, test the matrix with controlled accounts: ordinary target by `super_admin`, `super_admin` target by the system owner, forbidden owner target, forbidden peer-`super_admin` target, immediate protected-request rejection, refresh rejection, expiry, and early removal. Do not use a production owner's account for destructive drills.

Після розгортання перевірте матрицю на контрольних акаунтах: звичайна ціль від `super_admin`, ціль-`super_admin` від системного власника, заборонена ціль-власник, заборонена ціль-рівний `super_admin`, негайне відхилення захищеного запиту, відхилення refresh, завершення строку й дострокове зняття блокування. Не використовуйте production-акаунт власника для руйнівних навчань.

## 6. Monitoring and incident response / Моніторинг та реагування

Run the `observability` profile and keep its UI ports bound to localhost. Review alerts for sustained 401/403/429 responses, elevated 5xx or latency, API CPU/RAM pressure, PostgreSQL pool waiters, Redis availability/memory, notification queue age/failures, and unusually large campaigns. Correlate an alert with structured logs by request ID; sensitive headers, tokens, passwords, MFA factors, and notification bodies are redacted.

Запускайте профіль `observability` і залишайте його UI-порти прив'язаними до localhost. Перевіряйте попередження про тривалі 401/403/429, підвищені 5xx або затримку, навантаження CPU/RAM API, очікування в пулі PostgreSQL, доступність/пам'ять Redis, вік і помилки черги сповіщень та незвично великі кампанії. Зіставляйте попередження зі структурованими логами за request ID; чутливі заголовки, токени, паролі, MFA-фактори та тексти сповіщень редагуються.

For suspected credential or refresh-token compromise: disable external traffic at the gateway/tunnel, preserve logs, rotate the affected secret, revoke active refresh sessions, verify privileged MFA state, and only then restore traffic. Rotating `JWT_SECRET` invalidates all access tokens immediately; revoking refresh sessions prevents renewal. Validate a fresh login after recovery.

Якщо підозрюється компрометація облікових даних або refresh-токена: вимкніть зовнішній трафік на шлюзі/тунелі, збережіть логи, змініть уражений секрет, відкличте активні refresh-сесії, перевірте стан MFA привілейованих користувачів і лише потім відновіть трафік. Ротація `JWT_SECRET` негайно робить усі access-токени недійсними; відкликання refresh-сесій блокує їх поновлення. Після відновлення перевірте новий вхід.

## 7. Rollback / Відкат

Application rollback is safe only while the new migrations remain in place: they are additive, and older application builds ignore the security tables, campaign idempotency column, and account-suspension columns. Do not reverse migrations during an ordinary rollback. Restore the prior application images, keep Redis available, and verify ordinary login and core read/write flows. A database rollback requires a separately approved maintenance window and a verified backup because dropping security tables or columns destroys MFA/session and suspension history.

Відкат застосунку безпечний лише зі збереженням нових міграцій: вони адитивні, а старі збірки ігнорують безпекові таблиці, колонку ідемпотентності кампаній та поля блокування акаунта. Не скасовуйте міграції під час звичайного відкату. Поверніть попередні образи застосунку, залиште Redis доступним і перевірте звичайний вхід та основні операції читання/запису. Відкат бази даних потребує окремо погодженого вікна обслуговування та перевіреної резервної копії, оскільки видалення безпекових таблиць або полів знищує історію MFA/сесій і блокувань.

After either a release or rollback, record the deployed commit, migration result, container health, backup set, restore-drill result, and the operator/time. Do not record secret values.

Після релізу або відкату зафіксуйте розгорнутий коміт, результат міграції, стан контейнерів, набір резервної копії, результат перевірки відновлення, оператора й час. Не записуйте значення секретів.
