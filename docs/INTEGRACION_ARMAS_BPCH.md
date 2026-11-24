# Integración con el software de armas del BPCH

Integración **asíncrona** entre el LIMS y el software de certificación de armamento del
BPCH (inspección y ensayos balísticos, visaciones, firma electrónica avanzada con OTP en su
gestor documental, cobro y cierre). Cada sistema carga su información y se avisan los cambios.

Fuente: «Fases o etapas proceso de certificaciones armamento BPCH Apis.pdf», «Diagrama
estados.pdf» y «Entidad-Relacion DB.pdf» (IDIC, 24-11-2026) y la reunión con el BPCH del
24-11-2026.

**Decisión de la reunión:** los certificados por arma **se quedan en el aplicativo del
BPCH**. El LIMS no guarda sus PDF: guarda **enlaces** y los muestra en la ficha de la OT.

Código: `apps/api/src/integracion/armas/` (reglas puras en `reglas-armas.ts` con
`reglas-armas.spec.ts`; servicio y controladores; `cuerpo-crudo.ts`). SQL:
`packages/db/align_integracion_armas.sql`. Web: panel «Sistema de armas BPCH» en la ficha de
la OT (`apps/web/components/bpch-procesos/SistemaArmasBpchOt.tsx`). Recorrido:
`scripts/verificacion/integracion-armas.js` (con un BPCH simulado).

## 1. Flujo

```
LIMS                                              Software de armas del BPCH
 │  OT de la D11/BPCH (internación o delegación)
 │  ── encola ──► trabajador (cada minuto) ──── POST /api/v1/integracion/lims/ordenes-trabajo ──►  Estado 1 Pendiente
 │                                         ◄──── 201 {bpch_id} / 409 ya existía ─────────────────
 │                                         ◄──── GET resolución (enlace firmado, sin sesión) ────
 │
 │  ◄── aviso de estado (webhook firmado | POST directo | consulta) ──  6 Visado Delegación
 │                                                                      7 Visado Internación
 │                                                                      5 En firma FEA (OTP)
 │                                                                      2 Firmada y en Comercial
 │  ── GET {ruta_enlaces_ot} (al recibir 2 y 8, o a pedido) ────────►   enlaces a la OT y a cada certificado
 │  ◄── aviso estado 8 + acta (PDF base64 o enlace) ──────────────────  8 OT Finalizada
 │                                                                      3 Anulada · 1 + motivo = devuelta
```

- El LIMS **no cierra ni anula** su OT por un aviso del BPCH (pendiente del IDIC; parámetro
  `cerrar_ot_al_finalizar`, hoy solo deja constancia en el historial).
- Devolución (1 con motivo), anulación y envío rechazado → aviso **de prioridad alta** en Mi
  bandeja a los jefes de la unidad de la OT, al Jefe de Laboratorio de la D11 y a Comercial.
  Firmada (2) y finalizada (8) → aviso informativo a los mismos.

## 2. Salida: crear la OT en el BPCH

`POST {url_base}/api/v1/integracion/lims/ordenes-trabajo` con:

| Cabecera | Valor |
|---|---|
| `Authorization` | `Bearer <BPCH_ARMAS_TOKEN>` (token que entrega el BPCH) |
| `Content-Type` | `application/json` |
| `X-Idempotency-Key` | UUID fijo por OT (el mismo en cada reintento) |

Cuerpo (datos PRUEBA):

```json
{
  "lims_ot_id": "OT-PRUEBA-0001",
  "tipo_orden": 2,
  "resolucion": { "numero": "RES-PRUEBA-0001", "fecha": "2026-11-20" },
  "solicitante": { "rut": "11111111", "email": "prueba@ejemplo.cl" },
  "creador": { "rut": null },
  "cantidad_armas": 3,
  "observaciones": "Envío PRUEBA",
  "documentos_adjuntos": [
    { "nombre": "resolucion_PRUEBA.pdf", "url_descarga": "https://<LIMS>/api/v1/integracion/bpch/adjuntos/<enlace firmado>" }
  ]
}
```

De dónde sale cada campo:

| Campo | Origen en el LIMS |
|---|---|
| `lims_ot_id` | Código de la OT |
| `tipo_orden` | 2 si la OT nace de una internación del BPCH (`bpch_internacion`), si no 1. Se puede corregir al enviar |
| `resolucion` | Resolución de la internación; si la OT no la tiene, se escribe al enviar |
| `solicitante.rut` | RUT del cliente **sin puntos, guion ni DV** (parámetro `rut_con_dv`) |
| `solicitante.email` | Correo de contacto del cliente, o el de la ficha; vacío = `null` |
| `creador.rut` | **`null`**: el LIMS no guarda el RUT de sus usuarios (por confirmar) |
| `cantidad_armas` | Armas del listado de la resolución; si no hay, las registradas en la OT; si no, a mano |
| `documentos_adjuntos` | PDF que se suban en la OT (clase «resolución») con un enlace firmado que vence en `vigencia_enlace_horas` |

Respuesta del BPCH → qué hace el LIMS:

