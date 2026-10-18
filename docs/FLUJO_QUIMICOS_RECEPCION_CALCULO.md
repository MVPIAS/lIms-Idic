# Depto. Químico · recepción, cálculo auditable, factor y costos reales · LIMS IDIC

Respuesta a lo que envió el Departamento Químico el 15-10-2026 (maqueta LQC comentada y
documento del Laboratorio Textil). Este documento dice qué regla aplica el servidor y cómo se
comprueba.

- SQL: `packages/db/align_quimicos_recepcion_calculo.sql` (aditivo e idempotente; último de `ORDEN_SQL.txt`).
- Reglas puras con pruebas: `apps/api/src/flujo-real/recepcion-muestra.ts`,
  `apps/api/src/laboratorio/{factor,traza,planilla-calculos,costos-reales}.ts` (`*.spec.ts` al lado).
- Verificación contra la API: `scripts/verificacion/quimicos-recepcion-calculo.js` (21 pasos; cada
  regla con el perfil que puede y con uno que no).

## 1. Recepción e identificación de la muestra

Expediente de la OT › pestaña «Muestras» › «Registrar muestras recibidas» y, por muestra,
«Recepción…».

| Campo | Regla |
|---|---|
| Toma de muestra | Obligatoria. Una de las opciones vigentes de la lista `toma_muestra` (Catálogo › Parámetros): «En terreno por el laboratorio», «Entregada por el cliente», «Tomada por personal de la Sección Muestreo IDIC». El IDIC puede renombrarlas o agregar otras sin cambiar código. |
| Condición de recepción | Obligatoria: Cumple / No cumple. Si no cumple, la observación es obligatoria (mínimo 5 caracteres). También lo exige la base (`ck_muestra_condicion_recepcion`). |
| Nº de sello | Opcional (`muestra.sello_numero`, ya existía). |
| Identificación dada por el cliente | Opcional: el rótulo del cliente («Estanque Nº 3»), distinto del código del laboratorio. |
| ¿Requiere ensayos de otros laboratorios? | Si se marca, hay que indicar cuál(es) (no el laboratorio responsable de la OT). Queda en la muestra y se enlaza con las órdenes internas de la OT hacia ese laboratorio; si no hay, se muestra «sin orden interna». |

- `POST /flujo/ot/:id/muestras` acepta `muestras[].recepcion` (la pantalla lo envía siempre; la API
  lo admite opcional para no romper integraciones anteriores, y la lista marca «Recepción
  incompleta»). Los datos comunes se aplican a todas las muestras del registro; sello e
  identificación van por muestra.
- `PATCH /flujo/muestras/:id/recepcion` (`muestra.crear` + alcance de la OT; no en OT cerrada o
  anulada) completa o corrige la recepción. Queda en el historial de la OT (`recepcion_muestra`)
  con lo anterior COMPLETO (incluido quién y cuándo recibió) y lo nuevo. Corregir **no cambia**
  quién y cuándo se recibió la muestra (`recepcionada_por`, `recepcionada_at`): se anota aparte
  quién corrigió y cuándo (`recepcion_corregida_por`, `recepcion_corregida_at`,
  `align_revision_r3.sql`). Si la muestra aún no tenía recepción, completarla es la recepción.
- El registro de varias muestras es **todo o nada** (una transacción): si una falla, no queda
  ninguna creada.
- Las órdenes internas apuntan al laboratorio del catálogo (`cat_familia`); se corresponden con
  la unidad del organigrama por su código CODSUCDEL.

## 2. Planilla de registros y cálculos (auditable)

`/ot/[id]/calculos` (enlace en «Resultados» del expediente y en «Captura y revisión por OT»).
Solo lectura. `GET /laboratorio/ot/:id/planilla-calculos` (`resultado.ver` + alcance de la OT;
un laboratorio que trabaja en la OT por orden interna u «otros laboratorios» la abre con **solo
sus ensayos** —`soloSuLaboratorio: true`—; el ensayo es del laboratorio de su método en el
catálogo, o del responsable si no se sabe);
`?formato=csv` descarga para Excel (punto y coma, coma decimal, BOM UTF-8; las celdas que Excel
interpretaría como fórmula se neutralizan).

