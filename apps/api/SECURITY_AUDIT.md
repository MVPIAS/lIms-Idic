# Auditoría de seguridad · LIMS IDIC API (apps/api)

Fecha: 2026-07-14
Alcance: `apps/api/**` + infraestructura raíz (`Caddyfile`, `docker-compose.prod.yml`, `.env.example`).
Contexto: NestJS 10 + Prisma + PostgreSQL, desplegado tras Caddy (TLS) en servidor público. Preparación para pentesting.

> Nota: NO se modificó `apps/web`. NO se hicieron commits ni despliegues.

---

## Resumen de hallazgos

| # | Severidad | Hallazgo | Estado |
|---|-----------|----------|--------|
| 1 | **Crítica** | `JWT_SECRET` con fallback hardcodeado `"dev-secret-change-me"` en `jwt.strategy.ts` y `auth.module.ts` | **Corregido** |
| 2 | **Crítica** | Deriva de esquema Prisma ↔ BD real: los endpoints de listado devuelven 0 (dashboard) | **Corregido en parte** (ver §Conteos) |
| 3 | **Alta** | Sin cabeceras de seguridad (helmet). `X-Powered-By: Express` expuesto | **Corregido** |
| 4 | **Alta** | Rate limiting no activo (ThrottlerModule importado pero sin guard global); login sin protección anti fuerza bruta | **Corregido** |
| 5 | **Alta** | `FlujoController` (`/api/flujos/*`) SIN guard de autenticación: lectura y mutación de flujos sin login | **Corregido** |
| 6 | **Media** | `ZodError` de `Schema.parse()` en controladores → 500 con stack trace en vez de 400 | **Corregido** |
| 7 | **Media** | Fuga de stack traces / detalles internos en errores no controlados (500) | **Corregido** |
| 8 | **Media** | CORS con default permisivo y sin exigir dominio en producción | **Corregido** |
| 9 | **Media** | Listados sin aislamiento por tenant (posible fuga entre tenants / IDOR) | **Documentado** (recomendación) |
| 10 | Baja | Swagger deshabilitado en prod | **Verificado OK** |
| 11 | Baja | Postgres/Redis/MinIO no expuestos a Internet | **Verificado OK** |

---

## Correcciones aplicadas

### 1. JWT_SECRET sin default inseguro (Crítica)
- Nuevo helper `apps/api/src/common/jwt-secret.ts` (`getJwtSecret()`): lee `JWT_SECRET` del entorno y **aborta el arranque** si falta o mide menos de 32 caracteres.
- Eliminado el fallback `"dev-secret-change-me"` de `jwt.strategy.ts` y `auth.module.ts`; ambos usan ahora `getJwtSecret()`.
- Efecto: es imposible arrancar firmando/validando JWT con un secreto conocido.

### 3. Cabeceras de seguridad (Alta)
- Instalado **`helmet@^7.1.0`** (compatible con Nest 10 / Express 4) — añadido a `apps/api/package.json`.
- Aplicado en `main.ts`: HSTS (solo prod, 180 días + subdominios), `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `frame-ancestors 'none'` vía CSP, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`, y `baseUri/objectSrc` restringidos.
- `X-Powered-By` deshabilitado explícitamente (`getInstance().disable('x-powered-by')`).
- CSP de la API restrictiva (`default-src 'self'`) — la API es JSON puro, no rompe el front (Next lo sirve Caddy en el mismo dominio).
- Defensa en profundidad en `Caddyfile`: HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` para todo el sitio (sin CSP en el front para no romper Next.js).

### 4. Rate limiting (Alta)
- `ThrottlerGuard` registrado **global** vía `APP_GUARD` en `app.module.ts` (antes estaba importado pero inactivo).
- Dos limitadores: `default` (100 req/min) y `login` (5 req/min).
- `POST /api/auth/login` decorado con `@Throttle({ login: { ttl: 60000, limit: 5 } })` → mitigación de fuerza bruta.

### 5. Endpoint sin guard (Alta)
- `FlujoController` ahora exige JWT: `@UseGuards(AuthGuard("jwt"))` + `@ApiBearerAuth()`. Antes exponía sin login el catálogo de flujos, guardado de borradores, publicación, instanciación y cierre de tareas.

### 6. ZodError → 400 (Media)
- Nuevo `apps/api/src/common/zod-exception.filter.ts` (`@Catch(ZodError)`): responde **400** con `{ statusCode, error, message, issues[] }`, sin stack.
- Registrado global en `main.ts` (`app.useGlobalFilters(...)`).
- Resuelve los 500 que producían `Schema.parse(body)` en los controladores CRUD y en `auth`/`resultados`.

### 7. Fuga de errores (Media)
- Nuevo `apps/api/src/common/all-exceptions.filter.ts`: registra el error completo en el log del servidor pero, en producción, devuelve un **500 genérico** sin stack ni mensaje interno. Respeta las `HttpException` (400/401/403/404).

### 8. CORS (Media)
- `main.ts`: en producción **exige** `CORS_ORIGINS` (aborta si falta); nunca usa `*` con `credentials: true`. Lista blanca por env separada por comas.
- `CORS_ORIGINS=https://${DOMAIN}` añadido al servicio `api` en `docker-compose.prod.yml` y documentado en `.env.example`.

