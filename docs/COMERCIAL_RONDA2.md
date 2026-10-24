# Comercial · rondas 1 y 2 de observaciones (SVT / SPC) — oct-2026

Cambios comprometidos con el Departamento Comercial (Sección Ventas **SVT** y Sección
Planificación y Control **SPC**) tras las dos revisiones de la maqueta, aplicados al
producto real (API + web + BD).

- **BD:** `packages/db/align_comercial_r2.sql` (aditivo e idempotente; en `provision.sh`
  justo después de `align_parametros.sql`). `schema.prisma` actualizado y regenerado.
- **API:** `apps/api/src/cotizacion/*`, `apps/api/src/ot/*`, `apps/api/src/internacion/*`.
- **Web:** `/cotizaciones`, `/cotizaciones/nueva`, `/ot`, `/ot/[id]`, `/ot/nueva`,
  `/centros-costo`, `/clientes` y la página nueva `/internaciones`.

---

## 1. Qué cambió

### Ronda 1

| Tema | Decisión | Implementación |
|---|---|---|
| Estados de la cotización | Solo **Abierta / Aceptada / Anulada**; sin Vencida ni Revalidada (**actualizado:** desde `align_comercial_usuarios.sql` una Abierta fuera de validez pasa sola a **Vencida**, ver docs/FLUJO_COMERCIAL_USUARIOS.md §3) | Toda cotización nueva nace `abierta`. Transiciones `abierta → aceptada \| anulada` (`common/estados.ts`). Los estados antiguos (`borrador`, `enviada`, `rechazada`, `expirada`) se conservan como **histórico de solo lectura**. |
| Formatos | Solo **NORMAL** y **PERSONALIZADO** | `formato` ∈ {NORMAL, PERSONALIZADO} al crear/editar. F1–F4 quedan en el histórico. Parámetro `formato_cotizacion`. |
| Moneda | **CLP** y **USD**; el dólar del día se guarda y **congela** al emitir | `cotizacion.moneda`, `dolar_valor`, `dolar_fecha`. Cambiar el dólar de una cotización ya emitida exige `dolarMotivo` (se guarda en `dolar_motivo`). |
| Forma de pago | Solo «Contado 30 días» y «Por adelantado» | Parámetros `forma_pago`: `contado_30`, `adelantado`. Los antiguos (`contado`, `credito`, `transferencia`, `cheque`, `tarjeta`) quedan **inactivos**. |
| Descuento | **No existe** | El campo desaparece de la UI; la API solo admite `descuentoPct = 0` (cualquier otro valor → 400). |
| Referencia / Condiciones | Campos separados | `cotizacion.referencia` y `cotizacion.condiciones_adicionales`. |
| Aceptación Ejército | El documento es la **OPI** | Tipo de aceptación `OPI_RESOLUCION` (ver ronda 2). |
| Validez | Automática por IT DCO-PG01-P01-IT02 | `cotizacion.valida_hasta` (ver §2.1). |
| Medios de envío | Sin FAX | Parámetro `medio_envio`: correo electrónico, entrega en mano, courier; `fax` inactivo. |
| Línea de cotización | La línea es el **ensayo (código EN)** valorizado por su ficha de costos | `linea_cotizacion.cat_ensayo_id` + `ensayo_codigo`; el precio sale de `cat_ensayo.precio` (en USD se convierte con el dólar congelado). Las líneas libres HH/HM existentes se conservan, pero la UI de creación ya no las ofrece. |

### Ronda 2