| HTTP | Resultado |
|---|---|
| 201 | Enviada; guarda `bpch_id` y el estado inicial |
| 409 | Ya estaba registrada: la da por enviada y toma `bpch_id` |
| 400 y otros 4xx | Error **sin reintento**; aviso con el detalle; se reintenta a mano desde la bandeja |
| 5xx, 408, 429 o sin respuesta | Reintento con espera exponencial (1, 2, 4… min, tope 6 h) hasta `max_intentos` |

## 3. Entrada: estados del BPCH

Las tres opciones del documento del BPCH llegan al **mismo manejador**. URL del LIMS (prefijo
global `/api`):

| Opción | Método y URL | Autenticación |
|---|---|---|
| 2 · Webhook (recomendada) | `POST /api/v1/integracion/bpch/webhook` | Sin sesión, **firma obligatoria**: `X-BPCH-Signature: sha256=<HMAC-SHA256 del cuerpo crudo con BPCH_ARMAS_HMAC_SECRET>`; `X-Event-ID` para no procesar dos veces |
| 1 · POST directo | `POST /api/v1/integracion/bpch/estado` | `Authorization: Bearer <token de integración del LIMS>` (Administración › API e integración), con un rol que tenga `integracion.armas.estado` |
| 3 · Consulta | El LIMS llama `GET {url_base}/api/v1/integracion/lims/ordenes-trabajo/{ot}/estado` cada `intervalo_pull_min` | Bearer `BPCH_ARMAS_TOKEN` |

Cuerpo aceptado (cualquiera de las dos formas del documento; datos PRUEBA):

```json
{
  "evento_id": "evt-prueba-8",
  "ot": "OT-PRUEBA-0001",
  "estado": 8,
  "estado_descripcion": "OT Finalizada",
  "usuario_rut": "11111111",
  "fecha_cambio": "2026-11-23T16:45:00-03:00",
  "motivo": null,
  "total_certificados": 3,
  "documento_cierre": { "nombre": "Acta_PRUEBA.pdf", "tipo": "acta_finalizacion", "base64": "JVBERi0x..." },
  "url_ot": "https://armas.idic.local/ot/1289",
  "certificados": [ { "numero_serie": "PRUEBA-001", "url": "https://armas.idic.local/certificados/1", "idFed": "FED-PRUEBA-1" } ],
  "enlaces": [ { "tipo": "otro", "etiqueta": "Expediente", "url": "https://armas.idic.local/expedientes/1289" } ]
}
```

- Opción 1: `nuevo_estado`, `fecha_actualizacion` y `operador_rut` en lugar de `estado`,
  `fecha_cambio` y `usuario_rut`. Opción 3: además `bpch_id`.
- `documento_cierre`: con `base64` se guarda el PDF como documento de la OT (si
  `guardar_acta_pdf` = sí; máx. 15 MB, debe empezar por `%PDF-`); con `url` se guarda el enlace.
- `url_ot`, `enlaces[]` y `certificados[]` son **opcionales**. De un certificado solo se
  guarda `numero_serie` + `url` + `idFed`; si trae `base64`, **se ignora**.
- El evento se guarda **sin los base64** (se reemplazan por tamaño y SHA-256).

Respuestas del LIMS:

| HTTP | Cuándo |
|---|---|
| 200 `{codigo: 200, mensaje, evento_id}` | Procesado; `enlaces_rechazados` si algún enlace no pasó la validación |
| 200 `{duplicado: true}` | Ese `X-Event-ID`/`evento_id` ya se había procesado |
| 400 `{codigo, error, detalles[]}` | Cuerpo inválido o acta que no es PDF (el evento no queda registrado: se puede reenviar) |
| 401 | Firma o token inválidos, o el LIMS sin `BPCH_ARMAS_HMAC_SECRET` |
| 404 | No hay en el LIMS una OT enviada con ese identificador |
| 503 | La integración está desactivada en el LIMS |

Sin `evento_id` ni `X-Event-ID` (opción 1 y consultas) el identificador es un hash de OT,
estado, fecha y motivo. Un aviso con fecha anterior al último estado guardado se registra en
el historial pero no pisa el estado vigente.

## 4. Enlaces del BPCH (certificados en su aplicativo)

- Tabla `integracion_armas_enlace` (OT, tipo `ot|certificado|acta|otro`, etiqueta, serie,
  id externo/FED, URL, vigente) y `integracion_armas_ot.url_ot_externa`.
- **Validación:** solo `http`/`https`, sin usuario ni contraseña en la URL y con servidor en
  `hosts_permitidos` (vacío = el servidor de `url_base`). Un servidor escrito sin puerto vale
  con cualquier puerto; con puerto, solo ese. Los enlaces que no pasan se descartan (se
  informan en `enlaces_rechazados` y en el evento). La ficha vuelve a filtrar con la lista
  vigente y abre cada enlace en una pestaña nueva (`noopener noreferrer`).
- Un enlace nuevo para la misma OT, tipo y elemento (serie o id externo) deja al anterior
  como no vigente.
