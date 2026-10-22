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
| ADMIN | Administrador del sistema | SISTEMA | GLOBAL | `admin.usuarios/estructura/roles/firmas`, toda la lectura (`*.ver`) **salvo SAEC**, catálogo, plantillas, flujos, `metrologia.config`, auditoría. Sin SAEC (fase 0). |
| DIRECTOR | Director | DIRECCION | GLOBAL | Toda la lectura + firmar/emitir certificados, aprobar/revisar resultados, aprobar cotizaciones y métodos, NC, cerrar OT, VB/firma de oficios. |
| SUBDIRECTOR | Subdirector | DIRECCION | GLOBAL | Igual que Director (subroga). |
| JEFE_DEPTO | Jefe de Departamento | JEFATURA | DESCENDENCIA | Todo lo del Jefe de Sección + aprobar cotizaciones, ver facturación. Oficializa/firma en todo su departamento. |
| JEFE_SECCION | Jefe de Sección | JEFATURA | DESCENDENCIA | Todo lo del Jefe de Laboratorio + ver clientes, `saec.certificado.emitir`. Ve y firma en sección + labs. |
| JEFE_LAB | Jefe de Laboratorio / Sucursal | JEFATURA | UNIDAD | Base de laboratorio + revisar/aprobar resultados, emitir/firmar certificados, métodos (crear/aprobar), equipos, NC, catálogo, cerrar OT, metrología (crear/emitir), IBIS (ver/asignar analistas). Titular o subrogante vía `unidad_jefe`. |
| REVISOR | Analista revisor | OPERATIVO | UNIDAD | Base de laboratorio + `resultado.revisar`, transferir muestras. Sin SAEC ni Metrología (fase 0). (Alias legado: `ANALISTA_SR`.) |
| ANALISTA | Analista | OPERATIVO | UNIDAD | **Base de laboratorio**: ver OT/muestras/resultados/métodos/equipos/plantillas/flujos, capturar resultados, crear muestras, registrar firma. Sin SAEC ni Metrología (fase 0). |
| TECNICO | Técnico de laboratorio | OPERATIVO | UNIDAD | Base de laboratorio + transferir muestras. |
| INSPECTOR | Inspector (LCA · BPCH) | OPERATIVO | UNIDAD | Base de laboratorio + transferir muestras y los procesos BPCH. Sin SAEC (fase 0: el de la Delegación Nº 11 lleva además PERITO_SAEC). |
| PERITO_SAEC | Perito SAEC (Delegación Nº 11) | OPERATIVO | UNIDAD | Complementario: `evidencia.ver/custodiar`, `arma.ver`, `caso.ver`, `ibis.ver`, `peritaje.registrar`. Solo en la Delegación Nº 11. |
| OPERADOR_METROLOGIA | Operador de Metrología | OPERATIVO | UNIDAD | Complementario: `metrologia.ver/crear`, para el personal operativo de la Sección Metrología que no es metrólogo. |
| METROLOGO | Metrólogo | OPERATIVO | UNIDAD | Base de laboratorio + `metrologia.ver/crear`, `equipo.gestionar`. |
| RECEPCION | Recepción de muestras | OPERATIVO | GLOBAL | Clientes (ver), muestras (ver/crear/transferir), OT (ver). Sin SAEC (fase 0: la recepción de evidencias es de la Delegación Nº 11). |
| COMERCIAL | Ejecutivo de Ventas | OPERATIVO | GLOBAL | Clientes (ver/crear/editar), cotizaciones (ver/crear) y **registrar aceptación / anular** (`cotizacion.aceptar`, `cotizacion.anular`), OT (ver/crear), muestras y facturas (ver). |
| PLANIFICACION | Planificación y Control | OPERATIVO | GLOBAL | Control de OT (ver/crear), costeo (`cotizacion.crear`), resultados (SPC), facturas, auditoría (lectura). |
| MUESTREO | Muestreo | OPERATIVO | GLOBAL | OT (ver), muestras (ver/crear/transferir), clientes y cotizaciones (ver). |
| FINANZAS | Finanzas | SOPORTE | GLOBAL | Facturas: ver/emitir/cobrar (incluye pagos y notas de crédito), clientes/cotizaciones/OT (ver). |
| COBRANZA | Cobranza | SOPORTE | GLOBAL | Igual que Finanzas. |
| ABASTECIMIENTO | Abastecimiento (SAB) | SOPORTE | GLOBAL | Proveedores y órdenes de compra (`compra.ver`/`compra.gestionar`), equipos (ver), kardex de consumibles (`consumible.gestionar`). **No** emite ni ve facturas, ni toca centros de costo, catálogo o parámetros del sistema (align_correcciones_manuales.sql), ni ve OT ni informes (`ot.ver` retirado en la fase 0). |
| CALIDAD | Gestión de Calidad | SOPORTE | GLOBAL | NC, auditoría, métodos (aprobar), plantillas (gestionar), catálogo, QC/resultados (ver), `certificado.firmar` (firma de LME). Sin SAEC (fase 0). |
| LECTOR | Lector / Auditor | SOPORTE | GLOBAL | Todos los `*.ver` (en SAEC entra por excepción, solo a consultar). |
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

