# Integración con el software de armas del BPCH

Integración **asíncrona** entre el LIMS y el software de certificación de armamento del
BPCH (inspección y ensayos balísticos, visaciones, firma electrónica avanzada con OTP en su
gestor documental, cobro y cierre). Cada sistema carga su información y se avisan los cambios.

Fuente: «Fases o etapas proceso de certificaciones armamento BPCH Apis.pdf», «Diagrama
estados.pdf» y «Entidad-Relacion DB.pdf» (IDIC, 24-11-2026) y la reunión con el BPCH del
24-11-2026.

**Acuerdos de la reunión (24-11-2026):**

| Tema | Acuerdo | En el LIMS |
|---|---|---|
| Sistema del BPCH | Lo mantiene el BPCH; mandará su colección Postman | Nuestra colección: `docs/postman/LIMS_IDIC_integracion_armas.postman_collection.json` (§9) |
| Origen de las OT | Las OT **solo nacen en el LIMS**; no se importan OT del BPCH ni se migra histórico | Solo existe el envío LIMS → BPCH |
| Tipos de orden | Solo 1 (persona natural) y 2 (empresa); el BPCH definirá los demás | `tipo_orden` 1 o 2 |
| Persona natural | Va a la oficina y quien recepciona crea la OT en el LIMS; la **Delegación Nº 11 es la mantenedora** de las personas naturales | §6 |
| Resolución | Viaja **dentro del mensaje** | `documentos_adjuntos[].contenido_base64` (parámetro `modo_adjunto`, §2) |
| Rechazos | Ya no vuelven a 1: estado propio «Pendiente rechazado» (código por confirmar) y **4 = Rechazado total** (terminal) | Mapa de estados configurable (§4) |
| Hora | La usan para auditoría | Se guarda tal cual (texto con desfase) y en `timestamptz` |
| Reintentos | El BPCH reenvía si no recibe acuse | Acuse inmediato, `duplicado: true`, fuera de orden (§3) |
| FEA | Los certificados se firman en el BPCH | **Sin FEA del lado LIMS**: solo enlaces de descarga (§5) |
| Certificados por arma | Misma vigencia (4 años), cuño y numeración que el LIMS | El LIMS **no** emite certificados D11 en esas OT (§7) |
| Estadísticas | El rechazo del estado 7 lo hace un rol del BPCH y nos lo informan | `GET /api/integracion/armas/estadisticas` y vista `bi_integracion_armas_fases` (§8) |
| Munición | Su sistema solo registra los disparos | `total_disparos` informativo; el descuento del lote sigue manual de la D11 |
| DGMN | Hoy nadie avisa a la DGMN; lo hará el IDIC | Rechazo total y certificado de rechazo dejan la notificación pendiente (§7) |

Código: `apps/api/src/integracion/armas/` (reglas puras en `reglas-armas.ts` con
`reglas-armas.spec.ts`; servicio, controladores, `cuerpo-crudo.ts`, `bloqueo-d11.ts`),
`apps/api/src/cliente/persona-natural*.ts`, `apps/api/src/bpch/notificacion-dgmn/`. SQL:
`packages/db/align_integracion_armas.sql`. Web: panel «Sistema de armas BPCH» en la ficha de
la OT, aviso en el paso 9 de la D11 y la notificación a DGMN. Recorrido con un BPCH simulado:
`scripts/verificacion/integracion-armas.js`.

## 1. Flujo

```
LIMS                                              Software de armas del BPCH
 │  OT creada en el LIMS (D11 o internación BPCH)
 │  ── encola ──► trabajador (cada minuto) ──── POST /api/v1/integracion/lims/ordenes-trabajo ──►  Pendiente
 │                 (resolución en base64)   ◄──── 201 {bpch_id} / 409 ya existía ─────────────────
 │
 │  ◄── aviso de estado (webhook firmado | POST directo | consulta) ──  6 Visado Delegación
 │      acuse 200 < 2 s; mismo X-Event-ID = duplicado                   7 Visado Internación (rol del BPCH)
 │                                                                      9* Pendiente rechazado (código por confirmar)
 │                                                                      5 En firma FEA (OTP)
 │                                                                      2 Firmada y en Comercial
 │  ── GET {ruta_enlaces_ot} (al recibir 2 y 8, o a pedido) ────────►   enlaces a la OT y a cada certificado
 │  ◄── aviso estado 8 + acta (PDF base64 o enlace) ──────────────────  8 OT Finalizada
 │                                                                      4 Rechazado total · 3 Anulada
```