| Punto | Decisión | Implementación |
|---|---|---|
| SVT1 | Quitar «Tipo cotización Extensión/Comprensión»; agregar «Descripción técnica y alcance» | La UI ya no muestra el tipo; `cotizacion.descripcion_tecnica`. El enum y la tabla `cotizacion_comprension` se mantienen para los datos heredados; `tipo_linea_costeo.extension` queda inactivo. |
| SVT2 | Centros de costo con sucursales BPCH, Delegación Nº 11 y LMT Área Eléctrica | `centro_costo.tipo` ∈ {`laboratorio`, `sucursal_bpch`, `delegacion_bpch`}. Siembra: 16 laboratorios (incl. `LMT-AE` · LMT Área Eléctrica), Sucursal Santiago, Antofagasta, La Serena, Calama, Copiapó, Iquique y Delegación Nº 11. El combo de la cotización agrupa «Laboratorios» / «Sucursales y Delegación BPCH». |
| SVT3 | Condiciones adicionales máx. 2000 (se imprimen); Observaciones internas (no se imprimen); texto base por laboratorio | `condiciones_adicionales VARCHAR(2000)` + CHECK; `observaciones_internas TEXT`; `centro_costo.condiciones_base` (se precarga al elegir el centro y hay botón «Usar texto base»). El PDF de la cotización imprime referencia, descripción técnica y condiciones adicionales, **nunca** las observaciones internas. |
| SVT5 / SPC2.2 | Lista única de tipos de cliente | Parámetro `tipo_cliente` (ver §3). |
| SVT6 | Documento de aceptación | `aceptacion_tipo` ∈ {`OPI_RESOLUCION`, `OC`, `CORREO`, `PAGO_ADELANTADO`, `DISPOSICION_DIRECTOR`} + `aceptacion_numero`, `aceptacion_fecha`, `aceptacion_adjunto`, `con_cobro`. |
| SVT7 | OT por disposición del Director (IDIC-PG03 6.4 g) | `orden_trabajo.opi_pendiente`: queda en TRUE si la OT nace de una disposición **con cobro** y sin OPI; se limpia con `POST /ot/:id/registrar-opi`. Una OT **sin cobro** no espera OPI pero registra `horas_hombre` y `costo_estimado`. |
| SPC2.2 | OT Interlaboratorio | `origen_trabajo = INTERLABORATORIO`: la pide un laboratorio (`lab_solicitante_cc_id`) a otro (`centro_costo_id`) sin OT padre; **nunca** tiene cobro; se costea por horas. |
| SVT8 | Búsqueda de internaciones con tasa 1,5 % | `GET /internaciones/ot` + página `/internaciones`. El cálculo sigue en `POST /cotizaciones/tasa-internacion`. |

---

## 2. Reglas de negocio

### 2.1 Validez de la cotización (IT DCO-PG01-P01-IT02)

Función pura `apps/api/src/cotizacion/validez.ts` (tests en `validez.spec.ts`):

- **Particulares:** 45 días corridos desde la emisión. Si el centro de costo tiene
  `validez_particular_dias` (p. ej. LRB, LMT), se usa ese valor.
- **Ejército:** hasta el **31 de diciembre** del año de emisión. Si se emite en
  **octubre, noviembre o diciembre**, la validez es de **6 meses** desde la emisión
  (31-oct + 6 meses → 30-abr: se ajusta al último día del mes).
- La regla de cada tipo de cliente es el campo `parametro_sistema.valor` de la
  categoría `tipo_cliente` (`EJERCITO` | `PARTICULAR`). Sembrado: solo `ejercito`
  (y el antiguo `institucional`) siguen la regla Ejército; el resto, Particular.
  El IDIC puede cambiarlo desde Parámetros sin tocar código.
- Los números (45 días / 6 meses) están en la categoría `validez_cotizacion`
  (`particular_dias`, `ejercito_meses_oct_dic`).
- La validez se calcula al emitir (y se recalcula al editar una Abierta con la
  misma fecha de emisión); se guarda en `valida_hasta` y, por compatibilidad,
  en `expira_at` y `validez_dias`. El tipo de cliente usado queda congelado en
  `tipo_cliente_codigo`. En la UI es de solo lectura, con la explicación.

> **Pendiente IDIC:** confirmar la validez propia de LRB y LMT (se configura en
> Centros de costo → «Validez cotización a particulares»). Hoy no se siembra
> ningún valor para no inventarlo.

### 2.2 Ciclo de vida de la cotización

```
           PATCH (solo Abierta)
               ┌──────┐
               ▼      │
 POST ──▶  ABIERTA ───┘ ──POST :id/aceptar {tipo,…}──▶ ACEPTADA ──▶ genera la OT
               │
               └────────POST :id/anular {motivo}────▶ ANULADA
```

- Editar el contenido (`PATCH`) solo con la cotización **Abierta** → 409 en otro caso.
- `PATCH {estado:"aceptada"|"anulada"}` se rechaza: se debe usar el endpoint propio
  (exigen documento / motivo).
- Aceptar exige `tipo`; `OPI_RESOLUCION` y `OC` exigen además `numero`.
- Una cotización histórica en estado `enviada` aún puede aceptarse sin documento
  (compatibilidad con el flujo anterior).
- Anular exige motivo; no se puede anular una cotización que ya generó OT (409).

### 2.3 OT: origen, cobro y OPI pendiente

Funciones puras en `apps/api/src/ot/reglas-ot.ts` (tests en `reglas-ot.spec.ts`).

