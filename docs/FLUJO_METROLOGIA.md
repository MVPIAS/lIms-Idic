# Flujo de Metrología (LMT, LMTE, LNF)

Módulo `apps/api/src/metrologia` y pantallas `apps/web/app/(app)/metrologia`.
Pertenece a la Sección Metrología (`@AmbitoUnidad("SAM")`): solo entra quien
trabaja en SAM o en sus laboratorios, o quien tiene alcance global.

Actualizado el 17-10-2026 con la información que el LMT envió el 15-10-2026
(respuesta a las consultas, acreditaciones INN LC 001 / LC 004 / LC 005,
programas de calibración IDIC-PG11-Anexo02, planillas M-3947-ITM03 y
V-5920-ITV05 y registro de firmas autorizadas LMT-PG01 Anexo 11 Rev. 28).
SQL: `packages/db/align_metrologia_1510.sql` (aditivo e idempotente, al final de
`ORDEN_SQL.txt`). Verificación: `scripts/verificacion/metrologia-1510.js`.

## 1. Procesos y cómo se calcula cada uno

| Laboratorio | Procesos | Cálculo |
|---|---|---|
| LMT · Área Mecánica | ITM01, ITM02, ITP01, ITP02, ITL01, ITL02, ITL06, ITL07, ITV02a/g/c, ITF01, ITF03, ITPT01 | Motor validado de su IT: **1531 de 1531** valores idénticos a los Excel del LMT (16 casos reales) |
| LMT | **ITM03** (masas no normalizadas) | Motor validado contra la planilla real **M-3947**: **167 de 167** valores idénticos |
| LMT | **ITV05** (micropipetas) | Motor validado contra la planilla real **V-5920**: **72 de 72** valores idénticos |
| LMT | **ITL05** (espesores), **ITL10** (trazador de altura y profundidad) | Formulario estándar por puntos (acreditados en LC 004; el LMT no entregó planilla) |
| LMTE · Área Eléctrica | ITT01, ITT02 | Motor validado (49/49 y 52/52, incluidos en los 1531) |
| LMTE | ITME01, ITE03 | Formulario estándar por puntos |
| LNF | LCPNF-IT01 (ISO 376) | Motor validado: **483 de 483** (caso LCPNF-010.26) |
| Cualquiera | PTS01 | Formulario estándar por puntos |

Paridad: `GET /metrologia/motores/paridad` recalcula todos los casos (2253 valores).
Las pruebas `motores/paridad.spec.ts`, `paridad-1510.spec.ts` y `lnf.spec.ts` la exigen.

### ITM03 · masas no normalizadas (`motores/masa-nn.ts`)

Una «Tabla de resultados» de la planilla = un ítem. Lecturas p-m-m-p en g →
mg redondeadas a los decimales del comparador; densidad del aire CIPM
simplificada; masa convencional `mc = (m_patrón + dmp)(1 + C) + ΔĪ`;
incertidumbre u(mcp) = U/2, u(ΔĪ) = s/√n, u(d) = (d/2√3)·√2, u(C) por empuje,
u(deriva) = deriva/√3; U = 2·uc. **El certificado informa la masa convencional
en g con 3 decimales y la U ASIGNADA por clase en mg** (EMP de la tabla de la
planilla, dos columnas a la derecha de la clase declarada), no la calculada.
Para nominales no normalizados (300 g, 475 g) la planilla deja «--» y el
metrólogo escribe la U a mano: el LIMS pide ese valor (`uAsignadaManual`).

### ITV05 · micropipetas (`motores/micropipeta.ts`)

V = Z·(m̄ − m_vacío) con Z = 1/(ρw − ρa)·(1 − ρa/ρB)·(1 − γ·(tw − 20)), ρw de
Tanaka, presupuesto completo de la planilla y U = máx(2·uc, CMC),
CMC = √(a·V + 0,333·r²) por rango. **Certificado en µL con 2 decimales**
(redondeo hacia arriba), error, inexactitud Et % e imprecisión CVt %.

### Correcciones a la planilla (opciones del motor)

Desactivadas, el motor da exactamente la planilla. Cada una registra la
**decisión del laboratorio** (respuesta del 15-10, C6):

