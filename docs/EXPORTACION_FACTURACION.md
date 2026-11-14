# Exportación de facturas para el sistema de facturación · LIMS IDIC

Esquema `lims-idic.factura.v1` · versión del documento 1.0 (14-11-2026).

## Para qué sirve

El LIMS se instala dentro de la red del IDIC y **no sale a internet**: no puede
emitir documentos tributarios electrónicos (DTE) ante el SII. Por cada factura,
el LIMS entrega dos cosas:

1. **Documento de cobro (PDF).** Acompaña el cobro al cliente. Dice en el
   encabezado y en el pie de cada página: «Documento de cobro · no es un
   documento tributario electrónico».
2. **Archivo JSON `lims-idic.factura.v1`.** Lleva los datos que necesita el
   sistema de facturación electrónica del IDIC para emitir el DTE. El IDIC (o su
   proveedor de facturación) lo importa en su aplicación.

El esquema es genérico: sigue la estructura del DTE chileno (encabezado, emisor,
receptor, detalle, descuentos globales, totales y referencias) con nombres en
español, para que cualquier sistema de facturación pueda leerlo.

## Flujo de trabajo

1. Al cerrar una OT con cobro, el LIMS crea la factura **pendiente de facturar**
   (número provisional `PEND-…`). Finanzas revisa las líneas en
   **Facturas › Revisar y emitir** y marca **Exenta de IVA** si corresponde
   (p. ej. la tasa de internación del BPCH).
2. Finanzas abre la **ficha** de la factura (clic en la fila o «Ver ficha») y
   pulsa **«Exportar para facturación (JSON)»**. También puede exportar varias
   facturas con **«Exportar para facturación (JSON)»** en la cabecera del
   listado (rango de fechas de emisión y estado).
3. El sistema de facturación importa el archivo y emite el DTE ante el SII. El
   folio que asigna el SII es el **folio tributario**.
4. Finanzas registra ese folio en **Revisar y emitir › Folio de la factura** y la
   factura queda **emitida** en el LIMS (desde ahí se registran pagos y notas de
   crédito).
5. **«Descargar documento de cobro (PDF)»** está disponible en la ficha en
   cualquier estado (una anulada sale marcada «ANULADO»).

Una factura ya emitida en el LIMS también se puede exportar: su número en el
LIMS es el folio que se registró al emitirla.

## Quién

| Acción | Permiso | Roles con el permiso hoy |
|---|---|---|
| Ver la ficha, descargar el PDF, exportar JSON (una o varias) | `factura.ver` | Finanzas, Cobranza, Administración, Comercial, Dirección, Subdirección, jefaturas de departamento, Planificación, Asesor técnico, Lector |
| Marcar exenta de IVA una factura pendiente | `factura.emitir` | Finanzas, Cobranza, Administración |

No hay permisos nuevos: son los de Facturas.

## Dónde se configuran los datos

| Dato | Dónde |
|---|---|
| Emisor (IDIC): RUT, razón social, giro, Acteco, dirección, comuna, ciudad, código de sucursal SII, correo, teléfono | **Administración › Parámetros del sistema › Parámetros de la operación › «Emisor de la factura»** (categoría `emisor_facturacion`). Todo cambio exige motivo y queda en el historial. La instalación trae valores de ejemplo «PRUEBA»: **hay que reemplazarlos** por los del IDIC |
| Receptor (cliente): RUT, razón social, giro, dirección, **comuna**, ciudad, contacto, días de crédito, forma de pago habitual | **Comercial › Clientes** (la comuna es un campo nuevo) |
| Exención de IVA de la factura | **Facturas › Revisar y emitir › «Exenta de IVA»** (solo mientras está pendiente) |

## Endpoints

Todos bajo `/api`, con el token de sesión (`Authorization: Bearer …`).

