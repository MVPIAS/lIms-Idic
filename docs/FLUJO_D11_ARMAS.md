# Delegación Nº 11 y SAEC · armas, munición de prueba y evidencias · LIMS IDIC

Contrato del frente r4b (temas T25 y T24 del backlog). Especificación de origen:
`EP-11_Delegacion11_SAEC.md` (y EP-07 7.3, EP-08, EP-09 9.16, EP-10 10.15 para
lo del BPCH). Todo lo que depende del IDIC está en «Parámetros de la operación»
o marcado «por confirmar» con su pregunta.

## Compartimento (EP-11 11.41)

- Las pantallas y la API de la D11 y del SAEC (`/d11/*`, `/saec/*`, `/evidencias`,
  `/armas`, `/prestamos-evidencia`, `/ibis`) llevan `@AmbitoUnidad("D11")`: solo la
  Delegación Nº 11, la Dirección/Subdirección y Auditoría (Lector, en solo lectura:
  tiene `*.ver` y ninguna escritura). Comercial, Administración y los demás
  laboratorios reciben 403.
- Excepciones medidas: la planilla del listado de armas de la resolución la lee
  quien registra la internación (`POST /bpch/resolucion-armas/leer`, ámbito
  BPCH/DCO) y el laboratorio que pide munición de prueba usa `/municion/*` con
  alcance por su unidad.
- Datos de prueba: solo ficticios (marcas «Marca Prueba», series «PRUEBA…»,
  personas por cargo o «ficticio»).

## A · Certificación de armas internadas (11.1 a 11.27)

Pantalla **BPCH · SAEC › Certificación de armas** (`/saec/ot`, `/saec/ot/[id]`):
10 pasos numerados con «le toca a» y el botón «Verbo → siguiente».

| Paso | Quién | Qué | Regla clave |
|---|---|---|---|
| 1 Programar la recepción | Jefe D11 | fecha, lugar, responsable | el armero no programa (403) |
| 2 Aviso de llegada | D11 | fecha, transportista, bultos, aviso previo | — |
| 3 Acta de recepción | Armero | bultos, cantidad, ubicación | conteo contra la resolución |
| 4 Registro de armas | Armero | desde el listado de la resolución o planilla (.xlsx/.csv) | serie única por marca; tope del acta; cada arma es una **muestra** de la OT con código de barras y primer movimiento de custodia |
| 5 Clasificación y camino | Armero | clase, permisibilidad (IT05) → camino CIP / completa / directo | ensayos del camino según «Parámetros de la operación» |
| 6 Ensayos por arma | Armero | 0/1 por fila sin valores por defecto (BL-038); tensión del disparador; IBIS | **prueba de fuego (IT04): lote de munición y cartuchos usados obligatorios**, se descuentan del inventario |
| 7 Revisión y aprobación | Jefe D11 / BPCH | flujo general por OT | quien revisa no aprueba |
| 8 Acuñación IT08 | Armero | Nº de cuño y año | solo camino completo (CIP según parámetro) |
| 9 Certificados por arma | Jefe D11 | emisión en bloque (rango) → firma | vigencia 4 años (parámetro); QR y código de verificación |
| 10 Entrega | D11 / Comercial | por código de barras, guía GE-AAAA-NNNN | la prohibida no se entrega; salida en la custodia |

La lista `/saec/ot` muestra el **calendario de recepción** (programadas sin acta,
por día, con el aviso de llegada) y las OT por programar. La ficha de la OT usa la
**Ruta de las armas** y el cierre exige la entrega o el «no emitido».

Verificación pública: `/verificar/[codigo]` (sin sesión, sin datos personales:
serie enmascarada, vigencia).

## B · Munición de prueba (11.40, 11.17; EP-05 2.5 y 3.4)

| Pantalla | Quién | Botón |
|---|---|---|
| **Laboratorio › Munición de prueba** (`/municion`) | LRB / LAM (`municion.solicitar`, alcance por su unidad) | «Enviar orden → D11» · «Anular» · «Acta» |
| **BPCH · SAEC › Munición de prueba** (`/saec/municion`) | D11 (`municion.gestionar`; ver con `arma.ver`) | «Alta de lote» · «Entregar munición → laboratorio» · «Cerrar acta» · «Movimientos» |

- Orden interna MP-AAAA-NNNN: norma*, nivel, calibre*, masa de bala, velocidad ±
  tolerancia, cartuchos*, OT del ensayo (de la misma unidad) e ítem de HCP.