| Origen (`origen_trabajo`) | Requisitos | Cobro | OPI pendiente |
|---|---|---|---|
| `COTIZACION` | `cotizacionId` | según aceptación (`con_cobro`) | no |
| `DISPOSICION` | `disposicionRef` | con o sin cobro | **sí**, si con cobro y sin OPI |
| `INTERLABORATORIO` | lab solicitante ≠ lab ejecutor, sin cotización | **siempre sin cobro** (pedir cobro → 400) | no |
| `INTERNACION` | `resolucion` (Nº resolución DGMN → `numero_ley`) | con cobro (tasa 1,5 %) | no |
| `OT_INTERNA` | — | según se indique | no |

- Aceptar una cotización con `DISPOSICION_DIRECTOR` crea la OT con origen
  `DISPOSICION`; con `OPI_RESOLUCION` la OT nace con la OPI ya registrada; con `OC`
  guarda `oc_numero`.
- `origen_trabajo` ya existía como texto libre heredado (p. ej. «Internación de
  armamento»): esos textos **no se modifican**; las OT nuevas guardan el código.
  Las OT con cotización y sin origen se rellenan con `COTIZACION`.
- OT Interlaboratorio sin `clienteId`: se usa el cliente de tipo `interlaboratorio`
  (registre el cliente interno, p. ej. «IDIC», con ese tipo).

---

## 3. Tipos de cliente (SVT5 / SPC2.2)

Lista única sembrada en `parametro_sistema` (categoría `tipo_cliente`):

| Código | Etiqueta | Regla de validez |
|---|---|---|
| `ley_17798` | Ley 17.798 | PARTICULAR |
| `ejercito` | Ejército | EJERCITO |
| `carabineros` | Carabineros | PARTICULAR |
| `fuerza_aerea` | Fuerza Aérea | PARTICULAR |
| `armada` | Armada | PARTICULAR |
| `pdi` | PDI | PARTICULAR |
| `gendarmeria` | Gendarmería | PARTICULAR |
| `dgmn` | DGMN | PARTICULAR |
| `particulares` | Particulares | PARTICULAR |
| `prov_ejercito` | Particular proveedor Ejército | PARTICULAR |
| `prov_carabineros` | Particular proveedor Carabineros | PARTICULAR |
| `prov_fuerza_aerea` | Particular proveedor Fuerza Aérea | PARTICULAR |
| `prov_armada` | Particular proveedor Armada | PARTICULAR |
| `interlaboratorio` | Interlaboratorio | PARTICULAR |

Los valores anteriores (`institucional`, `gubernamental`, `externo`,
`laboratorio_asociado`) quedan **desactivados, no borrados**: los clientes que los
tienen siguen funcionando, pero ya no se ofrecen en los combos. **`cliente.tipo` no
se modifica automáticamente.** En la cotización, si el cliente tiene un tipo antiguo,
la UI lo advierte y permite reclasificarlo en ese momento.

### 3.1 Consulta de reclasificación (manual, revisar antes de ejecutar)

La correspondencia antigua → nueva **no es 1:1** (p. ej. «gubernamental» incluye
universidades y empresas del Estado). Por eso se ejecuta a mano, tras revisar el
listado con Comercial:

```sql
-- 1) Revisar qué clientes tienen tipos antiguos
SELECT c.id, c.rut, c.razon_social, c.tipo
  FROM cliente c
 WHERE c.tipo IN ('institucional', 'gubernamental', 'externo', 'laboratorio_asociado')
   AND c.deleted_at IS NULL
 ORDER BY c.tipo, c.razon_social;

-- 2) Reclasificación propuesta (ajustar la lista de excepciones antes de ejecutar)
BEGIN;
-- Unidades del Ejército (antes 'institucional', o 'gubernamental' con «Ejército» en el nombre)
UPDATE cliente SET tipo = 'ejercito', updated_at = now()
 WHERE tipo = 'institucional'
    OR (tipo = 'gubernamental' AND razon_social ILIKE '%ejército%');
-- Laboratorios asociados → Interlaboratorio
UPDATE cliente SET tipo = 'interlaboratorio', updated_at = now()
 WHERE tipo = 'laboratorio_asociado';
-- Externos → Particulares (los proveedores de FF.AA. se reclasifican a mano a prov_*)
UPDATE cliente SET tipo = 'particulares', updated_at = now()
 WHERE tipo = 'externo';
-- 'gubernamental' restante: revisar uno a uno (Carabineros, FACh, Armada, PDI,
-- Gendarmería, DGMN o Particulares). Ejemplos:
-- UPDATE cliente SET tipo = 'dgmn'        WHERE id = '<uuid>';
-- UPDATE cliente SET tipo = 'carabineros' WHERE id = '<uuid>';
COMMIT;

-- 3) Verificar que no quedan tipos antiguos
SELECT tipo, count(*) FROM cliente WHERE deleted_at IS NULL GROUP BY tipo ORDER BY 1;
```