**BPCH · Internación, Reinspección y Codificación Única** (`align_bpch_internacion_reinspeccion.sql`,
ver `docs/FLUJO_BPCH_INTERNACION_REINSPECCION_CODIFICACION.md`): `bpch.internacion.ver/registrar/gestionar`,
`bpch.tasa.gestionar`, `bpch.reinspeccion.ver/gestionar`, `bpch.codificacion.ver/gestionar`.

**BPCH · Producción Nacional, Prototipos y Clasificación** (`align_bpch_pn_prototipos_clasificacion.sql`,
ver `docs/FLUJO_BPCH_PRODUCCION_PROTOTIPOS_CLASIFICACION.md` §4): `bpch.pn.ver/gestionar/programar`,
`bpch.prototipo.ver/gestionar/dictaminar`, `bpch.clasificacion.ver/registrar/aprobar`.

**Especificaciones técnicas y muestreo** (`align_r2b_especificacion_tecnica.sql`, `align_r2b_muestreo.sql`,
ver `docs/FLUJO_ESPECIFICACIONES_MUESTREO.md` §5): `et.ver` (laboratorio, jefaturas, Calidad, Comercial,
Planificación, Muestreo, Recepción, Dirección, Lector), `et.gestionar` (jefaturas, Calidad, Administración; alcance
por los laboratorios de la E.T.) y `muestreo.registrar` (Muestreo, personal de laboratorio, inspectores, jefaturas).

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

## 3 bis. Alcance por asignación (fase 0 · 20-10-2026)

**Cada permiso vale con el alcance del rol que lo concede**, no con la unión de
todas las asignaciones del usuario. Antes bastaba un rol transversal (Comercial,
Planificación, Recepción…) para que TODOS los permisos de la persona valieran en
todos los laboratorios: con ANALISTA@LPN + COMERCIAL, el analista capturaba y veía
resultados de cualquier laboratorio y entraba en SAEC y Metrología.

**Regla**

- Alcance de un permiso P = **unión** de los alcances de las asignaciones
  **vigentes** cuyo rol concede P (GLOBAL → todo; DESCENDENCIA → la unidad y lo
  que cuelga; UNIDAD → la unidad; asignación legada de un rol acotado sin unidad →
  global, como antes).
- Ruta que exige varios permisos: la **intersección** de sus alcances.
- **Jefaturas** (`unidad_jefe`, titular o subrogante): amplían los permisos que
  concede un rol acotado de nivel JEFATURA o DIRECCION. Si la persona no tiene
  ningún rol de ese nivel, amplían los de todos sus roles acotados (así se
  comportaba con un solo rol).
