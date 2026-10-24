# Avisos, despacho y entrega, oficio conductor, bandejas, reportes y carpeta · LIMS IDIC

Frente r4c (entregas R2/R4): temas T14, T20, T03 y T23 del backlog consolidado.
SQL: `packages/db/align_r4c_avisos_despacho.sql` y `packages/db/align_r4c_oficio.sql`
(antes de `align_cierre_permisos.sql`). Guion: `scripts/verificacion/r4-r4c.js`.

## 1. Avisos (T20 · BL-103, BL-220)

Un aviso es una fila por persona en `aviso` y se ve en **Mi bandeja › Avisos**
(urgente, atención o aviso; «Leído», «Marcar todos como leídos», «Ver también los
leídos»). Si el parámetro lo pide, también sale **un correo** con el correo del LIMS.

| Aviso | Cuándo | A quién | Clave (no se repite) |
|---|---|---|---|
| Resultado **No cumple** / **Contaminado** (contrato §4.2.6, §4.3.9) | Al aprobar el resultado | Jefes del laboratorio dueño del ensayo y ejecutivo de la cotización; el cliente solo si `avisos.no_cumple_al_cliente` = Sí | `no_cumple:<resultado>` |
| **Documento oficial** | Con la última firma | Ejecutivo de la cotización (o Ventas y Planificación) y jefes del laboratorio | `documento_listo:<documento>` |
| **OT por vencer** | Revisión cada hora, o «Avisar →» | Jefes del laboratorio y ejecutivo (o Planificación) | `ot_por_vencer:<ot>:<fecha>` (una vez) |
| **OT vencida** | Revisión cada hora, o «Avisar →» | Ídem | `ot_vencida:<ot>:<día>` (una vez al día) |
| **Despacho** | Al despachar el documento | El destino (ver §2) | `despacho:<documento>` |
| **Oficio** por firmar / firmado / devuelto | Al generar, en cada firma, al terminar o al devolver | Firmante de turno · autor y Oficina de partes · autor | `oficio_*` |

- «Contaminado» = No cumple cuyo texto u observación dice «contaminado» o «presencia».
- «Avisar →» (`POST /avisos/plazos`, `ot.seguimiento`) avisa ahora las OT de su alcance;
  con OT indicadas lo repite aunque ya se hubiera avisado ese día. La revisión
  automática no duplica lo enviado a mano.
- Cada aviso de una OT deja un **hito** en su historial (`ot_historial`, tipo `aviso`).
- **Sin correo configurado nada falla**: el aviso queda en la bandeja con «correo no
  configurado: solo en el LIMS» y el intento en la bitácora de Mensajería
  (`correo_enviado`, tipo `aviso`). Personas sin correo: «sin correo registrado».
- La revisión automática se desactiva con `AVISOS_AUTOMATICOS=false` (entorno) o con
  el parámetro `avisos.revision_automatica`.

Disparo: `common/eventos.ts`. Laboratorio y firma de documentos solo emiten
`resultado.aprobado` y `documento.oficial` después de confirmar; `AvisosService` se
suscribe. Un oyente que falla no afecta a quien emitió.

## 2. Despacho, entrega y envío (T20 · BL-168, BL-169, BL-171, BL-221, BL-222)

**Despachar →** (ficha del documento; `certificado.despachar`, jefaturas y Dirección):
destino **DCO**, **laboratorio solicitante**, **BPCH** o **cliente**, fecha (no futura),
nº de ejemplares (1–50), distribución (destinatario y ejemplares), copia archivada
(ubicación y retención en meses), oficio y observación. Solo documentos oficiales, una
vez. El destino recibe aviso y tarjeta **Despachos por recibir** y lo da por recibido
(«Dar por recibido el despacho», `certificado.entregar`).

**Remitir a DCO** (expediente BPCH, EP-06 6.14 y EP-07 7.18): el documento final oficial
(Certificado de Conformidad o Informe de Incumplimiento, con o sin tasa) se despacha
al DCO; es distinto de «Remitir a facturación» (la tasa).

**Registrar entrega**: además de fecha, medio y destinatario, **Nº de guía**, ejemplares,
copias (laboratorio, DCO), **oficio conductor** firmado y devolución de muestras
solicitada (EP-05 8.1).

**OT › Informe y cierre › Seguimiento y envío al cliente**:
1. **Notificar plazo al cliente →** (EP-00 4.3; `ot.seguimiento`): exige fecha de
   compromiso (la fija el laboratorio con «Fijar fecha»); por correo, oficio, teléfono u
   otro. Hito «plazo informado».
2. **Registrar recepción → enviar al cliente** (EP-00 6.3, §5.5; `ot.seguimiento`):
   fecha (≥ fecha de la OT, no futura) con al menos un documento oficial;
   d = recepción − compromiso: d > 0 «Terminado fuera de plazo» (días de atraso),
   d ≤ 0 «Terminado dentro de plazo» (días a favor). Escribe `fecha_recep_dco`,
   `dias_atraso` y `estado_envio`.
