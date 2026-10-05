FROM node:26 AS dependencies

WORKDIR /app

COPY package*.json ./
RUN npm ci

FROM dependencies AS build

COPY . .
RUN npm run build

FROM dependencies AS migration

COPY drizzle.config.ts ./
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY src/db ./src/db

FROM dependencies AS search-tools

COPY . .
CMD ["npm", "run", "search:rebuild"]

FROM node:26 AS production

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY packages/event-contracts/schemas ./packages/event-contracts/schemas

EXPOSE 3000

CMD ["node", "dist/src/main.js"]
