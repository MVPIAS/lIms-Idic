# Web Next.js 14 · build desde la raíz del monorepo (pnpm workspace)
# Construir con:  docker build -f apps/web/Dockerfile -t lims-web .
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --no-frozen-lockfile
# Minutos de inactividad hasta el cierre de sesión. Next.js incrusta las
# variables NEXT_PUBLIC_* al COMPILAR, así que se fija con --build-arg y no en
# el .env del servidor. Vacío = valor por defecto de la aplicación (20).
ARG NEXT_PUBLIC_IDLE_MINUTES=""
ENV NEXT_PUBLIC_IDLE_MINUTES=$NEXT_PUBLIC_IDLE_MINUTES
# Zona horaria del IDIC en la web (frente f8, lib/fecha-chile.ts). Vacío =
# America/Santiago. Se incrusta al compilar, como la anterior.
ARG NEXT_PUBLIC_ZONA_HORARIA=""
ENV NEXT_PUBLIC_ZONA_HORARIA=$NEXT_PUBLIC_ZONA_HORARIA
RUN pnpm --filter @lims-idic/web build

FROM node:20-alpine AS run
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
WORKDIR /repo/apps/web
EXPOSE 3000
# Se arranca Next con node directamente, SIN pnpm. Con `pnpm start`, corepack
# descargaba pnpm de registry.npmjs.org en cada arranque: en el servidor aislado
# del IDIC (sin Internet) el contenedor entraba en bucle de reinicio y la web
# no llegaba a levantar. Detectado en el ensayo on-premise del 13-10-2026.
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