| Decisión | Efecto en una calibración nueva | Correcciones |
|---|---|---|
| aplicar | activada por defecto (se puede desactivar) | M1, M6, M7, P2, P3, L1, T1 (ITL06, ITT01), L18, V5, F3, F4, F9, F10; en ITM03: M6, M7 |
| rechazada | no se puede activar (400) | P10, L8, L17, V8 (ITV02), T5a, PT3 |
| pendiente | desactivada, a elección | V2, F1, F8, G3/G4/G6 (LNF); ITM03: M10, C5 (regla del nominal superior); ITV05: V8 (signo de la evaporación), V1 (k = 2,15 del balance) |

Errores ya identificados en las planillas nuevas, reproducidos tal cual y con
su corrección como opción desactivada: **U escrita a mano** (ITM03, ítems de
300 g y 475 g = 25 mg), **signo de la evaporación** (ITV05 la resta),
**k = 2,15** solo en el balance del primer punto de ITV05 (el certificado usa
k = 2) y **u(C) sin pasar a mg** en la primera tabla de ITM03 (hallazgo nuevo M10).

## 2. Certificado de calibración

### Sin evaluación de conformidad (C1)
El LMT no evalúa conformidad: el certificado no dice «cumple / no cumple». En
fuerza (ITF01, ITF03) se informa la clase de cada punto; en par torsional e
ITM01 no hay veredicto (la verificación interna queda en el detalle del cálculo).

### Acreditación por proceso (C2)
`met_proceso.acreditacion` es del PROCESO: ITM03 **no** está acreditado (no figura
en LC 001) y su certificado dice «Laboratorio de Calibración en la magnitud
Masa», sin código. LC 004 acredita ITL01, ITL02, ITL05, ITL06, ITL07 e ITL10.
Presión (LC 022), volumen (LC 023), par (LC 108) y temperatura (LC 155) quedan
como estaban: no se entregó su alcance.

### Numeración (C3)
Número por magnitud y **sin año**: M-, V-, L-, T-, P-, F-, PT- (`met_numeracion`,
PT con 4 cifras: PT-0091). Se asigna **al emitir** (no se pierden números en
borradores). El PDF lleva **un solo identificador**: el número del certificado
(el código interno CAL-AAAA-NNNN solo aparece en el borrador). Los procesos sin
prefijo (LNF, eléctrica, tiempo) usan el código CAL-. El último número de cada
prefijo se fija en Maestros › Numeración (no puede quedar por debajo de lo ya
emitido). Valores sembrados: los más altos vistos en los documentos del 15-10.

**Reemisión**: `POST /calibraciones/:id/reemitir { motivo }` (`metrologia.emitir`
y `metrologia.crear`) crea un borrador con los mismos datos; al emitirse, su
certificado dice «Este certificado reemplaza al certificado N° …» y el anterior
queda **reemplazado** (la verificación lo informa). Una reemisión a la vez (409):
se bloquea la fila de la calibración original, así que dos peticiones simultáneas
(doble clic) dejan un solo borrador.

### Circuito de firma (C4)

```
borrador ─enviar (metrólogo)─▶ en_revision ─firmar (jefe LMT o subrogante)─▶ en_firma ─emitir (jefe de departamento o metrólogo habilitado*)─▶ emitida
   ▲                              │                                            │
   └──────────── devolver (motivo; se anulan las firmas hechas) ───────────────┘
```

- Los pasos y responsables salen de la **matriz de firmas** `CERTIFICADO_CALIBRACION`
  (regla de SAM: ELABORA metrólogo → FIRMA jefe del laboratorio → FIRMA jefe del
  departamento). Responsables: titular y subrogante de la jefatura
  (`unidad_jefe`) y quienes tengan el rol en la unidad. Nadie se adelanta; quien
  ya firmó como jefe no firma otro paso salvo que sea el único responsable.
- **Habilitación del metrólogo** por magnitud: para enviar, el autor debe estar
  vinculado a una fila vigente del **registro de firmas autorizadas**
  (`met_firmante`, LMT-PG01 Anexo 11) que incluya la magnitud del proceso, en LMT
  o LMTE. Magnitudes o laboratorios que el registro no declara (LNF) no se controlan.
  El registro sembrado identifica a las personas **solo por iniciales** (RMM jefe
  LMT, HOC subrogante, LSV, ABG, LSP, MEC metrólogos, PRE jefe de departamento);
  el administrador las vincula con su usuario en Metrología › Maestros.
