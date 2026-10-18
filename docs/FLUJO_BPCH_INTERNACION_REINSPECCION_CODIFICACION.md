# BPCH · Internación, Reinspección y Codificación Única · LIMS IDIC

El Banco de Pruebas de Chile (BPCH) pidió poder ejecutar sus procesos **desde cero**,
como en su operación: ingreso de antecedentes, creación de la OT, selección de productos
y ensayos, incorporación de muestras, registro de resultados, documentos, cambios de
estado y cierre. Este documento recoge las reglas de tres de esos procesos y la pauta de
pruebas para entregar a BPCH.

**Principio**: no hay un segundo flujo. Cada proceso es un **origen de OT** con su
expediente (antecedentes de cabecera, reglas y documento propio) y se apoya en el flujo
general ya existente: muestras → captura → revisión → aprobación → emisión → firma según
la matriz → entrega → cierre → factura (`docs/FLUJO_LABORATORIO.md`,
`docs/FLUJO_FIRMA_CIERRE.md`).

- SQL: `packages/db/align_bpch_internacion_reinspeccion.sql` (aditivo e idempotente, último de `ORDEN_SQL.txt`).
- API: `apps/api/src/bpch/` (`comun/`, `codificacion/`, `internacion/`, `reinspeccion/`). Reglas puras en `comun/reglas-bpch.ts` (pruebas en `reglas-bpch.spec.ts`).
- Pantallas: menú **BPCH · Certificación** → `/bpch/internaciones`, `/bpch/reinspecciones`, `/bpch/codificacion`.
- Verificación de punta a punta: `scripts/verificacion/bpch-internacion-reinspeccion.js`.

Fuentes: IDIC-PG 24 Anexo 03 (diagrama del subproceso Internaciones y del cobro de la
tasa), maqueta `Maqueta_BPCH_Aiuken.html` y `Paridad_BPCH_fase_por_fase_Aiuken.xlsx`
(revisadas por BPCH), flujos levantados `BPCH.json`, `INTERNACION.json`, `SUC.json`,
y el Informe de Inspección real de una reinspección (origen «REINSPECCIONES»).
**Lo que no consta en las fuentes queda como campo editable y como pregunta abierta (§6).**

---

## 1. Codificación Única

Listado oficial (DGMN/BPCH) de productos con su código único **CNC-DGMN** por fabricante.

| Regla | Fuente |
|---|---|
| Dos listados: **Explosivos** y **Sustancias químicas**; estados **Vigente** y **En receso** (la pestaña «En receso» reúne los de ambos listados) | Maqueta (3 listados oficiales) · Paridad F6 |
| Obligatorios: listado, código, fabricante/titular, producto. Para **explosivos**, además Clase/División UN y Nº UN | Paridad F6 · maqueta («al dar de alta un explosivo, División ONU y Nº ONU son obligatorios») |
| Formato del código: prefijo y cinco tramos numéricos separados por «/» (`E-I/7/176/673/30365/3202`); un tramo puede ir sin dato («-», listados químicos) | Paridad F4/F6 · BPCH.json B24 |
| El código es **único**. Se compara normalizado: sin espacios ni separador de miles (`E-I / 21 / 1433 / 7,357 / …` = `E-I/21/1433/7357/…`) | BPCH.json B24 («unicidad») · informe real de reinspección |
| Pasar a receso o reactivar exige **motivo**; queda en el historial | Maqueta (acción ↓ A receso / ↑ Reactivar) |
| Corregir el código exige motivo; cada corrección queda con el antes/después | Trazabilidad (contrato) |
| Historial por producto: alta, corrección, receso, reactivación, **certificación** (internación), **reinspección**, **cambio de titular** | BPCH.json B19/B24 · SUC.json S-22 |
| El fabricante puede ser una empresa del maestro de clientes o un nombre (fabricante extranjero) | Paridad F6 («Fabricante · RUT») |

Permisos: `bpch.codificacion.ver` (consultar; también Comercial) y
`bpch.codificacion.gestionar` (inscribir, corregir, receso, titular: Subdirección BPCH =
Jefe de Departamento BPCH, Jefe Sección Certificación, Dirección, Administración). El
mantenimiento solo lo hace la rama del BPCH (`@AmbitoUnidad("BPCH")`).

Uso al registrar casos: el formulario de internación y el de reinspección buscan en el
listado (por código, producto o fabricante) y heredan producto, genérico, código, clase y
Nº UN y el elemento del catálogo. Un código que no está en el listado **no es
reinspección** (corresponde Prototipo).