| Método y ruta | Devuelve |
|---|---|
| `GET /facturas/:id/exportacion` | Archivo JSON `lims-idic.factura.v1` de una factura (`Content-Disposition: attachment`). **409** con el motivo si no se puede exportar |
| `GET /facturas/exportacion?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&estado=` | Archivo JSON `lims-idic.factura-lote.v1` con varias facturas. `estado` vacío = todas menos las anuladas; admite `pendiente`, `emitida`, `parcial`, `pagada`, `por_cobrar` (emitidas y con pago parcial) y `anulada`. Máximo 500 facturas por archivo |
| `GET /facturas/:id/documento-cobro` | PDF/A del documento de cobro |
| `PUT /facturas/:id/exencion` `{ "exenta": true }` | Marca (o desmarca) exenta de IVA una factura **pendiente** y recalcula neto, IVA y total |

## Reglas

- **Montos enteros en pesos (CLP).** Cada monto de línea se redondea al peso; el
  IVA es `round(neto × 19 / 100)`; `total = neto + IVA + exento`.
- **Solo pesos.** Una factura en dólares no se exporta en v1 (se emite directo
  en el sistema de facturación).
- **Tipo de DTE sugerido.** 33 (factura electrónica, afecta) o 34 (factura no
  afecta o exenta). Una factura es exenta si Finanzas la marcó así; si nunca se
  marcó, se considera exenta cuando su IVA es 0 %.
- **Líneas negativas** del LIMS (descuento, ajuste de redondeo) no son ítems
  del DTE (su monto no puede ser negativo): salen como **descuentos globales**
  (`descuentosRecargos`).
- **No se exporta** (409, con lo que falta y cómo seguir):
  - una factura **anulada**;
  - si faltan datos del **receptor**: RUT con dígito verificador válido, razón
    social, giro, dirección, comuna o ciudad;
  - si faltan datos del **emisor**: RUT válido, razón social, giro, dirección,
    comuna o ciudad;
  - sin líneas, o con una línea en $ 0;
  - una afecta con IVA distinto de 19 %, o una exenta que registra IVA;
  - si los totales no cuadran (neto + IVA + exento ≠ total) o si los importes
    registrados en la factura no coinciden con sus líneas.
- **Advertencias** (se exporta igual; van en `advertencias`): datos del emisor de
  ejemplo («PRUEBA»), falta el Acteco, el cliente no tiene contacto, factura
  pendiente (el folio tributario lo asigna el sistema de facturación), tasa de
  internación marcada como afecta.
- En la exportación por rango, las facturas que no se pueden exportar van en
  `omitidas` con sus motivos; el resto, en `documentos`.

## Esquema `lims-idic.factura.v1`, campo por campo

Convenciones: fechas `AAAA-MM-DD`; montos enteros en pesos; `null` = sin dato.
Entre paréntesis, el campo equivalente del DTE del SII como referencia.

### Raíz

| Campo | Tipo | Descripción |
|---|---|---|
| `esquema` | texto | Siempre `lims-idic.factura.v1` |
| `generadoEn` | texto | Fecha y hora de la exportación con el desfase de Chile (`2026-11-14T09:04:12-03:00`) |
| `origen.sistema` | texto | `LIMS IDIC` |
| `origen.idFactura` | texto (UUID) | Identificador único de la factura en el LIMS. Sirve para no importar dos veces la misma factura |
| `origen.estadoLims` | texto | `pendiente`, `emitida`, `parcial` o `pagada` |
| `origen.origenLims` | texto o null | Cómo nació: `cierre_ot`, `tasa_internacion`, `sistema` (manual) |

### `encabezado` (IdDoc)

| Campo | Tipo | Descripción |
|---|---|---|
| `tipoDte` | número | **33** factura afecta · **34** factura exenta (TipoDTE) |
| `tipoDteNombre` | texto | «Factura electrónica» o «Factura no afecta o exenta electrónica» |
| `folioInterno` | texto | Número de la factura en el LIMS (`PEND-…` si está pendiente) |
| `folioTributario` | texto o null | null si está pendiente (lo asigna el sistema de facturación, Folio); si ya está emitida, el folio registrado en el LIMS |
| `fechaEmision` | fecha | Fecha de emisión (FchEmis). En una pendiente, la fecha del día de la exportación |
| `fechaEmisionSugerida` | sí/no | `true` si la fecha es la del día (pendiente), para que el sistema de facturación la confirme |
| `fechaVencimiento` | fecha o null | Emisión + días de crédito del cliente, solo si la forma de pago es crédito (FchVenc) |
| `formaPago.codigoSii` | número | **1** contado · **2** crédito (FmaPago) |
| `formaPago.texto` | texto | «Contado» o «Crédito» |
| `formaPago.codigoLims` / `textoLims` | texto o null | Forma de pago de la cotización o, si no hay, la habitual del cliente |
| `formaPago.diasCredito` | número | Días de crédito del cliente |
| `moneda` | texto | Siempre `CLP` en v1 |