- **Pedirlos al BPCH — ruta POR CONFIRMAR con el BPCH:** `GET {url_base}{ruta_enlaces_ot}`
  con `{ot}` o `{bpch_id}` reemplazados (ej.
  `/api/v1/integracion/lims/ordenes-trabajo/{bpch_id}/enlaces`), Bearer `BPCH_ARMAS_TOKEN`,
  **sin seguir redirecciones**. Se llama al recibir los estados 2 y 8 (en segundo plano) y con
  el botón «Actualizar enlaces». Respuesta esperada (propuesta): el mismo formato `url_ot` /
  `enlaces[]` / `certificados[]` o un arreglo de enlaces.

## 5. Rutas internas del LIMS

Permiso `integracion.armas.gestionar` y ámbito BPCH (incluye la D11) o DCO.

| Método y URL | Para qué |
|---|---|
| `GET /api/integracion/armas/bandeja?estado=&limite=` | Envíos y avisos recientes, con la configuración (sin secretos) |
| `GET /api/integracion/armas/ot/:otId` | Estado externo, historial, envíos, enlaces y adjuntos de la OT |
| `POST /api/integracion/armas/ot/:otId/previsualizar` | JSON que se enviaría y lo que falta (no envía) |
| `POST /api/integracion/armas/ot/:otId/enviar` | Encolar el envío (cuerpo opcional para completar datos) |
| `POST /api/integracion/armas/ot/:otId/adjuntos` | Subir la resolución en PDF (multipart `archivo`) |
| `GET /api/integracion/armas/ot/:otId/adjuntos/:id` | Descargar la resolución o el acta |
| `POST /api/integracion/armas/ot/:otId/enlaces` | Pedir ahora los enlaces al BPCH |
| `POST /api/integracion/armas/envios/:id/reintentar` | Reintentar un envío en error |
| `POST /api/integracion/armas/procesar` | Enviar lo pendiente y consultar estados ya |
| `GET /api/v1/integracion/bpch/adjuntos/:token` | (Lo usa el BPCH) descarga de la resolución por enlace firmado |

## 6. Configuración

**Variables de entorno** (nunca en la base ni en documentos):

| Variable | Para qué |
|---|---|
| `BPCH_ARMAS_TOKEN` | Token que entrega el BPCH para llamar a su API |
| `BPCH_ARMAS_HMAC_SECRET` | Clave compartida de la firma del webhook |
| `LIMS_URL_INTEGRACION` | Dirección del LIMS que el BPCH alcanza (enlaces de descarga). Si falta: `https://<DOMAIN>` o el primer origen de `CORS_ORIGINS` |
| `INTEGRACION_ARMAS_TRABAJADOR=false` | Apaga los trabajadores de envío y consulta en esa instancia |

**Parámetros del sistema › «Integración con el software de armas del BPCH»**
(`integracion_armas`): `activa` (no), `url_base`, `modo_retorno` (webhook | post | pull),
`enviar_automatico` (no: se envía desde la ficha de la OT), `unidades` (D11,BPCH; con envío
automático, solo las OT de esas unidades), `max_intentos` (8), `intervalo_pull_min` (15),
`rut_con_dv` (no), `vigencia_enlace_horas` (72), `cerrar_ot_al_finalizar` (no),
`hosts_permitidos` (vacío = servidor de `url_base`), `ruta_enlaces_ot` (vacío = no se piden),
`guardar_acta_pdf` (sí).

El cuerpo de `/api/v1/integracion/bpch/*` lo lee `cuerpo-crudo.ts` (antes de los lectores de
Nest y solo para ese prefijo) para conservar el cuerpo crudo de la firma y admitir hasta
40 MB (acta en base64); el resto de la API sigue con el tope estándar.

## 7. Por confirmar con el BPCH / IDIC

1. RUT con o sin dígito verificador (su ejemplo «76192834» va sin DV).
2. `creador.rut`: el LIMS no guarda el RUT de sus usuarios. ¿Es obligatorio? ¿Basta el RUT
   genérico de la cuenta?
3. Ruta y formato de la API de **enlaces** de una OT y de cada certificado; si los enlaces
   exigen sesión en el BPCH al abrirlos.
4. Servidor y puerto del BPCH en la red del IDIC (para `url_base` y `hosts_permitidos`);
   ¿HTTPS con certificado interno?
5. Modo de retorno que implementarán (webhook con HMAC, POST directo o consulta) y cómo nos
   entregan el token y la clave HMAC (canal seguro).
6. ¿Validan el solicitante contra su catálogo de propietarios (`armas_propietarios` /
   `armas_propietarios_empresa`)? ¿Qué pasa si el cliente del LIMS no existe allí?
7. Qué OT del LIMS van al BPCH (¿todas las de la D11 y las internaciones de armas?) y si el
   envío es automático al crear la OT.
8. ¿El LIMS debe cerrar su OT al recibir el estado 8? ¿Y anularla con el 3?
9. Plazo de vida de su enlace de descarga: ¿descargan la resolución al momento o más tarde?