Por ensayo: lecturas con los campos del método (C1..Cn y su nombre), réplicas, variables (las de
la última captura: una corrección sin variables las vacía),
fórmula y su origen (de la orden o del catálogo, y la del catálogo si se cambió), factor (del
método o ajustado en la OT, con quién, cuándo y motivo), fórmula aplicada, valor sin factor,
resultado, promedio/DE/CV, especificación, quién capturó, revisó y aprobó, y el historial.

### Historial de cambios (todo cambio de valor queda registrado)

El disparador `trg_resultado_historial` anota en `resultado_historial` cada alta, cambio y baja de
un resultado, campo por campo (valor, réplicas, lecturas, variables, fórmula, fórmula aplicada,
factor, límites, unidad, requisito, tipo de dato, veredicto, estado, observación, equipo): valor
anterior y nuevo, cuándo, quién, motivo y origen. Quién, motivo y origen los fija la API en la
misma transacción (`conTraza`, `set_config` local); si algún camino no lo hiciera, el cambio igual
queda anotado «sin usuario identificado». Usan `conTraza`: registro de muestras, captura y
corrección (puente y réplicas), especificación de la orden, factor, revisar, aprobar, devolver,
reabrir, veredicto manual, edición y eliminación por el CRUD de resultados.

Reglas nuevas de motivo:

- Corregir un valor **ya capturado y aún sin revisar** (`POST /flujo/resultado/:id/valor`) exige
  `motivo` (mínimo 5 caracteres). La primera captura no lo pide; tras una devolución o reapertura
  el motivo registrado es el de la devolución. La corrección por réplicas del catálogo antiguo
  (`/resultados/:id/recapturar`) acepta `motivo` opcional (su pantalla no es de este frente).
- Cambiar en la orden lo que vino del catálogo, el tipo de dato o la fórmula (jefatura,
  `resultado.aprobar`) exige `motivo`.

## 3. Factor de la fórmula

- El método (`cat_metodo.factor_valor`, `factor_operacion` multiplicar/dividir,
  `factor_descripcion`) trae el factor por defecto; se fija con `PATCH /cat/metodos/:id`
  (`catalogo.gestionar`). Al generar los ensayos de una OT se copia al resultado (origen «metodo»).
- En la OT: `PATCH /flujo/resultado/:id/factor { valor|null, operacion, descripcion?, motivo,
  todoElMetodo? }` (permiso **`resultado.factor`** + alcance). Motivo obligatorio. Con
  `todoElMetodo` se aplica a todos los ensayos de la OT con el mismo método que aún se pueden
  corregir. Lo revisado o aprobado no se toca (409).
- Se aplica al valor **calculado** (lecturas con fórmula o réplicas): `formula_aplicada` queda
  como «(C1 / C2) / 10» o «PROMEDIO(RN) * 2». Un valor final ingresado directamente no se toca.
- Si el factor cambia después de capturar (`laboratorio/ajuste-factor.ts`): se **recalcula** desde
  las lecturas o réplicas guardadas (o desde `valor_sin_factor`) y se vuelve a evaluar el
  veredicto. Si el valor se ingresó directo (o es una captura antigua sin esos datos), el factor
  **no se aplica**: el ensayo se devuelve en `omitidos` con el motivo y su resultado y factor
  quedan como estaban. Nunca se muestra un factor que no se aplicó: la planilla marca
  «no aplicado» (`factor.aplicado = false`) si hay valor directo con factor del método.
- En el catálogo, factor y operación van juntos (ambos o ninguno): uno solo es 400 con el
  motivo.