- Ruta sin permiso (solo autenticada, p. ej. `/me/bandeja`): unión de todas las
  asignaciones, como antes.
- **Usuarios de un solo rol: nada cambia.**

Ejemplo: ANALISTA@LPN + COMERCIAL@SVT → `resultado.crear` y `resultado.ver` solo en
LPN; `cotizacion.ver`, `cotizacion.anular` y `ot.ver` en todo el IDIC (los concede
Comercial, que es global). JEFE_LAB@LAM + ANALISTA@LEM → `resultado.aprobar` solo
en LAM; `resultado.crear` en LAM y LEM.

**Cómo se aplica**

| Pieza | Qué hace |
|---|---|
| `rbac/alcance.ts` | Reglas puras: `alcanceDePermiso`, `alcanceDePermisos`, `intersecarAlcances`, `resolverAmbito`, `entraEnAmbito` (pruebas: `alcance-asignacion.spec.ts`). |
| `PermisoGuard` | Además de comprobar el permiso, deja en el request los permisos que exige la ruta (`req.__permisosRuta`). |
| `AlcanceService` | `filtroUnidades(req)`, `exigirUnidad(req, unidad)` y `paraRequest(req)` valen con el alcance de **los permisos de la ruta**. Si una acción exige otro permiso, se pasa explícito: `exigirUnidad(req, unidad, que, "resultado.aprobar")` (lo usa completar un paso de flujo). `contexto.usuario` conserva la unión. |
| `AmbitoUnidadGuard` | El ámbito del módulo se evalúa con los roles que conceden el permiso de la ruta. |
| `GET /me/alcance` | `permisosPorAmbito`: permisos que valen dentro de cada rama. El menú (`itemEnAmbito`, `lib/navegacion.ts`) exige que el permiso del ítem valga dentro de la rama del ítem. |
| JWT | Sin cambios: `permisos` sigue siendo la unión (dice QUÉ puede hacer); el DÓNDE lo calcula la API en vivo. |

**Ámbitos de módulo** (`rbac.constants.ts › AMBITOS`)

| Ámbito | Rama | Regla |
|---|---|---|
| `D11` | Delegación Nº 11 | **Estricto**: el alcance global solo vale a Superadministración, Dirección, Subdirección y Lector/Auditor (este, con permisos de consulta). El resto necesita la Delegación (o lo que cuelga) en el alcance del permiso: su personal y la jefatura del BPCH. Recepción, Calidad y Administración ya no entran. |
| `BPCH` | Banco de Pruebas | Internaciones, reinspecciones, prototipos y clasificación: la Delegación Nº 11 entra, pero los listados la dejan solo en lo que inspecciona ella. |
| `BPCH_CERT` | BPCH sin la Delegación Nº 11 | Codificación Única y Producción Nacional (registros nacionales). |
| `BPCH_ASIGNADO` | Solo menú | `BPCH_CERT` más las unidades con trabajo asignado en un proceso BPCH: la D11 ve «Internaciones», «Reinspecciones», «Prototipos» y «Clasificación» solo si inspecciona alguno. |
| `DCO`, `SAM` | Comercial, Sección Metrología | Sin cambios. |

**Registros acotados en la fase 0** (además de OT, muestras, resultados,
informes, calibraciones y BPCH, que ya lo estaban)

