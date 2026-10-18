# Administración de roles con alcance por laboratorio · LIMS IDIC

Contrato backend ↔ web de la administración de **estructura, usuarios, roles y matriz de firmas**, y de cómo se calcula el **alcance por laboratorio** de cada usuario.

- SQL: `packages/db/align_admin_roles.sql` (aditivo e idempotente; en `provision.sh` va después de `align_metrologia.sql`; requiere `align_rbac_unidad.sql`).
- API: `apps/api/src/rbac/*` (prefijo `/api`, JWT Bearer).
- Lógica pura y probada: `rbac/alcance.ts`, `rbac/firmas-resolver.ts` (tests `*.spec.ts`).

---

## 1. Modelo

```
unidad (árbol)            rol ─┬─ rol_permiso ── permiso
  id, codigo, nombre           │
  tipo, padre_id ──┐           └─ usuario_rol (ASIGNACIÓN) ── usuario
  sigla, icono,    │               id, usuario_id, rol_id,
  color, codsucdel,│               unidad_id (NULL = sin unidad),
  centro_costo,    │               vigente_desde, vigente_hasta
  orden, activa    │
        ▲──────────┘           unidad_jefe: (unidad_id, usuario_id, rol = titular | subrogante)

flujo_firma (matriz de firmas)
  tipo_documento, unidad_id (NULL = regla por defecto), orden, accion,
  rol_id, nivel_unidad, unidad_destino_id (solo nivel FIJA), obligatorio, activo, descripcion
```

| Tabla | Columnas nuevas | Notas |
|---|---|---|
| `unidad` | `tipo`, `padre_id`, `sigla`, `icono`, `color`, `codsucdel`, `centro_costo`, `orden` | `tipo` ∈ DIRECCION, DEPARTAMENTO, SECCION, LABORATORIO, SUCURSAL, DELEGACION, APOYO. La vigencia usa la columna existente **`activa`**; la API la expone como **`activo`**. |
| `rol` | `nivel`, `alcance`, `orden`, `alias_de` | `nivel` ∈ OPERATIVO, JEFATURA, DIRECCION, SOPORTE, SISTEMA. `alcance` ∈ UNIDAD, DESCENDENCIA, GLOBAL. `alias_de` = código canónico de un rol legado. |
| `usuario_rol` | FK `unidad_id → unidad` (NOT VALID) | Un usuario puede tener **varias asignaciones** (mismo rol en varias unidades, varios roles). |
| `flujo_firma` | tabla nueva | Ver §4. |

### 1.1 Organigrama sembrado (upsert por `codigo`)

| Código | Nombre | Tipo | Padre | CODSUCDEL |
|---|---|---|---|---|
| DIR ★ | Dirección IDIC | DIRECCION | — | |
| DCO ◱ | Departamento Comercial | DEPARTAMENTO | DIR | |
| SVT / SPC / MUE | Secc. Ventas / Planificación y Control / Muestreo | SECCION | DCO | MUE 9999 (CC 400495110) |
| DQO ⚗ | Departamento Químico | DEPARTAMENTO | DIR | |
| SQU | Sección Química → LME 7005, LQC 7003, LPN 7004 | SECCION | DQO | |
| SAL | Sección Alimentos (7007) → LQA 7009, LMB 7010, LES 7008 | SECCION | DQO | |
| SVE | Sección Vestuario y Equipos → LCC 7006, LTX 7011 | SECCION | DQO | |
| DSA ⌖ | Departamento Armamento y Munición → LRB 4009, LAM 4008, SEO 400440110, SVM 4007 | DEPARTAMENTO | DIR | |
| SEM | Sección Ensayos Mecánicos → LEM 4006 | SECCION | DSA | |
| SAM | Sección Metrología → LMT 400450130, LMTE 400450140, LNF 400450150, LCAD 400450120 | SECCION | DSA | |
| BPCH ✹ | Banco de Pruebas de Chile | DEPARTAMENTO | DIR | |
| SCC | Sección Certificación de la Conformidad | SECCION | BPCH | 3002 |
| SSTGO, SANTOF, SSEREN, SCALAM, SCOPIAP, SIQUIQU | Sucursales Santiago, Antofagasta, La Serena, Calama, Copiapó, Iquique | SUCURSAL | BPCH | 3000, 3001, 3005, 3010, 3003, 3004 |
| D11 | Delegación Nº 11 | DELEGACION | BPCH | 3009/3008 |
| DGC ✔ / DFZ $ / SAB ▦ | Gestión de Calidad / Finanzas / Abastecimiento | APOYO | DIR | |

