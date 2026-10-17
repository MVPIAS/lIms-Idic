# Del resultado aprobado al informe firmado, el cierre y la factura · LIMS IDIC

Tramo final del flujo estándar: **Aprobación → Informe/Certificado → Firma según
la matriz → Entrega → Cierre de la OT → Facturación → Pago**.

- SQL: `packages/db/align_firma_cierre.sql` (aditivo e idempotente, último de `ORDEN_SQL.txt`).
- Reglas puras con pruebas: `apps/api/src/plantilla-render/reglas-emision.ts`,
  `apps/api/src/ot/plazos.ts`, `apps/api/src/facturacion/reglas-factura.ts` (`*.spec.ts` al lado).

## 1. Emisión con condiciones

`POST /informes/emitir { otId, plantillaId, tipoDocumento? }` (`certificado.emitir`, y la OT
dentro del alcance por laboratorio del usuario) solo emite si se cumple **todo**:

1. **Todos los resultados de la OT aprobados** (`resultado.estado = 'aprobado'`, sin
   contar los borrados). Sin resultados no se emite, salvo la plantilla de informe técnico.
2. **Control de calidad** aprobado (el gate que ya existía, `QcService.verificarGate`).
3. **Laboratorio responsable** (`orden_trabajo.unidad_principal`): sin él no se sabe quién firma.
4. **Matriz de firmas** con reglas para el tipo de documento y al menos un responsable en
   cada paso obligatorio (un paso opcional sin responsables se omite).
5. Que no haya ya un documento **vigente** (en firma u oficial) de la misma plantilla en la OT.

Si algo falla responde **409** con la lista de lo que falta (p. ej. «Faltan resultados por
aprobar: 2 de 5 (1 capturado (sin revisar), 1 revisado, sin aprobar). Pendientes: M-001 · pH…»).
`POST /informes/condiciones` devuelve lo mismo **sin escribir nada** (`puedeEmitir`,
`faltantes[]`, `pasos[]` con sus responsables): es lo que usa la pantalla para avisar antes.

Tipo de documento de la matriz (decide quién firma), por este orden
(`reglas-emision.ts · tipoDocumentoPorDefecto`):

1. el que indica quien emite (`CERTIFICADO_CALIBRACION`, `INFORME_INSPECCION`…);
2. el propio de la plantilla si es de tipo específico (IVC → `IVC`; I.TECNICO → `INFORME_TECNICO`);
3. el de la **unidad de la OT** (`unidad.tipo_documento_defecto`, heredado por la rama):
   el Banco de Pruebas de Chile, sus sucursales y la Delegación Nº 11 → `INFORME_INSPECCION`
   (align_correcciones_manuales.sql; se cambia por unidad con SQL, sin tocar código);
4. el de la plantilla (I.ENSAYO / CERTIFICADO / PLANILLA / BOLETIN / OTRO → `INFORME_ENSAYO`).

`POST /informes/condiciones` devuelve además `tipoDocumentoOrigen` (`indicado | plantilla | unidad`)
y `tipoDocumentoUnidad`, y la pantalla lo muestra. Si un paso obligatorio de la matriz no tiene
responsables, el mensaje dice cuál, en qué unidad y las salidas: «Paso 1 de la matriz de «Informe
de ensayo» (revisa · Analista revisor): nadie tiene el rol «Analista revisor» en SSTGO. Para
resolverlo: asigne ese rol a una persona de SSTGO (Administración › Usuarios), o cree una regla
propia para SSTGO en Administración › Matriz de firmas, o emita con otro tipo de documento.»

**OT interna** (`origen_trabajo = OT_INTERNA`): no firma el Jefe de Departamento; los pasos
`OFICIALIZA` de la matriz se omiten y `condiciones` los devuelve en `pasosOmitidos` con el
motivo. Contenido del informe, modalidad (cumplimiento / solo resultados), formato por
plantilla, fotos y portada del IVC: `FLUJO_INFORME_ENSAYO.md`.

**Reapertura de un resultado aprobado** (docs/FLUJO_LABORATORIO.md §4): anula los documentos en
firma u oficiales de la OT con el motivo; tras aprobar de nuevo se **reemiten** (nueva versión).

## 2. Circuito de firma

Al emitir, el documento (tabla `certificado`) queda **`en_firma`** y se guardan sus pasos en
`documento_firma`, con los responsables que resolvió la matriz (`GET /firmas-matriz/resolver`):
titular y subrogante de la jefatura y quienes tienen el rol asignado en la unidad.