### `emisor` (Emisor)

| Campo | Tipo | Descripción |
|---|---|---|
| `rut` | texto | RUT sin puntos, con guion y DV en mayúscula (RUTEmisor) |
| `razonSocial` | texto | Hasta 100 caracteres (RznSoc) |
| `giro` | texto | Hasta 80 caracteres (GiroEmis) |
| `acteco` | texto o null | Código de actividad económica (Acteco) |
| `direccion` | texto | Hasta 70 caracteres (DirOrigen) |
| `comuna` / `ciudad` | texto | Hasta 20 caracteres (CmnaOrigen / CiudadOrigen) |
| `codigoSucursalSii` | texto o null | Código de sucursal ante el SII (CdgSIISucur) |
| `correo` / `telefono` | texto o null | Contacto de facturación |

### `receptor` (Receptor)

| Campo | Tipo | Descripción |
|---|---|---|
| `rut` | texto | RUT sin puntos, con guion y DV en mayúscula (RUTRecep) |
| `razonSocial` | texto | Hasta 100 caracteres (RznSocRecep) |
| `giro` | texto | Hasta 40 caracteres (GiroRecep) |
| `direccion` | texto | Hasta 70 caracteres (DirRecep) |
| `comuna` / `ciudad` | texto | Hasta 20 caracteres (CmnaRecep / CiudadRecep) |
| `correo` | texto o null | Correo del cliente (CorreoRecep) |
| `contacto.nombre` / `correo` / `telefono` | texto o null | Contacto principal del cliente (Contacto) |

### `detalle[]` (Detalle)

| Campo | Tipo | Descripción |
|---|---|---|
| `linea` | número | 1, 2, 3… (NroLinDet) |
| `codigo` | objeto o null | `{ "tipo": "INT1", "valor": "1585" }`: código interno del ensayo (CdgItem); null si la línea no lo trae |
| `nombre` | texto | Hasta 80 caracteres (NmbItem) |
| `descripcion` | texto o null | Texto completo si el nombre se acortó (DscItem) |
| `cantidad` | número | Cantidad (QtyItem): en las OT, número de muestras |
| `unidad` | texto | `UN` (UnmdItem). El LIMS no guarda unidad por línea |
| `precioUnitario` | número | Puede tener decimales (PrcItem) |
| `descuentoPct` / `descuentoMonto` | número | 0 en v1: los descuentos van como descuento global |
| `montoItem` | número entero | Monto de la línea (MontoItem) |
| `indicadorExencion` | 1 o null | **1** = no afecto o exento (IndExe); null = afecto |

### `descuentosRecargos[]` (DscRcgGlobal)

| Campo | Tipo | Descripción |
|---|---|---|
| `linea` | número | 1, 2… (NroLinDR) |
| `tipoMovimiento` | texto | `D` descuento · `R` recargo (TpoMov) |
| `glosa` | texto | Hasta 45 caracteres (GlosaDR) |
| `tipoValor` | texto | `$` (TpoValor) |
| `valor` | número entero | Monto positivo (ValorDR) |
| `indicadorExencion` | 1 o null | 1 si afecta a ítems exentos (IndExeDR) |

### `totales` (Totales)

| Campo | Tipo | Descripción |
|---|---|---|
| `montoNeto` | número entero | Ítems afectos menos descuentos afectos (MntNeto). 0 en una exenta |
| `montoExento` | número entero | Ítems exentos menos descuentos exentos (MntExe) |
| `tasaIva` | número o null | **19** en una afecta; null en una exenta (TasaIVA) |
| `iva` | número entero | `round(montoNeto × 19 / 100)` (IVA) |
| `montoTotal` | número entero | `montoNeto + iva + montoExento` (MntTotal) |

