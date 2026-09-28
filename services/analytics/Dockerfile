# Build context is the REPOSITORY ROOT (the shared event contracts live in
# packages/event-contracts, and the Nest-independent tracing bootstrap in
# packages/tracing), e.g.:
#   docker build -f services/analytics/Dockerfile .
# Nothing from the main API's src/ is copied: the service shares only those
# two packages, never the API's database schema.
FROM node:24 AS dependencies

WORKDIR /app/services/analytics
COPY services/analytics/package*.json ./
RUN npm ci
# packages/tracing (copied alongside, not under, this WORKDIR - see the build
# stage below) needs `npm ci`'s @opentelemetry/* packages to type-check and
# build; Node/TypeScript module resolution only walks UP a file's own
# ancestor directories for node_modules, and /app/packages/tracing is a
# sibling of /app/services/analytics, not a descendant. This symlink gives
# it the same node_modules by walking up through /app instead - at runtime
# (production stage) this is unnecessary because dist/packages/tracing ends
# up nested inside dist/services/analytics/dist, whose ancestor already
# includes its own node_modules (see the production stage below).
RUN ln -s /app/services/analytics/node_modules /app/node_modules

FROM dependencies AS build

COPY packages/event-contracts /app/packages/event-contracts
COPY packages/tracing /app/packages/tracing
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