## 2. Internación (IDIC-PG 24 Anexo 03)

```
Registro de la resolución DGMN (Comercial / SCC)
  └─ Análisis técnico (SCC): ¿información completa?
        ├─ No → solicitud de antecedentes a DGMN → (respuesta) → se repite el análisis
        └─ Sí → OT automática (sin cotización ni aprobación) ──────────────┐
                 └─ si sujeta a tasa: documentación administrativa         │
                    solicitar → recibir → conforme / no conforme (→ solicitar)
Inspección (Sucursal / Delegación): lugar, fecha, inspectores, lote, tamaños
  └─ Lote = muestra de la OT con los ensayos del panel del catálogo
Resultados (flujo general): captura del inspector → revisión → aprobación
  └─ Condición final: CUMPLE si todos los lotes cumplen; NO CUMPLE si alguno no
Informe de Inspección (firma Jefe de Sucursal según la matriz)
  ├─ CUMPLE    → Certificado de Conformidad (firma Sección Certificación) → Codificación Única
  └─ NO CUMPLE → Informe de Incumplimiento (firma Jefe SCC; VB Dirección opcional)
                 → entrega a «DGMN · DCAE» (= se informa a DGMN)
Tasa (si sujeta): cálculo → remisión a facturación (une documento final + documentación conforme)
Entrega de los documentos → cierre de la OT (flujo general)
```

### 2.1 Registro

| Campo | Regla |
|---|---|
| Nº de internación | Automático `INT-AAAA-NNNN` (correlativo atómico por año) |
| Resolución DGMN (Nº y fecha) | Obligatorios. El Nº viaja a la OT (`numero_ley`, columna «Resolución» de la lista de OT de internación) |
| Empresa importadora | Obligatoria, del maestro de clientes (RUT validado en el maestro) |
| Unidad que inspecciona | Obligatoria: sucursal, delegación o sección del BPCH (= laboratorio responsable de la OT) |
| ¿Sujeta a la tasa? | Obligatorio (sí/no). Sí → documentación administrativa «pendiente»; la OT nace **con cobro** |
| Oficio, documento aduanero (DIN), país, esquema (por lotes / tipo), procedimiento | Opcionales y editables |
| Elementos (uno o más) | Elemento específico, Clase/División UN y Nº UN obligatorios; CNC con formato válido si se indica; cantidad y unidad opcionales; elemento del catálogo para el panel |

El registro se corrige (o se anula, con motivo) solo **antes** de generar la OT. La
corrección bloquea la fila del expediente: si el análisis técnico genera la OT a la vez,
o la corrección entra antes (y la OT nace con el dato corregido) o responde 409.

### 2.2 Análisis técnico y OT

- Información **incompleta** → hay que indicar destinatario en DGMN y qué falta; el
  expediente queda «Antecedentes pedidos a DGMN». La respuesta se registra con su fecha
  (no anterior al envío).
- Información **completa** → no puede quedar ninguna solicitud sin respuesta. Se genera la
  OT en la misma transacción (bloqueo de fila: dos clics no crean dos OT): origen
  `INTERNACION`, tipo de trabajo `CERTIFICACION`, laboratorio = unidad que inspecciona,
  con cobro = sujeta a tasa, descripción con el Nº de internación, resolución y elementos;
  queda en el historial de la OT.

### 2.3 Inspección y lotes

- Tamaño de muestra ≤ tamaño de lote, ambos enteros positivos (SAC-PG01-IT10 · NCh 44).
- Para registrar un lote como muestra hacen falta su identificación y sus tamaños. La
  muestra se crea con el mismo servicio que la pestaña «Muestras» del expediente
  (`RegistroMuestrasService`): ensayos del **panel del elemento** del catálogo
  (`cat_panel`), marcados de partida y editables, con su especificación del catálogo.
  El nombre de la muestra lleva el lote; `muestra.numero_lote` también.
- Los lotes se registran **todos o ninguno** en una transacción con la fila del
  expediente bloqueada: un doble envío espera al primero y recibe «ya está registrado»
  (400); si un lote falla, no queda ninguna muestra creada. Igual en la reinspección (409).
- Cabecera de inspección (lugar, fecha, inspectores por iniciales, procedimiento,
  vencimiento del producto, vigencia del informe, observaciones): editable mientras la OT
  esté abierta; es la que imprimen los documentos.

### 2.4 Resultados y documentos (flujo general + reglas BPCH)