Reglas del seed: las unidades existentes **no se duplican**; solo se completan los campos vacíos. El nombre se corrige únicamente la primera vez (cuando la unidad aún no tenía `tipo`), para no pisar renombres hechos luego en Administración. La unidad legada `COM` («Comercial») queda como SECCION bajo DCO. Cualquier otra unidad preexistente sin tipo queda como LABORATORIO bajo DIR. Nombres a validar con IDIC: **LCAD** (se dejó «Laboratorio LCAD (Metrología)»).

---

## 2. Roles

| Código | Nombre | Nivel | Alcance | Qué puede (permisos por defecto) |
|---|---|---|---|---|
| SUPERADMIN | Super Administrador | SISTEMA | GLOBAL | Todo (el guard lo deja pasar siempre). Sus permisos **no son editables**. |
| ADMIN | Administrador del sistema | SISTEMA | GLOBAL | `admin.usuarios/estructura/roles/firmas`, toda la lectura (`*.ver`), catálogo, plantillas, flujos, `metrologia.config`, `ibis.config`, auditoría. |
| DIRECTOR | Director | DIRECCION | GLOBAL | Toda la lectura + firmar/emitir certificados, aprobar/revisar resultados, aprobar cotizaciones y métodos, NC, cerrar OT, VB/firma de oficios. |
| SUBDIRECTOR | Subdirector | DIRECCION | GLOBAL | Igual que Director (subroga). |
| JEFE_DEPTO | Jefe de Departamento | JEFATURA | DESCENDENCIA | Todo lo del Jefe de Sección + aprobar cotizaciones, ver facturación. Oficializa/firma en todo su departamento. |
| JEFE_SECCION | Jefe de Sección | JEFATURA | DESCENDENCIA | Todo lo del Jefe de Laboratorio + ver clientes, `saec.certificado.emitir`. Ve y firma en sección + labs. |
| JEFE_LAB | Jefe de Laboratorio / Sucursal | JEFATURA | UNIDAD | Base de laboratorio + revisar/aprobar resultados, emitir/firmar certificados, métodos (crear/aprobar), equipos, NC, catálogo, cerrar OT, metrología (crear/emitir), IBIS (ver/asignar analistas). Titular o subrogante vía `unidad_jefe`. |
| REVISOR | Analista revisor | OPERATIVO | UNIDAD | Base de laboratorio + `resultado.revisar`, transferir muestras. (Alias legado: `ANALISTA_SR`.) |
| ANALISTA | Analista | OPERATIVO | UNIDAD | **Base de laboratorio**: ver OT/muestras/resultados/métodos/equipos/plantillas/flujos, capturar resultados, crear muestras, registrar firma. |
| TECNICO | Técnico de laboratorio | OPERATIVO | UNIDAD | Base de laboratorio + transferir muestras. |
| INSPECTOR | Inspector (LCA · BPCH) | OPERATIVO | UNIDAD | Base de laboratorio + transferir muestras. |
| METROLOGO | Metrólogo | OPERATIVO | UNIDAD | Base de laboratorio + `metrologia.ver/crear`, `equipo.gestionar`. |
| RECEPCION | Recepción de muestras | OPERATIVO | GLOBAL | Clientes (ver), muestras (ver/crear/transferir), OT (ver), evidencias SAEC (ver/crear/custodiar). |
| COMERCIAL | Ejecutivo de Ventas | OPERATIVO | GLOBAL | Clientes (ver/crear/editar), cotizaciones (ver/crear) y **registrar aceptación / anular** (`cotizacion.aceptar`, `cotizacion.anular`), OT (ver/crear), muestras y facturas (ver). |
| PLANIFICACION | Planificación y Control | OPERATIVO | GLOBAL | Control de OT (ver/crear), costeo (`cotizacion.crear`), resultados (SPC), facturas, auditoría (lectura). |
| MUESTREO | Muestreo | OPERATIVO | GLOBAL | OT (ver), muestras (ver/crear/transferir), clientes y cotizaciones (ver). |
| FINANZAS | Finanzas | SOPORTE | GLOBAL | Facturas: ver/emitir/cobrar (incluye pagos y notas de crédito), clientes/cotizaciones/OT (ver). |
| COBRANZA | Cobranza | SOPORTE | GLOBAL | Igual que Finanzas. |
| ABASTECIMIENTO | Abastecimiento (SAB) | SOPORTE | GLOBAL | Proveedores y órdenes de compra (`compra.ver`/`compra.gestionar`), equipos (ver), kardex de consumibles (`consumible.gestionar`). **No** emite ni ve facturas, ni toca centros de costo, catálogo o parámetros del sistema (align_correcciones_manuales.sql). |
| CALIDAD | Gestión de Calidad | SOPORTE | GLOBAL | NC, auditoría, métodos (aprobar), plantillas (gestionar), catálogo, QC/resultados (ver), `certificado.firmar` (firma de LME). |
| LECTOR | Lector / Auditor | SOPORTE | GLOBAL | Todos los `*.ver`. |
| CLIENTE | Cliente externo | SOPORTE | UNIDAD | Cotizaciones y OT (ver). El filtro por cliente es aparte (pendiente). |

