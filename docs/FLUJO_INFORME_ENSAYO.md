# Informe de ensayo · contenido, modalidades y formato por plantilla · LIMS IDIC

Reglas que aplica el servidor desde `align_informe_ensayo.sql`. Complementa
`FLUJO_FIRMA_CIERRE.md` (emisión, circuito de firma, entrega) y
`FLUJO_LABORATORIO.md` (captura y especificación de la orden).

- SQL: `packages/db/align_informe_ensayo.sql` (aditivo, idempotente, último de `ORDEN_SQL.txt`).
- Reglas puras con pruebas: `apps/api/src/plantilla-render/filas-informe.ts`,
  `bloques-informe.ts`, `config-informe.ts`, `reglas-fotos.ts`,
  `apps/api/src/rbac/firmas-resolver.ts` (`*.spec.ts` al lado).
- Verificación contra la API: `scripts/verificacion/informe-ensayo.js`.

## 1. Qué imprime cada fila (defecto corregido)

Antes la tabla de resultados salía con «—» en el ensayo y en el límite de **todas** las
filas: el informe tomaba el analito y el límite del catálogo antiguo (`analito`,
`norma_limite`) y los resultados del catálogo v2 guardan `cat_analito_id` y su propia
especificación. Ahora, por fila:

| Columna | De dónde sale |
|---|---|
| Ensayo / característica | `cat_analito.nombre` (o el analito legado en resultados antiguos) |
| Método | La norma del método si es una referencia (lleva algún número: «ASTM D 629», «NCh 409/2»), con el nombre si aporta; si el campo norma es solo una categoría del catálogo heredado («Agua», «Cueros»), el nombre del método |
| Unidad | La del resultado (la de la orden), si no la del analito |
| Requisito | La especificación que guarda el resultado: la **de la orden** si se fijó o cambió en la OT (se marca con `*` y una nota), si no la copiada del catálogo. Formato: `6,5 – 8,5`, `Mín. 2,5`, `Máx. 0,05`, `10,5 ± 0,3` (nominal con cotas simétricas), `10,5 (10 – 12)`, o el texto («100 % poliamida»). Sin requisito: «No especificado» (informativo) |
| Resultado | Número (fórmula › valor › promedio, coma decimal) o, en atributos, el texto observado o Cumple / No cumple, con la observación debajo |
| DE / CV % | Solo si algún ensayo tiene réplicas (configurable) |
| Veredicto | Cumple / No cumple / Informativo; solo «No cumple» va en rojo |

Además: el **veredicto de cada muestra** (No cumple si un ensayo no cumple; Pendiente si
falta alguno; Cumple si todos cumplen; los informativos no cuentan en contra) y
`{{veredicto_ot}}` para la OT. Los resultados antiguos sin especificación propia siguen
tomando el límite de `norma_limite`.

## 2. Dos tipos de informe (modalidad)

| Modalidad | Contenido |
|---|---|
| `cumplimiento` | Requisito y veredicto por ensayo, veredicto de la muestra, cuadro de referencias |
| `solo_resultados` | Solo el valor de cada ensayo: sin columnas de requisito ni veredicto, sin referencias |

- Se elige al emitir (`modalidad` en `POST /informes/previsualizar` y `/emitir`).
  **Por defecto**: cumplimiento si algún ensayo de la OT tiene requisito; solo resultados
  si ninguno lo tiene (`POST /informes/propuesta` devuelve la sugerida y cuántos ensayos
  tienen requisito).
- Queda guardada en el documento (`certificado.modalidad`); el listado
  (`GET /informes/documentos`) y el circuito (`GET /informes/:id/circuito`) la devuelven,
  y la **reemisión conserva** la modalidad y los datos del documento.

## 3. Formato por plantilla (`plantilla_informe.config_informe`)

Parametrizable por plantilla, no solo para Textil. Valor efectivo = el del tipo de plantilla
+ lo guardado (`config-informe.ts`); un valor guardado inválido se ignora campo a campo.

