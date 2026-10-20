# BPCH · Producción Nacional, Prototipos y Clasificación de sustancias · LIMS IDIC

Tres procesos del Banco de Pruebas de Chile (BPCH) que se ejecutan **desde cero** en el
LIMS, sin datos precargados, apoyados en el flujo general de la OT (registro de muestras →
captura → revisión → aprobación → documento → firma según la matriz → entrega → cierre →
facturación, ver `FLUJO_LABORATORIO.md` y `FLUJO_FIRMA_CIERRE.md`). Ningún proceso duplica
ese flujo: Producción Nacional y Prototipos son **orígenes de OT** con sus antecedentes,
reglas y documento; la Clasificación de sustancias es un **maestro** que los demás usan.

- SQL: `packages/db/align_bpch_pn_prototipos_clasificacion.sql` (aditivo e idempotente, último de `ORDEN_SQL.txt`).
- API: `apps/api/src/bpch/` (`produccion-nacional/`, `prototipos/`, `clasificacion/`, `ot-desde-proceso.service.ts`).
- Reglas puras con pruebas: `reglas-pn.ts`, `reglas-prototipo.ts`, `reglas-clasificacion.ts`, `alcance-bpch.ts` (`*.spec.ts` al lado).
- Pantallas: `apps/web/app/(app)/bpch/produccion-nacional`, `/prototipos`, `/clasificaciones`; menú «BPCH · SAEC».
- Recorrido automático: `scripts/verificacion/bpch-produccion-prototipos-clasificacion.js`.

## Fuentes

| Fuente | Qué aporta |
|---|---|
| `Maqueta_BPCH_Aiuken.html` (vistas Producción Nacional, Prototipos, Clasificación) | Módulos y campos revisados por BPCH |
| `Paridad_BPCH_fase_por_fase_Aiuken.xlsx` (hojas Producción Nacional, Prototipos, Comparativa 4 caminos, Formularios) | Diferencias de cada camino frente a Internación |
| `Diagramas de Flujo/BPCH - DIAGRAMA DEL SUBPROCESO PRODUCCIÓN NACIONAL.docx` (Bizagi) | Carriles Subdirección / SCC-PN / Sucursales; correlación de ventas e informe a DCO |
| `BPCH/SAC-PG01-IT08` | Documentos legales de Producción Nacional (RAF, listado, inspección en línea, almacenamiento) |
| `BPCH/SAC-PG01-IT10` | Muestreo; excluye la línea móvil; para prototipos, pronunciamiento de la SAC sobre el tamaño de muestra |
| `BPCH/SAC-PG01-IT21`, `IT22`, `IT23` | Criterios +/− de las series de prueba ONU; registro en SAC-PG01-FORM12 |
| `scratchpad/flujos/BPCH.json`, `SUC.json` | Pasos B04/B06/B26–B28 y S-08/S-10/S-11/S-33/S-34 |

## 1. Producción Nacional

```
Fabricante (cliente) ─► RAF DGMN (línea fija/móvil) ─► O/C operativa anual (productos y cantidades)
   ─► Programa de inspecciones (mes · sucursal · producto · lote · cantidad)
      ─► OT por inspección (origen PRODUCCION_NACIONAL) ─► flujo general ─► OT cerrada = inspección ejecutada
   ─► Correlación con la relación de ventas ─► informe técnico ─► remisión a DCO
```

**Fabricante**: se registra como **cliente** (mismas reglas que Comercial: RUT módulo 11, tipo
de cliente vigente). Un RUT ya registrado se rechaza (409) diciendo a quién pertenece.

**RAF DGMN**: número (único), fecha, línea **fija o móvil** (obligatoria), planta/faena, vigencia,
listado de productos, resolución de inspección en línea (si corresponde) y de almacenamiento
de sustancias peligrosas (los documentos que revisa SAC-PG01-IT08). No se anula una RAF con
O/C vigentes.

**O/C operativa anual**: RAF vigente, número (único), año, vigencia (debe incluir el año),
**con o sin cobro** (obligatorio: las fuentes no lo fijan) y al menos un producto con unidad y
cantidad autorizada. A cada producto se le puede asociar un elemento del catálogo y una
**clasificación aprobada**. Se cierra al terminar el programa; se anula solo si no generó OT.