**Alias legados** (BD antiguas): `JEFELAB ≈ JEFE_LAB`, `JEFEDCO ≈ JEFE_DEPTO`, `ANALISTA_SR ≈ REVISOR`. Heredan nivel/alcance y los permisos por defecto del canónico; el código conserva su fila (no se borra nada).

**Permisos nuevos**: `admin.estructura`, `admin.roles`, `admin.firmas` (además de `admin.usuarios`). Se conceden a ADMIN (SUPERADMIN pasa siempre).

**Permisos de `align_comercial_usuarios.sql`** (docs/FLUJO_COMERCIAL_USUARIOS.md):
`cotizacion.aceptar` y `cotizacion.anular` (COMERCIAL + todo rol que ya tenía
`cotizacion.aprobar`); `nc.ver` y `nc.crear` (roles con `nc.gestionar` + REVISOR,
ANALISTA, ANALISTA_SR, TECNICO, METROLOGO, INSPECTOR; LECTOR solo `nc.ver`).

**Flujo de laboratorio** (`align_flujo_laboratorio.sql`, ver `docs/FLUJO_LABORATORIO.md`):
`ot.asignar` (asignar la OT, muestras o ensayos a analistas: ADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB) y
`ot.cambiar_laboratorio` (fijar o cambiar el laboratorio responsable: los anteriores + PLANIFICACION). PLANIFICACION recibe
además `muestra.crear` para registrar la OT con sus elementos.

**BPCH · Producción Nacional, Prototipos y Clasificación** (`align_bpch_pn_prototipos_clasificacion.sql`,
ver `docs/FLUJO_BPCH_PRODUCCION_PROTOTIPOS_CLASIFICACION.md` §4): `bpch.pn.ver/gestionar/programar`,
`bpch.prototipo.ver/gestionar/dictaminar`, `bpch.clasificacion.ver/registrar/aprobar`.

La matriz por defecto **solo concede** (`ON CONFLICT DO NOTHING`); no revoca nada que ya existiera. Los cambios de permisos de un rol se reflejan en el JWT al volver a iniciar sesión o al refrescar el token (`POST /auth/refresh`).

---

## 3. Cómo funciona el alcance

`AlcanceService` (`rbac/alcance.service.ts`, módulo `@Global`) calcula **en vivo** las unidades visibles de un usuario a partir de sus asignaciones **vigentes** (`vigente_desde ≤ ahora < vigente_hasta`):

| Asignación | Unidades visibles |
|---|---|
| Rol con alcance **GLOBAL** (o SUPERADMIN / ADMIN / DIRECTOR / SUBDIRECTOR, siempre) | **Todas** (`esGlobal = true`) |
| Rol con alcance **DESCENDENCIA** en la unidad X | X + toda su descendencia (p. ej. Jefe DQO → DQO, SQU, LME, LQC, LPN, SAL, LQA, LMB, LES, SVE, LCC, LTX) |
| Rol con alcance **UNIDAD** en la unidad X | Solo X |
| Jefatura en `unidad_jefe` (titular/subrogante) de X | X + su descendencia |
| Asignación legada de un rol acotado **sin unidad** | Global (compatibilidad con el comportamiento anterior: `unidad_id NULL` = global) |

El resultado es la **unión** de todas las asignaciones. Sin asignaciones vigentes → no ve ninguna unidad.

