# Comercial, datos de la OT, cobro, calidad y recepción · frente r4d · LIMS IDIC

Entrega R4 · temas T05, T15, T17, T22, T27, T12, T18, T19, T32 y T08 del backlog
(`Backlog_Consolidado_Procesos_Aiuken.xlsx`, columna O). SQL:
`packages/db/align_r4d_comercial.sql` (aditivo e idempotente, antes de
`align_cierre_permisos.sql`). Guion: `scripts/verificacion/r4-r4d.js`.

## 1. Cliente y CRM (T22)

| Hueco | Pantalla y botón | Regla |
|---|---|---|
| BL-172 · EP-00 0.1 | Comercial › Clientes › fila › **«Plantas»** → «Agregar planta» / «Corregir» / «Desactivar». La ficha muestra además los días de crédito. | Código P01, P02… automático; nombre único por cliente; una planta no se borra (puede estar citada en cotizaciones y OT), se desactiva. `cliente.ver` / `cliente.editar`. |
| BL-173 · EP-00 0.3 | Comercial › Oportunidades (CRM): campo «Laboratorio o centro de costo», **«Crear cotización →»**, «Perder» con motivo, enlaces a la cotización y la OT. | Código `OPP-AAAA-NNNN` con el año en curso. Alcance: Comercial (DCO en su alcance) las ve todas; una jefatura técnica, las de sus laboratorios. «Crear cotización →» abre Nueva cotización con el cliente y la enlaza al guardarla (etapa Propuesta); al aceptarse la cotización, la oportunidad queda Ganada con su OT. |

## 2. Cotización: costeo, V°B° y aceptación (T05)

| Hueco | Pantalla y botón | Regla |
|---|---|---|
| BL-149 · EP-00 2.2 | Nueva cotización › «Ensayos cotizados»: el precio sale de la ficha; **«Agregar gasto»** (viático, pasaje, traslado) con valor manual. | La API rechaza un precio manual distinto de la ficha (400), un ensayo sin valor en su ficha (400) y una línea libre que no sea gasto tipificado (400). Al editar, lo ya cotizado conserva su precio. **Varios centros de costo por cotización: por confirmar (EP-00 §10 P7).** |
| BL-210 · EP-01/02 0.1 | Nueva cotización › «Solicitud del cliente»: solicitante (contacto del cliente o nombre), medio (oficio / correo), Nº y fecha. | La Referencia se completa con «OF Nº …» o «Correo de fecha dd-mm-aaaa» si estaba vacía. |
| BL-151 · EP-05 0.2 | Cotización › «Solicitar al laboratorio» › tipo **«Comisión en terreno o en el extranjero»**; respuesta del laboratorio con «Puntos de la E.T.» y «Nº de ítems» (Programa de Trabajo LEM). Nueva cotización con centro de costo LRB: **«Sumar N a cada ensayo»**. | La comisión exige el costeo FORM05 (horas por rol, viáticos, pasajes, traslados, arriendo, tipo de cambio). Reposición del LRB: parámetro `cotizacion_lrb.reposicion` (4). |
| BL-209 · EP-00 4.1 | Registrar aceptación › «Documento de aceptación (PDF o imagen)». La ficha lista y descarga los adjuntos. | Se valida por el contenido (PDF, PNG, JPEG; 5 MB). Aceptación: `cotizacion.aceptar`. |
| BL-150 · EP-00 4.2 | Registrar aceptación con O/C › «Monto de la O/C», «Discrepancia», **«Resolver → crear OT»** / **«Anular orden del cliente»**. | Si la O/C difiere del total más que `aceptacion_oc.tolerancia` (0 CLP), la OT solo nace con la discrepancia escrita (409 sin ella). Anular la orden deja la cotización Abierta. Ambos quedan como hitos en la bitácora. |

## 3. Datos y origen de la OT (T15)

OT › Cabecera › **«Datos del encargo»** («Completar o corregir» → «Guardar datos
del encargo», `ot.crear`) y **«Recepción en el laboratorio»** (`ot.planificar`).