**Programa de inspecciones**: cada línea es **una visita o un lote = una OT**. Mes dentro de la
vigencia de la O/C; la fecha programada (opcional) debe ser de ese mes. El lugar por defecto es la
planta de la RAF. Lote y cantidad pueden completarse después (también con la OT en curso).

| Estado de la línea | Cuándo |
|---|---|
| Planificada | sin OT |
| OT en curso | con OT no cerrada ni anulada |
| Ejecutada | su OT está **cerrada** |
| OT anulada | su OT se anuló: se puede generar otra |
| Anulada | la línea se anuló (con motivo; solo sin OT vigente) |

Resumen: programadas, planificadas, en curso, ejecutadas, **atrasadas** (sin OT y con su mes ya
vencido) y pendientes.

**Generar la OT** de una línea (`POST /bpch/pn/programa/:id/generar-ot`): cliente = fabricante,
origen `PRODUCCION_NACIONAL`, laboratorio responsable = la sucursal de la línea, `numero_ley` =
Nº RAF, cobro = el de la O/C, elemento = el producto, descripción con O/C, RAF, línea, lote,
cantidad y lugar. Queda en el historial de la OT (`origen_bpch`). No se genera dos veces (bloqueo
de la fila). Avisos que no bloquean: RAF vencida («defecto crítico» según IT08) y **línea móvil**
(«SAC-PG01-IT10 excluye estos productos del muestreo NCh 44»).

**Consumo de la O/C** por producto: autorizado · planificado (sin OT, no descuenta) ·
comprometido (OT en curso) · ejecutado (OT cerrada) · saldo · % ejecutado. El exceso **se avisa**
(saldo negativo en rojo); no se bloquea porque las fuentes no lo dicen.

**Correlación y informe técnico** (cierre propio del camino, diagrama Bizagi):
1. La SCC registra la relación de ventas de un período (cantidad declarada por producto).
2. El sistema la compara con lo inspeccionado en OT **cerradas** cuya inspección cae en el período
   (fecha programada o día 1 del mes): desviación = declarado − inspeccionado; sugiere «conforme»
   si nada se vendió por sobre lo inspeccionado. **La decisión es de la persona.**
3. Conforme → informe técnico. No conforme → solicitud de información técnica a la Sucursal y su
   respuesta → ¿responde al requerimiento? Si no: solicitud a la DGMN y su respuesta → en ambos
   casos, **propuesta técnica** obligatoria.
4. «Emitir informe técnico» sella el documento (`ITPN-AAAA-NNNN`, SHA-256, HTML y PDF) y bloquea la
   correlación; «Remitir a DCO» registra quién y cuándo. Comercial (DCO) lee Producción Nacional.

**Clasificación de un producto después de crear la O/C** (pauta de pruebas BPCH, caso P1, paso 4).
En la ficha de la O/C, columna «Clasificación», botón «Asociar» (o «Cambiar» si ya tiene): mismos
permisos que crear la O/C (`bpch.pn.gestionar`, ámbito BPCH) y la O/C vigente. Solo se elige una
clasificación **aprobada**: las de borrador o registradas aparecen en el desplegable pero no se
pueden elegir, y la API las rechaza (400). Exige motivo (mínimo 5 caracteres); asociar, cambiar o
quitar queda en `bpch_oc_producto_clasificacion_hist` (quién, cuándo, antes, después, motivo) y se
ve en el mismo diálogo; la clasificación muestra su uso (O/C y producto). API:
`POST /bpch/pn/oc/:id/productos/:productoId/clasificacion { clasificacionId | null, motivo }`.
El `PATCH` del producto que cambie la clasificación también deja constancia (sin motivo).

## 2. Prototipos

```
Ingreso (fabricante · elemento nuevo · solicitud DGMN) ─► clasificación aprobada
   ─► pronunciamiento SAC (tamaño de muestra) ─► OT (origen PROTOTIPO) ─► flujo general
   ─► dictamen: aprobado → «Certificado de aprobación de tipo» · rechazado → «Informe de rechazo»
      (circuito de firmas) ─► código único CNC-DGMN del tipo aprobado
```

