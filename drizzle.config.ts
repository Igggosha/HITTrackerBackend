// EN: Configures Drizzle Kit to read the backend schema, store migrations, and connect to PostgreSQL through DATABASE_URL.
// UK: Налаштовує Drizzle Kit для читання схеми бекенду, зберігання міграцій і підключення до PostgreSQL через DATABASE_URL.

import { defineConfig } from "drizzle-kit";
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL не найдена в файле .env");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});