### `referencias[]` (Referencia)

| Campo | Tipo | Descripción |
|---|---|---|
| `linea` | número | 1, 2… (NroLinRef) |
| `tipo` | texto | `OT`, `COTIZACION`, `OC` (orden de compra del cliente), `OPI`, `RESOLUCION` (resolución DGMN de la internación), `DISPOSICION` (disposición del Director) |
| `tipoDocSii` | texto o null | Código sugerido de tipo de documento de referencia del SII (TpoDocRef): `801` orden de compra, `804` resolución; null para los documentos internos (el sistema de facturación decide si los informa) |
| `folio` | texto | Número del documento (FolioRef). El SII admite hasta 18 caracteres: el LIMS lo entrega completo |
| `fecha` | fecha o null | Fecha del documento (FchRef) |
| `razon` | texto o null | Hasta 90 caracteres (RazonRef) |

### Resto

| Campo | Tipo | Descripción |
|---|---|---|
| `centroCosto` | objeto o null | `{ "codigo", "nombre" }` de la factura o, si no tiene, de la OT |
| `observaciones` | texto o null | Observaciones internas de la factura en el LIMS |
| `advertencias` | lista de textos | Lo que conviene revisar antes de emitir el DTE |

### Archivo de varias facturas · `lims-idic.factura-lote.v1`

| Campo | Tipo | Descripción |
|---|---|---|
| `esquema` | texto | `lims-idic.factura-lote.v1` |
| `generadoEn` | texto | Fecha y hora de la exportación |
| `filtro` | objeto | `{ "desde", "hasta", "estado" }` usados |
| `cantidad` | número | Facturas en `documentos` |
| `documentos` | lista | Un documento `lims-idic.factura.v1` por factura |
| `omitidas` | lista | `{ "idFactura", "folioInterno", "estadoLims", "motivos": [...] }` de las que no se pudieron exportar |

## Ejemplo (datos PRUEBA)

```json
{
  "esquema": "lims-idic.factura.v1",
  "generadoEn": "2026-11-14T09:04:12-03:00",
  "origen": { "sistema": "LIMS IDIC", "idFactura": "00000000-0000-0000-0000-000000000001", "estadoLims": "pendiente", "origenLims": "cierre_ot" },
  "encabezado": {
    "tipoDte": 33,
    "tipoDteNombre": "Factura electrónica",
    "folioInterno": "PEND-OT-2026-0001",
    "folioTributario": null,
    "fechaEmision": "2026-11-14",
    "fechaEmisionSugerida": true,
    "fechaVencimiento": "2026-12-14",
    "formaPago": { "codigoSii": 2, "texto": "Crédito", "codigoLims": "contado_30", "textoLims": "Contado 30 días", "diasCredito": 30 },
    "moneda": "CLP"
  },
  "emisor": {
    "rut": "11111111-1",
    "razonSocial": "PRUEBA · Razón social del emisor",
    "giro": "PRUEBA · Servicios de laboratorio de ensayo y control",
    "acteco": "PRUEBA",
    "direccion": "PRUEBA · Dirección del emisor",
    "comuna": "PRUEBA",
    "ciudad": "PRUEBA",
    "codigoSucursalSii": null,
    "correo": null,
    "telefono": null
  },
  "receptor": {
    "rut": "12345678-5",
    "razonSocial": "PRUEBA Cliente SpA",
    "giro": "PRUEBA Comercio",
    "direccion": "PRUEBA Avenida Dos 200",
    "comuna": "Providencia",
    "ciudad": "Santiago",
    "correo": "prueba.cliente@example.cl",
    "contacto": { "nombre": "PRUEBA Contacto", "correo": "prueba.contacto@example.cl", "telefono": null }
  },
  "detalle": [
    { "linea": 1, "codigo": { "tipo": "INT1", "valor": "1585" }, "nombre": "Humedad", "descripcion": null, "cantidad": 2, "unidad": "UN",
      "precioUnitario": 40000, "descuentoPct": 0, "descuentoMonto": 0, "montoItem": 80000, "indicadorExencion": null },
    { "linea": 2, "codigo": null, "nombre": "PRUEBA servicio de muestreo", "descripcion": null, "cantidad": 1, "unidad": "UN",
      "precioUnitario": 30000, "descuentoPct": 0, "descuentoMonto": 0, "montoItem": 30000, "indicadorExencion": null }
  ],
  "descuentosRecargos": [
    { "linea": 1, "tipoMovimiento": "D", "glosa": "Descuento (10 %)", "tipoValor": "$", "valor": 10000, "indicadorExencion": null }
  ],
  "totales": { "montoNeto": 100000, "montoExento": 0, "tasaIva": 19, "iva": 19000, "montoTotal": 119000 },
  "referencias": [
    { "linea": 1, "tipo": "OT", "tipoDocSii": null, "folio": "OT-2026-0001", "fecha": "2026-11-01", "razon": "Orden de trabajo del LIMS" },
    { "linea": 2, "tipo": "COTIZACION", "tipoDocSii": null, "folio": "2026-00010", "fecha": "2026-10-20", "razon": "Cotización aceptada" },
    { "linea": 3, "tipo": "OC", "tipoDocSii": "801", "folio": "4500001", "fecha": "2026-10-25", "razon": "Orden de compra del cliente" }
  ],
  "centroCosto": { "codigo": "LME-001", "nombre": "PRUEBA centro de costo" },
  "observaciones": null,
  "advertencias": [
    "Los datos del emisor son de ejemplo («PRUEBA»): reemplácelos por los del IDIC en Parámetros del sistema antes de usar el archivo.",
    "La factura está pendiente de emitir en el LIMS: el folio tributario lo asigna el sistema de facturación. Después registre ese folio en «Revisar y emitir»."
  ]
}
```