- **Ingreso**: fabricante, elemento, **solicitud o resolución DGMN obligatoria** («sin resolución
  DGMN no se abre expediente», BPCH.json B01), antecedentes técnicos, ficha técnica, HDS, grupo
  propuesto. Esquema **TIPO** (se aprueba el tipo, no un lote). Correlativo `PROTO-AAAA-NNNN`.
- **Pronunciamiento SAC** (SAC-PG01-IT10 «Para prototipos»): fecha de consulta y respuesta,
  referencia y **tamaño de muestra**. Es requisito para generar la OT (SUC.json S-10 → S-11).
- **OT**: unidad de BPCH que inspecciona y cobro (con/sin, obligatorio). Origen `PROTOTIPO`,
  `numero_ley` = solicitud DGMN. Con OT vigente ya no se cambian fabricante, elemento ni solicitud.
- **Dictamen** (permiso `bpch.prototipo.dictaminar`): exige todos los resultados de la OT
  aprobados. **Aprobar** exige además que todos cumplan y una **clasificación aprobada**;
  **rechazar** exige motivo. El documento se emite con la plantilla propia (`PROTO-APR` /
  `PROTO-REC`) y el tipo de documento de la matriz (`CERTIFICADO_CONFORMIDAD` /
  `INFORME_INCUMPLIMIENTO`, hoy firma el Jefe de la SCC). Se firma, entrega y la OT se cierra con
  el flujo general. Esas plantillas no se pueden emitir en otra OT ni con otro dictamen (409).
  Con el documento anulado se puede volver a dictaminar. El dictamen se toma con la fila del
  prototipo bloqueada: dos dictámenes simultáneos (p. ej. aprobado y rechazado) → uno sigue y
  el otro recibe 409; nunca se emiten dos documentos. La tabla de ensayos del documento
  imprime el **resultado final** (con fórmula y factor), el mismo con el que se calculó el
  veredicto, igual que la tabla de inspección de los documentos SCC.
- **Código único CNC-DGMN**: solo con el certificado de aprobación **oficial**; seis partes
  separadas por «/» (forma E-I/n/n/n/n/n), único entre prototipos. La inscripción en el Listado de
  Codificación Única es de ese módulo.

## 3. Clasificación de sustancias

Maestro con: sustancia, fabricante/origen, OT y muestra de las pruebas, antecedentes, **pruebas
ONU** (registro SAC-PG01-FORM12), la **decisión** y su trazabilidad. Correlativo `CLS-AAAA-NNNN`
con versiones.

| Prueba | Criterio (literal de la IT) |
|---|---|
| IT21 barrera interpuesta (Serie 1 y 2) | + si el tubo se fragmenta completamente o la placa testigo se perfora. Un solo ensayo negativo no concluye: la IT exige un segundo |
| IT22 Koenen | Placas 12→5→1 mm (Serie 1) o 12→5→2 mm (Serie 2). Efectos F, G, H = explosión. Diámetro límite = mayor orificio con explosión; + si ≥ 1,0 mm (S1) o ≥ 2,0 mm (S2). Sin explosión, negativo solo con las tres placas probadas |
| IT23 TPT | 3 ensayos; + si la presión máxima alcanza 2.070 kPa; se informa el menor tiempo 690→2.070 kPa |

**Decisión** (quien clasifica): ¿explosiva (Clase 1)? · clase/división (1.1–1.6 si es explosiva;
otra clase si no) · grupo de compatibilidad (solo Clase 1) · Nº ONU (4 dígitos) · designación
oficial · justificación. Las listas ONU están en Parámetros del sistema
(`clase_division_onu`, `grupo_compatibilidad_onu`) y el IDIC las puede editar.
**Las pruebas solo dan un indicador**; el sistema no calcula la división. Se exige justificación si
la decisión contradice el indicador o si no se registró ninguna prueba; no se registra con pruebas
sin concluir.

**Ciclo**: borrador (editable) → **registrada** (queda quién clasificó y cuándo) → **aprobada** por
otra persona (quien clasificó no aprueba: 403) → documento sellado (HTML y PDF, SHA-256).
Devolver (motivo) vuelve a borrador; anular con motivo; **reclasificar** crea una nueva versión en
borrador y, al aprobarla, la anterior queda «reemplazada».

