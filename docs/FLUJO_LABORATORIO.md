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
| Corregir por réplicas | `resultado.crear` | `POST /resultados/:id/recapturar` `{ replicasTexto, equipoId?, motivo }` |

- Quien capturó un resultado no lo revisa ni lo aprueba (409). En la acción por OT completa esos resultados se omiten y se dice por qué.
- **Una sola captura.** Todo se captura y corrige en «Captura y revisión por OT» (`/captura-ot`).
  Los resultados por réplicas (analito del catálogo antiguo) se corrigen en su fila con
  «Corregir réplicas…» (réplicas, equipo y motivo). Rige la misma regla de corrección que la
  captura por valor (`traza.ts · exigeMotivoCorreccion`): si el ensayo ya tiene un valor capturado
  sin revisar, el motivo es obligatorio (mínimo 5 caracteres, 400 si falta) y queda en el historial
  del resultado; tras una devolución vale el motivo de la devolución. La antigua pantalla suelta
  `/captura` redirige a `/captura-ot` (y `/captura?corregir=<id>` abre la OT del resultado con la
  corrección abierta); su alta de un resultado suelto por muestra + analito, fuera de la OT, ya no
  está en la interfaz ni en el menú.
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

## Órdenes internas (derivación a otro laboratorio)

Una orden interna deriva parte de una OT a OTRO laboratorio con los ensayos del
catálogo que le corresponden (`orden_interna`, `align_frente_k.sql` y, desde el
frente r1b, `align_r1b_ordenes_internas.sql`). Especificación: EP-01 0.6, 2.2,
3.7 y 5.5; EP-02 0.6 y 5.4; EP-03 0.6, 2.2, 3.5 y 5.5; EP-05 4.10.

**Pantallas.**

| Pantalla | Ruta | Qué se hace |
|---|---|---|
| Laboratorio › Órdenes internas · «Bandeja de entrada» | `/ordenes-internas` | Las que LLEGAN a sus laboratorios: Nº interno · OT y muestra de origen (y origen BPCH: internación con su resolución DGMN, Producción Nacional con su RAF, reinspección) · laboratorio solicitante · ensayos pedidos · requisito. Botón «Recibir →». |
| Laboratorio › Órdenes internas · «Todas las de mi alcance» | `/ordenes-internas?vista=todas` | Las emitidas desde sus OT y las que llegan; «＋ Nueva orden interna» (primero se elige la OT). |
| Ficha de la orden | `/ordenes-internas/[id]` | Barra de 5 pasos, «Siguiente paso · Le toca a», un bloque por paso con su botón «Verbo → siguiente», informe de respuesta renderizado y bitácora. |
| Ficha de la OT › «Órdenes internas» | `/ot/[id]` | Las de la OT, su costo directo y el aviso de las que volvieron con informe. |
| Ficha de la OT › «Muestras» · columna «Otros laboratorios» | `/ot/[id]` | Por cada laboratorio que la muestra necesita y aún no tiene orden: «Emitir orden interna» (lleva a la pestaña «Órdenes internas» con el destino propuesto). Se ve con `orden_interna.emitir`, el mismo permiso que exige la API (antes miraba `ot.crear`). |
| Mi bandeja (Jefe de Laboratorio) | `/inicio` | «Órdenes internas por atender» (destino) e «Informes internos por integrar» (origen). |

**Ciclo (ficha de la orden).**

1. **Emitida** · «OT {código} · Órdenes internas · Nueva» → botón «Emitir OT
   interna → enviar muestra». Campos obligatorios: laboratorio de destino,
   ensayos del destino, **muestra de origen** (de la OT), **requisito y punto de
   la especificación**, **fecha de envío** (no anterior a la OT ni a más de 60
   días); opcional el **IE de referencia** de la OT madre (LAL) y el detalle.
   Emite el **analista** o la jefatura del laboratorio de la OT
   (`orden_interna.emitir`, EP-01 2.2), con la OT en su alcance.
2. **Recibida** · «Recibir OT interna → recepción»: la jefatura del laboratorio
   de destino (`orden_interna.responder` con el DESTINO en su alcance). Al
   recibirla se crean en la muestra de origen los ensayos derivados (método
   vigente por defecto de cada ensayo; idempotente). Desde entonces la orden no
   cambia de contenido.