- El LIMS **no cierra ni anula** su OT por un aviso del BPCH (pendiente del IDIC; parámetro
  `cerrar_ot_al_finalizar`, hoy solo deja constancia en el historial).
- Avisos en Mi bandeja (jefes de la unidad de la OT, Jefe de Laboratorio de la D11 y
  Comercial): devolución, rechazo total, anulación, código desconocido y envío rechazado
  (prioridad alta); firmada y finalizada (informativo). La notificación pendiente a la DGMN
  avisa además a las jefaturas del BPCH.

## 2. Salida: crear la OT en el BPCH

`POST {url_base}/api/v1/integracion/lims/ordenes-trabajo`:

| Cabecera | Valor |
|---|---|
| `Authorization` | `Bearer <BPCH_ARMAS_TOKEN>` (token que entrega el BPCH) |
| `Content-Type` | `application/json` |
| `X-Idempotency-Key` | UUID fijo por OT (el mismo en cada reintento) |

Cuerpo (datos PRUEBA):

```json
{
  "lims_ot_id": "OT-PRUEBA-0001",
  "tipo_orden": 1,
  "resolucion": { "numero": "RES-PRUEBA-0001", "fecha": "2026-11-20" },
  "solicitante": {
    "rut": "22222222",
    "email": "persona.prueba@ejemplo.cl",
    "persona": {
      "rut": "22222222", "dv": "2", "nombres": "Persona", "apellidos": "PRUEBA Uno",
      "email": "persona.prueba@ejemplo.cl", "telefono": null, "domicilio": "Calle PRUEBA 1", "comuna": "Santiago"
    }
  },
  "creador": { "rut": null },
  "cantidad_armas": 3,
  "observaciones": "Envío PRUEBA",
  "documentos_adjuntos": [
    { "nombre": "resolucion_PRUEBA.pdf", "tipo": "resolucion", "contenido_base64": "JVBERi0xLjQK..." }
  ]
}
```

| Campo | Origen en el LIMS |
|---|---|
| `lims_ot_id` | Código de la OT |
| `tipo_orden` | 2 si la OT nace de una internación del BPCH (`bpch_internacion`), si no 1. Se puede corregir al enviar |
| `resolucion` | Resolución de la internación; si la OT no la tiene, se escribe al enviar |
| `solicitante.rut` | RUT del cliente **sin puntos, guion ni DV** (parámetro `rut_con_dv`) |
| `solicitante.email` | Correo de contacto del cliente, o el de la ficha; vacío = `null` |
| `solicitante.persona` | **PROPUESTA, por confirmar con el BPCH.** Solo con `tipo_orden` = 1 y cliente persona natural: RUT y DV por separado, nombres, apellidos, email, teléfono, domicilio y comuna (los campos de su `armas_propietarios`) |
| `creador.rut` | **`null`**: el LIMS no guarda el RUT de sus usuarios (por confirmar) |
| `cantidad_armas` | Armas del listado de la resolución; si no hay, las registradas en la OT; si no, a mano |
| `documentos_adjuntos` | PDF subidos en la OT (clase «resolución»). Con `modo_adjunto` = `base64` (por defecto): `{nombre, tipo, contenido_base64}`. Con `url`: `{nombre, tipo, url_descarga}` con un enlace firmado que vence en `vigencia_enlace_horas` |

La cola guarda el mensaje sin los adjuntos; se agregan al enviar (siempre la versión vigente).

Respuesta del BPCH → qué hace el LIMS:

| HTTP | Resultado |
|---|---|
| 201 | Enviada; guarda `bpch_id` y el estado inicial |
| 409 | Ya estaba registrada: la da por enviada y toma `bpch_id` |
| 400 y otros 4xx | Error **sin reintento**; aviso con el detalle; se reintenta a mano desde la bandeja |
| 5xx, 408, 429 o sin respuesta en 10 s | Reintento con el calendario de §3 hasta `max_intentos` (12) o 48 h |