- Subrogante del jefe del LMT: el registro indica al jefe de la Sección Ensayos
  Mecánicos; se configura en Administración › Unidades (LMT, subrogante). En la
  base de demostración: `demo.sem.jefe`.
- Endpoints: `POST /calibraciones/:id/enviar` (`metrologia.crear`, autor
  habilitado), `/firmar` (paso pendiente; si es el último, emite; `/emitir` es su
  alias), `/devolver { motivo }` (responsable del paso pendiente),
  `GET /calibraciones/:id/circuito`. Cada firma queda en `met_calibracion_firma`
  (nombre, grado, cargo, vía) y cada paso en `met_calibracion_evento`.
- Cada paso se identifica por **(orden, acción)**. La firma ELABORA del metrólogo
  se registra aparte (en el orden de su paso o, si la matriz no tiene ELABORA, con
  orden 0) y nunca da por firmado un paso de jefe: si el primer paso de la matriz es
  el jefe del laboratorio, él firma siempre. Unicidad en la base:
  `(calibracion_id, orden, accion)` (`align_revision_r3.sql`).
- **Emisión por el metrólogo · DECISIÓN PROVISIONAL (18-10-2026), pendiente de
  confirmar con el IDIC.** Además del Jefe de Departamento, el **metrólogo
  habilitado para la magnitud** puede firmar el paso de emisión:
  - Se configura en la matriz de firmas como **responsable alternativo** del paso
    (Administración › Matriz de firmas › Certificado de calibración › excepción
    SAM › paso 3 › ✎ › «Responsable alternativo (opcional)» = Metrólogo, «¿De qué
    unidad el alternativo?» = Misma unidad). `align_frente_k.sql` lo siembra **una
    sola vez** (`flujo_firma.alternativo_configurado_at`).
  - **Para quitarlo sin tocar código** (si el IDIC dice que no): en ese mismo paso,
    «Responsable alternativo» = «Ninguno» y Guardar. Reaplicar los SQL no lo repone.
  - El metrólogo debe figurar en el **registro de firmas autorizadas** vigente para
    la magnitud y el laboratorio de la calibración (`met_firmante`). A diferencia del
    envío, una magnitud que el registro no declara **no** habilita a nadie a emitir.
    Uno no habilitado recibe 403 con el motivo.
  - La **revisión del Jefe LMT o su subrogante sigue siendo obligatoria y anterior**:
    los pasos se firman en orden; el metrólogo no puede emitir mientras el paso
    pendiente sea el del jefe (403).
  - Puede emitir también quien elaboró la calibración (coherente con la decisión del
    14-10 para laboratorios de dos personas): la revisión del Jefe LMT queda entre
    ambos. Si el IDIC prefiere que emita otro metrólogo, es una regla a añadir.
  - La firma queda con `via = alternativo` y el rol Metrólogo; el certificado imprime
    en esa casilla «Metrólogo habilitado para la magnitud (emite)».
  - Lo prueban `emision-metrologo.spec.ts` y el paso «Emisión por el metrólogo
    habilitado» de `scripts/verificacion/metrologia-1510.js`.
- **No se envía** sin matriz que resolver: sin reglas, con error al resolverla, sin
  ningún paso de firma después del ELABORA o con un paso obligatorio sin
  responsables, `enviar` responde 409 con qué falta (si se enviara, nadie podría
  firmarla ni devolverla). Las calibraciones que ya estaban en el circuito sin
  matriz las firma quien tiene `metrologia.emitir`.