- **Regla parametrizable**: por defecto `resultado.factor` lo tienen las jefaturas (SUPERADMIN,
  DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB). Si el IDIC decide que también lo
  ajuste el analista, basta con asignar el permiso al rol ANALISTA en Administración › Roles.

## 4. Planilla de costos reales por OT (DCO-PG01-P05-IT03-FORM01)

`/ot/[id]/costos` (enlace en «Resultados» del expediente). Una planilla por OT y laboratorio: el
responsable de la OT o uno que trabaja en ella por orden interna o por «otros laboratorios» de la
recepción.

- Bloques: horas hombre por cargo (lista editable `cargo_costo`: Jefe de Departamento, Jefe de
  Laboratorio, Profesional, Analista, Técnico), reactivos y consumibles, equipos (horas máquina) y
  otros. Cada línea: cantidad × costo unitario. **Las tarifas no constan en las fuentes recibidas**
  (la planilla real no llegó; las siglas HRSS/HRST/HRSA/HRSM/HRSJLAB/HRSJDEP del LIMS antiguo no
  tienen significado ni tarifa documentados): se escriben en cada línea.
- Sugerencias: equipos usados en los ensayos de la OT y consumos del kardex sobre sus muestras.
- Comparación con la estimación (`estimacion.alcance`):
  - OT de **un solo laboratorio** («ot»): costo directo del costeo consolidado, si no la estimación
    de los laboratorios (`solicitud_costeo`), si no el costo estimado de la OT; horas hombre
    estimadas; precio cotizado por bloque (referencia) y neto cotizado − costo real.
  - OT con **varios laboratorios**: la planilla de cada uno se compara con **su** parte, sus
    solicitudes de costeo (`solicitud_costeo.familia_id` → unidad por CODSUCDEL) («laboratorio»);
    sin ellas no se compara con el total y se avisa («sin_estimacion_laboratorio»). El neto y el
    precio por bloque son de la OT completa: no se usan por laboratorio.
- `GET /laboratorio/ot/:id/costos-reales?unidadId=` (**`costo_real.ver`**: SUPERADMIN, ADMIN,
  DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_LAB, PLANIFICACION, FINANZAS) ·
  `PUT …` guarda el borrador · `POST …/cerrar` · `POST …/reabrir { motivo }`
  (**`costo_real.gestionar`**: JEFE_LAB y SUPERADMIN). Todas exigen el alcance del laboratorio.
- Cerrar exige al menos un costo, horas hombre y todos los ensayos **de ese laboratorio**
  aprobados (los suyos, no los de los demás: cada uno cierra al terminar su parte). Cerrada no se
  edita; reabrir exige motivo. Cierre y reapertura quedan en el historial de la OT
  (`costos_reales`), en una transacción con la planilla bloqueada: un doble clic da un cierre y
  un 409, nunca dos eventos.
- El Jefe de Sección no participa en la planilla (pedido del Depto. Químico: sacarlo de
  revisión, informe y planilla de costos).

## Decisiones que el IDIC debe confirmar

- Si el **cierre de la OT** debe exigir la planilla de costos cerrada (hoy no la exige; el cierre
  es de otro frente). Se podría agregar como condición en `GET /ot/:id/cierre`.
- Tarifas $/h por cargo y por equipo (cuando lleguen, pueden cargarse como valor por defecto).
- Si el analista ajusta el factor (permiso `resultado.factor` a ANALISTA).
- Opciones de «Toma de muestra» y lista de cargos (editables en Catálogo › Parámetros).

## Permisos nuevos

| Permiso | Roles |
|---|---|
| `resultado.factor` | SUPERADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB (+ alias JEFEDCO, JEFELAB) |
| `costo_real.ver` | SUPERADMIN, ADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_LAB, PLANIFICACION, FINANZAS (+ alias) |
| `costo_real.gestionar` | SUPERADMIN, JEFE_LAB (+ alias JEFELAB) |

Los permisos viajan en el token: hay que volver a iniciar sesión para verlos.