## 3. Entrada: estados del BPCH, acuse y reintentos

Las tres opciones del documento del BPCH llegan al **mismo manejador**. URL del LIMS (prefijo
global `/api`):

| Opción | Método y URL | Autenticación |
|---|---|---|
| 2 · Webhook (recomendada) | `POST /api/v1/integracion/bpch/webhook` | Sin sesión, **firma obligatoria**: `X-BPCH-Signature: sha256=<HMAC-SHA256 del cuerpo crudo con BPCH_ARMAS_HMAC_SECRET>`; `X-Event-ID` |
| 1 · POST directo | `POST /api/v1/integracion/bpch/estado` | `Authorization: Bearer <token de integración del LIMS>` (Administración › API e integración), rol con `integracion.armas.estado`; `X-Event-ID` opcional |
| 3 · Consulta | El LIMS llama `GET {url_base}/api/v1/integracion/lims/ordenes-trabajo/{ot}/estado` cada `intervalo_pull_min` | Bearer `BPCH_ARMAS_TOKEN` |

Cuerpo aceptado (datos PRUEBA):

```json
{
  "evento_id": "evt-prueba-8",
  "ot": "OT-PRUEBA-0001",
  "estado": 8,
  "estado_descripcion": "OT Finalizada",
  "usuario_rut": "11111111",
  "fecha_cambio": "2026-11-24T16:45:00-03:00",
  "motivo": null,
  "total_certificados": 3,
  "total_disparos": 9,
  "documento_cierre": { "nombre": "Acta_PRUEBA.pdf", "tipo": "acta_finalizacion", "base64": "JVBERi0x..." },
  "url_ot": "https://armas.idic.local/ot/1289",
  "certificados": [
    { "numero_serie": "PRUEBA-001", "url": "https://armas.idic.local/certificados/1", "idFed": "FED-PRUEBA-1", "total_disparos": 3 },
    { "numero_serie": "PRUEBA-002", "url": "https://armas.idic.local/rechazos/2", "tipo": "certificado_rechazo" }
  ],
  "enlaces": [ { "tipo": "otro", "etiqueta": "Expediente", "url": "https://armas.idic.local/expedientes/1289" } ]
}
```

- Opción 1: `nuevo_estado`, `fecha_actualizacion` y `operador_rut` en lugar de `estado`,
  `fecha_cambio` y `usuario_rut`. Opción 3: además `bpch_id`.
- `estado`: cualquier código entero; lo interpreta el mapa de estados (§4).
- `fecha_cambio`: ISO 8601 con desfase. Se guarda **tal cual** (texto, para auditoría) y como
  `timestamptz` para ordenar.
- `documento_cierre`: con `base64` se guarda el PDF como documento de la OT (si
  `guardar_acta_pdf` = sí; máx. 15 MB, debe empezar por `%PDF-`); con `url` se guarda el enlace.
- `url_ot`, `enlaces[]`, `certificados[]`, `total_certificados` y `total_disparos` son
  opcionales. De un certificado solo se guarda serie + URL + `idFed` + disparos; un `base64`
  se **ignora**.

**Acuse.** El LIMS valida el cuerpo (y el acta), **guarda el evento** (normalizado, sin
base64) y responde **200**. Lo aplica dentro del mismo acuse si alcanza (≤ 1,5 s) y, si no, en
segundo plano; un trabajador reintenta cada minuto los eventos guardados que no se pudieron
aplicar. Respondemos en **menos de 2 s**.

| HTTP | Cuándo |
|---|---|
| 200 `{codigo: 200, mensaje, evento_id, procesado}` | Recibido (`procesado: false` = se aplica en segundo plano); `enlaces_rechazados` si algún enlace no pasó la validación |
| 200 `{duplicado: true}` | Ese `X-Event-ID`/`evento_id` ya se había recibido |
| 400 `{codigo, error, detalles[]}` | Cuerpo inválido o acta que no es PDF (no se guarda: corregir y reenviar) |
| 401 | Firma o token inválidos, o el LIMS sin `BPCH_ARMAS_HMAC_SECRET` |
| 403 | Token sin `integracion.armas.estado` |
| 404 | No hay en el LIMS una OT enviada con ese identificador |
| 503 | La integración está desactivada en el LIMS |