- Captura, revisión y aprobación: las del flujo general. Cada fila **cumple ⟺ Mínimo ≤
  Resultado ≤ Máximo**; los defectos se capturan como conteo (crítico 0/0, menor 0/6).
  Si el catálogo no trae los límites, quien captura los completa en la orden.
- Emisión (`/informes/condiciones` y `/informes/emitir`, reglas nuevas en la emisión general):
  - **Certificado de Conformidad** (`CERTIFICADO_CONFORMIDAD`): solo si la condición final
    es **CUMPLE**;
  - **Informe de Incumplimiento** (`INFORME_INCUMPLIMIENTO`): solo si es **NO CUMPLE**;
  - ambos exigen el **Informe de Inspección** (`INFORME_INSPECCION`) **oficial** de la OT,
    al que hacen referencia.
- Firmantes: los de la matriz ya sembrada — Informe de Inspección: Jefe de la unidad
  (sucursal); Certificado: Jefe Sección Certificación (SCC); Incumplimiento: Jefe SCC + VB
  opcional de Dirección.
- Plantillas SCC (`SCCII`, `SCCCC`/`SCCDG`, `SCCID`/`SCCIN`): el SQL les carga un cuerpo
  con la cabecera oficial (empresa, origen, esquema, documento, procedimiento, elemento
  genérico/específico, CNC, clase UN, organismo, lugar, fecha, lote, tamaños, vencimiento,
  vigencia, condición final, Nº del Informe de Inspección) y la tabla **Inspección ·
  Mínimo · Máximo · Resultado · Unidad · Condición** (`{{tabla_inspeccion}}`). Solo si la
  plantilla seguía con el cuerpo genérico: nunca pisa una plantilla ya maquetada.
  Datos: vista `v_bpch_cabecera_ot` → `{{bpch.*}}`.
- **Informar a DGMN**: registrar la entrega del Informe de Incumplimiento oficial con
  destinatario «DGMN · DCAE» (lo hace la Subdirección BPCH, que tiene la OT en su alcance).

### 2.5 Codificación Única tras certificar

Con el Certificado de Conformidad **oficial**: cada elemento se asocia a su producto del
listado (si venía de él o si su código ya está inscrito —también por otro lote de la
misma petición: dos lotes del mismo producto nuevo se inscriben una sola vez—) con el
certificado, y queda
«certificación» en el historial; si no estaba inscrito, se inscribe (hay que elegir el
listado) con el titular = importador. Un producto **en receso** recibe el certificado pero
no cambia de estado solo (aviso: reactivarlo es una decisión de la Codificación Única).
Con NO CUMPLE no se toca la Codificación Única.

### 2.6 Tasa de internación

- Documentación administrativa: `pendiente → solicitada → recibida → conforme | no
  conforme → solicitada`. Solicitar y «no conforme» exigen detalle; todo queda en una
  bitácora del expediente.
- Cálculo (permiso `bpch.tasa.gestionar`: Comercial y jefaturas), solo con la
  documentación **conforme**:
  `tasa = CIF US$ × paridad × % afecto × % tasa` y `IVA = tasa × % IVA` (redondeo al peso).
  `% tasa` e `% IVA` son **parámetros** (Administración › Parámetros del sistema, categoría
  `bpch_tasa`: 1,5 y 19 sembrados). Calcular con otros porcentajes exige el permiso de
  configuración `catalogo.gestionar` (403 a Comercial); sin indicarlos se usan los vigentes. Se guarda en `calculo_tasa_internacion` (con quién y
  cuándo); se puede recalcular hasta remitir.
- **Remitir a facturación** exige: sujeta a tasa, documentación conforme, tasa calculada y
  el **documento final oficial** (certificado o incumplimiento: el diagrama une las dos
  ramas antes de remitir a DCO). Crea la factura **pendiente** de la OT (origen
  `tasa_internacion`, número provisional `PEND-<OT>`) con una línea por la tasa; si el
  cierre de la OT ya había dejado una factura pendiente sin líneas, se completa esa.
  Finanzas la emite con folio y registra los pagos como cualquier factura.
- El **cierre de la OT** ya no crea otra factura si existe la de la tasa (una por OT).

## 3. Reinspección

Nueva inspección de un producto o lote ya inspeccionado (traspaso, vencimiento, lote
rechazado…). Única evidencia real: un Informe de Inspección con origen «REINSPECCIONES»,
procedimiento SAC-PG05 (no entregado), esquema Tipo, firma del Jefe de Sucursal y
distribución solo interna.