```
en_firma ──firma el último paso──► oficial ──anular (motivo)──► anulado
    │                                                             ▲
    └──devolver (motivo)──► devuelto ──reemitir (nueva versión)───┘ (la versión devuelta se anula)
```

- **Quién firma**: solo un responsable del **paso actual** (el pendiente de menor orden; pasos
  con el mismo orden se firman en paralelo). Nadie se adelanta. **Separación de funciones**:
  quien ya firmó un paso del documento no firma otro, salvo que sea el único responsable
  posible de ese paso (si no, el documento quedaría bloqueado).
- `POST /informes/:id/firmar` y `/devolver { motivo }`: sin `@RequierePermiso`; la autorización
  es la matriz (403 con el nombre de quien debe firmar). `documento.firmar` solo gobierna el menú.
- Registro de cada firma: quién, cuándo, cargo/grado, vía (titular / subrogante / asignación),
  **imagen de firma congelada** (copia de la registrada en ese momento) y
  `hash_firma = sha256(hash del documento | paso | usuario | instante)`.
- **Oficial**: al firmar el último paso, `estado = 'oficial'` y `oficial_at`. El documento sellado
  (`documento_html`, su SHA-256 y su número) no se modifica nunca: el CRUD genérico
  `/certificados` quedó de **solo lectura** (crear, editar y borrar → 400).
- **PDF / HTML** (`GET /informes/:id/pdf|html`): muestran las firmas (nombre, cargo, acción,
  fecha e imagen) en el lugar del bloque de firmas de la plantilla, fuera de lo sellado. Si el
  documento no es oficial llevan la marca «EN FIRMA» / «DEVUELTO» / «ANULADO» y el aviso de
  que no tiene validez.
- **Verificación pública** (`GET /informes/verificar/:codigo`): `valido: true` solo si es oficial
  (o `emitido`, documentos previos al circuito) y el hash cuadra.
- **Anular** (`POST /informes/:id/anular { motivo }`, `certificado.anular`): desde en firma,
  devuelto u oficial. **Reemitir** (`POST /informes/:id/reemitir`, `certificado.emitir`): desde
  devuelto o anulado; vuelve a pasar por las condiciones, conserva el número con sufijo
  (`CERT-2026-0007-V2`, no consume correlativo) y anula la versión devuelta.
- `GET /informes/por-firmar`: documentos cuyo paso actual tiene al usuario como responsable
  (tarjeta «Documentos por firmar» de Mi bandeja). `GET /informes/documentos?otId&estado`
  (`estado=por_entregar` = oficiales sin entrega) y `GET /informes/:id/circuito` (pasos y
  `puedo{ firmar, anular, reemitir, entregar }` del usuario).
- Documentos `emitido` (anteriores al circuito): se tratan como oficiales y no tienen pasos.

### Imagen de firma

`GET|PUT|DELETE /mi-firma` (cualquier autenticado, la suya): PNG o JPEG de hasta 70 KB,
validado por sus bytes, guardado en `firma.imagen_data`. Cargar la de otro usuario:
`PUT /mi-firma/usuario/:id` (`admin.usuarios`). El listado `/firmas` ya no entrega imágenes
(solo `tieneImagen`).

## 3. Entrega

`POST /informes/:id/entregar { fecha?, medio, destinatario, observacion? }`
(`certificado.entregar`): solo documentos oficiales y una sola vez. Medios: mano, correo,
oficina_partes, courier, plataforma, otro.

`POST /informes/:id/enviar-correo { destinatarios, mensaje? }`: envía el PDF oficial con la
configuración SMTP del tenant (la misma de Mensajería) y lo deja en la bitácora
`correo_enviado` (tipo `informe`). Si sale bien y no había entrega, la registra (medio
«correo»); si el SMTP no está operativo responde `{ ok: false, error }` y no registra nada.

## 4. Fecha de compromiso y plazos

- `cotizacion.plazo_entrega_dias` (nuevo): plazo comprometido con el cliente, en días corridos.
  Se informa en la cotización («Plazo de entrega (días corridos)», campo `plazoEntregaDias`
  de `POST/PATCH /cotizaciones`, 1 a 730); vacío = la fecha la fija Planificación.
- Al crear la OT o enlazarle la cotización, el disparador `trg_ot_fecha_compromiso` fija
  `fecha_compromiso = fecha de recepción + plazo` (origen `cotizacion`).