**Perfil** (`/me/alcance.perfil`, claim `perfil` del JWT): el de mayor prioridad entre los roles vigentes y las jefaturas, en este orden:
`DIRECTOR > JEFE_DEPTO > JEFE_SECCION > JEFE_LAB > REVISOR > ANALISTA > COMERCIAL > PLANIFICACION > FINANZAS > ABASTECIMIENTO > CALIDAD > ADMIN > LECTOR`.
Mapeo: SUPERADMIN/ADMIN→ADMIN · SUBDIRECTOR→DIRECTOR · TECNICO/METROLOGO/INSPECTOR/RECEPCION→ANALISTA · MUESTREO→COMERCIAL · COBRANZA→FINANZAS · CLIENTE→LECTOR · roles personalizados según `nivel` (DIRECCION→DIRECTOR, JEFATURA→JEFE_LAB, OPERATIVO→ANALISTA, SOPORTE→LECTOR, SISTEMA→ADMIN). Ser jefe de un DEPARTAMENTO/SECCION/LABORATORIO implica JEFE_DEPTO/JEFE_SECCION/JEFE_LAB.

**Dónde se aplica**

| Ruta | Efecto |
|---|---|
| `GET /ot` | Solo OT con `unidad_principal` en las unidades visibles (global = sin filtro). Un usuario acotado sin unidades no ve ninguna (antes veía todas). |
| `GET /ot/:id`, `GET /ot/:id/flujo`, `PATCH /ot/:id`, `POST /ot/:id/flujo` | **403** si la OT está fuera de alcance (una OT sin `unidad_principal` solo la ven los globales). |
| `GET /muestras`, `GET /muestras/:id` | Muestras de OT dentro del alcance; 403 en el detalle si está fuera. |

Uso desde otros módulos:

```ts
constructor(private readonly alcance: AlcanceService) {}
const filtro = await this.alcance.filtroUnidades(req);      // null = global
where: filtro ? { unidadPrincipal: { in: filtro } } : {}
await this.alcance.exigirUnidad(req, ot.unidadPrincipal);   // 403 si fuera de alcance
```

**JWT** (login y refresh): `roles` (asignaciones vigentes), `permisos`, `unidades` = ids de unidades **visibles** (ya expandidas con descendencia; vacío si global), `unidadGlobal` = `esGlobal`, `perfil`. El backend no confía en `unidades` del token para filtrar: recalcula en vivo.

---

## 4. Matriz de firmas

Una regla = un paso: `(tipoDocumento, unidadId|null, orden, accion, rol, nivelUnidad, unidadDestinoId?, obligatorio, activo)`.

- `tipoDocumento` ∈ INFORME_ENSAYO, IVC, INFORME_TECNICO, CERTIFICADO_CALIBRACION, INFORME_INSPECCION, CERTIFICADO_CONFORMIDAD, INFORME_INCUMPLIMIENTO, COTIZACION, OT_DISPOSICION, SOLICITUD_ADQUISICION, OFICIO.
- `accion` ∈ **ELABORA**, REVISA, APRUEBA, FIRMA, OFICIALIZA, VB.
- `nivelUnidad` (dónde se busca al firmante, relativo a la unidad que emite): MISMA · SECCION / DEPARTAMENTO (ancestro de ese tipo) · DIRECCION (DIR) · CALIDAD (DGC) · COMERCIAL (DCO) · **FIJA** (= `unidadDestinoId`).

**Resolución** (`GET /firmas-matriz/resolver`): se sube desde la unidad por `padre_id`; el primer nivel que tenga reglas propias para ese tipo gana (override); si ninguno, se usan las reglas por defecto (`unidad_id NULL`). Para cada paso se resuelve la unidad concreta y los responsables: `unidad_jefe` (titular, luego subrogante) si el rol es de jefatura/dirección, más quienes tengan ese rol (o un alias) asignado y vigente en esa unidad (o sin unidad, si el rol es GLOBAL).

### 4.1 Reglas por defecto sembradas