| Regla | Detalle |
|---|---|
| Antecedente | Obligatorio al menos uno: **OT original** (del BPCH), **certificado/informe original** de esa OT, o **producto de la Codificación Única** |
| Herencia | De la OT original (y su internación o reinspección): titular, elemento, genérico, CNC, clase y Nº UN, lote, elemento del catálogo, unidad; de la Codificación Única: producto y titular. Todo editable antes de guardar |
| No codificado | Si se indica un código que no está en la Codificación Única: no es reinspección (corresponde Prototipo) |
| Motivo | Lista editable `bpch_motivo_reinspeccion`: Traspaso, Vencimiento, Lote rechazado, Otro (Otro exige detalle). Solo «Traspaso» está documentado |
| Solicitud | Solicitado por (cargo), documento, fecha; obligatorios los dos primeros datos y la fecha |
| ¿Con cobro? | Obligatorio elegirlo (no consta si aplica tasa) |
| OT | Se genera al registrar: origen `REINSPECCION`, tipo de trabajo `REINSPECCION`, laboratorio = unidad que inspecciona; nº `REI-AAAA-NNNN` |
| Documento | Informe de Inspección (firma Jefe de Sucursal). La pantalla no ofrece certificado (por confirmar) |
| Trazabilidad | Con el informe **oficial**: evento «reinspección» en el historial del producto. Opcional: **cambio de titular** a la empresa de destino (solo si se marca y con `bpch.codificacion.gestionar`) |

Permisos: `bpch.reinspeccion.ver` y `bpch.reinspeccion.gestionar` (solicitud y
trazabilidad: Jefe de Sucursal y jefaturas). La cabecera de inspección y el lote los
completa quien captura en la sucursal (`resultado.crear` / `muestra.crear`).

## 4. Alcance

- Un expediente lo ven y tramitan quienes tienen en su alcance la **unidad que
  inspecciona** o la **Sección Certificación de la Conformidad** (carril SCC: tramita las
  internaciones de todas las sucursales). Global: Dirección, Comercial, Planificación,
  Finanzas, Administración. Otra sucursal: 403.
- La OT sigue el alcance general (unidad responsable). La SCC no ve la OT de una
  sucursal: firma los certificados por la matriz (`Documentos por firmar`); la entrega del
  incumplimiento a DGMN la registra la Subdirección BPCH.
- Módulos: internaciones y Codificación Única `@AmbitoUnidad("BPCH","DCO")`;
  reinspecciones `@AmbitoUnidad("BPCH")`; acciones técnicas y de mantenimiento, `BPCH`.

## 5. Permisos nuevos

| Permiso | Roles |
|---|---|
| `bpch.internacion.ver`, `bpch.reinspeccion.ver`, `bpch.codificacion.ver` | SUPERADMIN, ADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB, INSPECTOR, COMERCIAL, PLANIFICACION, FINANZAS, LECTOR (+ alias JEFEDCO, JEFELAB) |
| `bpch.internacion.registrar` | SUPERADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, COMERCIAL |
| `bpch.internacion.gestionar` | SUPERADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB, INSPECTOR |
| `bpch.tasa.gestionar` | SUPERADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, COMERCIAL |
| `bpch.reinspeccion.gestionar` | SUPERADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB |
| `bpch.codificacion.gestionar` | SUPERADMIN, ADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION |

Los permisos viajan en el token: hay que volver a iniciar sesión para verlos.

## 6. Preguntas abiertas para BPCH (no constan en las fuentes)

1. **¿La OT nace al registrar la resolución o tras el análisis técnico?** La maqueta la
   creaba al registrar; el IDIC-PG 24 la pone después de «¿información completa?». Se
   implementó según el IDIC-PG 24.
2. **Tasa**: ¿lleva IVA? (se dejó parámetro, 19 %); ¿el «IVA internación» y «otros
   documentos de la operación» forman parte de la base?; reparto por centro de costo
   (observado 85 % Sucursal / 10 % OTCG / 5 % SDBPCH, sin confirmar: no se aplica);
   intereses fuera de plazo y nota de débito (los gestiona Finanzas, fuera de este cambio).
3. **Remisión de la tasa**: ¿se factura también cuando el resultado es NO CUMPLE? (el
   diagrama lleva ambas ramas a «Remitir a DCO»: implementado así).
4. **Firmantes**: el certificado real lo firma el Jefe del Escalón Internaciones; la matriz
   sembrada pide al Jefe de la Sección Certificación. Ajustable en Administración › Matriz de firmas.
