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

## 1b. Recepción de las muestras desde el expediente

Pestaña «Muestras» del expediente de la OT (`ot/[id]/_components/RegistroMuestras.tsx`).
Sirve para cualquier OT abierta, en especial la que nace al aceptar una cotización
(antes solo «Registrar OT» generaba ensayos y «Muestras › + Nuevo» creaba la muestra vacía).

- `GET /flujo/ot/:id/registro-muestras` (`muestra.ver`): muestras de la OT (con sus ensayos y
  métodos) y, si viene de una cotización, sus líneas con los métodos del catálogo de cada ensayo.
  Un ensayo con un solo método lo trae **marcado**; con varios, hay que elegir (no se adivina).
- `POST /flujo/ot/:id/muestras` (`muestra.crear`: Recepción, Planificación, jefaturas…)
  `{ muestras: [{ nombre, metodoIds[] }] }`: crea las muestras (`<OT>-M1`, `-M2`…, sin repetir) y
  sus ensayos por analizar con la especificación y la fórmula del catálogo (el mismo puente que
  `generar-analisis`). La pantalla permite además buscar otros métodos en el catálogo.
- Valida OT abierta, descripción y métodos existentes con analitos (400 con la lista). Exige que la
  OT sea del alcance del usuario. Queda en el historial de la OT (`registro_muestras`).
- `flujo-completo.js` registra la muestra por esta misma ruta.

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
- **Reabrir un resultado aprobado** (`POST /resultados/:id/reabrir { motivo }`, permiso `resultado.reabrir`:
  jefaturas y Dirección; botón «Reabrir» en «Captura y revisión por OT»): si al revisar o firmar el
  informe se detecta un valor erróneo. El resultado vuelve a `devuelto` (el analista lo corrige y se
  repite revisión y aprobación, con la misma segregación); los documentos de la OT **en firma u
  oficiales se anulan** con el motivo y, tras aprobar de nuevo, se reemiten como nueva versión
  (`FLUJO_FIRMA_CIERRE.md`). No se reabre en una OT cerrada o anulada (409). Traza: `resultado.reabierto_*`,
  `reaperturas` y `ot_historial` (`reapertura_resultado`, con el valor y la aprobación anteriores).
- **Control de calidad** (`/qc`): misma independencia. Al registrar, un control que cumple su
  criterio queda **pendiente** (con su evaluación automática a la vista) y uno que no, rechazado.
  Aprobarlo exige `resultado.revisar` y no haberlo registrado (409); todo exige el alcance de la OT.
- Lo revisado o aprobado no se sobrescribe: hay que devolverlo antes (409).
- Todas las acciones exigen que el resultado sea de un laboratorio del alcance del usuario (403).
- Se registra quién capturó, revisó (o devolvió) y aprobó, y cuándo.
- Bandeja: `GET /resultados/bandeja?estado=capturado|revisado_n1|devuelto,rechazado|pendiente&mios=1&asignados=1`. Las tarjetas de Mi bandeja abren «Captura y revisión por OT» filtrada.

## 5. Listas

`GET /ot` y `GET /cotizaciones` buscan, filtran y paginan en el servidor y
devuelven `{ data, meta }` (cotizaciones también `conteos` por estado). Ya no
se limitan a las 50 más recientes.

Integración con el frente de firma y cierre (docs/FLUJO_FIRMA_CIERRE.md):

- `GET /ot` acepta además `semaforo=vencida|por_vencer|en_plazo|sin_fecha`
  (mismos cortes que Mi bandeja: OT no cerradas ni anuladas, «hoy» en Chile;
  `vencidas=1` y `porVencer=1` quedan como alias), `listasCierre=1` (documentos
  oficiales y entregados, resultados aprobados) y `sinFactura=1` (cerradas con
  cobro sin factura viva). Con filtro de plazo ordena por fecha de compromiso.
- La lista de OT muestra la columna «Plazo» (semáforo) y los atajos «Vencidas»,
  «Por vencer» y «Listas para cerrar». Toda tarjeta de Mi bandeja que abre
  `/ot?…` llega con su filtro aplicado; los filtros sin botón propio (en plazo,
  sin fecha, estado concreto, sin factura) se muestran en un aviso con «Quitar
  filtro».
- `GET /cotizaciones`: `expirada` («Vencida») es un estado vigente, no
  histórico; `porVencer=1` usa la fecha de Chile y solo Abiertas (o `enviada`
  histórica), igual que la tarjeta comercial; `conteos.porVencer` alimenta el
  chip «Por vencer (7 días)».
- Las pantallas que elegían OT de una lista fija (emitir informe) usan el
  buscador de OT; las demás piden `GET /ot?limit=200`.