3. **Respondida** · «Guardar respuesta → cerrar»: Nº del informe de respuesta
   (numeración `RESPUESTA_OI`, por defecto «I.E. N° {NI_N}/{AAAA}»; el destino
   puede escribir otro, p. ej. «Boletín N° …»), informe, **horas**, insumos y
   **costo directo** (obligatorios horas y costo, no negativos). El costo se
   imputa a la OT de origen (se suma en la pestaña de la OT).
   El **destino captura, revisa y aprueba sus resultados en la misma muestra**
   (desde «Captura y revisión por OT»): solo los ensayos derivados y solo
   mientras la orden está recibida. El laboratorio responsable los ve en solo
   lectura (frente r1g · docs/FLUJO_R1G_RECORRIDO.md §1).
4. **Cerrada · informe devuelto** · «Cerrar OT interna → devolver al
   solicitante»: exige la respuesta guardada y cada ensayo derivado con su
   resultado capturado **y aprobado por el destino** (r1g); **un resultado 0,00 sin observación no se acepta** (en
   el LIMS antiguo el destino dejaba 0,00 como marcador, EP-03 3.5 y EP-05 4.10).
   Cerrada, el destino ya no captura en la muestra.
5. **Dada por recibida** · «Dar por recibido → evaluación»: el laboratorio
   solicitante (`orden_interna.emitir` con la OT en su alcance) integra el
   informe; sus resultados ya vienen aprobados por el destino y entran al
   informe de la OT (r1g; EP-01 3.7 frente a EP-02 4.1, por confirmar).

Anular (con motivo) o borrar una abierta: `orden_interna.anular` (quien gestiona
la OT de origen: jefaturas de laboratorio, planificación; el analista emite pero
no anula). Una OT con órdenes sin cerrar o sin integrar mantiene la etapa
**Análisis** de la Ruta de la OT en curso y el «Siguiente paso» dice a quién le
toca (destino o solicitante). Todo queda en `orden_interna_historial`.

**Compatibilidad.** `PATCH /ordenes-internas/:id { estado: "recibida" }` hace lo
mismo que «Recibir» (historial «estado»); `{ estado: "cerrada" }` responde 409:
el cierre lo hace el destino con su respuesta.

- **Destino y ensayos**: el destino es un laboratorio del catálogo
  (`cat_familia`, enlazado con su unidad por CODSUCDEL) con ensayos vigentes y
  distinto del responsable de la OT; los ensayos deben ser de ese laboratorio
  (400). Los que ya figuran en la OT se proponen primero («en la OT»).
- **Alta de OT**: `POST /ot` exige que el laboratorio responsable esté en el
  alcance de quien la registra (los perfiles globales no cambian).

## Ruta de la OT (barra de etapas y «Siguiente paso · Le toca a»)

El expediente de la OT (`/ot/[id]`) muestra a la izquierda la **Ruta de la OT**
(etapas hechas ✓, la actual resaltada, las pendientes en gris, las que no
aplican con «–») y, encima de las pestañas, el recuadro **«Siguiente paso · Le
toca a»** con qué falta, quién debe hacerlo (rol, laboratorio y, si están
asignadas, las personas) y un botón que lleva a la pestaña o pantalla donde se
hace. El botón solo aparece a quien puede hacerlo; los demás leen «Esperando a
que lo haga…». Con la OT cerrada, el recuadro dice «OT cerrada el dd-mm-aaaa ·
Factura F-… (pagada / pago pendiente / por emitir)». La cabecera del expediente
muestra «Etapa: …» en lugar del estado interno de la OT.

**Cómo se calcula.** `GET /ot/:id/avance` (permiso `ot.ver`, mismo alcance por
laboratorio que la OT). La etapa NO se guarda en ninguna columna: se deduce en
cada consulta de lo que ya existe y el servidor ya valida. Una sola función pura,
`apps/api/src/ot/avance-ot.ts › calcularAvance`, da a la vez la barra y el
siguiente paso, así que nunca se contradicen (pruebas: `avance-ot.spec.ts`;
recorrido: `scripts/verificacion/flujo-completo.js`, que afirma la etapa en cada
momento). La etapa actual es la primera que no está hecha ni «no aplica»; todo
lo posterior se muestra pendiente (un solo punto actual, como en las maquetas).
En una OT cerrada, lo que quedó atrás sin hacer se muestra «no aplica».

