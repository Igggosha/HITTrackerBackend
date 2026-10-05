# Hit Tracker security hardening report / Звіт про посилення безпеки Hit Tracker

Date / Дата: 2026-10-05

## Outcome / Результат

The account-suspension and emergency-session controls are implemented, tested, migrated, and deployed together with the existing security stack. The web application and public API are operational behind Cloudflare Tunnel. Android `1.3.4` build `21` is published as the latest signed universal APK. No new environment variables or secrets were introduced by this feature.

Керування блокуванням акаунта та аварійним завершенням сесій реалізовано, протестовано, мігровано й розгорнуто разом із наявним комплексом захисту. Web-застосунок і публічний API працюють за Cloudflare Tunnel. Android `1.3.4` build `21` опубліковано як останній підписаний універсальний APK. Ця функція не додала нових змінних середовища або секретів.

## Defence layers in request order / Рівні захисту в порядку проходження запиту

1. **Cloudflare edge and tunnel:** hides the host address and provides the external TLS boundary.
2. **Nginx API gateway:** limits body size, connections, request rate, and timeouts; replaces untrusted forwarding headers; the Nest API is not on the public Docker network.
3. **Shared Redis throttling:** coordinates account- and IP-based short-term limits across API instances. IP is a rate signal, never an account-ban identity.
4. **Authentication:** normalized identity lookup, generic invalid-login responses, strong password rules, email verification, and controlled Google OAuth linking.
5. **Privileged MFA:** `helper`, `moderator`, `admin`, and `super_admin` require encrypted TOTP credentials or one-time hashed recovery codes.
6. **Token and session lifecycle:** short-lived access tokens, rotating refresh families, refresh-reuse detection, current-device/all-device logout, and database-backed immediate invalidation boundaries.
7. **Authorization and ownership hierarchy:** protected requests re-read authoritative user state; controller and service checks prevent privilege escalation. Only the system owner may manage a `super_admin`; nobody may remotely manage the owner.
8. **Account suspension:** password login, Google login, token refresh, mobile OAuth exchange, and every protected API request reject an active suspension with its reason and expiry.
9. **Data boundary:** a least-privilege PostgreSQL application role performs DML only; administrative credentials are reserved for migration, seed, backup, and maintenance jobs.
10. **Detection and recovery:** redacted structured logs, metrics and alerts, notification audit/delivery records, versioned migrations, verified PostgreSQL/MinIO backups, and an isolated restore drill.

1. **Cloudflare edge і tunnel:** приховують адресу хоста та утворюють зовнішню TLS-межу.
2. **Nginx API gateway:** обмежує розмір тіла, з'єднання, частоту запитів і тайм-аути; замінює недовірені forwarding-заголовки; Nest API не входить до публічної Docker-мережі.
3. **Спільний Redis throttling:** узгоджує короткочасні ліміти за акаунтом та IP між екземплярами API. IP є лише сигналом частоти, а не ідентичністю для блокування акаунта.
4. **Автентифікація:** нормалізований пошук ідентичності, узагальнені помилки входу, надійні правила пароля, підтвердження email і контрольоване прив'язування Google OAuth.
5. **MFA привілейованих ролей:** `helper`, `moderator`, `admin` і `super_admin` використовують зашифровані TOTP-дані або одноразові хешовані recovery-коди.
6. **Життєвий цикл токенів і сесій:** короткочасні access-токени, ротація refresh-сімейств, виявлення повторного refresh, вихід на одному/всіх пристроях і негайна межа анулювання в базі даних.
7. **Авторизація та ієрархія власника:** захищені запити повторно читають авторитетний стан користувача; перевірки controller і service запобігають підвищенню привілеїв. Лише системний власник може керувати `super_admin`; ніхто не може віддалено керувати власником.
8. **Блокування акаунта:** вхід паролем, Google-вхід, refresh токена, mobile OAuth exchange і кожен захищений API-запит відхиляють активне блокування з причиною та строком.
9. **Межа даних:** прикладна роль PostgreSQL має лише DML-права; адміністративні дані доступу використовуються лише для міграцій, seed, backup і технічних робіт.
10. **Виявлення та відновлення:** редаговані структуровані логи, метрики й alert-правила, аудит/доставка сповіщень, версійні міграції, перевірені резервні копії PostgreSQL/MinIO та ізольована перевірка відновлення.

## Administrative controls / Адміністративні дії

| Actor / Виконавець | Ordinary roles / Звичайні ролі | `super_admin` | system owner / системний власник |
| --- | --- | --- | --- |
| `super_admin` | end sessions, suspend, restore / завершити сесії, заблокувати, відновити | denied / заборонено | denied / заборонено |
| system owner / системний власник | end sessions, suspend, restore / завершити сесії, заблокувати, відновити | allowed / дозволено | denied / заборонено |

The actions are available in **Admin → Users → user profile → Account security**. Every destructive action requires confirmation. Suspension additionally requires a future local date/time and a 3–500 character reason. The administrator's local input is converted to an absolute UTC timestamp; every user sees that same instant formatted in their own local time.

