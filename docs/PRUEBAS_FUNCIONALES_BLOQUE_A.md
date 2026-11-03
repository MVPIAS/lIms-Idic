# Pruebas funcionales documentadas · LIMS IDIC (bloque A)

**Contrato:** §5.7 («pruebas funcionales que validen que todos los módulos operan conforme a especificación, corrigiendo incidencias antes de la entrega»); también se prueban aquí §4.5.7 (tendencias), §4.7.6 (inactividad) y §4.8.4 (respaldo en SQL y CSV).
**Fecha:** 02-11-2026 (hora de Chile). **Versión:** rama `bloqueA-operacion` (sobre `8b676cc`), compilación de producción.
**Entorno:** copia local de la base de demostración (`ba4_demo`) con los usuarios demo; API en `localhost:3012`. Todo dato creado lleva «PRUEBA» y se retira al terminar.

## 1. Resumen

| Módulo | Guion | Casos | Resultado | Incidencias encontradas y corregidas |
|---|---|---:|---|---|
| Control de calidad (QC) | `scripts/verificacion/qc-spc-mensajeria.js` | 13 | 13/13 OK | — |
| Control estadístico (SPC) | ídem | 8 | 8/8 OK | Un identificador de analito mal formado devolvía error 500; ahora 400 con el motivo (`spc.module.ts`) |
| Mensajería | ídem | 7 | 7/7 OK | — |
| Tendencias (§4.5.7) | API + navegador | 5 | 5/5 OK | — |
| Sesión por inactividad (§4.7.6) | API + navegador | 4 | 4/4 OK | — |
| Usuarios (≥ 1000, §4.7.6) | `carga-concurrente.js` | 2 | 2/2 OK | El listado cortaba en 500 usuarios y declaraba total 500; ahora tope 5000 y total real (`usuarios.controller.ts`) |
| Exportación portable cifrada (§4.8.4) | `exportar-portable.sh` / `restaurar-portable.sh` | 6 | 6/6 OK | Las tablas particionadas (`audit_log`) no se podían copiar; el recuento de filas por líneas fallaba con textos de varias líneas |
| Consumibles | — | — | **Pendiente** | Se documentan con el descuento automático y el factor de conversión (§4.4.4, §4.4.5), en el otro frente del bloque A |

Pruebas unitarias del API: **1820 superadas** (160 suites, 5 omitidas), incluidas las nuevas `reportes/tendencias.spec.ts` y `auth/sesion.spec.ts`. Comprobaciones del repositorio: orden del SQL al día (115 ficheros) y 757 rutas sin duplicados.

## 2. Control de calidad (QC)

Usuarios: `demo.lmb.analista1` (registra), `demo.lmb.revisor` (aprueba), `demo.lqa.analista1` (otro laboratorio). OT del LMB con métodos microbiológicos que exigen controles positivo, negativo y blanco.

| Caso | Qué se comprueba | Resultado | Evidencia |
|---|---|---|---|
| QC-01 | El analista ve el QC de una OT de su laboratorio con los tipos exigidos por método | OK | OT-2026-0012: 1139 exige positivo/negativo/blanco; 429 exige positivo/negativo/blanco |
| QC-02 | Un control positivo sin cepa de referencia ATCC no se registra | OK | HTTP 400 El control microbiológico necesita: cepa de referencia ATCC. |
| QC-03 | Positivo que crece (+) con cepa y lote: cumple y queda pendiente de aprobación | OK | HTTP 201 resultado=pendiente |
| QC-04 | Negativo que crece (+): se rechaza automáticamente | OK | HTTP 201 resultado=rechazado |
| QC-05 | Negativo (−) y blanco de medio (−) cumplen: pendientes de aprobación | OK | negativo=pendiente blanco=pendiente |
| QC-06 | Aprobar exige el permiso de revisión: el analista que lo registró no puede aprobarlo | OK | HTTP 403 Aprobar un control de calidad exige el permiso «resultado.revisar» (revisor o jefatura). |
| QC-06b | Segregación: un revisor no puede aprobar el control que él mismo registró | OK | HTTP 409 Segregación de funciones (ISO/IEC 17025): quien registró el control de calidad no puede aprobarlo. Debe hacerlo otra persona. |
| QC-07 | Mientras falten aprobaciones el método no está aprobado (bloquea la emisión del informe) | OK | aprobado=false |
| QC-08 | El revisor del laboratorio aprueba los tres controles | OK | 200/aprobado 200/aprobado 200/aprobado |
| QC-09 | Con positivo, negativo y blanco aprobados, el método queda aprobado (no le faltan tipos) | OK | aprobado=true faltan= |
| QC-10 | Alcance: un analista de otro laboratorio no ve el QC de esta OT | OK | HTTP 403 |
| QC-11 | Un control ya aprobado no se puede retirar | OK | HTTP 409 No se puede eliminar un control aprobado: cambie antes su resultado. |
| QC-12 | Limpieza: los controles PRUEBA se retiran (baja lógica) | OK | 5/5 |

