# Recepción y custodia de la muestra, equipo en la captura e informes del LME · LIMS IDIC

Entrega R1, frente r1d. Reglas que aplica el servidor desde
`packages/db/align_recepcion_custodia_equipo_lme.sql`. Especificaciones: EP-01 §1.2–1.3
y §6.4, EP-02 §1.2 y §2.1, EP-03 §1.2 y §6.3, EP-05 §3.1 y §4.9, y las respuestas del
LME del 20-10-2026. Complementa `FLUJO_QUIMICOS_RECEPCION_CALCULO.md` (recepción del
15-10), `FLUJO_LABORATORIO.md` (captura) y `FLUJO_INFORME_ENSAYO.md` (formato del informe).

- Reglas puras con pruebas: `apps/api/src/recepcion/reglas-recepcion.ts`,
  `apps/api/src/laboratorio/equipo-captura.ts`, `apps/api/src/flujo-real/recepcion-muestra.ts`,
  `apps/api/src/plantilla-render/filas-informe.ts` y `bloques-informe.ts`
  (`*.spec.ts` al lado; `informe-lme.spec.ts`).
- Verificación contra la API: `scripts/verificacion/r1-r1d.js`.

## 1. Bandeja de entrada del laboratorio

Pantalla **Laboratorio › Bandeja de entrada del laboratorio** (`/recepcion`), permiso
`muestra.crear`, solo los laboratorios del usuario (alcance por asignación).

| Columna | Qué muestra |
|---|---|
| Origen | **DCO** (cotización, disposición, OT directa) · **OT interna** (otro laboratorio pide) · **BPCH** (internación, producción nacional, reinspección, prototipo) |
| OT | Código de la OT, o de la orden interna y su OT de origen |
| Cliente / laboratorio que pide | Razón social del cliente o laboratorio solicitante |
| Producto | El de la OT o el de sus muestras; si no hay, «Se elige al recepcionar» |
| Plazo | Semáforo: vencido · vence pronto (≤ 2 días) · a tiempo · sin plazo |
| Por hacer | «Por recepcionar» o «Recepción incompleta (n de m)» |

Entra una OT abierta del laboratorio sin muestras o con alguna muestra con la recepción
incompleta, y una orden interna dirigida al laboratorio que aún no se recibe. Botón
**«Abrir → registrar muestras»** (pestaña Muestras de la OT) u «Abrir orden interna».
API: `GET /recepcion/bandeja`.

## 2. Recepción e identificación de la muestra

Pestaña **Muestras** de la OT · **«Recepcionar muestras»** → botón
**«Recepcionar → asignar y ejecutar»** (lleva a la pestaña Asignación).

| Campo | Regla |
|---|---|
| Nº de muestra interno | Correlativo por tenant, atómico. «Asignar número» por muestra o para todas; al recepcionar se asigna solo si se deja marcada la casilla. No cambia (409). Primer número: parámetro `numeracion_muestra.inicio` |
| Producto (matriz) | Por muestra. Lista del laboratorio (parámetro `producto_lab`, código `<LAB>.<código del elemento>`) o, si no tiene, los elementos de su familia; también búsqueda en el catálogo. Al elegirlo se carga su panel de ensayos (marcados si la OT no viene de una cotización). **Obligatorio** donde el parámetro `recepcion_producto_obligatorio` del laboratorio está activo |
| Toma de muestra | Lista `toma_muestra`; se agrega «Sucursal Santiago» (LME) |
| Cliente de la muestra | Del maestro de clientes; por defecto el de la OT (p. ej. el importador en una internación) |
| Identificación dada por el cliente | Texto del rótulo |
| Condición de recepción | Botones **Cumple / No cumple**; no cumple exige qué no cumple (≥ 5 caracteres) |
| Nº de sello(s) | Uno o varios, separados por coma. «Sellos verificados» exige el número |
| Destino de la muestra | análisis · testigo · en custodia · contramuestra; cada laboratorio le pone su nombre (LME «Tipo de muestra»; LCC/LTX «Destino final») |
| Ubicación | Texto o lista según el laboratorio |
| Campos propios del laboratorio | Ver §2.1 |
| ¿Requiere ensayos de otros laboratorios? | Sin cambios (recepción del 15-10) |