**Uso en los demás procesos**: solo una clasificación **aprobada** se asocia a un producto de la
O/C de Producción Nacional o a un prototipo (400 si no); la ficha de la clasificación muestra
dónde se usa, el aviso del expediente de la OT de Producción Nacional muestra la del producto y
los documentos del prototipo imprimen Clase/División y Nº ONU. Lista para selectores:
`GET /bpch/clasificaciones?vigentes=1`.

## 4. Permisos, alcance y ámbito

| Permiso | Roles (siembra) |
|---|---|
| `bpch.pn.ver` · `bpch.prototipo.ver` · `bpch.clasificacion.ver` | SUPERADMIN, ADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB, INSPECTOR, CALIDAD, LECTOR, PLANIFICACION (+ alias). `bpch.pn.ver` también COMERCIAL |
| `bpch.pn.gestionar` (fabricante, RAF, O/C, correlación, informe técnico) | SUPERADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION |
| `bpch.pn.programar` (programa y OT de inspección) | los anteriores + JEFE_LAB |
| `bpch.prototipo.gestionar` (ingreso, SAC, OT, fabricante) | SUPERADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, INSPECTOR |
| `bpch.prototipo.dictaminar` (dictamen y código único) | SUPERADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION |
| `bpch.clasificacion.registrar` | SUPERADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB, INSPECTOR |
| `bpch.clasificacion.aprobar` | SUPERADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB |

- **Ámbito** (`@AmbitoUnidad`): Prototipos y Clasificación, rama BPCH (la Delegación Nº 11 entra, pero
  los listados la dejan solo en lo suyo, §6.9); Producción Nacional, lectura BPCH Certificación
  (`BPCH_CERT`: la rama BPCH sin la Delegación Nº 11) y Comercial (DCO), escrituras solo BPCH Certificación (un jefe de departamento de Comercial, que tiene `bpch.pn.gestionar` por su rol,
  no registra RAF ni O/C; quien tiene además un rol de alcance global, como Planificación, sí pasa el ámbito).
- El dictamen y el código único exigen alcance sobre la unidad **actual** de la OT del prototipo.
- Los documentos HTML se sirven con `Content-Security-Policy: default-src 'none'` (sin scripts).
- **Alcance para programar, generar OT y dictaminar** (`alcance-bpch.ts`): quien tiene la unidad en
  su alcance (la sucursal programa lo suyo; Antofagasta no programa Santiago), quien tiene la **SCC**
  en su alcance (la SCC «genera la OT asignada a la sucursal», SUC.json S-11) o alcance global. La
  unidad debe colgar de BPCH.
- La OT generada sigue las reglas del flujo general: la ven y trabajan los de su laboratorio.

## 5. Cambios fuera de `bpch/` (acotados, para la integración)

| Fichero | Cambio |
|---|---|
| `apps/api/src/plantilla-render/plantilla-render.service.ts` | `registrarContexto(clave, proveedor)`: otro módulo aporta datos (`{{prototipo.*}}`) y bloques (`{{tabla_ensayos}}`) a las plantillas y puede rechazar el uso de una plantilla propia. No pisa claves del motor |
| `apps/api/src/app.module.ts` | importa `BpchProduccionPrototiposClasificacionModule` |
| `packages/db/ORDEN_SQL.txt` | añade el SQL al final |
| `apps/web/lib/navegacion.ts` | tres entradas en la sección «BPCH · SAEC» |
| `apps/web/app/(app)/ot/[id]/page.tsx` | aviso `OrigenBpchOt` con el proceso de origen y enlace |
| `apps/web/app/(app)/cotizaciones/_components/comercial.ts` | etiquetas `PRODUCCION_NACIONAL` y `PROTOTIPO` |
| `parametro_sistema` (`origen_trabajo`) | dos valores nuevos. **No** se añadieron a `ORIGENES_OT` de `reglas-ot.ts`: estas OT nacen solo desde su proceso, no desde «Registrar OT» |

## 6. Preguntas abiertas para BPCH (no se inventó la regla)

