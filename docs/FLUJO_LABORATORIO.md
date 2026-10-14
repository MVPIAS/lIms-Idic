# Flujo de laboratorio · de la OT al resultado aprobado · LIMS IDIC

Reglas que aplica el servidor desde `align_flujo_laboratorio.sql`. La pantalla
solo las refleja: si algo no se permite, la API responde con el motivo.

## 1. Laboratorio responsable de la OT

Toda OT nace con su laboratorio (`orden_trabajo.unidad_principal`). Sin él,
ningún analista, revisor ni jefe de laboratorio la ve: el alcance por unidad
filtra por esa columna.

| Cómo nace la OT | Laboratorio |
|---|---|
| Registro de OT (`POST /ot`) | El elegido en «Laboratorio responsable». Si no se elige, se deduce del catálogo; si no se puede, la OT no se crea (400) |
| Aceptación de cotización (`POST /cotizaciones/:id/aceptar`) | `unidadPrincipalId` del diálogo, o el deducido; si no se puede, la cotización no se acepta (400) y sigue abierta |
| Alta automática del SAEC | Siempre la Delegación Nº 11 (`D11`) |
| OT antigua sin laboratorio | Lo toma de los métodos al generar los análisis de una muestra, si son de un solo laboratorio |

**Deducción** (`apps/api/src/ot/laboratorio-ot.ts`), solo si todas las pistas
apuntan a la misma unidad:

1. Centro de costo de la cotización o laboratorio ejecutor (`centro_costo.unidad_id`, nuevo). Si existe, manda.
2. Familia CODSUCDEL de los ensayos de la cotización (`cat_ensayo.familia_id → cat_familia.codsucdel → unidad.codsucdel`; una unidad puede tener varios, «3009/3008»).
3. Familia de los elementos y de los métodos elegidos al registrar la OT.

Pistas de laboratorios distintos → hay que elegir. El selector muestra la
sugerencia (`GET /ot/laboratorio-sugerido`) y permite cambiarla.

**Unidades elegibles** (`GET /ot/laboratorios`): laboratorios, sucursales,
delegaciones y secciones técnicas con CODSUCDEL. No departamentos ni apoyo.

**Cambio** (`PATCH /ot/:id/laboratorio`, permiso `ot.cambiar_laboratorio`:
jefaturas, planificación y administración). Quien lo hace debe ver la OT.
Cambiarlo exige motivo; se retiran las asignaciones del personal del
laboratorio anterior. Todo queda en `ot_historial` (quién, cuándo, desde,
hacia, motivo) y se ve en la pestaña «Historial» del expediente.

## 2. Asignación de analistas

Permiso `ot.asignar` (jefaturas). Pestaña «Asignación» del expediente.

- `PUT /ot/:id/analistas` fija la lista completa de personas de la OT (puede haber varias).
- `POST /ot/:id/asignar-ensayos` asigna una muestra completa o un ensayo concreto (`resultado.asignado_a`) a una persona; esa persona queda también asignada a la OT.
- Solo se puede asignar personal con rol vigente en el laboratorio de la OT: analista, analista senior, revisor, técnico, metrólogo, inspector o jefatura.
- «Mis OT» (`GET /ot?mias=1`) = OT donde la persona figura en la OT o en un ensayo. La tarjeta «OT asignadas a mí» de Mi bandeja cuenta lo mismo y abre esa lista.
- La jefatura ve además «OT sin analista» (`/ot?sinAsignar=1`).

La asignación organiza el trabajo; no impide que otro analista del mismo
laboratorio capture (el alcance sigue siendo el laboratorio).

## 3. Captura estándar (todos los laboratorios)

Pantalla «Captura y revisión por OT». Cada ensayo de la muestra trae su
especificación COPIADA del catálogo al registrar la OT.

| Campo | Viene del catálogo | Si el catálogo no lo trae |
|---|---|---|
| Mín / Nom / Máx, unidad | `cat_especificacion` (estándar) o `cat_analito.rango_*` | Vacío y editable en la captura |
| Requisito de texto | `cat_especificacion.requisitos` (+ norma de `texto`) | Vacío y editable |
| Tipo de dato | Numérico si alguna cota es número; atributo si la especificación es de texto | Numérico (informativo) |
| Fórmula | `cat_analito.formula`, traducida del LIMS antiguo cuando se puede | Valor directo |