3. **Documentos y envío** (EP-00 6.4): «＋ Documento» registra cartas, oficios en papel,
   copias, planillas o actas con Nº, copias, fecha y archivo (PDF, imagen, Word o Excel,
   5 MB); el mismo tipo y Nº crea una nueva versión (`ot.carpeta`). «Registrar envío»
   junta documentos oficiales, oficios, documentos registrados y la **factura** emitida
   (EP-06 6.18): medio, fecha, destinatario y guía; por correo adjunta los PDF. Los
   documentos sin entrega quedan entregados con el envío y la OT pasa a «Enviado al
   cliente». Si el correo no sale, no se registra un envío que no ocurrió.

**Comercial › Seguimiento y envío** (`/seguimiento`): las listas por despachar,
despachos por recibir, plazo por informar, recepción en DCO y por enviar (mismas filas
que las tarjetas de Mi bandeja).

## 3. Mi bandeja y barras de fases (T14 · BL-157, BL-158, BL-168, BL-215–BL-217)

- Cada tarjeta con pendientes trae **sus primeras 5 filas** («lo que le toca»): la OT,
  el documento, el resultado agrupado por OT, la cotización, la factura o el oficio,
  con su enlace (`rbac/bandeja-listas.ts`, mismo criterio y alcance que el conteo).
  «Ver los N →» abre la lista completa.
- Tarjetas nuevas: **OT sin plazo · Asignar plazo** (jefaturas y Planificación;
  = `/ot?semaforo=sin_fecha`), **Informes de inspección por emitir** (inspectores y
  jefaturas del BPCH), **Requerimientos técnicos por responder** (Jefe de Sucursal,
  EP-07 7.14), **Muestreos por completar o entregar** (Sección Muestreo), las del
  seguimiento (§2) y las de oficios (§4).
- **Requerimiento a la sucursal** (EP-07 7.14): el Jefe de la Sucursal que inspeccionó
  la O/C responde en la correlación («Responder → SCC»); la SCC recibe aviso.
- **Ruta de la OT del BPCH** (OT directa y Producción Nacional, BL-158): apertura →
  cabecera de inspección → lotes → resultados → Informe de Inspección → documento final
  (no aplica en Producción Nacional: el informe técnico va en la correlación) →
  **Remitir a DCO** → entrega → cierre → factura → pago.
- **Barra de fases con «Siguiente paso · Le toca a»** en la O/C de Producción Nacional
  (RAF → O/C → programa → inspecciones → planillas → correlación → informe → DCO), el
  prototipo y la clasificación (`components/bpch-procesos/BarraFases.tsx`).
- **OT › Muestras › Estado por laboratorio** (EP-02 4.2): con ensayos en más de un
  laboratorio, por muestra y laboratorio: por capturar, en revisión, aprobados.
- Pestañas **Muestreo** y **Preparación** solo en OT de laboratorio fuera del BPCH, de
  la D11 y de Metrología (la Ruta de la OT lo dice en `pestanas`).
- La OT de la D11 que no es del SAEC sigue la ruta de armas desde que nace; la
  entrega cuenta solo las armas entregables (las prohibidas no se entregan), igual que
  el cierre y el expediente SAEC.

## 4. Oficio conductor (T03 · BL-005, BL-207, BL-208)

`borrador → «Generar oficio → firmas» → en_firma → firmado → «Firmar y despachar» → despachado`
(`devuelto` vuelve a borrador corregible; se anula con motivo mientras no esté despachado).

| Paso | Quién | Pantalla y botón |
|---|---|---|
| 1 · Elaborar | Ejecutivo (cotización a Ejército y FF.AA., EP-00 3.1) · Jefe de Lab o de Depto. (IVC, Informe Técnico, Rechazo, EP-05 7.2); `oficio.crear` | «Generar oficio →» en la cotización u «Oficio conductor…» en el documento → `/oficios/nuevo`: destinatario, materia, texto, distribución |
| 2 · V°B° | Jefe del Departamento de la unidad emisora (matriz OFICIO) | `/oficios/<id>` «Dar V°B° → Dirección» / «Devolver» |
| 3 · Firma | Director (matriz OFICIO) | «Firmar →» / «Devolver» |
| 4 · Despacho | Oficina de partes (`oficio.despachar`: Director, Subdirector) | «Firmar y despachar»: Nº y fecha de despacho (EP-00 3.3) |

- Número al enviarlo a firmas con la **numeración de documentos** (tipo OFICIO); regla
  general por unidad `OF-{LAB}-{AAAA}-{N:4}` (**por confirmar**), editable en
  Administración › Numeración de documentos. Se conserva al corregir y reenviar.