Sin `evento_id` ni `X-Event-ID` el identificador es un hash de OT, estado, fecha y motivo.

**Orden.** Un aviso con `fecha_cambio` **anterior** al último estado aplicado no retrocede el
estado: se guarda en el historial marcado `fuera_de_orden`.

**Recomendación para el BPCH (y lo que hace el LIMS con sus envíos):**

- Considerar entregado solo con una respuesta **2xx**. Esperar **10 s** como máximo.
- Si no hay 2xx: reintentar a **1 min, 5 min, 15 min, 1 h** y luego **cada 6 h hasta 48 h**,
  siempre con el **mismo `X-Event-ID`** (y el mismo cuerpo).
- Un 400 no se reintenta igual: hay que corregir el mensaje.

## 4. Mapa de estados (configurable)

Tabla `integracion_armas_estado` (código → descripción, tipo, terminal). Valores sembrados:

| Código | Descripción | Tipo | Terminal |
|---|---|---|---|
| 1 | Pendiente | en_curso | no |
| 6 | Visado Delegación | en_curso | no |
| 7 | Visado Internación | en_curso | no |
| 5 | En firma digital | en_curso | no |
| 2 | Firmada y en Comercial | firmada | no |
| 8 | OT Finalizada | finalizada | sí |
| 3 | Anulada | anulada | sí |
| 4 | Rechazado total | rechazo_total | sí |
| 9 | Pendiente rechazado — **código por confirmar con el BPCH** | rechazo | no |

Tipos: `en_curso`, `rechazo` (devolución, aviso), `rechazo_total` (aviso + DGMN), `firmada`
(aviso + pedir enlaces), `finalizada` (aviso + pedir enlaces + acta), `anulada`. Un código que
no esté en la tabla se **guarda igual** (historial marcado `estado_desconocido`) y avisa; no
falla. Compatibilidad con el primer documento: un 1 con `motivo` se trata como devolución.
Cuando el BPCH fije el código del rechazo parcial, se cambia la fila 9 (o se agrega la suya).

## 5. Enlaces del BPCH (certificados y FEA en su sistema)

- **Sin FEA del lado LIMS en esta integración**: los certificados firmados con OTP quedan en
  el BPCH y el LIMS solo guarda sus **enlaces de descarga** (no hay subida de PDF firmado ni
  llamada a FirmaGob).
- Tabla `integracion_armas_enlace` (OT, tipo `ot|certificado|certificado_rechazo|acta|otro`,
  etiqueta, serie, id externo/FED, URL, disparos, vigente) e
  `integracion_armas_ot.url_ot_externa`.
- **Validación:** solo `http`/`https`, sin usuario ni contraseña y con servidor en
  `hosts_permitidos` (vacío = el servidor de `url_base`). Un servidor sin puerto vale con
  cualquier puerto; con puerto, solo ese. Los que no pasan se descartan (`enlaces_rechazados`).
  La ficha vuelve a filtrar con la lista vigente y abre cada enlace en una pestaña nueva.
- **Pedirlos al BPCH — ruta POR CONFIRMAR con el BPCH:** `GET {url_base}{ruta_enlaces_ot}`
  con `{ot}` o `{bpch_id}` (ej. `/api/v1/integracion/lims/ordenes-trabajo/{bpch_id}/enlaces`),
  Bearer, **sin seguir redirecciones**. Se llama al recibir 2 y 8 y con «Actualizar enlaces».
  Respuesta esperada (propuesta): el mismo formato `url_ot` / `enlaces[]` / `certificados[]`.

## 6. Persona natural (la mantiene la Delegación Nº 11)

Hasta ahora el cliente del LIMS era siempre empresa (razón social). La persona natural
(armas usadas) va a la oficina y quien recepciona crea la OT en el LIMS; la **D11 es la
mantenedora** de estas personas:

- `cliente.es_persona_natural`, `nombres`, `apellidos` (la razón social es «nombres
  apellidos»), tipo de cliente «persona_natural».