| Documento | Ámbito | Pasos |
|---|---|---|
| INFORME_ENSAYO | defecto | 1 REVISA REVISOR (MISMA) → 2 FIRMA JEFE_LAB (MISMA, «aprueba y firma») → 3 OFICIALIZA JEFE_DEPTO (DEPARTAMENTO) |
| INFORME_ENSAYO | **LME** | 1 FIRMA JEFE_LAB (MISMA) → 2 OFICIALIZA JEFE_DEPTO (DEPARTAMENTO) → 3 FIRMA CALIDAD (CALIDAD = DGC) |
| IVC | defecto | igual que INFORME_ENSAYO |
| INFORME_TECNICO | defecto | 1 FIRMA JEFE_LAB (MISMA) → 2 OFICIALIZA JEFE_DEPTO (DEPARTAMENTO) |
| CERTIFICADO_CALIBRACION | **SAM** (aplica a LMT, LMTE, LNF, LCAD) | 1 ELABORA METROLOGO (MISMA) → 2 FIRMA JEFE_LAB (MISMA, «revisa y firma») → 3 FIRMA JEFE_DEPTO (DEPARTAMENTO = DSA) |
| INFORME_INSPECCION | defecto | 1 FIRMA JEFE_LAB (MISMA = Jefe de Sucursal) |
| CERTIFICADO_CONFORMIDAD | defecto | 1 FIRMA JEFE_SECCION (FIJA = SCC) |
| INFORME_INCUMPLIMIENTO | defecto | 1 FIRMA JEFE_SECCION (FIJA = SCC) → 2 VB DIRECTOR (DIRECCION, **opcional**) |
| COTIZACION | defecto | 1 ELABORA COMERCIAL (COMERCIAL = DCO) → 2 FIRMA JEFE_DEPTO (COMERCIAL = DCO) |
| OT_DISPOSICION | defecto | 1 VB JEFE_DEPTO (DEPARTAMENTO, opcional) · 2 VB DIRECTOR (DIRECCION, opcional) — basta uno de los dos |
| SOLICITUD_ADQUISICION | defecto | 1 VB JEFE_LAB (MISMA) → 2 APRUEBA ABASTECIMIENTO (FIJA = SAB) |
| OFICIO | defecto | 1 VB JEFE_DEPTO (DEPARTAMENTO) → 2 FIRMA DIRECTOR (DIRECCION) |

---

## 5. Endpoints

Convenciones: listados con sobre `{ data, meta }` (como el resto de la API); errores Nest estándar `{ statusCode, message, error }`. Validación con Zod → 400. Fechas ISO-8601.

### 5.1 Unidades — lectura: cualquier autenticado · escritura: `admin.estructura`

**`GET /unidades`** →
```json
{ "data": [ {
    "id": "uuid", "codigo": "LQC", "nombre": "Laboratorio Químico Central", "descripcion": null,
    "tipo": "LABORATORIO", "padreId": "uuid|null", "sigla": "LQC", "icono": "⚗", "color": "#15803d",
    "codsucdel": "7003", "centroCosto": null, "orden": 23, "sedeId": "uuid", "activo": true } ],
  "meta": { "total": 42 } }
```

**`GET /unidades/arbol`** → array de raíces (normalmente `[DIR]`):
```json
[ { "id": "uuid", "codigo": "DIR", "nombre": "Dirección IDIC", "tipo": "DIRECCION", "padreId": null,
    "sigla": "DIR", "icono": "★", "color": "#6d28d9", "codsucdel": null, "centroCosto": null, "orden": 0,
    "descripcion": null, "sedeId": "uuid", "activo": true,
    "jefes": [ { "usuarioId": "uuid", "nombre": "…", "rol": "titular" }, { "usuarioId": "uuid", "nombre": "…", "rol": "subrogante" } ],
    "hijos": [ { "...mismo shape...": "" } ] } ]
```
Incluye unidades inactivas (`activo:false`); la UI decide si las oculta.

**`POST /unidades`** body:
```json
{ "codigo": "LXX", "nombre": "…", "tipo": "LABORATORIO", "padreId": "uuid|null",
  "sigla": "…", "icono": "⚗", "color": "#…", "codsucdel": "…", "centroCosto": "…", "orden": 10,
  "descripcion": "…", "sedeId": "uuid (opcional: hereda la del padre)", "activo": true }
```
→ 201 unidad (shape de `GET /unidades`). 409 si el código existe.

**`PATCH /unidades/:id`** body: cualquier subconjunto del anterior → 200 unidad. 400 si `padreId` crea un ciclo; 409 si `activo:false` y tiene hijas activas.

**`DELETE /unidades/:id`** → 200 unidad con `activo:false` (baja lógica). **409** si tiene unidades hijas activas.

**`PUT /unidades/:id/jefes`** body `{ "titularId"?: "uuid|null", "subroganteId"?: "uuid|null" }` (ausente = no tocar, `null` = quitar) →
```json
{ "unidadId": "uuid", "jefes": [ { "usuarioId": "uuid", "nombre": "…", "rol": "titular" } ] }
```
Mantiene `unidad.jefe_usuario_id` (legado) = titular.

### 5.2 Usuarios — `admin.usuarios`

