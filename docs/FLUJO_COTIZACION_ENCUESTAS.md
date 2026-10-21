# Cotización de punta a punta y encuestas de satisfacción (frente r1c)

Especificación: `EP-00_Comercial_y_Facturacion.md`, pasos 2.1 y 2.3 a 2.9, 3.4, 4.1 y 9.1.
SQL: `packages/db/align_cotizacion_circuito.sql` y `packages/db/align_encuestas_satisfaccion.sql`.
Recorrido verificado: `scripts/verificacion/r1-r1c.js`.

## 1. Ruta de la cotización

La ficha `/cotizaciones/<id>` sigue el patrón de la ficha de la OT. Tiene una barra
de seis etapas, el recuadro «Siguiente paso · Le toca a» y una pestaña por paso.
La etapa no se guarda: el servidor la deduce de lo que ya existe
(`apps/api/src/cotizacion/circuito-cotizacion.ts`, `calcularRutaCotizacion`).

| # | Etapa | Quién | Pantalla y botón | Estado al salir |
|---|---|---|---|---|
| 1 | Elaboración | Ejecutivo de Ventas | «Nueva cotización» → ficha, pestaña «Datos» | Abierta, en elaboración |
| 2 | Costeo del laboratorio | Ejecutivo pide, Jefe de Laboratorio responde | Pestaña «Laboratorio»: **«Solicitar → laboratorio»**; el laboratorio responde con **«Aceptar → Comercial»**, **«Aceptar con comentario → Comercial»** o **«Rechazar con comentario → Comercial»** | Solicitud respondida |
| 3 | V°B° del laboratorio y del departamento | Jefe de Laboratorio y luego Jefe de Departamento | Pestaña «Laboratorio»: **«Dar V°B° → Comercial»** o **«Devolver con comentario»** | Solicitud con V°B° |
| 4 | Firma del Jefe DCO | Ejecutivo envía, Jefe DCO firma | Pestaña «Documento y firma»: **«Enviar a firma → Jefe DCO»**, después **«Firmar → emitir»** o **«Devolver al ejecutivo»** | Firmada (emitida) |
| 5 | Envío al cliente | Ejecutivo | Pestaña «Envío»: **«Enviar al cliente →»** (correo con PDF) o **«Registrar entrega →»** (en mano o por courier) | Enviada |
| 6 | Aceptación y OT | Ejecutivo | Pestaña «Aceptación»: **«Registrar aceptación → crear OT»** | Aceptada, nace la OT |

Si la cotización se anula o vence, el recuadro lo avisa y no ofrece pasos.
Las cotizaciones anteriores a este circuito (`cotizacion.circuito = 'historico'`)
no pasan por la firma y se aceptan como antes.

## 2. Reglas

**Numeración (2.1).** El formato es `AAAA-NNNNN` (real: `2026-14324`). El correlativo
es atómico por tenant (`cotizacion_correlativo`, `INSERT … ON CONFLICT DO UPDATE …
RETURNING`). Si un número ya existe (dato migrado), se salta. Parámetros en
`numeracion_cotizacion`:

| Parámetro | Por defecto | Para qué |
|---|---|---|
| `formato` | `{AAAA}-{N}` | Plantilla del número |
| `digitos` | `5` | Ceros a la izquierda |
| `reinicio` | `global` | `global` o `anual` |
| `inicio` | `0` | Último número usado en el Sistema Comercial |

**Solicitud al laboratorio (2.3 y 2.4).**
- La solicitud va a un laboratorio, sucursal, delegación o sección.
- Hay una sola solicitud vigente por laboratorio y cotización.
- Servicio no estandarizado: abre el Formulario de cotización con el número
  `FORM-<nº cotización>/00n`, que es correlativo por cotización.
- Servicio estandarizado: es una solicitud de fechas, sin número.
- Solo se pide con la cotización Abierta y fuera de firma.

**Respuesta del laboratorio (2.5).**
- Responde quien tiene el permiso `cotizacion.costear` con el laboratorio de la
  solicitud en su alcance: Jefe de Laboratorio, de Sección o de Departamento.
- Responde una vez, o de nuevo si la respuesta se devolvió.
- El Programa de trabajo (FORM06) exige un plazo de entrega de 1 a 730 días; las
  etapas y las fechas son opcionales.
- El Formulario de costeo (FORM05) es obligatorio si el servicio no es estandarizado:
  - tiene siete secciones;
  - viático = monto diario × % del grado × días;
  - CDT = suma de las secciones 1 a 6;
  - CFA = CDT × `cfa_pct`;
  - CT = CDT + CFA = precio Ejército;
  - precio particular = CT × (1 + `margen_particular_pct`).