Lo completado o cambiado en la captura se guarda SOLO en el resultado de esa
orden (`resultado.espec_origen = 'orden'`, `espec_editada_por/_at`, copia del
catálogo en `espec_catalogo`). El catálogo no se toca. En revisión e informe se
ve la marca «de la orden» y el valor del catálogo.

- Rellenar lo que el catálogo dejó vacío: quien captura (`resultado.crear`).
- Cambiar lo que vino del catálogo, el tipo de dato (si el catálogo traía especificación) o la fórmula: jefatura (`resultado.aprobar`).
- Endpoint: `PATCH /flujo/resultado/:id/especificacion`.

**Numérico** (`POST /flujo/resultado/:id/valor`):
- valor directo (`12,4`), o réplicas (`12,4 12,6 12,5` → promedio, DE, CV), o
- lecturas con los campos del método (`paso_metodo` = C1..Cn): se aplica la fórmula a cada lectura y el valor es el promedio.
- Veredicto: Mín ≤ valor ≤ Máx; sin límites = «Informativo».

**Atributo**: el analista elige Cumple / No cumple; la observación es
obligatoria si no cumple.

**Fórmulas del LIMS antiguo** (`apps/api/src/laboratorio/formula-legado.ts`):
de 755 analitos con fórmula se traducen 552 (el patrón «por lectura»
`Acum := Acum + …` con `Val(sSql[i,2])` → `Ci`). Las demás (rutinas que leen
tablas, abren planillas o acumulan de otra forma) no se adivinan: el analista
ingresa el valor final o la jefatura define la fórmula de la orden.

**Coma decimal**: «12,4» es un número. Separan réplicas el espacio, el punto y
coma y «, » (coma seguida de espacio). Lo ambiguo («12,4,5», «1.234,5») se
rechaza diciendo qué no se entendió.

**Veredicto único**: `cumple | no_cumple | informativo | pendiente` en las dos
capturas (antes la de réplicas guardaba «Cumple / No cumple / Informativo» y no
entraba en los reportes). El informe muestra el texto legible.

**Veredicto de la muestra (lote)** (`muestra.veredicto`, lo recalcula cada
captura): No cumple si algún ensayo no cumple; Pendiente si falta alguno;
Cumple si todos cumplen (los informativos no cuentan en contra). La OT muestra
el de cada muestra y el global (`GET /flujo/ot/:id/resultados` →
`veredictosMuestra`, `veredictoOt`).

## 4. Revisión y aprobación

```
pendiente ─captura─▶ capturado ──revisar──▶ revisado_n1 ──aprobar──▶ aprobado
                         ▲                       │
                         └── devuelto ◀──────────┴── devolver (motivo obligatorio)
```

| Acción | Permiso | Endpoint |
|---|---|---|
| Revisar | `resultado.revisar` | `POST /resultados/:id/revisar` · OT completa: `POST /resultados/ot/:otId/revisar` |
| Aprobar | `resultado.aprobar` | `POST /resultados/:id/aprobar` · OT completa: `POST /resultados/ot/:otId/aprobar` |
| Devolver | `resultado.revisar` | `POST /resultados/:id/devolver` `{ motivo }` |
| Veredicto manual (texto que no se pudo contrastar) | `resultado.revisar` | `POST /resultados/:id/veredicto` |
| Corregir por réplicas | `resultado.crear` | `POST /resultados/:id/recapturar` |

- Quien capturó un resultado no lo revisa ni lo aprueba (409). En la acción por OT completa esos resultados se omiten y se dice por qué.
- Lo revisado o aprobado no se sobrescribe: hay que devolverlo antes (409).
- Todas las acciones exigen que el resultado sea de un laboratorio del alcance del usuario (403).
- Se registra quién capturó, revisó (o devolvió) y aprobó, y cuándo.
- Bandeja: `GET /resultados/bandeja?estado=capturado|revisado_n1|devuelto,rechazado|pendiente&mios=1&asignados=1`. Las tarjetas de Mi bandeja abren «Captura y revisión por OT» filtrada.

## 5. Listas

`GET /ot` y `GET /cotizaciones` buscan, filtran y paginan en el servidor y
devuelven `{ data, meta }` (cotizaciones también `conteos` por estado). Ya no
se limitan a las 50 más recientes.