- Unidad emisora: DCO para la cotización; la del documento para la OT.
- PDF/A del oficio con firmas, estado y código (`GET /oficios/:id/pdf`).
- **Oficio exigido**: con el parámetro `oficio_conductor`, un documento de los tipos y
  departamentos marcados (por defecto IVC, Informe Técnico y Rechazo del DSA) no se
  entrega ni se despacha al cliente sin un oficio firmado que lo conduzca (409).
- Laboratorio › **Oficios conductores** (`/oficios`): todos, por firmar, por despachar.

## 5. Reportes de gestión y carpeta de trabajo (T23 · BL-174, BL-175)

**Reportes › Gestión** (`reporte.ver`, acotado al alcance): OT por laboratorio y
estado; plazos por laboratorio (cerradas, dentro/fuera, % dentro, ciclo y atraso
promedio —con la recepción en DCO si existe—, vencidas abiertas); facturación por
centro de costo (neto, total, pagado, saldo); OT sin cobro valorizadas; encuestas por
laboratorio; trazabilidad cotización → OT → factura. **⬇ Excel** descarga un .xlsx con
una hoja por sección (`common/xlsx-escritura.ts`, sin dependencias). El exportador suma
la entidad **factura** (solo con `factura.ver`).

**OT › Carpeta de trabajo** (EP-05 9.3, LVM-PG01-IT05, contrato §4.6.2): informes y
certificados con todas sus versiones (también devueltos y anulados) y su PDF, oficios,
formularios del trabajo y adjuntos, documentos no-informe con versión, muestreos,
órdenes internas, fotos, costos reales y envíos. Con la OT cerrada, **Archivar → fin**
(`ot.carpeta`) registra quién, cuándo y la ubicación física (una vez).

## 6. Permisos nuevos

| Permiso | Roles |
|---|---|
| `certificado.despachar` | Jefe de Lab, de Sección y de Depto., Director, Subdirector |
| `ot.seguimiento` | Comercial, Planificación, jefaturas, Director, Subdirector |
| `ot.carpeta` | Analista, Técnico, Revisor, Metrólogo, Inspector, jefaturas, Planificación, Comercial, Dirección |
| `oficio.ver` | Comercial, Planificación, jefaturas, Dirección, Lector (y la cascada del cierre) |
| `oficio.crear` | Comercial, jefaturas, Director, Subdirector |
| `oficio.despachar` | Director, Subdirector |

Firmar y devolver un oficio no llevan permiso: los autoriza la matriz OFICIO.

## 7. Por confirmar con el IDIC

| Valor por defecto | Dónde se cambia | Pregunta |
|---|---|---|
| «Por vencer» = 3 días antes del compromiso (Sistema Comercial: 4) | Parámetros › Avisos | EP-00 §10 P9 |
| No se avisa al cliente un No cumple / Contaminado | Parámetros › Avisos | EP-02 P7 (DQO-07) |
| Oficio exigido: IVC, Informe Técnico y Rechazo, solo en el DSA | Parámetros › Oficio conductor | EP-05 7.2 (LEM «¿se requiere oficio?») |
| Formato del Nº de oficio `OF-{LAB}-{AAAA}-{N:4}`, por unidad y año | Administración › Numeración | EP-00 §6 «Correlativo DCO POR CONFIRMAR» |
| Oficina de partes = Director y Subdirector (`oficio.despachar`) | Administración › Roles | EP-00 3.3; EP-05 §7 «Registratura POR CONFIRMAR» |
| Destinos del despacho: DCO, laboratorio solicitante, BPCH, cliente | — | EP-01 6.3 |

## Medios de envío: una sola lista (frente f5)

El medio del envío conjunto (Seguimiento y envío), de la entrega de un documento
(panel del documento), del envío de la cotización y de la entrega de Metrología
(certificado, informe técnico y certificado externo) sale de **Parámetros del
sistema › `medio_envio`**. Antes cada pantalla y cada endpoint tenía su lista en el
código y el parámetro solo tenía correo, mano, courier y fax.

- `align_f5_correcciones.sql` da de alta en el parámetro todos los códigos que ya se
  guardaban (correo, mano, courier, oficio, oficina_partes, libro, plataforma, otro):
  lo guardado sigue siendo válido y se muestra con su texto, también lo inactivo
  (fax). Se retira el CHECK `ck_ot_envio_medio`, que fijaba la lista en la base.
- La API (`apps/api/src/common/medios-envio.ts`) acepta solo un medio activo de la
  lista. En Parámetros, un medio no se borra ni cambia de código (se desactiva), y
  «correo» no se desactiva: es el que envía los PDF.
- El aviso de plazo al cliente (correo, oficio, teléfono, otro) no es un medio de
  envío de documentos y conserva su lista.
