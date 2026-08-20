# Visualizate API + render worker.
# The Playwright base image ships Chromium and its system libraries; the
# Playwright version must match the one in package.json.
ARG PLAYWRIGHT_TAG=v1.61.1-noble

FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_TAG} AS build
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# Scripts are skipped so husky (prepare) does not run; Prisma is generated explicitly.
RUN npm ci --ignore-scripts && npx prisma generate
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_TAG} AS runtime
# Fonts used by templates that rely on system families (custom fonts come from
# the brand kit and are loaded from object storage).
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-core fonts-noto-color-emoji fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json /app/prisma.config.ts ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER pwuser
EXPOSE 3000
# API (no workers):  RUN_WORKERS=false node dist/src/main
# Worker (no HTTP):  node dist/src/worker
# Migrations:        npx prisma migrate deploy
CMD ["node", "dist/src/main"]