## 3. Control estadístico de procesos (SPC)

Usuarios: `demo.admin` (global) y `demo.lqa.jefe` (un laboratorio). Los estadísticos de la API se recalculan en el guion de forma independiente (media, desviación muestral, LC ± 3σ, rango móvil medio y LSC de la carta R con D4 = 3,267).

| Caso | Qué se comprueba | Resultado | Evidencia |
|---|---|---|---|
| SPC-01 | Lista de analitos con suficientes resultados numéricos para la carta | OK | 9 analitos (p. ej. Humedad n=9) |
| SPC-02 | La serie trae un punto por resultado (fecha, valor, OT y muestra) | OK | 9 puntos de 9 |
| SPC-03 | Media, desviación y límites LC ± 3σ coinciden con el cálculo independiente | OK | media 10.211111 vs 10.211111 · σ 0.658492 vs 0.658492 · LSC 12.186586 · LIC 8.235636 |
| SPC-04 | Rango móvil medio y LSC de la carta R (D4 = 3,267) | OK | MR̄ 0.75 vs 0.750000 · LSC-R 2.45025 |
| SPC-05 | Puntos fuera de control: los que superan LC ± 3σ | OK | 0 informados, 0 calculados |
| SPC-06 | Alcance: un jefe de laboratorio solo ve los puntos de sus OT | OK | jefe LQA 9 · global 9 |
| SPC-07 | Parámetro inválido: responde error de validación, no 500 | OK | HTTP 400 |
| SPC-08 | Rango de fechas sin datos: serie vacía y estadísticos nulos | OK | puntos=0 media=null |

## 4. Mensajería

Usuarios: `demo.dco.jefe` (Comercial) y `demo.lmb.analista1`. El entorno de prueba **no tiene servidor de correo configurado**: el envío queda en la bitácora con estado «error» y el motivo, y la operación no falla. La prueba con el servidor de correo real del IDIC queda pendiente del Instituto.

| Caso | Qué se comprueba | Resultado | Evidencia |
|---|---|---|---|
| MSJ-01 | Plantillas de correo disponibles (cotización y resultados) | OK | cotizacion_estandar, cotizacion_seguimiento, resultado_estandar, resultado_validado |
| MSJ-02 | Historial de correos paginado | OK | total=3 |
| MSJ-03 | Notificar el resultado de una OT: la operación responde y deja el envío en la bitácora (enviado o con su error si no hay servidor de correo) | OK | HTTP 201 |
| MSJ-04 | Búsqueda en el historial por destinatario encuentra el envío, con estado y OT | OK | estado=error error=No hay configuración de correo para este tenant. |
| MSJ-05 | Filtros por estado y tipo | OK | 4 filas |
| MSJ-06 | Permisos: un analista sin acceso comercial no ve la mensajería comercial | OK | HTTP 403 |
| MSJ-07 | Destinatario inválido: se rechaza sin enviar | OK | HTTP 400 No hay destinatarios válidos. Indique al menos un correo (o registre el email del cliente). |

## 5. Tendencias en tiempo real e históricas (§4.5.7)

Reportes › Tendencias (`GET /api/reportes/tendencias`).