1. **Cobro**: ¿las inspecciones de Producción Nacional y la evaluación de prototipos se cobran? ¿Base de la tasa del 1,5 % en Producción Nacional? Hoy se elige «con / sin cobro» en la O/C y al generar la OT del prototipo.
2. **Consumo de la O/C**: ¿se puede inspeccionar por sobre lo autorizado? Hoy solo se avisa.
3. **RAF vencida**: ¿se impide generar la OT o solo queda como defecto crítico (IT08)? Hoy se avisa.
4. **¿Qué cuenta como «inspeccionado»** en la correlación: la OT cerrada, el informe oficial o el certificado de control de la sucursal? Hoy, OT cerrada en el período (fecha programada o mes).
5. **Certificado de control de la sucursal** (diagrama PN: «Emisión de certificado de control») y **planilla mensual de actividades**: formato y numeración no constan; hoy la planilla se sustituye por el programa con sus OT.
6. **Prototipos**: ¿la clasificación debe existir antes de ensayar o basta antes de aprobar? (hoy, antes de aprobar). ¿Quién firma el certificado de aprobación de tipo y el rechazo? (hoy, la matriz de Certificado de conformidad / Informe de incumplimiento: Jefe SCC). ¿Se puede rechazar un tipo que cumple todas las pruebas? (hoy sí, con motivo). Formato y prefijo exactos del código único (hoy, seis partes).
7. **Clasificación**: ¿quién clasifica y quién aprueba? ¿Se clasifica a veces sin pruebas, por antecedentes? (hoy, con justificación). ¿Qué regla da la división 1.1–1.6? (las IT del BPCH no la fijan). ¿IT21 Serie 2 se hace siempre o solo si la Serie 1 es positiva? El criterio de IT23 dice «positivo si alcanza 2.070 kPa» y «negativo si en cualquiera de los ensayos es inferior»: hoy, positivo si alguno de los 3 ensayos alcanza 2.070 kPa.
8. **Plantillas oficiales** editables (Word) del certificado de tipo, del rechazo, de la clasificación y del informe técnico a DCO: hoy son formatos propios con membrete IDIC.
9. **Prototipos y clasificaciones por sucursal — DECIDIDA (frente L · fase 0, 20-10-2026)**:
   - Las **sucursales y la Delegación Nº 11** ven y gestionan **solo los de su unidad**: el prototipo,
     por la unidad actual de su OT (o la de su alta); la clasificación, por la de su OT o la de los
     prototipos que la usan.
   - La **Sección Certificación de la Conformidad (SCC)** y la **jefatura del BPCH** (y quien tiene
     alcance global) ven y gestionan **todos**.
   - Se aplica al **listado, al detalle** (también el documento y el PDF de la clasificación) **y a todas
     las escrituras**: `editar`, `pronunciamiento-sac`, `generar-ot`, `dictamen`, `codigo-cnc` y `anular`
     del prototipo; `editar`, `registrar`, `reclasificar`, `aprobar`, `devolver` y `anular` de la
     clasificación. Fuera del alcance: 403.
   - Un prototipo nace sin unidad (se elige al generar la OT): lo **ingresan** la SCC o la jefatura del
     BPCH. Una clasificación **sin OT** la registran ellas; una sucursal la registra con una OT suya.
   - Regla pura: `alcance-bpch.ts` (`filtroExpedientesBpch`, `expedienteVisible`), con pruebas en
     `alcance-bpch.spec.ts`; comprobación de punta a punta en
     `scripts/verificacion/alcance-por-laboratorio.js`.

## 7. Hallazgo en el flujo general (fuera de este frente)

La tabla `{{tabla_resultados}}` de los informes lee el nombre del analito y el límite de la
tabla antigua (`analito`, `norma_limite`); los resultados creados por el registro de muestras usan
`cat_analito_id` y los límites de la orden, así que el informe sale **sin nombre de ensayo ni
límite**. Los documentos del prototipo usan su propia tabla (`{{tabla_ensayos}}`, con catálogo y
especificación de la orden); conviene corregir la tabla general.

## 8. Casos de prueba desde cero

Perfiles de prueba (`demo.*`, ver `ACCESOS_DEMO.md`): Subdirección = `demo.bpch.jefe`; Jefe SCC =
`demo.scc.jefe`; inspectores SCC = `demo.scc.inspector1/2`; Sucursal Santiago = `demo.sstgo.jefe`
y `demo.sstgo.inspector`; otra sucursal = `demo.santof.jefe`; Comercial = `demo.ventas`; ajeno a
BPCH = `demo.lqc.analista1`. Todos los casos parten sin datos previos.

### Caso C1 · Clasificar una sustancia

