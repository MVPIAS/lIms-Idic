# Numeración oficial de documentos por laboratorio y tipo

Frente r1b · tema transversal T01 (EP-01, EP-03, EP-05, EP-06, EP-09, EP-10).
SQL: `packages/db/align_r1b_numeracion.sql`. Código: `apps/api/src/plantilla-render/numeracion.ts`
(reglas puras, `numeracion.spec.ts`) y `numeracion.service.ts`.

## Qué cambia

Hasta ahora todos los informes y certificados salían con `CERT-AAAA-NNNN`, un
correlativo único del instituto. Ahora cada documento toma el **número oficial
de su laboratorio y su tipo** según una regla configurable:

| Pantalla | Ruta | Permiso |
|---|---|---|
| Administración › Numeración de documentos | `/admin/numeracion` | `documento.numeracion` (SUPERADMIN, ADMIN, CALIDAD) |
| Emitir informe o certificado › 2 · Condiciones de emisión | `/informes` | `certificado.emitir` — muestra «Número oficial que tendrá» |

## La regla

Tabla `numeracion_documento`: unidad (vacía = general), tipo de documento (vacío
= todos), **formato**, reinicio del correlativo (anual o continuo), «un
correlativo por cada unidad que la hereda», «por confirmar» y fuente.

Qué regla se aplica (`elegirRegla`):
1. la de la unidad del documento (o de su ancestro más cercano) con ese tipo;
2. la de esa unidad (o ancestro) con «todos los tipos»;
3. la general con ese tipo; 4. la general con «todos los tipos»;
5. sin regla: `CERT-AAAA-NNNN` (el correlativo de siempre, `certificado_correlativo`).

Datos que puede llevar el formato:

| Token | Qué imprime |
|---|---|
| `{AAAA}` `{AA}` | Año de emisión |
| `{N}` `{N:3}` | Correlativo de la regla, con ceros si se indica el ancho |
| `{OT}` `{OT_N}` `{OT_N:5}` | Código de la OT y su parte numérica (OT-2026-0012 → 12) |
| `{LAB}` `{CODSUCDEL}` | Código de la unidad que emite y su código StarLIMS |
| `{MUESTRA}` `{MUESTRA_N}` | Primera muestra que cubre el documento y su parte numérica |
| `{NI}` `{NI_N}` | Número de la orden interna (respuesta a una orden interna) |
| `{NUM_INFORME}` | Número del Informe de Inspección de la OT (documentos finales BPCH) |

El formato se valida al guardarlo: tokens conocidos, llaves cerradas y al menos
un dato que cambie por documento. La pantalla muestra un ejemplo en vivo.

## Reglas de negocio

- **Atómico.** `{N}` sale de `numeracion_documento_correlativo` con
  `INSERT … ON CONFLICT DO UPDATE … RETURNING` dentro de la transacción de la
  emisión: dos emisiones simultáneas nunca reciben el mismo número y, si la
  emisión falla, el contador vuelve atrás.
- **No se reutiliza.** Si el número generado ya existe (p. ej. «Nº = Nº de OT» y
  la OT tiene un segundo documento), se toma el siguiente `{N}` o, si el formato
  no lleva `{N}`, se añade `-2`, `-3`… El sufijo de reemisión sigue siendo `-V2`.
- **Faltan datos.** Si el formato pide un dato que el documento no tiene (p. ej.
  `{NUM_INFORME}` en un prototipo sin Informe de Inspección), se emite con la
  numeración general y la emisión lo avisa.
- **Reemisión.** Conserva el número con el sufijo de versión (sin cambios).
- **IE no emitido.** El número reservado para un documento que no llega a
  emitirse (LPN: «la muestra no forma película») queda registrado como anulado
  con su motivo (ver `docs/FLUJO_DOCUMENTOS_POR_OT.md`).
- `certificado.numero` y `certificado.codigo` admiten ahora 80 caracteres.

## Reglas sembradas (configurables)

Se siembran una vez por (unidad, tipo); si el administrador las cambia, reaplicar
el SQL no las repone. «Por confirmar» = formato por defecto de la especificación,
pendiente de respuesta del IDIC.

| Unidad | Tipo | Formato | Correlativo | Estado | Fuente |
|---|---|---|---|---|---|
| LQC | Informe de ensayo | `IE {LAB} N° {N:3}/{AAAA}` | anual | por confirmar | EP-01 §6 |
| LPN | Informe de ensayo | `IE {LAB} N° {N:3}/{AAAA}` | anual | por confirmar | EP-01 5.1 (P6) |
| LME | Informe de ensayo | `IE {LAB} N° {N:3}/{AAAA}` | anual | por confirmar | EP-01 §6 |
| SVE (LCC, LTX) | Informe de ensayo | `IE.DQO.{LAB} Nº {OT_N}/{AAAA}` | — | por confirmar | EP-03 5.1 (P3) |
| SVE (LCC, LTX) | IVC | `IVC.DQO.{LAB} Nº {OT_N}/{AAAA}` | — | vigente | EP-03 §6 |
| LRB | todos | `IDIC DSA SAM LRB Nº J.{OT_N}/{AAAA}` | — | vigente | EP-05 §6 |
| SVM | IVC | `IDIC DSA SVM N.º {OT_N}/{AAAA}` | — | vigente | EP-05 §6 |
| LEM | IVC | `IVC.IDIC.DSA.SEM.LEM N°{OT_N}/{AAAA}` | — | vigente | EP-05 §6 |
| LEM | Informe de ensayo | `IE {LAB} N°{N:3}/{AAAA}` | anual | por confirmar | EP-05 (P20) |
| LEM | Respuesta a orden interna | `{OT_N}/{NI_N}/{N}` | anual | por confirmar | EP-05 4.10 |
| BPCH (sucursales, SCC, D11) | Informe de inspección | `{CODSUCDEL}/{N:4}/{OT_N:5}/{MUESTRA_N:6}` | continuo, uno por unidad | por confirmar | EP-10 §6 (P5) |
| BPCH | Certificado de conformidad | `{NUM_INFORME}/CC` | — | por confirmar | EP-10 10.13 |
| BPCH | Informe de incumplimiento | `{NUM_INFORME}/II` | — | por confirmar | EP-10 10.14 |
| General | Respuesta a orden interna | `I.E. N° {NI_N}/{AAAA}` | — | vigente | EP-01 §6, EP-03 §6 |

Metrología (HT-, ME-, TF-, LCPNF-NNN.AA) tiene su propio numerador
(`met_numeracion`, frente r1a) y no se siembra aquí.

## Por confirmar con el IDIC

1. Formato del IE de LQC, LPN y LME (EP-01 P6) y del IE del LEM (EP-05 P20).
2. Si el IE del LCC/LTX lleva el Nº de la OT y qué número lleva un segundo IE de
   la misma OT (EP-03 P3). Hoy: `-2`, `-3`.
3. Significado del 2.º tramo de `CODSUCDEL/código/OT/muestra` (EP-10 P5). Hoy: un
   correlativo continuo por unidad inspectora.
4. Si el Certificado de Conformidad y el Informe de Incumplimiento repiten el
   número del Informe de Inspección (EP-10 P5). El LIMS exige números únicos, por
   eso añade `/CC` o `/II`.