Una factura exenta (tasa de internación) cambia así: `"tipoDte": 34`, cada línea
con `"indicadorExencion": 1`, y
`"totales": { "montoNeto": 0, "montoExento": 50000, "tasaIva": null, "iva": 0, "montoTotal": 50000 }`,
con la referencia `{ "tipo": "RESOLUCION", "tipoDocSii": "804", "folio": "RES-PRUEBA-1", … }`.

## Versionado

- `lims-idic.factura.v1` no cambia el significado de sus campos. Si hiciera
  falta, se publica `lims-idic.factura.v2` y el LIMS la entrega en paralelo
  durante la transición.
- En v1 solo se pueden **agregar** campos opcionales: el sistema que importa
  debe ignorar los campos que no conoce.

## Código

| Pieza | Fichero |
|---|---|
| Reglas puras (esquema, RUT, cuadratura, validaciones) | `apps/api/src/facturacion/exportacion-factura.ts` (+ `.spec.ts`) |
| Documento de cobro (PDF) | `apps/api/src/facturacion/documento-cobro.ts` (+ `.spec.ts`) |
| Endpoints y lectura de datos | `apps/api/src/facturacion/exportacion-factura.controller.ts` |
| Base de datos | `packages/db/align_nuevo_f2.sql` (`factura.exenta_iva`, `cliente.comuna`, parámetros `emisor_facturacion`) |
| Pantallas | `apps/web/app/(app)/facturas/page.tsx` (ficha, exportación, exenta), `apps/web/app/(app)/clientes/page.tsx` (comuna) |

## Pendiente del IDIC

1. ¿Qué sistema de facturación electrónica usa el IDIC (o qué proveedor) y en qué
   formato importa los documentos? Con eso se ajusta el archivo (o se agrega un
   formato propio de ese sistema) sin cambiar v1.
2. Datos tributarios reales del IDIC como emisor: RUT, razón social, giro, Acteco,
   dirección, comuna, ciudad y código de sucursal SII (hoy son «PRUEBA»).
3. ¿La tasa de internación del BPCH se factura **exenta de IVA** (34)? Hoy el
   cálculo de la tasa le suma IVA según el parámetro y la factura nace afecta;
   la exportación lo advierte y Finanzas puede marcarla exenta antes de emitir.
4. ¿Las facturas con IVA 0 % (clientes institucionales) son exentas (34)? Hoy el
   LIMS las exporta como exentas.