**`GET /usuarios?q=&unidadId=&rolId=&activo=true|false`** (`q` busca en username, nombre, email, cargo; `unidadId`/`rolId` filtran por asignación):
```json
{ "data": [ {
    "id": "uuid", "username": "…", "email": "…|null", "nombreCompleto": "…", "nombre": "…",
    "grado": "…|null", "cargo": "…|null", "estado": "activo", "activo": true, "totpActivo": false,
    "ultimoLoginAt": "…|null", "createdAt": "…", "tenantId": "uuid",
    "asignaciones": [ {
      "id": "uuid",
      "rol": { "id": "uuid", "codigo": "ANALISTA", "nombre": "Analista", "nivel": "OPERATIVO" },
      "unidad": { "id": "uuid", "codigo": "LQC", "nombre": "…", "tipo": "LABORATORIO" },
      "vigenteDesde": "…", "vigenteHasta": "…|null" } ],
    "usuarioRoles": [ "…compatibilidad con la pantalla actual: {id, rolId, unidadId, vigenteDesde, vigenteHasta, rol{id,codigo,nombre}}" ] } ],
  "meta": { "page": 1, "limit": 500, "total": 6, "totalPages": 1 } }
```
Nunca devuelve `passwordHash` ni `totpSecret`.

**`GET /usuarios/:id`** → mismo shape de un usuario + `"jefaturas": [ { "rol": "titular", "unidad": { "id", "codigo", "nombre", "tipo" } } ]`.

**`POST /usuarios`** (legado) `{ username, nombreCompleto, email?, password, grado?, cargo?, rolId?, unidadId? }` → 201 usuario.

**`PATCH /usuarios/:id`** `{ nombreCompleto?, nombre?, email?, grado?, cargo?, estado?: "activo"|"inactivo"|"bloqueado", activo?: boolean }` → 200 usuario. **No toca las asignaciones**, salvo que venga el campo legado `rolId` (+ `unidadId`), que reemplaza todas por esa única asignación.

**`DELETE /usuarios/:id`** → soft-delete (`deletedAt`, estado inactivo).

**`POST /usuarios/:id/asignaciones`** `{ "rolId": "uuid", "unidadId": "uuid|null", "vigenteDesde"?: "ISO", "vigenteHasta"?: "ISO|null" }` →
```json
{ "id": "uuid", "rol": { "id", "codigo", "nombre", "nivel" }, "unidad": { "id", "codigo", "nombre", "tipo" } | null,
  "vigenteDesde": "…", "vigenteHasta": "…|null" }
```
Validación: roles **UNIDAD/DESCENDENCIA exigen `unidadId`**; roles **GLOBAL exigen `null`** (400). Unidad inactiva → 400. Duplicado (usuario, rol, unidad) → 409.

**`DELETE /usuarios/:id/asignaciones/:asignacionId`** → `{ "ok": true, "id": "uuid" }`.

**`POST /usuarios/:id/reset-password`** → `{ "passwordTemporal": "12 caracteres" }` (se muestra una sola vez; hash argon2; incrementa `token_version` → invalida refresh tokens). Si el módulo nativo argon2 no carga: **500** con mensaje explícito «No se pudo generar el hash argon2…».

### 5.3 Roles y permisos — `admin.roles`

**`GET /roles`** →
```json
{ "data": [ { "id": "uuid", "tenantId": "uuid", "codigo": "JEFE_LAB", "nombre": "Jefe de Laboratorio / Sucursal",
    "descripcion": "…", "esSistema": true, "nivel": "JEFATURA", "alcance": "UNIDAD", "orden": 22, "aliasDe": null,
    "createdAt": "…", "nPermisos": 46, "nUsuarios": 2 } ],
  "meta": { "page": 1, "limit": 23, "total": 23, "totalPages": 1 } }
```

**`POST /roles`** `{ codigo (MAYÚSCULAS/_), nombre, descripcion?, nivel?, alcance?, orden? }` → 201 rol (mismo shape). **`PATCH /roles/:id`** (mismos campos; el código de un rol de sistema no se cambia) → 200. **`DELETE /roles/:id`** → `{ ok, id }`; 403 si es de sistema.

**`GET /roles/:id/permisos`** → `["muestra.ver", "ot.ver", "resultado.crear", …]`

**`PUT /roles/:id/permisos`** `{ "codigos": ["ot.ver", …] }` → reemplaza el conjunto y devuelve el nuevo `string[]`. 403 para SUPERADMIN; 400 si algún código no existe.

**`GET /permisos/matriz`** →
```json
{ "modulos": [ { "modulo": "resultado", "permisos": [ { "id": "uuid", "codigo": "resultado.aprobar", "accion": "aprobar", "descripcion": "…" } ] } ],
  "roles": [ { "id": "uuid", "codigo": "ANALISTA", "nombre": "Analista", "nivel": "OPERATIVO" } ],
  "asignaciones": { "<rolId>": ["muestra.ver", "ot.ver"] } }
```