| Caso | Qué se comprueba | Resultado | Evidencia |
|---|---|---|---|
| TEN-01 | Sin fechas: últimos 12 meses en hora de Chile, rellenando con cero los meses sin datos | OK | 12 meses (dic 25 – nov 26) |
| TEN-02 | Foto «ahora»: OT abiertas, vencidas, ingresadas hoy y resultados por revisar | OK | 55 / 1 / 5 / 18 (administrador) |
| TEN-03 | Series por laboratorio (OT, muestras, % No cumple, días de respuesta), con media móvil de 3 meses, pendiente, sentido y mes atípico | OK | 24 laboratorios con datos; reglas probadas en `tendencias.spec.ts` (6 casos) |
| TEN-04 | Alcance: el jefe del LMB solo ve su laboratorio | OK | `laboratorios = [LMB]`, foto «ahora» del LMB (4 OT abiertas) |
| TEN-05 | Pantalla: pestaña Tendencias con 4 gráficos y la tabla comparativa, sin errores de JavaScript; se actualiza cada minuto | OK | Captura de pantalla; 0 errores de página |

## 6. Desconexión por inactividad configurable (§4.7.6)

| Caso | Qué se comprueba | Resultado | Evidencia |
|---|---|---|---|
| SES-01 | Valor por defecto | OK | `GET /auth/sesion-config` → `{"inactividadMinutos":20}` |
| SES-02 | El administrador lo cambia en Parámetros del sistema, con motivo e historial | OK | 20 → 35 min; historial «20 minutos → 35 minutos» |
| SES-03 | Fuera de rango se rechaza | OK | 1 min → HTTP 400 «El valor debe estar entre 2 y 480 minutos.» |
| SES-04 | La web lo lee al abrir la pantalla | OK | En el navegador, `GET /auth/sesion-config` → 200 al cargar Reportes |

## 7. Exportación portable cifrada: SQL plano y CSV (§4.8.4)

Probada con Docker en un PostgreSQL 16 aparte con una copia de la base (264 tablas, 24 MB de SQL), con las mismas órdenes que usa el instalador.

| Caso | Qué se comprueba | Resultado | Evidencia |
|---|---|---|---|
| RES-01 | Exportación: SQL plano + una tabla por CSV (incluida la tabla particionada `audit_log`, una sola vez) + manifiesto y SHA-256 | OK | 264 tablas; paquete de 9,6 MB |
| RES-02 | El paquete sale cifrado (AES-256, PBKDF2 600 000 iteraciones) y se verifica descifrándolo antes de darlo por bueno | OK | «EXPORTACIÓN CORRECTA Y VERIFICADA» |
| RES-03 | Restauración del SQL plano en una base NUEVA, con comparación de filas tabla a tabla | OK | «filas idénticas a las exportadas en todas las tablas» (264) |
| RES-04 | Extracción para leer los CSV en Excel | OK | `csv/unidad.csv` con cabecera y datos |
| RES-05 | Con una clave equivocada no se puede leer | OK | «No se pudo descifrar (¿clave distinta?)» |
| RES-06 | Rotación: se conservan solo las últimas `RETENCION_PORTABLES` | OK | Con 2 y una tercera exportación, se borró la más antigua (190441) y quedaron 191307 y 193423 |

Programación: `lims-exportacion.timer` (domingos 04:00, cada semana; el contrato pide cada 15 días como mínimo) o la línea equivalente en `lims-backup.cron`. La clave `RESPALDO_CLAVE` la genera el instalador. Procedimiento en `deploy/onpremise/GUIA_ONPREMISE.md` §7.8.

## 8. Cómo repetir

```bash
node scripts/verificacion/qc-spc-mensajeria.js --base http://localhost:3001/api --salida qc-spc-msj.json
APP_DIR=/opt/lims-idic /opt/lims-idic/scripts/backup/exportar-portable.sh
/opt/lims-idic/scripts/backup/restaurar-portable.sh <paquete.tar.gz.enc> --a-bd lims_simulacro
```

Úsense en una base de pruebas: el guion de QC registra y retira controles «PRUEBA», y el de mensajería deja un envío «PRUEBA» en la bitácora.
