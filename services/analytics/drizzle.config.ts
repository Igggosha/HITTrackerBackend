// EN: Configures Drizzle Kit to derive analytics migrations from the service's independent CQRS read-model schema.
// UK: Налаштовує Drizzle Kit для створення міграцій аналітики з незалежної CQRS-схеми моделей читання цього сервісу.

import { defineConfig } from 'drizzle-kit';

// The analytics service owns this database; it never sees the main API's
// schema. `analytics-migrate` runs this config as the `analytics_app` role.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.ANALYTICS_DATABASE_URL ??
      'postgresql://analytics_app:change_me@localhost:5432/analytics',
  },
});