5. **Reinspección** (SAC-PG05 no entregado): ¿emite certificado propio? ¿cambia siempre el
   titular tras un traspaso? ¿aplica tasa? ¿qué otros motivos existen? ¿la distribución es
   siempre interna?
6. **Codificación Única**: ¿reactivar un producto exige un certificado nuevo? ¿quién firma
   el listado (Subdirector BPCH y Jefe Depto. Control de Armas y Explosivos de DGMN)?
   ¿formato exacto del código de sustancias químicas? Falta el export del listado vigente
   para migrarlo (hoy se parte vacío).
7. **Especificaciones**: el catálogo trae Mín/Máx de los defectos (0/0, 0/6) pero no de
   muchos ensayos paramétricos (densidad, VOD, tiempo de retardo): se completan en la orden.
8. **Distribución de copias** de cada documento (texto fijo en las plantillas) y numeración
   oficial 3000/… de los documentos (hoy usan el correlativo único del LIMS).

---

## 7. Casos de prueba desde cero (pauta para BPCH)

Perfiles de la demo (uno por rol): Comercial `demo.ventas`, Jefe Sección Certificación
`demo.scc.jefe`, Jefe Sucursal Santiago `demo.sstgo.jefe`, inspector Santiago
`demo.sstgo.inspector`, Subdirección BPCH `demo.bpch.jefe`, Planificación
`demo.planificacion`, Finanzas `demo.finanzas`, Jefe Sucursal Antofagasta
`demo.santof.jefe`. Antes de empezar, Comercial crea las empresas en **Clientes**
(importador y, para C, comprador). Ningún formulario trae datos precargados.

### Caso CU-1 · Inscribir un producto en la Codificación Única
1. `demo.bpch.jefe` › BPCH · Certificación › Codificación Única › «Inscribir producto».
2. Listado Explosivos, código `E-I/21/1433/7357/30537/24369` (o uno propio), fabricante
   (buscar en clientes), producto, Clase/División UN y Nº UN. Guardar.
3. Repetir con el mismo código escrito con espacios y coma de miles.
4. Abrir el producto: «Pasar a receso» con motivo; luego «Reactivar».

**Esperado**: queda Vigente en Explosivos; el duplicado se rechaza («ya está inscrito»);
sin Nº UN o con un código sin formato se rechaza con el motivo; receso y reactivación
quedan en el historial con su motivo. `demo.ventas` consulta pero no ve «Inscribir».

### Caso IN-1 · Internación que CUMPLE, sujeta a la tasa
1. `demo.ventas` › Internaciones › «Registrar resolución DGMN»: empresa, unidad
   «SSTGO · Sucursal Santiago», Nº y fecha de resolución, ¿sujeta a la tasa? = Sí;
   elemento: buscar el producto del caso CU-1 (hereda código, clase y Nº UN) y el elemento
   del catálogo (p. ej. «Tronex Plus»). Registrar.
2. `demo.scc.jefe` › expediente › Registro y análisis: «No — solicitar antecedentes»,
   destinatario y faltante. Intentar luego «Sí» (debe estar bloqueado). Registrar la
   respuesta de DGMN. Elegir «Sí — generar la OT».
3. `demo.scc.jefe` › Tasa: solicitar documentación → registrar recepción (Nº factura
   comercial) → Conforme.
4. `demo.sstgo.inspector` › Inspección y lotes: lugar, fecha, inspectores (iniciales),
   lote, tamaño lote 1482 y muestra 36 (probar muestra 2000: rechazo). Guardar. Revisar los
   ensayos del panel y «Registrar lote como muestra».
5. `demo.sstgo.inspector` › Resultados… › «Capturar, revisar y aprobar»: capturar los
   defectos en 0 y los paramétricos dentro de rango (completar Mín/Máx si vienen vacíos).
6. `demo.sstgo.jefe` revisa la OT; `demo.bpch.jefe` aprueba.
7. `demo.sstgo.jefe` › Documentos oficiales: «¿Qué falta?» del Certificado (debe pedir
   antes el Informe de Inspección); emitir Informe de Inspección (plantilla SCCII) y
   firmarlo; emitir Certificado de Conformidad (SCCCC); `demo.scc.jefe` lo firma en
   Documentos por firmar.
8. `demo.bpch.jefe` › Codificación Única: «Inscribir / actualizar».
9. `demo.planificacion` registra la entrega del informe y del certificado.
10. `demo.ventas` › Tasa: CIF US$ 184.500, paridad 945,2, % afecto 100 → Calcular;
    «Remitir a facturación».