### CMC (C5)
Maestro versionado `met_cmc` con las CMC de **LC 001 Mod. 2**, **LC 004 Mod. 1** y
**LC 005 (ampliación 15-01-2026)**, más la tabla de ITV05 de su planilla. Tipos:
valor, lineal (a·L + b) y raíz. Una modificación del alcance = filas nuevas con
su versión y vigencia. En cada punto: **U certificada = máx(U, CMC)** (C12: dos
cifras significativas hacia arriba); si el proceso está acreditado y el punto
cae fuera de todas las filas vigentes, se marca **«*»** y el certificado añade
«* Las calibraciones marcadas no están incluidas en el alcance de acreditación».
ITM02 e ITV05 toman su tabla de CMC del maestro (ya no de constantes del código;
la de balanzas cambia de 0,15 a 0,12 mg en 100–200 g según LC 001 Mod. 2).

### Verificación (C7)
Al emitir: código de verificación (`XXXXX-XXXXX`, Crockford base32), cuerpo HTML
sellado guardado (`documento_html`) y su SHA-256. `GET /metrologia/verificar/:codigo`
es **público** (sin sesión): devuelve número, proceso, estado, fecha de emisión y
hash, nunca cliente ni resultados; informa si el certificado fue reemplazado.
Pantalla: Metrología › Verificar un certificado (`/metrologia/verificar`, dentro
del área con sesión, como la del SAEC).

### Unidades y decimales (C10), fechas (C11), U (C12)
- Micropipetas en **µL con 2 decimales**; masa convencional en **g con 3 decimales**
  y U en **mg**.
- Aviso (no bloquea) si la **fecha de la OT es posterior a la de recepción** o la
  recepción posterior a la calibración (caso V-5920: OT 03-09, recepción 02-09).
- U calculada con **dos cifras significativas**, redondeo hacia arriba. La U
  asignada por clase (ITM01, ITM03) se imprime como la planilla.

### Plantilla oficial de 2 páginas
Según las hojas «Certificado» de las planillas (`metrologia.certificado.ts`):

- **Página 1**: membrete, «CERTIFICADO DE CALIBRACIÓN N° …», acreditación del
  proceso, OT y fechas, instrumento (descripción, marca, modelo, serie,
  identificación especial, clase, capacidad, resolución, rango), cliente
  (cliente, solicitante, contacto, dirección), recepción y calibración, lugar,
  intervalo, temperatura, humedad y presión (± U del instrumento), método con
  revisión, desviaciones, norma base, hasta 3 patrones (marca, modelo, serie,
  clase, certificado, próxima calibración, emisor, trazabilidad), síntesis,
  firmas del jefe del departamento y del jefe del laboratorio (nombre, grado,
  cargo, fecha) y los 5 textos legales.
- **Página 2**: membrete, número, ítem, tabla de resultados propia de la
  instrucción (ITM03, ITV05, ITM01, ITM02, fuerza con clase, genérica, LNF,
  puntos), observaciones (intervalo, k = 2, 95 %, «"--" = No aplica», «*» fuera
  del alcance), firmas del jefe del laboratorio y del metrólogo y «Fin del
  certificado de calibración».
- El salto de página es `<div class="salto-pagina">` (soportado por
  `plantilla-render/pdf.renderer.ts`, cambio mínimo compartido).

### Departamento que firma
En los documentos oficiales del LMT figura «**Departamento Sistemas de Armas**»;
el organigrama del LIMS dice «Departamento Armamento y Munición» (DSA). **No se
cambió el organigrama** (lo decide el IDIC). El texto del certificado sale del
parámetro `parametro_sistema` (categoría `certificado_calibracion`, código
`nombre_departamento`), sembrado con el nombre que figura hoy en el organigrama y
editable en Administración › Parámetros. Sin parámetro, se usa el nombre del
departamento del organigrama.

## 3. Maestro de patrones y equipos auxiliares

`met_patron` cargado desde los tres Anexo02 (Fuerza 16, Longitud 22, Masa 49 =
87 equipos; 10 auxiliares: termohigrómetros, barómetros, termómetro ambiental,
comparadores, microscopio), con certificado, laboratorio emisor, última
calibración, intervalo, **vencimiento** y estado calculado a la fecha. Donde el
programa trae dos vencimientos (prórroga) se toma el último y se anota. Los
cuatro patrones de ejemplo anteriores quedan de baja.

