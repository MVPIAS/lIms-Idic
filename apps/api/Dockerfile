# API NestJS · build desde la raíz del monorepo (pnpm workspace)
# Construir con:  docker build -f apps/api/Dockerfile -t lims-api .
FROM node:20-alpine AS build
# openssl: Prisma lo necesita para detectar la versión y generar el engine correcto (musl/OpenSSL 3)
RUN apk add --no-cache openssl
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
# libssl.so.3 en runtime: el query engine de Prisma la enlaza dinámicamente
RUN apk add --no-cache openssl
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
WORKDIR /repo/apps/api
EXPOSE 3001
CMD ["node", "dist/main"]