11. `demo.planificacion` cierra la OT.

**Esperado**: `INT-AAAA-NNNN` registrada; la OT nace solo en el paso 2 (no antes), en
SSTGO, origen Internación, con cobro y con la resolución; Antofagasta no ve el
expediente (403); el Informe de Incumplimiento no se puede emitir (condición CUMPLE); los
documentos muestran CNC, lote, clase UN y la tabla Mín/Máx/Resultado/Condición; el
producto queda con el certificado en su historial; tasa = $2.615.841 + IVA 19 % =
$3.112.851; la factura pendiente `PEND-OT-…` tiene una línea por la tasa y al cerrar no se
crea otra; las 9 fases del expediente quedan hechas.

### Caso IN-2 · Internación que NO CUMPLE, sin tasa
1. `demo.scc.jefe` registra una internación con ¿sujeta a la tasa? = No y un elemento
   escrito a mano (producto, código, clase y Nº UN); análisis «Sí».
2. Inspector: lote y tamaños; registrar el lote; capturar **1** en un «Defecto crítico».
3. Revisión y aprobación como en IN-1; Informe de Inspección emitido y firmado.
4. Intentar el Certificado de Conformidad; emitir el **Informe de Incumplimiento** (SCCID);
   firma `demo.scc.jefe` y VB `demo.director`.
5. `demo.bpch.jefe` registra la entrega del incumplimiento: medio «Oficina de partes»,
   destinatario «DGMN · DCAE», observación «Copia al internador».
6. Entregar el informe; cerrar la OT.

**Esperado**: OT sin cobro; condición NO CUMPLE; el certificado se rechaza indicando que
corresponde el Informe de Incumplimiento; la pestaña Tasa indica que no aplica; la
Codificación Única no se toca; la OT se cierra sin factura.

### Caso RE-1 · Reinspección por traspaso del producto de IN-1
1. `demo.sstgo.jefe` › Reinspecciones › «Solicitar reinspección»: OT original = la de
   IN-1 (se proponen titular, producto, código, lote); certificado original = el de IN-1;
   motivo Traspaso con empresa de destino (comprador); solicitado por, documento y fecha;
   unidad SSTGO; ¿con cobro? = No; tamaño lote 8, muestra 2. Registrar.
2. Probar: sin antecedente; con un código no codificado; motivo «Otro» sin detalle;
   muestra mayor que el lote (todos rechazados con su motivo).
3. `demo.sstgo.inspector`: cabecera de inspección; registrar el lote; capturar en 0.
4. Revisión, aprobación, Informe de Inspección (firma Jefe de Sucursal), entrega interna.
5. `demo.sstgo.jefe` intenta «Cambiar el titular» (sin permiso de la Codificación Única);
   `demo.bpch.jefe` registra la trazabilidad con cambio de titular y motivo.
6. Cerrar la OT.

**Esperado**: `REI-AAAA-NNNN` ligada a la OT y al certificado originales; OT origen
Reinspección sin cobro; el informe muestra «Reinspección» y el procedimiento; el producto
cambia de titular y su historial muestra certificación → reinspección → cambio de titular;
la OT se cierra sin factura; las 6 fases quedan hechas.

### Caso PE-1 · Permisos y alcance (transversal)
- Un analista de otro laboratorio (`demo.lqc.analista1`) no ve el menú BPCH · Certificación
  y la API responde 403.
- El inspector no registra resoluciones ni reinspecciones; Comercial no hace el análisis
  técnico, no registra lotes ni inscribe en la Codificación Única.
- La Sucursal Antofagasta no ve expedientes de Santiago.

Estos casos los ejecuta automáticamente `scripts/verificacion/bpch-internacion-reinspeccion.js`
(30 pasos; se puede repetir sobre la misma base).

## Estado que muestran las listas de internaciones

`bpch_internacion.estado` solo cambia hasta generar la OT (registrada → antecedentes
pedidos → OT generada, o anulada). Lo que muestran el listado y la ficha (`avance`,
`avanceTexto`, regla `avanceInternacion` en `comun/reglas-bpch.ts`) es el avance real,
derivado de la OT, sus lotes, sus documentos y la tasa, en el orden del flujo:
OT generada · lotes por registrar → En inspección → Informe de Inspección emitido →
Certificado de Conformidad emitido / Informe de Incumplimiento emitido → Tasa remitida a
facturación → OT cerrada (u OT anulada). El filtro por estado sigue usando el estado del
expediente («Con OT» reúne las que están en curso y las cerradas).