En la calibración se eligen **hasta 3** (`patronIds`): si alguno está **vencido a
la fecha de calibración** se bloquea (400); si vence en menos de 30 días, aviso.
El certificado imprime la copia guardada (`met_calibracion.patrones`). El
patrón en texto libre de versiones anteriores ya no se acepta.
Edición (`metrologia.config`): `POST/PUT /metrologia/patrones`.

## 4. Pantallas

- **Calibraciones** (`/metrologia`): número del certificado, estado («con el jefe
  del laboratorio», «con el jefe del departamento», emitida, reemplazada), quién
  debe firmar y acciones según el servidor: Editar, Firmar y enviar, Devolver,
  Revisar y firmar, Firmar y emitir, Reemitir, Certificado (PDF).
- **Nueva calibración** (`/metrologia/nueva`): abre vacía; OT, fechas, cliente,
  instrumento, patrones del maestro, ambiente y el formulario del motor con las
  correcciones (y la respuesta del laboratorio), U calculada, CMC y U certificada.
- **Maestros y configuración** (`/metrologia/config`): patrones y equipos,
  registro de firmas, CMC, numeración, cálculo GUM y nombre del departamento.
- **Verificar un certificado** (`/metrologia/verificar`).

## 5. Permisos

Sin permisos nuevos: `metrologia.ver` (ver, vista previa, verificar, firmar el paso
que la matriz le asigna), `metrologia.crear` (registrar y enviar),
`metrologia.emitir` (reemitir; firmar las que quedaron en el circuito sin matriz), `metrologia.config` (maestros).

## 6. Pendiente del IDIC

Ver la lista de preguntas abiertas del informe del frente H (respuesta del
15-10). Además: LNF (G3, G4, G6, G7, G10), instrucciones ITME01/ITE03 y alcances
LC 022, LC 023, LC 108 y LC 155.

## 7. Calibración ligada a la OT (entrega R1, EP-04)

Especificación: `09_gestion/especificacion_procesos/EP-04_Metrologia.md`. SQL:
`packages/db/align_metrologia_ot.sql`. Reglas puras: `apps/api/src/metrologia/metrologia-ot.reglas.ts`
(pruebas en `metrologia-ot.reglas.spec.ts`). Recorrido: `scripts/verificacion/r1-r1a.js`.

### 7.1 Instrumentos de la OT (`met_ot_instrumento`)
Un ítem por instrumento. Ciclo: `por_recibir → recibido | no_apto → devuelto`; `anulado` (con
motivo) solo antes de recibir.

| Paso (EP-04) | Pantalla y botón | Quién (basta un permiso, con alcance en el laboratorio de la OT) | Regla |
|---|---|---|---|
| P0.2/P0.3 Registrar | OT › Instrumentos › «＋ Registrar instrumento» o «Cargar desde la cotización» | `ot.crear`, `ot.asignar` o `metrologia.crear` | Solo en OT de LMT, LMTE, LNF o LCAD. Desde la cotización: un ítem por unidad de cada línea, sin duplicar. IT de otro laboratorio → 400. Enlace opcional al equipo del laboratorio dueño (código del maestro de Equipos) |
| P1.3 Programar | «Asignar → metrólogo» | `ot.asignar` | Solo metrólogos del laboratorio de la OT y, si el registro de firmas declara la magnitud de la IT, habilitados para ella. Fecha prevista opcional |
| P2.1/P2.2 Recibir | «Recibir →» (registro de custodia) | `metrologia.crear` o `muestra.crear` | Fecha-hora ≥ fecha de la OT (R15 L2, **ahora bloquea**) y no futura; entregado por, estado físico (observación obligatoria si no está en buen estado), ubicación, accesorios; LNF: sentido, acondicionamiento y temperatura. «¿Se puede calibrar? No» exige motivo → `no_apto`. La OT pasa a «en análisis». Etiqueta `OT-AAAA-NNNN-Ikk` imprimible |
| P3.1 Calibrar | «Calibrar →» (abre la hoja de control) | `metrologia.crear` | **No hay calibración suelta**: `POST /metrologia/calibraciones` exige `otInstrumentoId` de un ítem recibido y calibrable; una calibración vigente por ítem. Hereda OT, cliente, fechas, instrumento e IT, que mandan sobre lo escrito. La IT la fija el ítem (la cambia quien registra antes de recibir) |
| P8.1 Entregar el certificado | «Registrar entrega →» (OT o ficha) | `certificado.entregar` o `metrologia.crear` | Solo emitido, una vez, fecha ≥ emisión y no futura (AAAA-MM-DD = día de Chile). Queda en la bitácora |
| P8.2 Devolver | «Devolver instrumento →» y «Acta» | `metrologia.crear` o `certificado.entregar` | El calibrable se devuelve con su certificado emitido; el no apto, sin él. Una vez |
| P9.1 Cierre técnico | «Cerrar técnicamente → Comercial» | `ot.asignar` | Todos los ítems con certificado emitido o no aptos → OT `finalizada` |