- API `GET/POST/PATCH /api/clientes/personas-naturales` con permiso
  `cliente.persona_natural.gestionar` y ámbito D11 (SUPERADMIN, ADMIN, JEFE_LAB, ANALISTA,
  TECNICO, INSPECTOR y RECEPCION, acotados a la Delegación Nº 11). No duplica un RUT; una
  empresa con ese RUT no se convierte en persona natural. (Sin pantalla propia todavía.)
- En el envío va el bloque **propuesto** `solicitante.persona` (§2).

## 7. Certificados D11, munición y DGMN

- **Certificados por arma:** misma vigencia (4 años), cuño y numeración en ambos sistemas.
  Para no duplicar la numeración, en una OT enviada al software de armas el LIMS **no emite**
  sus certificados D11: el paso 9 de *Certificación de armas* muestra el motivo y la API
  responde 409. **Por acordar: quién lleva el correlativo** (el BPCH, el LIMS o un rango
  reservado para cada uno).
- **Munición:** el BPCH informa `total_disparos` por OT y por certificado; se muestra en el
  panel. **Por definir:** el descuento del lote de munición en el inventario sigue siendo
  manual de la D11 (no se descuenta desde el aviso porque el BPCH no informa el lote).
- **DGMN:** hoy nadie avisa a la DGMN. Un **rechazo total** (tipo `rechazo_total`) o un
  **certificado de rechazo** (enlace `certificado_rechazo`) dejan en `bpch_notificacion_dgmn`
  una notificación **pendiente** (origen `integracion_armas`, con el motivo y el enlace) y un
  aviso en Mi bandeja. No se envía ningún correo: la Subdirección BPCH la registra (medio,
  oficio firmado por el Director, fecha, copia al internador) en «Notificación a DGMN» de la
  OT (`POST /api/bpch/notificacion-dgmn/ot/:otId/integracion/:id`). Mientras esté pendiente la
  OT no se cierra.

## 8. Estadísticas

`GET /api/integracion/armas/estadisticas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&tipo_orden=1|2`
(filtra por la fecha de envío de la OT):

- `totales`: OT, OT con devolución y OT con rechazo total;
- `porEstado`: OT por estado actual (con su tipo);
- `fases`: veces, horas promedio y mediana en cada estado (del historial, sin los avisos
  fuera de orden);
- `rechazos`: por etapa previa (p. ej. 7 Visado Internación, que rechaza un rol del BPCH) y
  motivo.

Vista para Metabase: `bi_integracion_armas_fases` (OT, tipo de orden, estado, tipo, inicio,
fin, horas, motivo).

## 9. Colección Postman

`docs/postman/LIMS_IDIC_integracion_armas.postman_collection.json` (v2.1; se regenera con
`node scripts/postman/generar-coleccion-armas.js`). Variables **vacías**: `lims_url`, `token`,
`hmac_secret` y `token_adjunto` (se completan por canal seguro). El webhook trae un script
previo que calcula `X-BPCH-Signature` (HMAC-SHA256 del cuerpo exacto) y un `X-Event-ID`
nuevo; «Reenvío con el mismo X-Event-ID» comprueba el `duplicado: true`. Ejemplos PRUEBA de
todos los estados, enlaces, certificado de rechazo, rechazo total y acta.

## 9 bis. Catálogo de APIs y documentación adjunta

- En **Administración › API e integración › Documentación de la API**, todas las rutas de esta
  integración (las que llama el BPCH y las internas) forman el módulo
  **«Integración · Sistema de certificación de armas BPCH»** (`segmentoDe` en
  `apps/api/src/integracion/openapi.ts`).
- En la pestaña **«Documentos de integraciones»** se descargan el documento funcional, la
  especificación técnica, la colección Postman y esta guía (`GET /api/integracion/documentacion`
  y `GET /api/integracion/documentacion/:grupo/:archivo`, permiso `integracion.documentacion`;
  lista cerrada en `apps/api/src/integracion/documentacion-integracion.ts`, archivos en
  `apps/api/documentacion/integracion-armas-bpch/`). Al cambiar un documento, reemplace el
  archivo en esa carpeta con el mismo nombre.

## 10. Rutas internas del LIMS

Permiso `integracion.armas.gestionar`, ámbito BPCH (incluye la D11) o DCO.