`orden_trabajo.estado` ya no gobierna la barra: no conoce «recepcionada» (el
estado con que nace toda OT) y solo cambia al cerrar. Por eso la barra anterior
de 14 fases se quedaba en «Fase 1 · Recepción» hasta el cierre.

### Etapas de una OT de laboratorio

| # | Etapa | Hecha cuando… | Siguiente paso · le toca a · dónde |
|---|---|---|---|
| 1 | Apertura de la OT | tiene laboratorio responsable (detalle: cotización aceptada u origen) | Fijar el laboratorio · Planificación y Control · pestaña Cabecera (`ot.cambiar_laboratorio`) |
| 2 | Recepción de muestras | hay al menos una muestra registrada (si la recepción está incompleta, se avisa) | Registrar muestras y ensayos · Recepción de muestras · pestaña Muestras (`muestra.crear`) |
| 3 | Asignación | hay analistas en la OT o en sus ensayos, o ya hay capturas (la asignación ordena, no bloquea) | Asignar analistas · Jefe de Laboratorio · pestaña Asignación (`ot.asignar`) |
| 4 | Análisis | hay ensayos y ninguno está pendiente, devuelto ni rechazado | Capturar N ensayos · Analista (personas asignadas) · Captura (`resultado.crear`) |
| 5 | Revisión | ninguno queda «capturado» | Revisar N resultados · Analista revisor · Captura (`resultado.revisar`) |
| 6 | Aprobación | todos «aprobado» | Aprobar N resultados · Jefe de Laboratorio · Captura (`resultado.aprobar`) |
| 7 | Emisión del informe | hay un documento vigente (en firma u oficial) y ninguno devuelto | Emitir (o reemitir el devuelto) · Jefe de Laboratorio · pestaña Informe y cierre (`certificado.emitir`) |
| 8 | Firmas | ningún documento en firma | Firmar X (paso de …) · el rol y las personas del paso pendiente según la matriz · Documentos por firmar (solo esas personas) |
| 9 | Entrega al cliente | todos los oficiales tienen la entrega registrada | Registrar la entrega · Planificación y Control o Ventas · Informe y cierre (`certificado.entregar`) |
| 10 | Cierre de la OT | `estado = cerrada` | Cerrar la OT, o lo que falte con el texto de `faltantesParaCerrar` (la MISMA regla que `POST /ot/:id/cerrar`) · Planificación y Control · Informe y cierre (`ot.cerrar`) |
| 11 | Factura | la factura de la OT está emitida (o con pagos) | Emitir la factura con folio · Finanzas · Facturas (`factura.emitir`) |
| 12 | Pago | la factura está pagada | Registrar el pago · Finanzas · Facturas (`factura.cobrar`) |

**Fases que se quitaron y por qué.** La barra anterior tenía 14 fases. Se
retiraron *Preparación*, *Captura RN*, *Cálculo* y *Validación técnica* porque
no corresponden a ningún dato ni acción del producto (el cálculo ocurre dentro
de la captura; la validación técnica es la revisión). *Registro* se funde con
*Recepción* (registrar las muestras es recibirlas). *Emisión del informe* y
*Firmas* se mantienen separadas porque tienen dato propio (documento vigente /
documento oficial) y responsables distintos. Se añaden *Apertura* (OT sin
laboratorio), *Factura* y *Pago*, que sí tienen dato propio. Resultado: 12
etapas observables.

### Variantes según el tipo de OT

- **OT interna, interlaboratorio o sin cobro**: Factura y Pago «no aplican».
- **Metrología** (laboratorio LMT, LMTE, LNF o LCAD que trabaja con
  calibraciones; si usa la captura estándar sigue la ruta de laboratorio):
  Apertura → Toma de datos y cálculo → Revisión técnica → Firma y emisión del
  certificado → Entrega → Cierre → Factura → Pago (con Programación y
  Recepción del instrumento antes de la toma de datos), tomadas de los
  instrumentos de la OT (`met_ot_instrumento`) y de `met_calibracion.estado` de
  sus calibraciones, que ya están ligadas a la OT y al instrumento (entrega R1,
  EP-04). La **Entrega ya no está bloqueada**: es «Entrega del certificado y
  devolución» («Registrar entrega →» y «Devolver instrumento →» en la pestaña
  Instrumentos o en la ficha de calibración), y el cierre cuenta cada
  certificado de calibración emitido y entregado como documento de la OT
  (detalle en `FLUJO_METROLOGIA.md` §7.2 y §7.3). Si el parámetro
  `metrologia.cierre_exige_devolucion` está en «Sí», el cierre exige además la
  devolución de cada instrumento (`PARAMETROS_OPERACION.md`).