Las reglas se validan en `POST /flujo/ot/:id/muestras` (registro, todo o nada) y en
`PATCH /flujo/muestras/:id/recepcion` (corrección, queda en el historial de la OT con lo
anterior y lo nuevo). La API admite registrar sin recepción (los recorridos y BPCH lo
usan); la pantalla siempre la envía.

### 2.1 Campos propios de cada laboratorio (sin código)

Catálogo › Parámetros, categoría `recepcion_campo`, código `<LAB>.<campo>`, etiqueta y
valor JSON `{"tipo": "texto|numero|entero|fecha|lista|casilla", "obligatorio": true,
"opciones": [...], "ayuda": "…"}`. Un JSON mal escrito no rompe la recepción: ese campo no
se pide. `clase_custodia` y `ubicacion` van a columnas de la muestra; el resto a
`muestra.datos_recepcion`. Un campo no definido para el laboratorio se rechaza (400).

| Laboratorio | Campos sembrados (obligatorios en negrita) | Fuente |
|---|---|---|
| LME | **Tipo de muestra** (análisis / testigo / en custodia), fabricante, lote, cantidad recibida, **verificada contra la especificación técnica**, **contra la O/T**, **contra el formulario de inspección de muestreo**, ubicación (sala de preparación / bodega) | EP-01 §1.3 (LME-PG01-IT02-FORM01) |
| LPN | color, lote, especificación (MOP 5.7 / norma del cliente / ficha técnica). Una muestra por envase o producto: la pantalla pide el producto en cada una | EP-01 §1.3 |
| LCC, LTX | **Nº de pares / unidades**, **ubicación**, **destino final** (destrucción / devolución / contramuestra) | EP-03 §1.2 |
| LQA, LMB, LES | lote, fecha de elaboración, tamaño de muestra / lote | EP-02 §2.1 |
| LRB, LAM, SEO, LEM | **tipo de ítem**, **cantidad**, **lote**, modelo, fabricante, año, series, unidades destructivas, testigo, estado al ingreso (según el laboratorio) | EP-05 §3.1 |
| SVM | **chasis**, **motor**, año, km, PPU o Nº EJTO | EP-05 §3.1 |

### 2.2 Registro fotográfico de la recepción

En «Recepción…» de cada muestra. Lo sube quien recepciona (`muestra.crear`); queda en
`ot_foto` con `tipo = recepcion` ligado a la muestra y **no va al informe** salvo que se
marque en la pestaña Fotos. Quien solo tiene `muestra.ver` ve únicamente estas fotos.

## 3. Custodia y retención

- Destino **testigo**: se conserva el plazo del parámetro `retencion_muestra.testigo`
  (1 mes, EP-01 §6.4); **contramuestra**: `retencion_muestra.contramuestra` (12 meses,
  EP-03 §1.2). `retener_hasta` = recepción + plazo.
- En la cadena de custodia no se puede registrar la **destrucción** de un testigo o
  contramuestra antes de su plazo, ni nunca la de una muestra **en custodia** (se
  devuelve): 409 con el motivo.
- Cadena de custodia › «Testigos, muestras en custodia y contramuestras»: estado
  (en retención, plazo por cumplirse en 7 días, plazo cumplido, dispuesta, se devuelve).
  API: `GET /recepcion/retenciones`.
- La cadena de custodia (`/custodia`) ahora filtra por el laboratorio de la OT de la
  muestra: listado, trazabilidad (`?muestraId=`) y nuevos traspasos (`muestra.transferir`).
- Acta de destrucción LME-PG01 Anexo 06: formato no recibido (por confirmar).

## 4. Equipo usado en la captura (contrato §4.4.2)

«Captura y revisión por OT» › cada ensayo › bloque **Equipo y condiciones del ensayo**:
equipo, fecha y hora del ensayo (vacía = ahora; no futura), T (°C), HR (0–100 %) e
incertidumbre. La «Captura de resultados» antigua sale del menú: queda una sola captura.

- Equipos que se ofrecen (`GET /flujo/ot/:id/equipos`): los del laboratorio de la OT,
  los de los laboratorios de quien captura (destino de una orden interna) y el
  equipamiento común. Uno vencido, sin calibración, en calibración o fuera de servicio
  aparece deshabilitado con el motivo y el servidor lo **bloquea (409)**; uno de otro
  laboratorio, 400.