| Hueco | Regla |
|---|---|
| BL-159 · EP-00 5.1, EP-03 0.1 | Al aceptar la cotización la OT hereda moneda, forma de pago, referencia, descripción técnica, valor inicial y paridad. Clasificación: tipo de trabajo (Ensayos · Adquisiciones · Asesoría · Calibración · Certificación; Adquisiciones propone IVC, el resto IE), nivel tecnológico (AA/AB/BA/BB), ¿requiere muestreo? También en Registrar OT. |
| BL-160 · EP-01/02 0.5 | Registrar OT › origen **«Institucional sin cobro (oficio)»**: Nº y fecha de oficio (parámetro `ot_institucional.exige_oficio`, sí) y laboratorios que intervienen; nunca con cobro. En el alta directa se ve la casilla «Con cobro». Quién la abre: **por confirmar (EP-01 §10 P17)**. |
| BL-161 · EP-03 0.3, EP-05 0.3 | Contrato y fecha, proyecto PICM, proveedor, fabricante y país, ítem, cantidad y unidad, E.T. y versión, lugar y fecha de muestreo, OT de origen y quién paga (proveedor/mandante). **Precargan la portada del IVC** al emitir. |
| BL-162 · EP-05 0.1 | Carril DSA, lugar de ejecución, país (obligatorio si es en el extranjero), muestreo en instalaciones del cliente. La comisión en fábrica va en US$; la reinspección exige la OT de origen. En la cotización no se pide el carril (se completa en la OT). |
| BL-163 · EP-05 1.2 | «Recepcionar → planificar»: alcance conforme, inicio, término, informe comprometido (obligatorios inicio e informe), fecha de muestreo/inspección, en el SVM la clasificación del vehículo (MMU/MUU/PPU/Apoyo) y subtipo, «Escalar al Jefe de Sección». «Alcance no conforme → Ventas» con motivo. Las fechas internas no cambian el plazo con el cliente (si el informe queda después, aviso). |

## 4. Cobro y costo real (T17, T27)

| Hueco | Pantalla y botón | Regla |
|---|---|---|
| BL-164 · EP-06 6.23 | Comercial › **Tasa 1,5 % mensual** (`/bpch/tasa-mensual`): mes, totales, tabla por OT, por centro de costo, «⬇ Excel», **«Emitir informe mensual → difusión»**. | Tasas calculadas en el mes (hora de Chile); estado de pago desde la factura y sus pagos. Ver: `bpch.tasa.gestionar`; emitir: `tasa.emitir` (Jefe DCO), una vez por mes. Difusión: parámetro `tasa_informe.difusion`. Comercial y la SCC ven todo; una sucursal, sus OT. |
| BL-218 · EP-06 6.22 | (Ya resuelto en r1g: medio de pago de lista y Nº de boletín.) | — |
| BL-193 · EP-00 7.1 | OT › Costos › bloque **«OT internas valorizadas»** → «Traer N orden(es) interna(s)». | Cada orden interna de la OT con su costo directo de respuesta; no se repite; debe ser de la OT. |
| BL-194 · EP-05 9.1 | OT › Costos › bloque **«Gastos de comisión»** → «Traer N gasto(s) del costeo». | Viático, pasaje, traslado, arriendo, combustible, rendición u otro. Se traen los que estimó el laboratorio en el FORM05 de la cotización; la pantalla «Comisión» de EP-05 2.4 no existe aún, así que los gastos reales se escriben aquí. |

## 5. Cierre (T12)

BL-152 (notificación DGMN entre los faltantes del cierre cuando la condición es
NO CUMPLE) ya estaba resuelto (`faltantesNotificacionDgmn`, frente r2b/r4b).

## 6. Trabajo no conforme, reclamos y apelaciones (T18)

| Hueco | Pantalla y botón | Regla |
|---|---|---|
| BL-165 · EP-01/03 4.2, EP-04 P6.3, EP-05 6.2 | Captura y revisión por OT › **«No conforme → PNC»** (OT y ensayo precargados); ficha de calibración devuelta › **«Registrar trabajo no conforme»**; No conformidades › clase PNC/TNC, acción, costo de no calidad, **«Reejecutar → captura»**, **«Escalar al Jefe de Sección»**. | Formulario IDIC-PG12-FORM01. Reejecutar devuelve los ensayos: aprobados → reabrir (exige `resultado.reabrir`, anula los documentos vigentes), capturados o revisados → devolver; una sola vez; queda en el historial de la OT. Relación con LMT-PG01-P01-01 (AC y CA): **por confirmar (EP-04 §10 P17)**. |
| BL-219 · EP-00 9.2 | Comercial › **Reclamos**: «Registrar reclamo → responsable», respuesta, «Cerrar reclamo». | Fecha (no futura), cliente y OT (del mismo cliente), motivo, rol responsable. Cerrar exige la respuesta. Es una NC de tipo reclamo de cliente. `reclamo.ver` / `reclamo.gestionar`; Comercial (DCO) los ve todos. |
| BL-166 · EP-05 8.2 | Laboratorio › **Apelaciones**: «Registrar apelación → Director», adjuntar antecedentes, **«Resolver → cerrar»**. | Plazo `lrb.plazo_apelacion` (5) días hábiles desde la recepción del informe (lunes a viernes; **feriados por confirmar**). Fuera de plazo se registra con marca y aviso. El Director acoge o rechaza; inapelable. Una sola apelación en trámite por informe. `apelacion.ver/registrar/resolver`. |