| # | Quién | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | Inspector SCC | BPCH › Clasificación de sustancias › Nueva sustancia. Sustancia y antecedentes; IT21 «Aplica», Serie 1 con un ensayo sin fragmentación ni perforación. Crear borrador y «Registrar clasificación» | Código CLS-AAAA-NNNN. IT21 «Incompleto». No registra: «Pruebas sin concluir… Indique si la sustancia es explosiva» |
| 2 | Inspector SCC | Añadir un 2.º ensayo negativo en IT21; IT23 «Aplica» con 1.900, 2.350 (18 ms) y 2.100 (25 ms) kPa; responder «No» explosiva; Registrar | IT21 «Negativo», IT23 «Positivo», menor tiempo 18 ms, indicador «comportamiento explosivo». No registra: pide justificar |
| 3 | Inspector SCC | «Sí» explosiva, clase 5.1 → Registrar; luego 1.1, grupo D, Nº ONU 0081 → Registrar | 5.1 rechazada («no es de Clase 1»); con 1.1D queda «Por aprobar», resumen «1.1D · UN 0081», con quién y cuándo clasificó |
| 4 | Inspector SCC | Intentar «Aprobar» | No tiene el botón / 403 |
| 5 | Jefe SCC | Aprobar | «Aprobada»; documento sellado; «Ver documento» y «PDF» muestran pruebas, decisión, clasificó y aprobó |
| 6 | Jefe SCC | Crear y registrar otra sustancia (no explosiva, 5.1, UN 1942) e intentar aprobarla | 403 «no puede aprobar su propia clasificación» |
| 7 | Jefe BPCH | Devolver con motivo «x» y luego con un motivo real | «x» rechazado (mínimo 5 caracteres); vuelve a borrador con el motivo a la vista |
| 8 | Analista LQC | Abrir /bpch/clasificaciones | 403 «Fuera de su alcance» (el menú no muestra la entrada) |

### Caso P1 · Producción Nacional de punta a punta

| # | Quién | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | Jefe SCC | Producción Nacional › Registrar RAF › Nuevo fabricante (RUT, razón social, tipo «Ley 17.798») | Fabricante creado y seleccionado. Repetir el RUT → «ya está registrado como …» |
| 2 | Jefe SCC | Completar RAF: número, línea «Fija», planta, vigencia, resoluciones. Probar sin línea | Sin línea: error. Con línea: RAF «Vigente» en la pestaña RAF DGMN. El mismo número dos veces: rechazado |
| 3 | Jefe BPCH | Nueva O/C operativa: RAF, número, año, vigencia del año, sin elegir cobro → Registrar; luego «Sin cobro» y productos ANFO 100 t y Emulsión 5.000 u | Sin cobro elegido: error. Registrada; abre su ficha con programa vacío |
| 4 | Jefe SCC | En el producto ANFO asociar la clasificación aprobada del caso C1 (y probar con una en borrador) | Borrador rechazado; la aprobada queda y la clasificación muestra su uso en la O/C |
| 5 | Jefe Sucursal Antofagasta | Programar una inspección en SSTGO | 403 «Fuera de su alcance» |
| 6 | Jefe Sucursal Santiago | Programar: ANFO, SSTGO, mes actual, lote, 40 t. Probar una fecha programada de otro mes | Fecha de otro mes rechazada; la línea queda «Planificada» |
| 7 | Jefe SCC | Programar dos inspecciones de Emulsión en SANTOF (mes anterior y diciembre) | Se aceptan (la SCC programa cualquier sucursal); «Atrasadas: 1» |
| 8 | Jefe Sucursal Santiago | «Generar OT» de la línea de Santiago (y repetir) | OT con origen Producción Nacional, laboratorio SSTGO, resolución = RAF, sin cobro; la línea pasa a «OT en curso»; consumo ANFO comprometido 40, saldo 60. Repetir: «ya tiene una OT» |
| 9 | Inspector Santiago | Abrir la OT | Aviso «Producción Nacional · O/C … · RAF …» con enlace a la O/C |
| 10 | Inspector / Jefe Santiago / Jefe BPCH | Flujo general: Muestras (método 10019 Inspección visual), captura (crítico 0, menor 2), revisión (Jefe Sucursal), aprobación (Jefe BPCH) | Ambos ensayos «Cumple» y aprobados |
| 11 | Jefe Sucursal Santiago | Emitir informe (plantilla «SCC Informe de Inspección», tipo Informe de inspección), firmar, entregar y cerrar la OT. Probar emitir con la plantilla «BPCH · Certificado de aprobación de tipo» | La plantilla del prototipo se rechaza; el informe queda oficial, entregado; OT cerrada sin factura |
| 12 | Comercial | Abrir la O/C | Línea «Ejecutada»; ejecutadas 1 de 3; ANFO ejecutado 40 de 100 t (40 %); lote y cantidad ya no editables |
| 13 | Jefe SCC | Registrar relación de ventas del año: ANFO 50 t | Desviación +10 t, sugerencia «no conforme». Emitir sin decidir: pide indicar conformidad |
| 14 | Jefe SCC | No conforme; requerimiento a la Sucursal, respuesta, «no responde», propuesta técnica → Emitir | Falta la solicitud y respuesta de la DGMN |
| 15 | Jefe SCC / Jefe BPCH | Completar DGMN → Emitir; Remitir a DCO | Informe ITPN-AAAA-NNNN sellado, no editable; «Remitido a DCO» |
| 16 | Comercial | Abrir la correlación y «Ver informe técnico» / PDF | Lo lee (no puede editar: 403) |