- «Rechazar» exige motivo. Bloquea la firma hasta que el ejecutivo retira la solicitud.
- El costo directo y las horas hombre de la respuesta quedan en `solicitud_costeo`.
  Así los usa la Planilla de costos reales como estimación del laboratorio.

**V°B° (2.6).**
- Lo da el Jefe de Laboratorio de la unidad (`JEFE_LAB`, nivel MISMA) y después el
  Jefe de Departamento del que cuelga (`JEFE_DEPTO`, nivel DEPARTAMENTO).
- Se resuelve con el mismo motor de la matriz de firmas: titular, subrogante o
  asignación vigente.
- Hace falta además el permiso `cotizacion.vb`.
- «Devolver» exige comentario y borra los V°B° anteriores; el laboratorio vuelve a
  responder.
- Sin V°B° completo de cada solicitud no se envía a firma ni se firma.

**Firma (2.8).**
- La firma quien resuelve el paso FIRMA de la matriz `COTIZACION` para el
  Departamento Comercial: por defecto, el Jefe DCO. Hace falta además el permiso
  `cotizacion.firmar`.
- Solo se firma una cotización enviada a firma por el ejecutivo.
- En firma o firmada no se edita (409).
- Al firmar:
  - la fecha de emisión pasa a ser hoy;
  - la validez se recalcula desde hoy (IT DCO-PG01-P01-IT02);
  - el dólar ya estaba congelado.
- «Devolver al ejecutivo» exige motivo. El ejecutivo corrige y vuelve a enviar.

**Documento (2.7).**
- `GET /cotizaciones/:id/html` (vista previa) y `GET /cotizaciones/:id/pdf` usan el
  mismo motor PDF/A que los informes.
- Llevan el bloque de firmas «Elaborado por» (ejecutivo) y «Firmado por» (Jefe DCO).
- Mientras no está firmada, el documento dice «EN PROCESO DE FIRMA: no tiene validez».
- Nunca imprime las observaciones internas ni el costeo.

**Envío (3.4).**
- Solo se envía una cotización firmada, o una histórica.
- Por correo:
  - adjunta el PDF y queda en la bitácora de Mensajería;
  - si el servidor de correo falla, el envío **no** se registra y se avisa.
- En mano o por courier: exige a quién se entregó o el número de seguimiento.
- Queda registrado el medio, la fecha, quién lo envió y a quién.
- Mensajería (`POST /mensajeria/cotizacion/:id`) aplica la misma regla y también
  registra el envío. Desde r1c exige `cotizacion.crear` y la cotización en el alcance;
  antes bastaba `cotizacion.ver`.

**Aceptación (4.1).** Con `exigir_firma_para_aceptar = si`, una cotización del
circuito nuevo sin firma no se acepta (409).

## 3. Encuestas de satisfacción (9.1)

Decisión del usuario del 20-10-2026:
- Toda OT que se cierra genera automáticamente una encuesta **pendiente**. Lo hace
  el trigger `trg_encuesta_al_cerrar_ot`: una encuesta por OT, en cualquier camino de
  cierre.
- No se publica a internet ni la llena el cliente: la **registra a mano Comercial**.

| Regla | Detalle |
|---|---|
| Preguntas | Las del formulario de evaluación del Sistema Comercial (`encuestaevalua.php`). C01 Satisfacción por el servicio prestado · C02 El servicio prestado cumplió con las expectativas de la empresa · C03 Conformidad con el tiempo de respuesta · C04 Coordinación Cliente – IDIC. Escala 1/3/5/7. Se editan en `/encuestas` › «Preguntas» (`encuesta.configurar`). Una pregunta se desactiva, no se borra |
| Registro | `encuesta.registrar` (Comercial y Planificación). Exige todas las respuestas obligatorias dentro de la escala, quién respondió y su cargo, el medio (teléfono, correo, en persona o formulario en papel) y la fecha. Guarda una copia del texto de cada pregunta, así que editar las preguntas no altera lo registrado. Calcula el promedio |
| Sin respuesta | «Cerrar sin respuesta» con motivo |
| Una vez | Una encuesta registrada o cerrada no se vuelve a registrar (409) |
| Orígenes excluidos | Parámetro `encuesta.excluir_origenes`. Por defecto `OT_INTERNA,INTERLABORATORIO`, porque no tienen cliente externo (EP-00 5.4) |
| Alcance | La encuesta es del laboratorio de la OT. Quien tiene el Departamento Comercial en su alcance, o alcance global, las ve todas; una jefatura técnica ve las de sus laboratorios (`encuesta.ver`) |
| Reporte | Por laboratorio y período: total, pendientes, registradas, sin respuesta, tasa de respuesta, promedio general y promedio por pregunta |