## 7. Control de calidad analítico (T19)

BL-167 · EP-01 3.5, contrato §4.2.3: Catálogo › Métodos › casilla **«QC
requerido»**; Control de calidad (QC) › tipos nuevos **MRC** y **patrón de
verificación** (% de recuperación del valor certificado, con el MRC o patrón
usado) y **«Tipos y criterios…»** por método (tipos exigidos y criterio de
aceptación de cada uno; quien gestiona el catálogo de ese laboratorio). Sin
tipos exigidos basta un control aprobado de cualquier tipo; con tipos, uno
aprobado de cada uno. El control sin criterio toma el del método o el general
(MRC 90–110 %, patrón 95–105 %). **Criterios por ensayo: por confirmar (EP-01 §10 P11).**

## 8. Plantillas oficiales (T32)

- BL-205: `PG09A2-LQC` y `PG09A2-LPN` (IDIC-PG09 Anexo 02-02 rev05) según el
  formato real (Anexo 02-02 del LCC y el IE 79636/032 del Laboratorio de
  Pinturas). El LME ya tenía LME-IT03, LME-INT y PG09A2-LME (r1d).
- BL-206: tablas del 15-10 de Textil y LCC: «Sello N.º» en Dimensiones (el sello
  de la muestra en su primera fila), sin método en Confección, Dimensiones,
  Etiquetado y Empaque (editables en «Formato del informe»), y en el IVC la tabla
  «Verificación del producto terminado» (ítems defectuosos), que se llena en
  Informes al emitir.

## 9. Recepción y custodia (T08)

| Hueco | Pantalla y botón | Regla |
|---|---|---|
| BL-211 · EP-00 5.7 | OT › Cabecera › **«Recepción de ítems en DCO»** → «Recepcionar → entregar al laboratorio», «Entregado al laboratorio». | Portador (RUT módulo 11, nombre, dirección), fecha y hora (no futura), cantidad > 0, condición; «No cumple» exige observación. `ot.recepcion_dco` (Comercial, Planificación, Recepción). |
| BL-212 · EP-02 1.3 | OT › Muestras › **«Distribuir…»** → «Distribuir → laboratorios». | Una fila por laboratorio con ensayos en la muestra: porción, fecha y hora (Chile), quién recibe. Corregir reemplaza. `muestra.transferir`. |
| BL-213 · EP-03 7.2 | Cadena de custodia › evento «Devolución»: cantidad devuelta, guía de despacho, medio. | Cantidad y guía obligatorias; entran en el hash del eslabón. |

## 10. Correcciones

- La columna «Límite» de la captura usa coma decimal y sin ceros de relleno
  («≤ 50», no «≤ 50,000»).
- La fecha y hora del ensayo, las de microbiología y la del movimiento de
  custodia se escriben y se muestran en hora de Chile
  (`aInputHoraChile` / `deInputHoraChile` en `apps/web/lib/format.ts`).
- NCh 44: una sola tabla (`apps/api/src/muestreo/nch44.ts`) para el muestreo del
  lote y la inspección por atributos (`formularios/aql.ts` la usa). El único
  borde en que diferían (letra R, AQL 0,015) conserva el criterio de cada
  pantalla y queda probado. Los parámetros AQL de las dos pantallas siguen
  siendo dos grupos (rigen procedimientos distintos con valores por defecto
  distintos: menor 4 en el muestreo, clase C 6,5 en la HCP), pero sus opciones
  salen de la misma tabla.

## 11. Permisos nuevos

`tasa.emitir` (JEFE_DEPTO), `apelacion.ver` (JEFE_LAB, JEFE_DEPTO, COMERCIAL,
CALIDAD + cascada de lectura), `apelacion.registrar` (JEFE_LAB, JEFE_DEPTO),
`apelacion.resolver` (DIRECTOR), `reclamo.ver` (COMERCIAL, PLANIFICACION,
CALIDAD + cascada), `reclamo.gestionar` (COMERCIAL, PLANIFICACION, CALIDAD),
`ot.recepcion_dco` (COMERCIAL, PLANIFICACION, RECEPCION). SUPERADMIN, todos.