---

## 4. Endpoints

Todos bajo `/api`, con JWT. Permisos entre paréntesis.

### Cotizaciones

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/cotizaciones/config` (`cotizacion.ver`) | Combos activos (`tipo_cliente`, `forma_pago`, `formato_cotizacion`, `moneda`, `medio_envio`, `aceptacion_tipo`, `origen_trabajo`, `estado_cotizacion`), centros de costo agrupados con `condicionesBase` y `validezParticularDias`, parámetros de validez. |
| GET | `/cotizaciones/validez?clienteId=&centroCostoId=&fecha=` (`cotizacion.ver`) | Vista previa de «válida hasta» con la explicación de la regla. |
| GET | `/cotizaciones` (`cotizacion.ver`) | Lista (incluye `ot` generada con `opiPendiente`). |
| GET | `/cotizaciones/:id` (`cotizacion.ver`) | Detalle (incluye `ot`). |
| POST | `/cotizaciones` (`cotizacion.crear`) | Crea en estado **Abierta**. Body: `clienteId`, `formato` (NORMAL\|PERSONALIZADO), `centroCostoId?`, `formaPago?`, `medioEnvio?`, `moneda` (CLP\|USD), `dolarValor` (obligatorio en USD), `dolarFecha?`, `referencia?`, `descripcionTecnica?`, `condicionesAdicionales?` (≤ 2000), `observacionesInternas?`, `lineas[]` (`{catEnsayoId, cantidad}`; `precioUnitario` opcional = ficha). |
| PATCH | `/cotizaciones/:id` (`cotizacion.crear`) | Edita los mismos campos **solo si está Abierta** (409 si no). Cambiar `dolarValor` exige `dolarMotivo`. |
| POST | `/cotizaciones/:id/aceptar` (`cotizacion.aceptar`) | `{tipo, numero?, fecha?, adjunto?, conCobro=true}` → Aceptada + OT (idempotente). Devuelve `{cotizacion, ot, mensaje}`. Fuera de validez → 409. |
| POST | `/cotizaciones/:id/anular` (`cotizacion.anular`) | `{motivo}` → Anulada. `DELETE /cotizaciones/:id` se mantiene como alias sin motivo. |
| POST | `/cotizaciones/costeo`, `/cotizaciones/tasa-internacion` | Sin cambios. |
| POST | `/cotizaciones/:id/enviar`, `/:id/rechazar` | Solo para cotizaciones históricas. |

### Órdenes de trabajo

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/ot` (`ot.crear`) | Campos nuevos: `origenTrabajo`, `conCobro`, `disposicionRef`, `disposicionFecha`, `opiNumero`, `opiFecha`, `resolucion`, `centroCostoId`, `labSolicitanteCcId`, `horasHombre`, `costoEstimado`, `descripcionTrabajo`. `clienteId` opcional solo en Interlaboratorio. Calcula `opiPendiente`. |
| PATCH | `/ot/:id` (`ot.crear`) | Admite además `horasHombre` y `costoEstimado`. |
| POST | `/ot/:id/registrar-opi` (`ot.crear`) | `{numero, fecha}` → guarda la OPI y pone `opiPendiente = false`. |
| GET | `/ot`, `/ot/:id` | Devuelven `origenTrabajo`, `conCobro`, `opiPendiente`, `opiNumero`, `disposicionRef`, `horasHombre`, `costoEstimado`, … |