### 5.4 Matriz de firmas — `admin.firmas` (resolver: cualquier autenticado)

**`GET /firmas-matriz?tipoDocumento=&unidadId=`** (`unidadId=null` → solo reglas por defecto) →
```json
{ "data": [ { "id": "uuid", "tenantId": "uuid", "tipoDocumento": "INFORME_ENSAYO", "unidadId": "uuid|null", "orden": 1,
    "accion": "REVISA", "rolId": "uuid", "nivelUnidad": "MISMA", "unidadDestinoId": "uuid|null",
    "obligatorio": true, "activo": true, "descripcion": "…", "createdAt": "…", "updatedAt": "…",
    "rol": { "id", "codigo", "nombre", "nivel", "alcance" },
    "unidad": { "id", "codigo", "nombre", "tipo" } | null,
    "unidadDestino": { "id", "codigo", "nombre", "tipo" } | null } ],
  "meta": { "total": 6 } }
```

**`POST /firmas-matriz`** `{ tipoDocumento, unidadId?: uuid|null, orden, accion, rolId, nivelUnidad (def. MISMA), unidadDestinoId? (obligatorio si FIJA), obligatorio? (true), activo? (true), descripcion? }` → 201 regla. **`PATCH /firmas-matriz/:id`** (subconjunto) → 200. **`DELETE /firmas-matriz/:id`** → `{ ok, id }`.

**`GET /firmas-matriz/resolver?tipoDocumento=X&unidadId=Y`** →
```json
{ "tipoDocumento": "INFORME_ENSAYO",
  "unidad": { "id", "codigo": "LQA", "nombre", "tipo" },
  "origen": "DEFECTO",                    // UNIDAD | DEFECTO | SIN_REGLAS
  "unidadRegla": null,                    // unidad cuyo override se aplicó (si origen = UNIDAD)
  "pasos": [ {
    "id": "uuid", "orden": 2, "accion": "FIRMA", "obligatorio": true, "descripcion": "Aprueba y firma el informe",
    "nivelUnidad": "MISMA",
    "rol": { "id": "uuid", "codigo": "JEFE_LAB", "nombre": "…" },
    "unidad": { "id", "codigo": "LQA", "nombre", "tipo" },
    "responsables": [ { "usuarioId": "uuid", "nombre": "…", "via": "titular" } ],   // titular | subrogante | asignacion
    "advertencia": null                   // p. ej. "Nadie tiene el rol JEFE_LAB en LQA"
  } ] }
```

### 5.5 Contexto del usuario — cualquier autenticado

**`GET /me/alcance`** →
```json
{ "usuario": { "id": "uuid", "nombre": "…", "username": "…" },
  "roles": [ { "codigo": "ANALISTA", "nombre": "Analista", "nivel": "OPERATIVO",
               "unidad": { "id", "codigo": "LQA", "nombre", "tipo" } | null } ],
  "perfil": "ANALISTA",
  "esGlobal": false,
  "unidadesVisibles": [ { "id": "uuid", "codigo": "LQA", "nombre": "…", "tipo": "LABORATORIO" } ],
  "jefaturas": [ { "rol": "titular", "unidad": { "id", "codigo", "nombre", "tipo" } } ],
  "permisos": ["ot.ver", "…"] }
```
Si `esGlobal`, `unidadesVisibles` trae todas las unidades activas.

**`GET /me/bandeja`** → `[{ "clave", "titulo", "descripcion", "cantidad", "ruta", "severidad": "info"|"warn"|"alta" }]`. Ítems por perfil (cantidades acotadas a las unidades visibles; `severidad` = `info` cuando `cantidad = 0`):