Rutas: `GET /ot/:id/metrologia`, `POST /ot/:id/instrumentos[/desde-cotizacion]`,
`PUT /ot/:id/instrumentos/:item`, `POST …/:item/{anular,asignar,recepcion,devolucion}`,
`GET …/:item/metrologos`, `POST /ot/:id/calibraciones/:cal/entregar`,
`POST /ot/:id/metrologia/cierre-tecnico`, `GET /metrologia/instrumentos` (por calibrar).
Van bajo `/ot` para que Comercial y Planificación trabajen sus OT sin pertenecer a SAM.

### 7.2 Cierre y factura
El cierre (`OtCierreService`, `faltantesParaCerrar`) cuenta cada certificado de calibración
vigente como un documento: emitido y entregado = oficial y entregado; en revisión o firma =
en firma; borrador = en elaboración. Además exige: instrumentos recibidos, los recibidos con
calibración y, si el parámetro `metrologia.cierre_exige_devolucion` (Administración ›
Parámetros, por defecto `si`) lo pide, todos devueltos. Las OT de calibración no tienen
resultados de laboratorio. Con cobro, el cierre crea la factura pendiente como en cualquier
OT. La reemisión tras el cierre conserva OT e ítem y no reabre la OT.

### 7.3 Ruta de la OT de Metrología
Apertura → Programación → Recepción del instrumento → Toma de datos y cálculo → Revisión
técnica → Firma y emisión → **Entrega del certificado y devolución** (ya no bloqueada) →
Cierre → Factura → Pago. El «Siguiente paso» lleva a la pestaña Instrumentos o a la ficha.

### 7.4 Ficha de calibración (`/metrologia/[id]`)
Chip de estado, barra de 6 pasos (Recepción · Toma de datos · Cálculo GUM · Revisión Jefe Lab.
· Firma y emisión · Entrega, calculada en el servidor), pestañas 1–6, circuito de 3 firmas con
sus botones, certificado en pantalla (`GET …/html?completo=1`, el mismo documento que el PDF,
en un iframe sin scripts) y bitácora. Devolver lleva la barra a «Toma de datos».

### 7.5 Numeración por laboratorio
`met_numeracion` tiene formato (`{P}` prefijo, `{N}` correlativo, `{AA}`/`{AAAA}` año), ceros y
correlativo anual. Sembrado: HT-, ME- (ITME01), TF- (ITE03) y LCPNF-NNN.AA anual (LNF, último
010.26). Se editan en Maestros › Numeración; el prefijo de un proceso, con
`PUT /metrologia/procesos/:codigo/prefijo` (`metrologia.config`). **Por confirmar con el IDIC**:
últimos números reales de HT-, ME- y TF-, qué proceso usa HT- (ITT04 no se ha entregado) y si
T- es común a LMT y LMTE.

### 7.6 Formulario por puntos
La tolerancia del fabricante queda como dato **informativo** («Dentro / Fuera» en gris, sin
«Cumple / No cumple»): el LMT no evalúa conformidad (pregunta 14 de EP-04).

### 7.7 Pendiente (fuera de R1 o a la espera del IDIC)
Informe técnico del no calibrable (EP04-12, R3: hoy el ítem no apto se cierra con su motivo y
devolución), servicio externo (EP04-13), envío del certificado por correo, actualización del
equipo del laboratorio dueño (EP04-30), códigos EN de la lista de precios en el catálogo
(EP04-01), Mi bandeja de Metrología (EP04-39) y el desglose uᵢ por punto de los motores (EP04-19).