### Internaciones

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/internaciones/ot?resolucion=&empresa=&estado=&cobro=&limit=` (`ot.ver`) | OT de internación (`origen_trabajo = 'INTERNACION'` o texto heredado con «internaci»), con la última tasa registrada en `calculo_tasa_internacion` y el estado de cobro (`pendiente`, `facturada`, `pagada`, `sin_cobro`, a partir de `factura.ot_id`). **Defensivo**: si la BD no tiene la tabla de tasas o la columna `factura.ot_id`, devuelve esos datos en `null` e informa en `meta.fuentes`. |

### Parámetros y centros de costo

- `parametro_sistema` tiene la columna nueva `valor` (aceptada por `POST/PATCH /parametros`).
- `POST/PATCH /centros-costo` aceptan `tipo`, `condicionesBase`, `validezParticularDias`.

---

## 5. Rutas web nuevas o modificadas

| Ruta | Cambio |
|---|---|
| `/cotizaciones` | Chips de estado (Todas / Abiertas / Aceptadas / Anuladas / Histórico), panel de detalle/edición, diálogo «Registrar aceptación», diálogo «Anular». |
| `/cotizaciones/nueva` | Formulario nuevo (sin Tipo cotización, sin descuento, ensayos del catálogo, validez automática, contador 2000, observaciones internas, CLP/USD). |
| `/ot`, `/ot/[id]` | Columna/cabecera de origen, marcas «OPI pendiente» y «Sin cobro», registro de OPI. |
| `/ot/nueva` | Origen en el alta directa: Disposición, Interlaboratorio, Internación, OT interna. |
| `/internaciones` | **Nueva**: búsqueda de OT de internación con tasa y cobro. |
| `/centros-costo` | Tipo, validez para particulares y texto base de condiciones. |

## 6. Pendientes / supuestos

- **Ficha de costos:** el precio del ensayo se toma de `cat_ensayo.precio` mientras
  no exista el módulo de Fichas de Servicio (versionadas, internas).
- **Regla de validez de otras instituciones** (Carabineros, FACh, Armada…): sembradas
  como PARTICULAR; IDIC puede cambiar el `valor` a `EJERCITO` desde Parámetros.
- **Adjuntos de aceptación:** se guarda una referencia de texto (`aceptacion_adjunto`);
  el archivo se gestiona en el repositorio documental.
- **Textos base por laboratorio:** la columna existe y se edita en Centros de costo;
  los textos reales los debe entregar cada laboratorio.

## 7. Moneda: solo CLP y USD (frente f5, Mapa de migración v2.1)

- Regla de la API: `apps/api/src/common/moneda.ts` (`zMoneda`), en listas de
  precio, cotización, gastos del costeo, OT, oportunidades y órdenes de compra.
- Lista de las pantallas: el parámetro `moneda` (Parámetros del sistema), que solo
  admite CLP y USD y no se borra.
- En la base, el disparador `lims_moneda_operacion()` rechaza una moneda nueva que
  no sea CLP o USD en `lista_precio`, `cotizacion`, `ot_encargo`, `oportunidad` y
  `orden_compra`, sin tocar las filas viejas. La carga histórica (ETL) lo salta con
  `SET lims.migracion = 'on'`.
- Lo guardado en UF, EUR… se muestra tal cual («UF 2,5»), sin convertir, y es de
  solo lectura; una lista de precios histórica no da precios a la cotización.

## 8. Tarifas HH, HM y servicios primarios (frente f5, Mapa de migración v2.1)

Las tarifas del Sistema Comercial antiguo tenían tabla en `schema.sql` pero no
pantalla. Se mantienen en **Tablas maestras › Tarifas** con el CRUD de las demás
maestras (listar, buscar, crear, editar, activar o desactivar; sin borrado
físico: `DELETE` responde 409).

| Pantalla | Tabla (origen) | API |
|---|---|---|
| `/catalogo/tarifas-hh` · horas hombre por categoría | `hora_hombre_catalogo` (COM.hrshombre) | `/tarifas/hh` |
| `/catalogo/perfiles-hh` · ajuste % civil / militar | `hora_hombre_perfil` (COM.phh_hh) | `/tarifas/hh-perfiles` |
| `/catalogo/tarifas-hm` · hora máquina por equipo (EQ###) | `hora_maquina_catalogo` (COM.hrsmaquina) | `/tarifas/hm` |
| `/catalogo/servicios-primarios` | `lista_precio_servicio_primario` (COM.lps_primaria) | `/tarifas/servicios-primarios` |

- Lectura: `tarifa.ver` (Comercial, Planificación, Finanzas, Calidad, jefaturas;
  Dirección, Administración y Lector por la cascada de `align_cierre_permisos.sql`).
  El rol CLIENTE no la tiene.
- Escritura: `catalogo.gestionar` con alcance global (Calidad, Administración). Una
  jefatura de laboratorio recibe 403: son tablas comunes (`AlcanceCatalogoGuard`).
- Valores en CLP con vigencia (desde ≤ hasta). Un cambio de valor = una fila nueva
  con otra fecha de inicio.
- **Ningún cálculo las lee todavía.** El Formulario de costeo (FORM05) recibe a
  mano el valor de la hora hombre y de la hora máquina, y la ficha de costos usa
  `cat_ensayo.precio` y la lista de precios vigente. Proponer el valor de estas
  tablas en el FORM05 queda pendiente de que el IDIC confirme las tarifas.
