# API NestJS · build desde la raíz del monorepo (pnpm workspace)
# Construir con:  docker build -f apps/api/Dockerfile -t lims-api .
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --no-frozen-lockfile
# Generar Prisma Client (obligatorio: la API tipa contra @prisma/client)
RUN pnpm --filter @lims-idic/db exec prisma generate
RUN pnpm --filter @lims-idic/api build

FROM node:20-alpine AS run
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
WORKDIR /repo/apps/api
EXPOSE 3001
CMD ["node", "dist/main"]