| Campo | Valores | Por defecto |
|---|---|---|
| `agrupacion` | `muestra` (una tabla por muestra) · `seccion` (secciones y componentes) | IVC: `seccion`; resto: `muestra` |
| `numeracion` | Punto donde empiezan los resultados («4» → 4.1, 4.1.1); vacío = sin numerar | IVC: «4» |
| `columnaMetodo`, `columnaUnidad` | sí / no | sí |
| `estadisticas` | `auto` (si hay réplicas) · `siempre` · `nunca` | `auto` |
| `referencias` | Cuadro con los No cumple citando el punto | sí |
| `anexoFotografico` | Fotos de la OT marcadas para el informe | sí |
| `conclusionFija` | Texto fijo de la conclusión | IVC y PG09A2: «Los registros y resultados… archivados… 5 años.» |
| `portada` | `ninguna` · `ivc` | IVC: `ivc` |
| `etiquetas` | Títulos de columna (ensayo, método, unidad, requisito, resultado, veredicto) | IVC: Característica / Método de verificación / Grado de cumplimiento |

- `GET /informes/plantillas/:id/formato` (`plantilla.ver`): guardado, efectivo y el del tipo.
- `PUT /informes/plantillas/:id/formato { formato }` (`plantilla.gestionar`): guarda solo
  lo que difiere del tipo; `formato: null` vuelve al del tipo. Aplica a lo que se emita después.
- Sembrado: todas las plantillas IVC con el formato del IVC, y la plantilla nueva
  **PG09A2 · Informe de ensayo Textil y Confección (PG09 Anexo 02-02)** (I.ENSAYO, secciones
  desde el punto 4, columnas Ensayo / Método / Requisito / Resultado / Condición).
- Bloques que pone el motor en el cuerpo de la plantilla: `{{tabla_resultados}}`,
  `{{referencias}}`, `{{anexo_fotografico}}`, `{{conclusion}}`, `{{portada}}`,
  `{{veredicto_ot}}`, `{{informe.modalidad_texto}}`. Si un cuerpo (sembrado antes) no nombra
  referencias, anexo o conclusión, se añaden solos antes del bloque de firmas; la portada,
  tras el título.

### Secciones numeradas (Textil y LCC)

`GET|PUT /informes/ot/:otId/estructura` (ver: `resultado.ver` o `certificado.emitir`;
fijar: `certificado.emitir` o `resultado.aprobar`): **sección** (p. ej. «Materiales»),
**componente** («Tela base») y **orden** de cada ensayo de la OT (`resultado_informe`).
Con agrupación por sección: `4.1 Materiales › 4.1.1 Tela base`; un ensayo sin sección va
bajo su muestra. Las **referencias** se arman solas: «Punto 4.1.1 Tela base no cumple con
Color instrumental.» (una por componente con algún No cumple).

### Anexo fotográfico

- `GET /informes/ot/:otId/fotos` (`resultado.ver` o `certificado.emitir`),
  `POST /informes/ot/:otId/fotos` (multipart: `archivo`, `pie`, `muestraId`, `resultadoId`,
  `enInforme`), `PATCH|DELETE /informes/fotos/:id` (`resultado.crear` o
  `certificado.emitir`). Todo exige el alcance de la OT.
- PNG o JPEG validados **por sus bytes** (no por la extensión), máximo 2 MB (la pantalla
  reduce a 1600 px), 60 fotos vigentes por OT, 24 en un documento. Quitar es borrado lógico.
- Una foto ligada a un ensayo lleva en el pie el punto del informe: «Foto 1 · Punto 4.1.1
  Tela base · Falta entretela». Las fotos van **dentro del cuerpo sellado** (data URI), así
  que el SHA-256 del documento las cubre; quitar una foto no altera documentos ya emitidos.

### Portada del IVC y conclusión

Datos del documento (`certificado.datos_informe`), elegidos al emitir
(`datosInforme: { conclusion, portada }`): propósito, OPI u OC y fecha, contrato y fecha,
proyecto, proveedor, ítem, cantidad, fabricante y país de origen. La OT propone OPI u OC
y el ítem (si hay una sola muestra); lo vacío se imprime «N/A». El N.º de O/T, su fecha,
la identificación del documento, la fecha de elaboración y el **N.º de páginas** (lo
escribe el PDF al final) los pone el sistema. La conclusión = texto fijo de la plantilla
+ texto libre del documento.

## 4. Matriz de firmas · OT interna