- **BPCH Internación**: las fases del expediente BPCH, con el mismo criterio que
  `internacion-bpch.service › fases()`: Resolución DGMN y análisis técnico → OT y
  lotes → Resultados de la inspección → Informe de Inspección → Certificado de
  Conformidad o Informe de Incumplimiento → Codificación Única (no aplica si NO
  CUMPLE) → Tasa → facturación (no aplica si no está sujeta) → Cierre.
- **BPCH Reinspección**: Solicitud → OT y lote → Resultados → Informe de
  Inspección (oficial y entregado) → Trazabilidad en Codificación Única (no
  aplica sin codificación) → Cierre.

Los avisos (OPI pendiente, muestras con la recepción incompleta) acompañan al
siguiente paso; no cambian la etapa porque el servidor no bloquea por ellos.
El botón es una ayuda: quien decide es siempre el servidor (403/409 con motivo).

## Motor de flujos genérico (BPM): oculto de la interfaz

**Qué había.** Además de la barra, la OT tenía una pestaña «Flujo» con «Iniciar
flujo» sobre un motor de flujos configurables (`flujo_def`, `flujo_version`,
`flujo_paso`, `flujo_transicion`, `flujo_instancia`, `/api/flujos`) y un
«Diseñador de flujos» en el menú. Era un flujo dentro de otro flujo: completar
una tarea del motor no cambiaba nada de la OT, y las acciones reales (recibir,
capturar, aprobar, emitir, firmar, entregar, cerrar) no movían el motor. Sus
tareas se asignaban a quien lo iniciaba y no llegaban a «Mi bandeja».

**Por qué queda oculto.** El recorrido de cada laboratorio ya lo imponen las
reglas del servidor (permisos, alcance por laboratorio, segregación de
funciones, matriz de firmas, condiciones de emisión y de cierre) y la Ruta de la
OT lo muestra. Un flujo dibujado aparte, que no controla esas reglas, duplica lo
mismo y puede contradecirlo.

**Qué se quitó de la vista (sin borrar nada).**
- La pestaña «Flujo» del expediente (el código vive en `ot/[id]/_components/FlujoBpmOt.tsx`).
- La columna «Flujo» de la lista de OT.
- «Diseñador de flujos» del menú (`lib/navegacion.ts`) y de los accesos del panel.
- `/flujos` muestra «Esta pantalla no está disponible» con enlaces a Órdenes de
  trabajo y Mi bandeja (no da error).
- Mi bandeja no lee tareas del motor (`rbac/bandeja.service.ts` no consulta `flujo_*`).

El motor, sus tablas, sus datos y su API (`/api/flujos/*`, `GET|POST /ot/:id/flujo`)
siguen intactos; los guiones que lo prueban por API pueden seguir haciéndolo. El
flujo de prueba antiguo `FLUJO-E2E` se retira con `align_retiro_flujo_e2e.sql`
(se borra si no tiene instancias; si las tiene, se archiva y se marca retirado).

**Cómo se reactivaría.** Si el IDIC decide configurar sus propios procesos,
compilar la web con `NEXT_PUBLIC_MOTOR_FLUJOS_VISIBLE=true` (variable de
COMPILACIÓN de Next.js, `apps/web/lib/motorFlujos.ts`): vuelven el menú, el
acceso del panel, la pantalla `/flujos` y la pestaña «Flujo» de la OT. Antes de
hacerlo conviene decidir el papel del motor: la propuesta (v2) es que deje de ser
un motor ejecutable y pase a **configurar** la Ruta por laboratorio (nombre
visible de cada etapa, plazo objetivo, etapas que no aplican y rol responsable
cuando la matriz no lo resuelve), leída por `avance-ot.ts`.