### 10/11. Verificaciones (OK, sin cambios)
- **Swagger**: solo se monta si `NODE_ENV !== "production"`. Correcto.
- **Exposición de servicios**: en `docker-compose.prod.yml` solo `caddy` publica `80/443`. `postgres`, `redis`, `minio`, `metabase`, `web`, `api` usan `expose`/red interna, sin `ports:` al host. Postgres/Redis/MinIO **no** son accesibles desde Internet. La consola de MinIO está comentada. Correcto.

---

## Conteos del dashboard — causa raíz y fix

**Síntoma:** el dashboard cuenta 0 en `metodos`/`plantillas`/`proveedores` (y `listas-precio`/`muestras`) aunque la BD tiene datos; `clientes` sí cuenta (8).

**Causa raíz real (≠ hipótesis de filtro por tenant):**
1. `BaseCrudService.listar()` **no filtra por tenant** en ningún momento; por tanto el tenant de las filas no explicaba el 0.
2. La BD de producción se construye desde **`packages/db/schema.sql` + seeds SQL** (ver `provision.sh`): los 136 métodos, 114 plantillas y 5 proveedores provienen de `seed_catalogos_metodos.sql`, `seed_plantillas.sql` y `seed_preprod_demo.sql`, escritos contra las columnas de `schema.sql`.
3. **`packages/db/prisma/schema.prisma` está desincronizado con la BD real.** Ejemplos verificados:
   - `proveedor`: la BD tiene `codigo, razon_social, rut, telefono, activo`; el modelo Prisma declara `rubro, contacto, email, condicion_pago, estado, deleted_at` (y NO `codigo`/`activo`).
   - `metodo`: BD `unidad_responsable, tecnica, familia, tipo, objetivo`; Prisma `norma, version, area, estado, deleted_at`.
   - `plantilla_informe`, `lista_precio`, `muestra`: mismas divergencias; ninguna de estas tablas tiene `deleted_at` (solo `usuario` y `cliente` lo tienen en `schema.sql`).
4. Doble efecto sobre los listados vía Prisma:
   - `BaseCrudService` añadía por defecto `WHERE deleted_at IS NULL` (`softDelete !== false`) contra tablas **sin** esa columna → error SQL.
   - Prisma, al hacer `findMany`, selecciona **todos los escalares declarados** en el modelo (incluidos `deleted_at`, `rubro`, `estado`…) que **no existen** en la BD → error SQL.
   - Resultado: el endpoint lanza 500 y el dashboard muestra 0. `clientes` funciona porque usa su propio servicio y su modelo sí coincide con la tabla.

**Fix aplicado (en alcance `apps/api`):**
- `BaseCrudService`: el soft-delete pasa a ser **opt-in** (`softDelete === true`). Por defecto ya no se emite `WHERE deleted_at IS NULL`, eliminando esa clase de 500 y corrigiendo las consultas `count()` (que no seleccionan escalares). Coherente con la BD real (ninguna tabla base-crud tiene `deleted_at`).