Дії доступні в **Admin → Users → профіль користувача → Account security**. Кожна руйнівна дія потребує підтвердження. Для блокування також потрібні майбутні локальні дата/час і причина довжиною 3–500 символів. Локальне введення адміністратора перетворюється на абсолютну UTC-мітку; кожен користувач бачить той самий момент у своєму локальному форматі.

Suspension revokes all refresh families, invalidates already issued access tokens on their next protected request, records an activity, and creates a system notification in one transaction. The retained account row prevents re-registration with the same normalized email or linked Google identity. Public-IP bans are intentionally excluded to avoid blocking unrelated people on shared Wi-Fi, carrier NAT, or VPN endpoints.

Блокування в одній транзакції відкликає всі refresh-сімейства, анулює вже видані access-токени під час наступного захищеного запиту, записує подію та створює системне сповіщення. Збережений рядок акаунта запобігає повторній реєстрації з тією самою нормалізованою email-адресою або прив'язаною Google-ідентичністю. Блокування за публічним IP навмисно відсутнє, щоб не блокувати сторонніх людей у спільному Wi-Fi, carrier NAT або VPN.

## Verification evidence / Докази перевірки

### VERIFIED — executed / ПЕРЕВІРЕНО — виконано

- Backend focused security tests: 18 suites, 87 tests passed.
- Backend full unit suite: 64 suites and 311 tests passed; 2 suites and 10 tests skipped by their existing definitions.
- Backend read-only ESLint, TypeScript typecheck, and production build passed.
- Backend e2e smoke: 3 suites, 12 tests passed.
- The additive suspension migration passed a transactional dry run with positive and constraint-negative probes, then applied in the running Compose database. All three expected user columns are present.
- Mobile: 106 Node tests passed; Expo export passed for web, Android, and iOS.
- Signed universal APK `1.3.4` build `21`: version metadata and four ABIs (`armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`) inspected; APK Signature Scheme v2 verified.
- APK SHA-256: `915784931257F12CDC68592CE5CAF5D80A8511D44C95EE916580143481316C1B`.
- Pre-release backup set `20261005T090928Z` completed; isolated restore verification queried users, workouts, exercises, and migration history, then dropped its scratch database.
- Deployed API, gateway, PostgreSQL primary/replica, Redis, MinIO, notification worker, frontend, and Cloudflare connector are running; health-checked release services are healthy.
- The complete working Compose stack was rebuilt/reconciled across `backup`, `events`, `search`, `edge`, `tools`, and `observability`; all one-shot initialization/migration/rebuild jobs exited `0`, and persistent services remained running.
- Public smoke after deployment: API root `200`, unauthenticated protected endpoint `401`, web application `200`, latest APK download `200` with `94,092,305` bytes.
- A post-deployment `502` caused by Nginx retaining the old API container address was reproduced and fixed with request-time Docker DNS resolution. The fix survives future API container replacement without exposing Nest to the edge network.

### INSPECTED / ПЕРЕГЛЯНУТО

- DTO, controller, service, JWT strategy, password/Google/refresh/mobile OAuth paths, notification transaction, Drizzle schema, mobile service, navigation, localization, and admin UI boundaries.
- Role hierarchy, system-owner exception, self-action denial, expired-suspension behavior, and same-identity re-registration behavior.
- Git history/status and fresh remote divergence checks in both repositories before pushing `master`.

### NOT VERIFIED / НЕ ПЕРЕВІРЕНО

- A destructive suspension drill was not run against a real production user. Use a dedicated ordinary test account from Safari on iPhone or another client.
- The APK was not installed on a physical Android device in this run.
- iOS was bundled and the deployed website is available to Safari, but no native iOS build or iPhone simulator run was performed.

## Residual risks and honest limits / Залишкові ризики та чесні обмеження

1. A person who creates a completely unrelated new identity cannot be reliably linked to a suspended account without an additional verified factor such as a phone number, identity verification, or platform attestation. Device fingerprinting and IP bans were not added because of false-positive and privacy risks.
2. Server rejection is immediate on the next request. An already open idle client cannot display the suspension screen until it performs a request or receives/opens a push notification.
3. Mobile build tooling still reports 16 high-severity npm advisories in Expo/Metro transitive build dependencies. The proposed forced fix downgrades Expo incompatibly; the Node build tools are not shipped as an executable server in the APK. Track supported Expo updates rather than forcing the breaking downgrade.
4. Browser XSS remains the principal web-client risk. CSP, safe URL handling, memory-only web access tokens, HttpOnly refresh handling, and dependency review reduce impact but do not make arbitrary future UI code safe automatically.

## Operations and delivery / Експлуатація та публікація

- Primary bilingual runbook: [`security-operations.md`](security-operations.md).
- Backend repository: `Igggosha/HITTrackerBackend`, `master`.
- Mobile repository: `smmlt/hit-tracker-mobile`, `master`.
- Android release: `android-v1.3.4-build21`.
- Canonical release repository: `https://github.com/smmlt/HitTracker/releases`.
- Stable latest asset: `https://github.com/smmlt/HitTracker/releases/latest/download/HitTracker-Android-universal.apk`.
- Keep `.env`, signing keys, Firebase service credentials, Cloudflare tokens, recovery codes, and generated APK files outside Git.