### Caso T1 · Prototipo aprobado

| # | Quién | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | Inspector SCC | Prototipos › Ingresar prototipo sin solicitud DGMN; luego completo | Sin solicitud: error. Código PROTO-AAAA-NNNN, etapa «falta pronunciamiento SAC» |
| 2 | Inspector SCC | Generar OT sin pronunciamiento | Rechazado: falta el pronunciamiento SAC (IT10) |
| 3 | Inspector SCC | Registrar pronunciamiento (tamaño de muestra 3); Generar OT en SSTGO, sin cobro | OT con origen Prototipo, laboratorio SSTGO, resolución = solicitud DGMN; el pronunciamiento ya no se modifica |
| 4 | Equipo Santiago / Jefe BPCH | Flujo general en la OT (crítico 0, menor 1) | Ensayos aprobados, «Cumple» |
| 5 | Inspector SCC | Dictaminar | Sin permiso (no ve el bloque / 403) |
| 6 | Jefe SCC | Aprobar el tipo sin clasificación | Rechazado: exige clasificación aprobada |
| 7 | Inspector SCC / Jefe SCC | Asignar la clasificación del caso C1; Aprobar el tipo con fundamento | «Certificado de aprobación de tipo» en firma (Certificado de conformidad). El documento muestra empresa, elemento, solicitud DGMN, 1.1D · UN 0081 y la tabla de ensayos. Intentar otro dictamen: «documento vigente» |
| 8 | Jefe SCC | Registrar el código único antes de firmar | Rechazado: el certificado aún no es oficial |
| 9 | Jefe SCC | Firmar (Documentos por firmar); registrar código «E-I/21/1433» y luego uno de seis partes | Oficial; tres partes rechazado; seis partes registrado, etapa «Aprobado · documento oficial» |
| 10 | Jefe BPCH | Entregar el certificado y cerrar la OT | OT cerrada |

### Caso T2 · Prototipo rechazado

| # | Quién | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | Jefe SCC | Ingresar, pronunciamiento SAC (2), generar OT en SSTGO | OT de prototipo |
| 2 | Equipo Santiago / Jefe BPCH | Flujo general con defecto crítico 1 | El defecto crítico «No cumple»; resultados aprobados |
| 3 | Jefe SCC | Aprobar el tipo | Rechazado: hay ensayos que no cumplen |
| 4 | Jefe SCC | Rechazar sin motivo; luego con motivo | Sin motivo: rechazado. Con motivo: «Informe de rechazo de prototipo» en firma (Informe de incumplimiento); no admite código único |

### Recorrido automático

```
pnpm --filter @lims-idic/api build
DATABASE_URL=postgresql://lims:lims@localhost:5432/<base> node scripts/verificacion/bpch-produccion-prototipos-clasificacion.js --arrancar --base http://localhost:4121/api
```

Hace los casos C1, P1, T1 y T2 con los perfiles indicados (26 pasos) y se puede repetir sobre la
misma base.