**Pendiente para conteos 100% (fuera de `apps/api`, requiere BD viva):**
- La resolución COMPLETA de los listados exige **reconciliar `packages/db/prisma/schema.prisma` con la BD real** (deriva de columnas más allá de `deleted_at`). Recomendado:
  1. `pnpm --filter @lims-idic/db exec prisma db pull` contra la BD real para regenerar el modelo, luego `prisma generate`.
  2. Ajustar los esquemas Zod de create/update e `include` en `catalogo.module.ts`, `comercial.module.ts`, `laboratorio.module.ts` a las columnas reales.
  3. Verificar contra la BD sembrada (136 métodos / 114 plantillas / 5 proveedores).
- No se aplicó aquí porque (a) `packages/db` queda fuera del dominio de edición asignado, (b) es una migración de capa de datos que cascadea sobre múltiples DTOs, y (c) no debe introducirse a ciegas (sin BD para verificar) en un despliegue que va a pentest.

---

## Recomendaciones pendientes para el pentest

- **Reconciliar el esquema Prisma ↔ BD** (bloqueante para el módulo, ver arriba).
- **Aislamiento por tenant (Media/Alta):** `BaseCrudService.listar/detalle` no filtran por `tenantId`. Con más de un tenant habría fuga de datos / IDOR. Cablear `req.user.tenantId` desde `BaseCrudController` hacia el servicio y filtrar (y validar en `detalle`).
- **2FA TOTP:** el modelo de usuario ya contempla MFA; habilitar el flujo TOTP para cuentas privilegiadas.
- **Rotación de secretos:** rotar `JWT_SECRET`, credenciales de Postgres/MinIO; gestor de secretos en vez de `.env` plano.
- **Invalidación de refresh tokens:** `logout` es un TODO; implementar lista negra en Redis (ya disponible) para revocación real.
- **Bloqueo de cuenta:** ya se incrementa `intentosFallidos`; añadir bloqueo temporal tras N intentos además del rate limit por IP.
- **Backups:** respaldos cifrados y automatizados de Postgres + prueba de restauración.
- **WAF / fail2ban:** proteger `443` con WAF (o reglas Caddy) y `fail2ban` sobre logs de auth.
- **Logging/auditoría:** existe `audit_log` en el esquema; asegurar que login, cambios de RBAC y operaciones sensibles se registran; centralizar logs.
- **CSP del front:** endurecer la CSP de Next.js en Caddy (hoy sin CSP para no romper el runtime).
- **Dependencias:** `npm audit` / SCA en CI; hay subdependencias deprecadas (ldapjs 2.x, glob, inflight).
- **Endpoints de health:** `/api/health` es público (aceptable); confirmar que no revela versión/detalle sensible en prod.

---

## Archivos modificados (apps/api + infra)

**Nuevos:**
- `apps/api/src/common/zod-exception.filter.ts`
- `apps/api/src/common/all-exceptions.filter.ts`
- `apps/api/src/common/jwt-secret.ts`
- `apps/api/SECURITY_AUDIT.md`

**Editados:**
- `apps/api/src/main.ts` (helmet, CORS, filtros globales, x-powered-by)
- `apps/api/src/app.module.ts` (ThrottlerGuard global + limitadores)
- `apps/api/src/auth/auth.controller.ts` (`@Throttle` en login)
- `apps/api/src/auth/auth.module.ts` (getJwtSecret)
- `apps/api/src/auth/jwt.strategy.ts` (getJwtSecret)
- `apps/api/src/flujo/flujo.controller.ts` (AuthGuard jwt)
- `apps/api/src/common/base-crud.service.ts` (soft-delete opt-in)
- `apps/api/package.json` (helmet)
- `Caddyfile` (cabeceras de seguridad)
- `docker-compose.prod.yml` (CORS_ORIGINS)
- `.env.example` (CORS_ORIGINS, nota JWT_SECRET)

**Verificación:** `pnpm --filter @lims-idic/db generate` + `pnpm --filter @lims-idic/api build` (`nest build`) compilan sin errores.
