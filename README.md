# LIMS IDIC · Repositorio del producto

Sistema LIMS para el Instituto de Investigaciones y Control del Ejército de Chile.
Stack: **NestJS + Next.js + PostgreSQL + Prisma + Redis + MinIO** con autenticación LDAP/AD.

## Estructura del monorepo

```
lims-idic/
├── apps/
│   ├── api/                 # NestJS backend (puerto 3001)
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── auth/        # LDAP + JWT + 2FA
│   │       ├── cliente/     # CRUD clientes con validación RUT chileno
│   │       ├── cotizacion/  # cotizaciones + líneas polimórficas
│   │       ├── ot/          # órdenes de trabajo + workflow BPM
│   │       ├── health/      # /health para monitoreo
│   │       └── common/      # prisma.service, audit interceptor, RUT validator
│   └── web/                 # Next.js 14 (puerto 3000)
│       ├── app/
│       │   ├── login/page.tsx
│       │   └── (app)/       # rutas con layout autenticado
│       │       ├── dashboard/page.tsx
│       │       ├── cotizaciones/page.tsx
│       │       └── ot/page.tsx
│       └── components/      # Sidebar, Topbar, ui/*
├── packages/
│   ├── db/                  # Prisma + schema sincronizado con ../02_diseno/schema.sql
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── seed.ts
│   └── shared/              # tipos compartidos api ↔ web
├── docker/
│   └── docker-compose.yml   # PG + Redis + MinIO para desarrollo local
├── package.json             # workspace root (pnpm)
├── pnpm-workspace.yaml
└── .env.example
```

## Requisitos

- **Node.js** 20.x LTS
- **pnpm** 9.x (`npm install -g pnpm`)
- **Docker Desktop** (para PostgreSQL, Redis, MinIO locales)
- **Git** 2.40+

## Arranque en 5 minutos

```bash
# 1. Clonar y entrar
git clone <repo> lims-idic && cd lims-idic

# 2. Instalar dependencias
pnpm install

# 3. Copiar variables de entorno
cp .env.example .env
# Editar .env si es necesario (los defaults sirven para dev local)

# 4. Levantar PostgreSQL + Redis + MinIO con Docker
docker compose -f docker/docker-compose.yml up -d

# 5. Crear schema en PostgreSQL (carga el schema.sql del proyecto)
psql -h localhost -U lims -d lims_idic -f ../../02_diseno/schema.sql

# 6. Generar cliente Prisma y aplicar migraciones
pnpm db:generate
pnpm db:seed

# 7. Arrancar app (en paralelo)
pnpm dev
# → API en http://localhost:3001
# → Web en http://localhost:3000

# 8. Login de prueba (modo dev sin LDAP)
# Usuario: c.vargas
# Pass:    demo (cualquier valor en dev)
```

## Comandos útiles

```bash
pnpm dev              # arranca api + web en paralelo
pnpm dev:api          # solo NestJS
pnpm dev:web          # solo Next.js
pnpm build            # build de producción de ambos
pnpm test             # tests unitarios + integración
pnpm test:e2e         # tests E2E con Playwright
pnpm lint             # ESLint
pnpm db:generate      # regenera el cliente Prisma
pnpm db:migrate       # nueva migración
pnpm db:studio        # abre Prisma Studio (UI de BD)
pnpm db:seed          # carga datos seed
```

## Convenciones de código

- **TypeScript** estricto en todo (no JavaScript)
- **Imports absolutos**: `@/auth/auth.service` (no `../../../auth/auth.service`)
- **Validación** con Zod en ambos lados (api con NestJS pipes, web con react-hook-form)
- **Errores** estandarizados: `ApiError` con código + mensaje + status
- **Audit log** automático vía interceptor NestJS para acciones críticas
- **Commits** con Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`)
- **PRs** con descripción del cambio + tests + screenshots si toca UI

## Decisiones arquitectónicas (ADR)

Ver `docs/adr/` para registro formal de decisiones. Las clave:

| # | Decisión | Por qué |
|---|---|---|
| 001 | Monorepo con pnpm workspaces | Compartir tipos y schemas entre api/web sin overhead |
| 002 | Prisma para ORM | TypeSafety, migraciones, performance, comunidad activa |
| 003 | NestJS sobre Express vainilla | Estructura modular, DI, decoradores, mantenibilidad |
| 004 | Next.js App Router (no Pages) | RSC, Streaming, futuro de React |
| 005 | LDAP con passport-ldapauth | Estándar maduro para AD del Ejército |
| 006 | Motor BPM propio + bpmn-js | Diferenciador comercial (ver `01_analisis/motor_bpm_y_disenador.html`) |
| 007 | Audit log particionado por mes | Performance + retención larga (NCh-ISO 17025) |
| 008 | MinIO en lugar de filesystem | S3-compatible, on-premise IDIC, sin lock-in |

## Tests y CI

- **Unit tests**: Jest (api + web)
- **E2E tests**: Playwright comparando contra capturas del legacy PHP
- **CI**: GitHub Actions (lint → test → build → docker)
- **Coverage objetivo**: 70% líneas, 80% en módulos críticos (auth, cotización, OT)

## Despliegue

Producción on-premise IDIC con Docker Compose:

```bash
# En servidor IDIC
docker compose -f docker/docker-compose.prod.yml up -d
```

Ver `docs/despliegue.md` para detalles de:
- Configuración HA (2 app servers + PG primary+replica)
- Backup automatizado pgBackRest
- Monitoreo Prometheus + Grafana
- Logs centralizados Loki

## Equipo

- **Backend (NestJS)**: 1 dev senior
- **Frontend (Next.js)**: 1 dev senior
- **Fullstack/QA**: 1 dev mid
- **DevOps**: 0.5 dev (compartido)
- **Arquitecto/PM**: 0.5 (Aiuken)

## Cronograma

9 meses desde firma de contrato hasta GoLive. Ver `01_analisis/plan_avance_paralelo.html`
para sprints S1-S18 con entregables verificables.

---

_Aiuken Solutions Chile · IAFIS · Proyecto LIMS IDIC 2026_