| Perfil | Claves |
|---|---|
| ANALISTA | `ot_asignadas` (ot_analista o ensayo asignado · abre `/ot?mias=1`), `ot_en_curso`, `resultados_devueltos` (abre `/captura-ot?estado=devuelto,rechazado&mios=1`), `firmas_pendientes` (ot_firma) |
| REVISOR | `resultados_por_revisar` (abre `/captura-ot?estado=capturado`), `ot_asignadas`, `resultados_devueltos`, `ot_por_vencer`, `firmas_pendientes` |
| JEFE_LAB | `ot_sin_asignar` (abre `/ot?sinAsignar=1`), `resultados_por_revisar`, `resultados_por_aprobar` (abre `/captura-ot?estado=revisado_n1`), `firmas_pendientes`, `ot_vencidas`, `ot_por_vencer`, `informes_por_oficializar` |
| JEFE_SECCION / JEFE_DEPTO | `firmas_pendientes`, `informes_por_oficializar`, `resultados_por_aprobar`, `ot_vencidas`, `ot_vencidas_<LAB>` (una por laboratorio con atraso), `ot_abiertas` |
| DIRECTOR | `firmas_pendientes`, `informes_por_oficializar`, `ot_vencidas`, `ot_vencidas_<LAB>`, `ot_abiertas`, `nc_abiertas`, `cotizaciones_aceptadas_sin_ot` |
| COMERCIAL | `cotizaciones_por_vencer` (7 días), `cotizaciones_aceptadas_sin_ot`, `ot_por_vencer`, `documentos_por_entregar` |
| PLANIFICACION | `ot_vencidas`, `ot_vencidas_<LAB>`, `ot_por_vencer`, `ot_listas_cerrar`, `documentos_por_entregar`, `ot_abiertas`, `cotizaciones_aceptadas_sin_ot` |
| FINANZAS | `facturas_pendientes` («Pendientes de facturar»), `facturas_por_cobrar` (emitidas y con pago parcial), `ot_cerradas_sin_factura` (con cobro, cerradas antes del cierre automático) |
| ABASTECIMIENTO | `oc_pendientes` |
| CALIDAD | `firmas_pendientes`, `nc_abiertas`, `informes_por_oficializar`, `ot_vencidas` |
| ADMIN | `usuarios_sin_rol`, `usuarios_bloqueados` (por el administrador **o por intentos fallidos**: `intentos_fallidos >= AUTH_MAX_INTENTOS`), `unidades_sin_jefe` |
| LECTOR | `ot_abiertas` |

Cada conteo es defensivo: si la tabla/columna no existe en la BD, ese ítem vale 0.

Solo se devuelven las tarjetas cuya pantalla el usuario puede abrir (mismo permiso
que el menú: `/captura-ot` → `resultado.ver`, `/informes/por-firmar` →
`documento.firmar`, `/facturas` → `factura.ver`, `/admin/…` → `admin.usuarios`…;
`filtrarPorPermiso` en `rbac/bandeja.service.ts`). Así Recepción, que comparte el
perfil «analista», no ve «Resultados devueltos». Cada tarjeta que abre una lista
(`/ot?…`, `/cotizaciones?…`, `/facturas?…`, `/certificados?…`, `/captura-ot?…`,
`/informes/por-firmar`) cuenta exactamente lo que esa lista muestra: lo comprueba
`scripts/verificacion/flujo-completo.js`. «OT abiertas» abre `/ot?estado=abiertas`;
«OT cerradas sin factura», `/ot?estado=cerrada&sinFactura=1`; las de administración,
`/admin/usuarios?sinRol=1`, `/admin/usuarios?estado=bloqueado` y `/admin/estructura`.

`informes_por_oficializar` cuenta los informes/certificados **en firma** del ámbito del usuario (aún no oficiales, le toque o no firmar) y abre `/certificados?estado=en_firma`; antes contaba registros del módulo antiguo de boletines (docs/FLUJO_CORRECCIONES_MANUALES.md).

`firmas_pendientes` cuenta los informes/certificados cuyo **paso actual** de la matriz de firmas tiene al usuario como responsable (tabla `documento_firma`) y enlaza a `/informes/por-firmar`. `ot_vencidas` / `ot_por_vencer` usan el mismo semáforo que la lista de OT (OT no cerradas ni anuladas; vencida = fecha de compromiso anterior a hoy en Chile; por vencer = hoy a +3 días) y enlazan a `/ot?semaforo=vencida|por_vencer`. Detalle en `docs/FLUJO_FIRMA_CIERRE.md`.

---

## 6. Notas de compatibilidad

- `GET /roles` ahora exige `admin.roles` (antes `admin.usuarios`); `GET /unidades` pasa a ser abierto a cualquier autenticado. ADMIN recibe ambos permisos con el seed.
- `POST /usuarios` y `PATCH /usuarios/:id` con `rolId` (rutas legadas) no aplican la regla de alcance estricta (solo validan que rol y unidad existan) para no romper la pantalla actual; la regla estricta está en `POST /usuarios/:id/asignaciones`.
- Una asignación sin unidad de un rol acotado (dato previo) se sigue tratando como global; `GET /usuarios` permite detectarlas (`asignaciones[].unidad = null` con rol de alcance UNIDAD/DESCENDENCIA).
- Los controladores RBAC usan el `PrismaService` compartido (antes cada uno creaba su `PrismaClient`).