En una OT interna (`orden_trabajo.origen_trabajo = 'OT_INTERNA'`, o el texto heredado «OT
interna») **no firma el Jefe de Departamento** (DQO): la oficialización (aprobación
administrativa y liberación) no aplica. Al resolver la matriz se quitan los pasos
`OFICIALIZA` y se devuelven en `omitidos` con el motivo (`firmas-resolver.ts ·
aplicarOtInterna`). `POST /informes/condiciones` devuelve `otInterna` y `pasosOmitidos`, y
la pantalla dice quién no firma y por qué. `GET /firmas-matriz/resolver?…&otInterna=1`
muestra la resolución para una OT interna. La OT **interlaboratorio** conserva el circuito
completo (decisión pendiente de confirmar con el IDIC).

**Quién puede marcar una OT como interna.** `origen_trabajo` solo se fija al crear la OT
(`POST /ot`, permiso `ot.crear`: Administración, Comercial y Planificación; la aceptación de
una cotización solo produce `COTIZACION` o `DISPOSICION`, y las internaciones
`INTERNACION`). Después no se puede cambiar: `PATCH /ot/:id` no admite `origenTrabajo`
(el esquema lo descarta). Ni el laboratorio ni quien emite el informe pueden convertir una
OT de cliente en interna para saltarse la firma del Jefe de Departamento.

## 5. NCh 409 Of.84 · requisitos de agua retirados

El laboratorio pidió eliminar los límites de agua potable de la NCh 409 Of.84 (versión
anterior) que traía el LIMS antiguo, y se acordó no migrarlos. `align_informe_ensayo.sql`
los **desactiva** (`cat_especificacion.activo = false`, sin borrar) y los registra en
`cat_especificacion_retirada` (lote `NCH409_OF84`, con copia de los valores). Esos analitos
quedan **sin requisito**: el analista lo fija por OT (especificación de la orden) hasta
recibir la tabla NCh 409/1 vigente. Los resultados ya generados conservan su copia.

32 especificaciones de 21 métodos:

| Método | Analito(s) | Requisito retirado |
|---|---|---|
| 289 Amonio | Amonio | máx. 0,25 mg/L N |
| 290 Arsénico | Arsénico (concentración / dilución) | máx. 0,05 mg/L As |
| 291 Cadmio | Cadmio (concentración / dilución) | máx. 0,01 mg/L Cd |
| 293 Cloruro | Cloruro | máx. 250 mg/L Cl |
| 294 Cobre | Cobre (concentración / dilución) | máx. 1 mg/L Cu |
| 295 Cromo | Cromo (concentración / dilución) | máx. 0,05 mg/L Cr |
| 296 Flúor | Flúor | máx. 1,5 mg/L F |
| 297 Hierro | Hierro (concentrado / diluido) | máx. 0,3 mg/L Fe |
| 298 Magnesio | Magnesio (concentración / dilución) | máx. 125 mg/L Mg |
| 299 Manganeso | Manganeso (concentración / dilución) | máx. 0,1 mg/L Mn |
| 300 Mercurio | Mercurio (concentración / dilución) | máx. 0,001 mg/L Hg |
| 301 Plomo | Plomo (concentración / dilución) | máx. 0,05 mg/L Pb |
| 304 Cinc | Cinc (concentración / dilución) | máx. 5 mg/L Zn |
| 305 Residuos sólidos filtrables | Residuos sólidos filtrables | máx. 1000 mg/L |
| 306 Selenio | Selenio (concentración / dilución) | máx. 0,01 mg/L Se |
| 308 Nitrato | Nitrato | máx. 10 mg/L N |
| 309 Nitrito | Nitrito | máx. 1 mg/L N |
| 310 Sulfato | Sulfato | máx. 250 mg/L |
| 2984 Cloro libre | Cloro libre | máx. 0,20 |
| 1127 Cianuro | Cianuro | máx. 0,20 mg/L CN |
| 251 pH | pH | 6,0 – 8,5 (la otra especificación del método, vacía, sigue activa) |

Identificación: métodos del LQC con norma «Agua» (289–310 y 2984), más el cianuro
(0,20, valor de la Of.84; el método no trae norma) y la especificación 6,0–8,5 del pH. Para
revertirlo, ver el bloque comentado en el SQL.