| Método y URL | Para qué |
|---|---|
| `GET /api/integracion/armas/bandeja?estado=&limite=` | Envíos y avisos recientes, mapa de estados y configuración (sin secretos) |
| `GET /api/integracion/armas/estadisticas` | §8 |
| `GET /api/integracion/armas/ot/:otId` | Estado externo, historial, envíos, enlaces, adjuntos y notificaciones a la DGMN |
| `POST /api/integracion/armas/ot/:otId/previsualizar` | JSON que se enviaría y lo que falta (el base64 se resume) |
| `POST /api/integracion/armas/ot/:otId/enviar` | Encolar el envío (cuerpo opcional para completar datos) |
| `POST /api/integracion/armas/ot/:otId/adjuntos` | Subir la resolución en PDF (multipart `archivo`) |
| `GET /api/integracion/armas/ot/:otId/adjuntos/:id` | Descargar la resolución o el acta |
| `POST /api/integracion/armas/ot/:otId/enlaces` | Pedir ahora los enlaces al BPCH |
| `POST /api/integracion/armas/envios/:id/reintentar` | Reintentar un envío en error (nueva ventana de 48 h) |
| `POST /api/integracion/armas/procesar` | Enviar lo pendiente y consultar estados ya |
| `GET /api/v1/integracion/bpch/adjuntos/:token` | (Lo usa el BPCH con `modo_adjunto` = url) descarga por enlace firmado |

## 11. Configuración

**Variables de entorno** (nunca en la base ni en documentos):

| Variable | Para qué |
|---|---|
| `BPCH_ARMAS_TOKEN` | Token que entrega el BPCH para llamar a su API |
| `BPCH_ARMAS_HMAC_SECRET` | Clave compartida de la firma del webhook |
| `LIMS_URL_INTEGRACION` | Dirección del LIMS que el BPCH alcanza (enlaces de descarga). Si falta: `https://<DOMAIN>` o el primer origen de `CORS_ORIGINS` |
| `INTEGRACION_ARMAS_TRABAJADOR=false` | Apaga los trabajadores de envío, eventos y consulta en esa instancia |

**Parámetros del sistema › «Integración con el software de armas del BPCH»**
(`integracion_armas`): `activa` (no), `url_base`, `modo_retorno` (webhook | post | pull),
`modo_adjunto` (base64 | url; base64), `enviar_automatico` (no), `unidades` (D11,BPCH),
`max_intentos` (12), `intervalo_pull_min` (15), `rut_con_dv` (no), `vigencia_enlace_horas`
(72), `cerrar_ot_al_finalizar` (no), `hosts_permitidos` (vacío = servidor de `url_base`),
`ruta_enlaces_ot` (vacío = no se piden), `guardar_acta_pdf` (sí). El mapa de estados está en
la tabla `integracion_armas_estado`.

El cuerpo de `/api/v1/integracion/bpch/*` lo lee `cuerpo-crudo.ts` (antes de los lectores de
Nest y solo para ese prefijo) para conservar el cuerpo crudo de la firma y admitir hasta
40 MB; el resto de la API sigue con el tope estándar.

## 12. Por confirmar con el BPCH / IDIC

1. Código del estado «Pendiente rechazado» (hoy 9 provisional) y los demás tipos de orden.
2. RUT con o sin dígito verificador (su ejemplo va sin él) y su código de validación de RUT.
3. Bloque `solicitante.persona` (propuesta) y si validan contra `armas_propietarios`.
4. `creador.rut`: el LIMS no guarda el RUT de sus usuarios.
5. Ruta y formato de la API de **enlaces**, y si sus enlaces piden sesión al abrirlos.
6. Servidor, puerto y certificado HTTPS del BPCH en la red del IDIC (`url_base`, `hosts_permitidos`).
7. Modo de retorno que implementan y entrega del token y la clave HMAC (canal seguro).
8. Qué OT se envían y si el envío es automático al crear la OT.
9. Si el LIMS cierra su OT con el 8 y la anula con el 3 o el 4.
10. **Quién lleva el correlativo** de los certificados por arma.
11. Descuento del lote de munición a partir de los disparos (hoy manual de la D11).
12. Modelo de oficio y responsable de la notificación a la DGMN.