## 4. Permisos nuevos

| Permiso | Roles |
|---|---|
| `cotizacion.costear` | JEFE_LAB, JEFE_SECCION, JEFE_DEPTO |
| `cotizacion.vb` | JEFE_LAB, JEFE_SECCION, JEFE_DEPTO (el V°B° además exige ser el jefe que resuelve el paso) |
| `cotizacion.firmar` | JEFE_DEPTO (la matriz `COTIZACION` decide quién firma) |
| `encuesta.ver` | COMERCIAL, PLANIFICACION, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB, DIRECTOR, SUBDIRECTOR, CALIDAD, LECTOR |
| `encuesta.registrar` | COMERCIAL, PLANIFICACION |
| `encuesta.configurar` | ADMIN |

## 5. Alcance de lectura

- La ficha (`GET /cotizaciones/:id/circuito`), la vista previa y el PDF exigen la
  cotización en el alcance de `cotizacion.ver`.
- Los laboratorios consultados (`solicitud_costeo.unidad_id`) cuentan como unidades de
  la cotización (`SQL_UNIDADES_COTIZACION`), así el Jefe de Laboratorio consultado
  abre la ficha para responder.
- «Cotizaciones por responder» (`GET /cotizaciones/solicitudes-laboratorio`) exige
  `cotizacion.ver` y muestra las solicitudes de los laboratorios del alcance.
  Responder exige `cotizacion.costear`.

## 6. Mi bandeja

| Perfil | Tarjeta | Lleva a |
|---|---|---|
| Jefe de Laboratorio | Cotizaciones por responder · Costeos por dar V°B° | `/cotizaciones/por-responder` |
| Jefe de Sección | Cotizaciones por responder | `/cotizaciones/por-responder` |
| Jefe de Departamento | Costeos por dar V°B° del departamento · Cotizaciones por responder · Cotizaciones por firmar (solo el Jefe DCO) | `/cotizaciones/por-responder`, `/cotizaciones?estado=abierta&firma=pendiente` |
| Comercial | Cotizaciones devueltas por el Jefe DCO · Cotizaciones firmadas sin enviar · Encuestas por registrar | `/cotizaciones?…`, `/encuestas` |
| Planificación | Encuestas por registrar | `/encuestas` |

## 7. Por confirmar con el IDIC (configurable, con valor por defecto)

| Tema | Valor por defecto | Dónde se cambia | Pregunta EP-00 §10 |
|---|---|---|---|
| Formato y reinicio del número de cotización; número desde el que continuar | `{AAAA}-{N}`, 5 dígitos, global, desde 0 | Parámetros › `numeracion_cotizacion` | P6 |
| Quién da el V°B° y si bloquea | Laboratorio y departamento, bloqueante | `circuito_cotizacion.vb_niveles` (`lab_depto`, `lab` o `ninguno`) | P2 |
| ¿Es obligatorio consultar al laboratorio antes de firmar? | No (si se consulta, su V°B° sí es obligatorio) | `circuito_cotizacion.exigir_consulta_laboratorio` | P2 |
| ¿La aceptación exige la firma del Jefe DCO? | Sí | `circuito_cotizacion.exigir_firma_para_aceptar` | P2 |
| CFA y recargo particular del FORM05 | 12 % y 20 % (como el costeo que ya existía) | `circuito_cotizacion.cfa_pct` y `.margen_particular_pct` | P1 |
| Firmante de la cotización | Jefe DCO (matriz `COTIZACION`) | Administración › Matriz de firmas | P2 |
| Preguntas y escala de la encuesta | Las cuatro del Sistema Comercial, escala 1/3/5/7 | `/encuestas` › Preguntas | P15 |
| OT sin encuesta | OT interna e interlaboratorio | `encuesta.excluir_origenes` | P15 |
| ¿Puede costear el analista? | No (solo jefaturas) | Administración › Roles (`cotizacion.costear`) | §7 |

Fuera de este frente, aunque la EP los pide: la Ficha de Servicios Digital (precios
base del costeo), el oficio conductor para FF.AA. (3.1–3.3), la regla de no enviar
más de una encuesta cada 90 días por contacto (no aplica al registro manual) y el
cierre comercial (9.3).
