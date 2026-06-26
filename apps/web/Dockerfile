# Web Next.js 14 · build desde la raíz del monorepo (pnpm workspace)
# Construir con:  docker build -f apps/web/Dockerfile -t lims-web .
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @lims-idic/web build

FROM node:20-alpine AS run
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
