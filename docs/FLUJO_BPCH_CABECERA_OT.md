# Cabecera de inspección en toda OT del BPCH

Frente r1b · tema transversal T24 (EP-10 10.3 y 10.11, EP-07 7.8).
SQL: `packages/db/align_r1b_bpch_cabecera.sql`. Código: `apps/api/src/bpch/cabecera/`
(`reglas-cabecera.ts` con sus pruebas, `cabecera-ot.ts`).

## Qué cambia

La cabecera que imprimen el Informe de Inspección, el Certificado de
Conformidad y el Informe de Incumplimiento (`{{bpch.*}}`, vista
`v_bpch_cabecera_ot`) solo existía para Internación y Reinspección. La **OT
directa** de una sucursal y la de **Producción Nacional** salían sin lugar, CNC,
lote ni clase UN. Ahora toda OT del BPCH (sucursales y SCC; la Delegación Nº 11
tiene su propio proceso, EP-11) tiene su cabecera.

## Pantalla

Ficha de la OT › pestaña **«Cabecera»** › bloque **«Cabecera de inspección ·
SAC-PG01-IT10 · NCh 44»** (solo en OT del BPCH), con el aviso «Se imprime en el
Informe de Inspección y en el documento final», lo que falta para emitir y el
botón **«Guardar cabecera → muestrear lotes»**. Campos (EP-10 10.3): lugar de
inspección, dirección, comuna, contacto en el lugar, fecha de inspección,
inspectores LCA (por iniciales; se sugieren los asignados a la OT),
procedimiento de control (SAC-PG01-P01, SAC-PG05… lista abierta), documento de
origen y su fecha, esquema (por lotes / tipo), elemento genérico y específico,
CNC-DGMN, clase/división UN, Nº UN, identificación del lote, tamaños de lote y
muestra, vencimiento del producto, vigencia del informe y observaciones. Debajo,
el historial de cambios.

| Proceso | Dónde se registra |
|---|---|
| OT directa | Aquí, completa |
| Producción Nacional | Aquí; lo que no se registre sale del programa (RAF y O/C como documento, producto, lote, lugar y fecha programada) |
| Internación · Reinspección | En su expediente (como hasta ahora); aquí solo dirección, comuna y contacto |

## Reglas

- Guardar exige el **procedimiento de control**; valida el formato del CNC-DGMN
  (E-I/n/n/n/n/n), los tamaños (muestra ≤ lote, NCh 44) y que la vigencia del
  informe no sea anterior a la inspección. La fecha de inspección puede ser
  futura (se programa): «no futura» está **por confirmar** con el IDIC.
- **Emitir el Informe de Inspección** (`INFORME_INSPECCION` en una OT del BPCH)
  exige la cabecera con **lugar y fecha de inspección** (EP-10 10.11): lo dice
  «2 · Condiciones de emisión» y la Ruta de la OT («Siguiente paso: completar la
  cabecera de inspección», con el botón a la pestaña Cabecera).
- Editable mientras la OT esté abierta; cada cambio queda en
  `bpch_cabecera_ot_historial` (campo, antes, después, quién y cuándo).
- Permisos: ver, `ot.ver` con la OT en su alcance; registrar,
  `bpch.cabecera.gestionar` (jefaturas, inspectores) con la OT en su alcance.

## API

| Ruta | Permiso |
|---|---|
| `GET /bpch/cabecera-ot/:otId` — cabecera propia, la que imprimen los documentos, qué falta y el historial | `ot.ver` |
| `PUT /bpch/cabecera-ot/:otId` — guardar (con historial) | `bpch.cabecera.gestionar` |

## Por confirmar con el IDIC

- Si la fecha de inspección puede ser futura (EP-10 10.3).
- Cómo se calcula la vigencia del informe y del certificado (EP-10 P7).
- Si se siguen imprimiendo nombre y correo del contacto (EP-10 P14): hoy se
  pide «cargo o iniciales».

Recorridos: `scripts/verificacion/r1-r1b.js` (sección BPCH: OT directa de la
Sucursal Santiago) y `bpch-produccion-prototipos-clasificacion.js` (paso B8:
la OT de Producción Nacional registra su cabecera antes de emitir).