- `PUT /ot/:id/fecha-compromiso { fecha, motivo? }` (`ot.planificar`: Planificación y
  jefaturas): origen `manual`; no puede ser anterior a la recepción (o al alta) de la OT; el
  cambio y su motivo quedan en las notas de la OT.
- **Semáforo** (OT no cerradas ni anuladas, día de Chile): vencida (fecha < hoy) · por vencer
  (hoy a +3 días) · en plazo · sin fecha. `GET /ot?semaforo=&listasCierre=1&unidad=`
  (lista paginada) y `GET /ot/plazos` (con el semáforo calculado) sirven la lista filtrada; la lista de OT muestra la columna «Plazo» y las tarjetas «OT
  vencidas / por vencer / listas para cerrar» de Mi bandeja cuentan y filtran igual.

## 5. Cierre de la OT

`GET /ot/:id/cierre` (plazo, documentos, resultados, factura, `faltantes[]`, `puedeCerrar`) y
`POST /ot/:id/cerrar` (`ot.cerrar`: jefaturas, Dirección y ahora **Planificación**). Se cierra
cuando:

- todos los resultados están aprobados;
- hay al menos un documento vigente y **todos** los vigentes están **oficiales y entregados**;
- no queda ningún documento devuelto sin resolver.

Si no, 409 con lo que falta. El cierre recorre la máquina de estados existente
(`common/estados.ts`) hasta `cerrada` (p. ej. recepcionada → en_analisis → validacion →
finalizada → cerrada), fija `fecha_cierre` y `cerrada_por`, con la fila bloqueada. El PATCH
genérico `/ot/:id` ya **no** acepta `estado: 'cerrada'`.

## 6. Facturación al cerrar

Si la OT es con cobro (`orden_trabajo.con_cobro`), el cierre crea en la misma transacción una
factura **`pendiente`** (número provisional `PEND-<OT>`, origen `cierre_ot`, una sola por OT):

- líneas de la cotización **aceptada** + descuento y gastos administrativos globales + un
  ajuste si quedara diferencia: la suma es exactamente el neto aceptado;
- moneda, IVA y centro de costo de la cotización (o de la OT);
- sin cotización aceptada nace sin líneas y Finanzas las completa.

Finanzas la ve en «Pendientes de facturar» (Mi bandeja y `/facturas?estado=pendiente`), puede
corregir las líneas (`PUT /facturas/:id/lineas`, solo pendientes) y la **emite** con el folio
real (`POST /facturas/:id/emitir { numero, fechaEmision? }`, `factura.emitir`).

Pagos (`POST /pagos`, `factura.cobrar`): solo a facturas emitidas o con pago parcial y sin
superar el saldo; la factura pasa a **parcial** o **pagada**. Un pago no se edita: se elimina
(la factura recalcula su estado) y se registra de nuevo. Una factura con pagos no se anula
(nota de crédito). El estado ya no se cambia a mano salvo para anular.

## 7. Permisos nuevos (align_firma_cierre.sql)

| Permiso | Roles |
|---|---|
| `documento.firmar` (menú «Documentos por firmar») | SUPERADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB, REVISOR, ANALISTA_SR, CALIDAD, METROLOGO, INSPECTOR |
| `certificado.anular` | SUPERADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB, CALIDAD |
| `certificado.entregar` | SUPERADMIN, ADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB, PLANIFICACION, COMERCIAL, RECEPCION |
| `ot.planificar` | SUPERADMIN, ADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB, PLANIFICACION |
| `ot.cerrar` (existente) | + PLANIFICACION |

(Con los alias legados JEFELAB / JEFEDCO cuando existen.) Los permisos viajan en el token:
hay que volver a iniciar sesión para verlos.

## 8. Correcciones de base incluidas

- `factura.codigo` (NOT NULL en `schema.sql`, desconocido para Prisma) se mantiene igual a
  `numero` con un disparador, y `factura.ot_id` deja de ser obligatorio: antes **todo** alta de
  factura desde la API fallaba con 500.
- `linea_factura.cantidad` pasa de INTEGER a NUMERIC(10,2) (como en Prisma).
- El pie del PDF generaba tres páginas de más en todos los documentos.

## 9. Pendiente / fuera de este cambio

- ~~`nota_credito` arrastraba la misma deriva que `factura`~~: corregido en
  `align_correcciones_manuales.sql` (disparador `trg_nota_credito_alinear`: `codigo` = `numero`,
  `tenant_id` de la factura).
- El envío por correo depende de que el SMTP del tenant esté configurado (`/config-correo`).
