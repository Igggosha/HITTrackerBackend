# Build context is the REPOSITORY ROOT (the shared event contracts live in
# packages/event-contracts), e.g.:
#   docker build -f services/analytics/Dockerfile .
# Nothing from the main API's src/ is copied: the service shares only the
# event contracts, never the API's database schema.
FROM node:24 AS dependencies

WORKDIR /app/services/analytics
COPY services/analytics/package*.json ./
RUN npm ci

FROM dependencies AS build

COPY packages/event-contracts /app/packages/event-contracts
COPY services/analytics ./
RUN npm run build

# One-shot `analytics-migrate`: drizzle-kit applies services/analytics/drizzle.
FROM dependencies AS migration

COPY services/analytics/drizzle.config.ts services/analytics/tsconfig.json ./
COPY services/analytics/drizzle ./drizzle
COPY services/analytics/src/db ./src/db
CMD ["npm", "run", "db:migrate"]

FROM node:24 AS production

WORKDIR /app/services/analytics
ENV NODE_ENV=production

COPY services/analytics/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/services/analytics/dist ./dist
# JSON Schemas are read at runtime (found by walking up to /app/packages).
COPY packages/event-contracts/schemas /app/packages/event-contracts/schemas

USER node
EXPOSE 3000

CMD ["node", "dist/services/analytics/src/main.js"]