- **Obligatorio** en los métodos marcados «Exige informar el equipo al capturar»
  (Catálogo › Métodos, `cat_metodo.equipo_requerido`) o según el parámetro
  `captura_equipo.obligatorio`: `metodo` (por defecto), `numerico` (todo ensayo
  numérico) o `siempre`. Sin equipo → 400. Un ensayo que exige equipo no se captura con
  el campo rápido de la tabla: se abre el formulario.
- La fecha y hora del ensayo alimenta la tabla «Fecha del análisis» del informe (§5).

## 5. Informes del LME

Formato por plantilla (`config_informe`, pantalla «Plantillas de documentos»), campos nuevos:

| Campo | Valores | Por defecto |
|---|---|---|
| `agrupacion` | además de `muestra` y `seccion`, `unica` (una sola tabla) | `muestra` |
| `columnasRequisito` | `texto` (una columna) · `min_max` (Mínimo y Máximo) | `texto` |
| `textoSinCota` | Texto de una cota vacía en Mínimo / Máximo | «—» (LME: «-.-») |
| `unidadEnResultado` | La unidad junto al valor («0,00 mg/L») | no |
| `columnaMuestra` | Columna Muestra siempre | no |
| `etiquetas.minimo` / `maximo` / `muestra` | Títulos de esas columnas | Mínimo / Máximo / Muestra |

Bloques nuevos: `{{tabla_metodos}}` (análisis · método · fecha y hora del análisis),
`{{termograma}}` (fotos de tipo termograma, que no van al anexo) e
`{{identificacion_muestras}}` (Nº interno, producto, cliente si difiere y datos propios) y
`{{conclusion_texto}}` (la conclusión sin su título, para plantillas que numeran la sección).

| Plantilla | Para qué | Tabla de resultados |
|---|---|---|
| `LME-IT03` | Informe que genera el LIMS (cabecera BPCH si la OT es de internación) | Análisis · Mínimo · Máximo · Resultado (unidad) · Condición |
| `LME-INT` | Informe interno | Muestra · Ensayo · Requisito · Resultado · Condición (una tabla) |
| `PG09A2-LME` | Cliente externo, IDIC-PG09-ANEXO 02-02-REV05: antecedentes, identificación, 3.1 normas y métodos con la fecha del análisis, resultados y termograma, conclusiones, notas aclaratorias | Ensayo · Requisito · Resultado · Condición |

El termograma se adjunta en la pestaña Fotos con el tipo «Termograma u otro registro del
instrumento». La tabla «Muestra · Proceso · T inicial · ΔH» del termograma DSC sale de los
ensayos que el catálogo tenga para el método DSC (por confirmar con el LME).

### Circuito de aprobación del LME

Respuesta del 20-10: Analista → Jefe de Laboratorio (revisión y firma) → aprobación
técnica → Jefe DQO (aprobación administrativa y liberación; no aplica a OT interna) → DCO
(despacho). Matriz de firmas del LME para el informe de ensayo: **1 Jefe de Laboratorio ·
2 Jefe de Sección (aprobación técnica) · 3 Jefe de Departamento (oficializa)**. Se
desactiva la firma de Gestión de Calidad que estaba sembrada y no figura en el circuito.
El texto del LME dice «Asesor Técnico» y la imagen y el informe real firmado, «Jefe de
Sección»: se usa el Jefe de Sección (el rol Asesor Técnico no existe, decisión del 17-10);
se cambia en Administración › Matriz de firmas si el IDIC lo confirma.

## 6. Ruta de la OT

El siguiente paso de la etapa Recepción dice «Recepcionar las muestras: producto,
condición de recepción, Nº interno y sus ensayos». Una muestra sin el producto que exige
el laboratorio cuenta como recepción incompleta (aviso; no bloquea, como antes).

## 7. Por confirmar con el IDIC (configurable mientras tanto)

1. Producto obligatorio en LQC, LCC y LTX (hoy no: sus productos no están en el
   catálogo). Se activa en `recepcion_producto_obligatorio`.
2. Qué métodos exigen el equipo en la captura (hoy, los marcados; ninguno sembrado).
3. Primer Nº de muestra interno (continuar la numeración del LIMS antiguo).
4. Plazos de retención por laboratorio (hoy uno por clase) y acta de destrucción Anexo 06.
5. «Asesor Técnico» o Jefe de Sección en la aprobación técnica del LME.
6. Tabla del termograma DSC (Muestra · Proceso · T inicial · ΔH): ensayos del método.
7. Decimales por analito del informe del LME (el LIMS imprime el valor sin ceros finales).
