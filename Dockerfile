FROM node:24 AS dependencies

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

FROM node:24 AS production

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main"]