| Recurso | Regla |
|---|---|
| `/certificados` (ruta heredada) | Retirada: **410 Gone** (se usa `/informes/documentos`). El Panel de indicadores cuenta `/informes/documentos`. |
| SPC (`/spc/series`, `/spc/analitos`) | Solo resultados de OT del alcance de `resultado.ver`. |
| `/internaciones/ot` (heredada, la usa `/bpch/internaciones`) | Unidad que inspecciona en el alcance; con la SCC en el alcance, todas. |
| Prototipos y clasificaciones BPCH | Sucursales y D11: los de su unidad. SCC y jefatura BPCH: todos. Listado, detalle y todas las escrituras (`alcance-bpch.ts`). |
| Equipos y calibraciones | Detalle, alta, edición, baja y calibraciones dentro del alcance. Sin unidad = común: se ve, pero solo lo cambia el alcance global. |
| Catálogo (`AlcanceCatalogoGuard`) | Escrituras con `catalogo.gestionar`, `metodo.crear` o `metodo.aprobar`: con alcance global (Calidad, Administración) todo; una jefatura, solo ensayos (y su precio), métodos, analitos, especificaciones, paneles y pasos de SU laboratorio (familia del catálogo → unidad por CODSUCDEL). Las tablas comunes (grupos, familias, elementos, tipos de muestra, parámetros, listas de precio, formatos…) solo con alcance global. El detalle por id de esos recursos también se acota; los listados siguen comunes. |
| Cotizaciones (escrituras) | Editar, anular, enviar, aceptar y rechazar exigen la cotización en el alcance del permiso. Unidades de la cotización: su OT y las que nacieron de ella, su centro de costo, los laboratorios de sus líneas y el Depto. Comercial (`cotizacion/alcance-cotizacion.ts`). Ver cotizaciones: fase 1. |

**Roles complementarios** (`align_alcance_fase0.sql`): `PERITO_SAEC` (consulta,
custodia y peritaje SAEC) para el personal operativo de la Delegación Nº 11, y
`OPERADOR_METROLOGIA` (`metrologia.ver/crear`) para el de la Sección Metrología
que no es metrólogo. Ambos de alcance UNIDAD; el SQL los asigna solo a quien ya
tenía un rol operativo en esas unidades. Al dar de alta a alguien nuevo en la
Delegación o en Metrología hay que asignárselos en Administración › Usuarios.

**Comprobación**: `scripts/verificacion/alcance-por-laboratorio.js` (todos los
perfiles `demo.*`, incluidos los de dos roles `demo.multi.*`).

---

## 4. Matriz de firmas

Una regla = un paso: `(tipoDocumento, unidadId|null, orden, accion, rol, nivelUnidad, unidadDestinoId?, obligatorio, activo)`.

- `tipoDocumento` ∈ INFORME_ENSAYO, IVC, INFORME_TECNICO, CERTIFICADO_CALIBRACION, INFORME_INSPECCION, CERTIFICADO_CONFORMIDAD, INFORME_INCUMPLIMIENTO, COTIZACION, OT_DISPOSICION, SOLICITUD_ADQUISICION, OFICIO.
- `accion` ∈ **ELABORA**, REVISA, APRUEBA, FIRMA, OFICIALIZA, VB.
- `nivelUnidad` (dónde se busca al firmante, relativo a la unidad que emite): MISMA · SECCION / DEPARTAMENTO (ancestro de ese tipo) · DIRECCION (DIR) · CALIDAD (DGC) · COMERCIAL (DCO) · **FIJA** (= `unidadDestinoId`).

**Responsable alternativo** (`rol_alternativo_id`, `nivel_unidad_alternativo`): un paso puede
admitir además otro rol, buscado en su propio nivel (MISMA, SECCION, DEPARTAMENTO, DIRECCION,
CALIDAD, COMERCIAL). Sus personas se suman a los responsables con vía `alternativo`. Se edita en
Administración › Matriz de firmas › ✎ del paso › «Responsable alternativo (opcional)»; «Ninguno» lo
quita sin tocar código y `alternativo_configurado_at` impide que reaplicar los SQL lo reponga.
Sembrado una sola vez: Certificado de Calibración (SAM), paso 3, alternativo Metrólogo (misma
unidad) — decisión provisional, ver docs/FLUJO_METROLOGIA.md.