- Entrega desde un lote del mismo calibre y con saldo; cierre con **entregados =
  usados + devueltos** (los devueltos vuelven al lote). Movimientos inmutables
  (trigger), saldo calculado.
- El ítem de HCP es texto libre (por confirmar su catálogo).

## C · Banco de evidencias (11.31 a 11.36)

| Paso | Pantalla | Regla |
|---|---|---|
| 11.31 Recibir el oficio | **SAEC › Evidencias › Nueva evidencia** | Nº de oficio*, unidad solicitante*, NUE* (único), fecha, RUC (NNNNNNNNNN-D); código de barras por defecto = NUE; «Registrar evidencia → custodia» abre la cadena de custodia |
| 11.33 Préstamos | Ficha de la evidencia | solicitado → aprobado / rechazado (motivo) → entregado (quién recibe, acta de salida imprimible) → devuelto (estado y ubicación); plazo obligatorio; alerta de vencidos en la lista y en la ficha |
| 11.34 Peritaje | Ficha de la evidencia | tipo*, resultado*, conclusiones*, adjuntos PDF/PNG/JPEG (se valida el contenido, máx. 5 MB); la evidencia pasa a «analizada» |
| 11.35 Casos | **SAEC › Casos** (`/saec/casos`) | abierto → en proceso → cerrado → archivado; reabrir exige motivo; no se cierra con evidencias prestadas; no se asocian evidencias a un caso cerrado; historial de estados y comentarios |
| 11.36 Certificado | Ficha de la evidencia | correlativo con año de Chile; unidad emisora D11; verificación pública |

## D · BPCH (T24) hecho en este frente

| Paso | Dónde | Qué |
|---|---|---|
| EP-10 10.15 | OT › Informe y cierre / expediente de la internación | Notificación a DGMN del Informe de Incumplimiento con destinatarios fijos; sin ella la OT no se cierra |
| EP-09 9.16 | Codificación Única › «Listado oficial» | PDF por fabricante para la firma (Subdirector BPCH y DGMN) y Excel; grupo, EQ.DIN 60 % y PTN/PIN en la ficha; cada emisión queda registrada |
| EP-07 7.3 | OT de Producción Nacional › Resultados | Revisión documental IT08 (checklist) con traslado de defectos crítico/menor al ensayo «Rev. Doc. Legal» |
| EP-08 8.3 / 8.4 | Clasificación | Koenen: masas del ensayo previo, tiempo y fragmentos; IT23: masa de muestra y curva del MCU adjunta |
| EP-08 8.6 | Clasificación | No se anula una clasificación aprobada en uso (409) |
| EP-08 8.8 | Prototipo · ingreso | «¿Está codificado?» contra la Codificación Única y el catálogo (exacto bloquea, parecido avisa); ficha técnica y HDS adjuntas |
| EP-08 8.11 | Prototipo · paso 4 | Parametrización del elemento: panel, validación (cuatro ojos), devolución con motivo y aplicación a la OT |
| EP-08 8.17 | Prototipo · paso 8 | «Inscribir en Codificación Única → listado oficial» con datos heredados y certificado de tipo |

No construido: **certificado de control de la sucursal** (EP-07 7.9): su formato,
firmante y numeración dependen del IDIC. **Carga inicial de la Codificación
Única** (BL-061): no hay exportación del sistema actual en las fuentes (P7).

## SQL

`packages/db/align_r4b_d11.sql`, `align_r4b_saec.sql`, `align_r4b_bpch.sql`
(aditivos e idempotentes, antes de `align_cierre_permisos.sql`). Tabla común de
adjuntos `registro_adjunto` (entidad + clase; cada controlador comprueba sus
permisos y alcance antes de leer o escribir).

## Pruebas

- Unitarias: `saec/d11/reglas-d11.spec.ts`, `saec/d11/municion.spec.ts`,
  `saec/reglas-saec.spec.ts`, `common/adjuntos.spec.ts`, `common/code128.spec.ts`,
  `common/tabla-archivo.spec.ts`, `bpch/notificacion-dgmn/*.spec.ts`,
  `bpch/codificacion/listado-oficial.spec.ts`, `bpch/prototipos/reglas-prototipo.spec.ts`,
  `bpch/clasificacion/reglas-clasificacion.spec.ts`,
  `bpch/produccion-nacional/revision-documental.spec.ts`.
- Recorrido: `scripts/verificacion/r4-r4b.js` (con `R4B_HASTA="11.11"` deja una
  OT a medio camino para recorrerla en el navegador).