**Resolución** (`GET /firmas-matriz/resolver`): se sube desde la unidad por `padre_id`; el primer nivel que tenga reglas propias para ese tipo gana (override); si ninguno, se usan las reglas por defecto (`unidad_id NULL`). Para cada paso se resuelve la unidad concreta y los responsables: `unidad_jefe` (titular, luego subrogante) si el rol es de jefatura/dirección, más quienes tengan ese rol (o un alias) asignado y vigente en esa unidad (o sin unidad, si el rol es GLOBAL).

### 4.1 Reglas por defecto sembradas

| Documento | Ámbito | Pasos |
|---|---|---|
| INFORME_ENSAYO | defecto | 1 REVISA REVISOR (MISMA) → 2 FIRMA JEFE_LAB (MISMA, «aprueba y firma») → 3 OFICIALIZA JEFE_DEPTO (DEPARTAMENTO) |
| INFORME_ENSAYO | **LME** | 1 FIRMA JEFE_LAB (MISMA) → 2 OFICIALIZA JEFE_DEPTO (DEPARTAMENTO) → 3 FIRMA CALIDAD (CALIDAD = DGC) |
| IVC | defecto | igual que INFORME_ENSAYO |
| INFORME_TECNICO | defecto | 1 FIRMA JEFE_LAB (MISMA) → 2 OFICIALIZA JEFE_DEPTO (DEPARTAMENTO) |
| CERTIFICADO_CALIBRACION | **SAM** (aplica a LMT, LMTE, LNF, LCAD) | 1 ELABORA METROLOGO (MISMA) → 2 FIRMA JEFE_LAB (MISMA, «revisa y firma») → 3 FIRMA JEFE_DEPTO (DEPARTAMENTO = DSA) **o, como alternativo, METROLOGO habilitado (MISMA)** |
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
  "ambitos": { "D11": false, "BPCH": false, "BPCH_CERT": false, "BPCH_ASIGNADO": false, "DCO": false, "SAM": false },
  "permisosPorAmbito": { "D11": [], "SAM": [], "…": ["…"] },
  "permisos": ["ot.ver", "…"] }
```
Si `esGlobal`, `unidadesVisibles` trae todas las unidades activas. `esGlobal` y
`unidadesVisibles` son la unión de todas las asignaciones (para describir el
alcance); el menú decide los ámbitos con `permisosPorAmbito` (§3 bis).

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

---

## 7. Permisos del frente r1b (20-10-2026)

| Permiso | Para qué | Roles sembrados |
|---|---|---|
| `orden_interna.emitir` | Emitir una orden interna desde una OT de su alcance, editarla mientras está abierta y darla por recibida | SUPERADMIN, ADMIN, ANALISTA, ANALISTA_SR, JEFE_LAB, JEFE_SECCION, INSPECTOR, PLANIFICACION, PLANIFICADOR_LAB |
| `orden_interna.responder` | Recibir, responder y cerrar las órdenes que llegan a su laboratorio (alcance sobre el DESTINO) | SUPERADMIN, ADMIN, JEFE_LAB, JEFE_SECCION |
| `orden_interna.anular` | Anular con motivo o borrar una orden de una OT de su alcance | SUPERADMIN, ADMIN, COMERCIAL, PLANIFICACION, PLANIFICADOR_LAB, JEFE_LAB, JEFE_SECCION |
| `documento.numeracion` | Administración › Numeración de documentos | SUPERADMIN, ADMIN, CALIDAD |
| `bpch.cabecera.gestionar` | Cabecera de inspección de la OT directa y de Producción Nacional (EP-10 10.3) | SUPERADMIN, ADMIN, JEFE_LAB, JEFE_SECCION, INSPECTOR, SUBDIRECTOR, JEFE_DEPTO |

Antes, las órdenes internas exigían `ot.crear` (que el Jefe de Laboratorio y el
analista no tienen). Detalle: `docs/FLUJO_LABORATORIO.md` › «Órdenes internas»,
`docs/FLUJO_NUMERACION_DOCUMENTOS.md`, `docs/FLUJO_DOCUMENTOS_POR_OT.md`.
