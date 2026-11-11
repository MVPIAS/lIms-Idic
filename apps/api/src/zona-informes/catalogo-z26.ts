/**
 * Zona de informes · bases de datos del documento Z26 del IDIC (frente S4).
 *
 * El IDIC (SPC) pidió por escrito «Exportación de datos y generación de bases de
 * datos LIMS» con su planilla «Filtros para exportar información»: cinco bases
 * exportables a Excel con filtros —cotizaciones, OT externas e interlaboratorio,
 * OT internas, ensayos, y recursos y costos (equipos, personal, insumos,
 * vehículos)—. Se suman las que pidieron las reuniones R1, R2, R5, R9 y R10:
 * ensayos por OT, recursos usados por OT, costo cotizado frente a costo real por
 * OT (con semáforo), inventario valorizado por bodega y consumos valorizados.
 *
 * Mismas reglas que catalogo.ts (se integran allí): SQL fijo en este fichero, la
 * entrada del usuario siempre como parámetro posicional y alcance por
 * laboratorio. Este fichero NO importa valores de catalogo.ts (evita el ciclo):
 * solo tipos.
 *
 * Lo que el LIMS aún no registra queda dicho en la descripción del informe
 * («Pendiente del IDIC»): personal y vehículos requeridos por ensayo, valor hora
 * de cada equipo y costo de los insumos.
 */
import type { Base, InformeFijo } from "./catalogo";
import { UMBRALES_POR_DEFECTO } from "../laboratorio/costos-reales";
import { SQL_HOY } from "../common/fecha-chile";

export const AREA_Z26 = "Bases de datos y costos (Z26)" as const;

const PEDIDO = "Documento Z26 del IDIC · Exportación de datos y generación de bases de datos LIMS";
const CC = `COALESCE(NULLIF(TRIM(COALESCE(cc.codigo, '') || ' · ' || COALESCE(cc.nombre, cc.descripcion, '')), '·'), cc.sigla)`;
const LAB = `COALESCE(u.sigla, u.nombre)`;

/** Alcance de una OT: laboratorio responsable o destino de una de sus órdenes internas. */
const ALCANCE_OT = (k: string) =>
  `(o.unidad_principal = ANY(${k}) OR EXISTS (SELECT 1 FROM orden_interna oix WHERE oix.ot_id = o.id AND oix.deleted_at IS NULL AND oix.destino_lab = ANY(${k})))`;

/** Facturas vigentes de la OT (o de su cotización): número, fecha y monto. */
const FACT = (ot: string, cot: string) =>
  `FROM factura fz WHERE fz.deleted_at IS NULL AND fz.estado <> 'anulada' AND (fz.ot_id = ${ot} OR (${cot} IS NOT NULL AND fz.cotizacion_id = ${cot}))`;
const SEL_FACTURA = (ot: string, cot: string) => `(SELECT string_agg(COALESCE(fz.numero, fz.codigo), ', ' ORDER BY fz.fecha_emision) ${FACT(ot, cot)}) AS factura,
  (SELECT MIN(fz.fecha_emision) ${FACT(ot, cot)}) AS fecha_factura,
  (SELECT SUM(fz.total) ${FACT(ot, cot)}) AS monto_factura`;

/** Costo real registrado en las planillas de la OT (todas las de sus laboratorios). */
const COSTO_REAL_OT = (ot: string) =>
  `(SELECT SUM(lz.total) FROM ot_costo_real crz JOIN ot_costo_real_linea lz ON lz.planilla_id = crz.id WHERE crz.ot_id = ${ot})`;

/** Umbrales del semáforo (parámetros costo_real.*); si faltan o no cuadran, los de ejemplo. */
const A = UMBRALES_POR_DEFECTO.amarilloPct;
const R = UMBRALES_POR_DEFECTO.rojoPct;
const NUM = (cod: string) =>
  `MAX(CASE WHEN ps.codigo = '${cod}' AND replace(ps.valor, ',', '.') ~ '^[0-9]+(\\.[0-9]+)?$' THEN replace(ps.valor, ',', '.')::numeric END)`;
const LATERAL_UMBRALES = `LEFT JOIN LATERAL (
      SELECT CASE WHEN x.r >= x.a THEN x.a ELSE ${A} END AS amarillo, CASE WHEN x.r >= x.a THEN x.r ELSE ${R} END AS rojo
        FROM (SELECT COALESCE(${NUM("semaforo_amarillo_pct")}, ${A}) AS a, COALESCE(${NUM("semaforo_rojo_pct")}, ${R}) AS r
                FROM parametro_sistema ps WHERE ps.tenant_id = o.tenant_id AND ps.categoria = 'costo_real' AND ps.activo) x
    ) um ON TRUE`;

const BASE_OT_Z26: Base = {
  from: `orden_trabajo o
    LEFT JOIN cliente c ON c.id = o.cliente_id
    LEFT JOIN unidad u ON u.id = o.unidad_principal
    LEFT JOIN centro_costo cc ON cc.id = o.centro_costo_id
    LEFT JOIN cotizacion cot ON cot.id = o.cotizacion_id`,
  donde: `o.tenant_id = $1::uuid`,
  fecha: `COALESCE(o.fecha_recepcion, o.created_at)`,
  unidad: (p) => `o.unidad_principal = ${p}`,
  centroCosto: `o.centro_costo_id`,
  estado: `o.estado`,
  texto: [`o.codigo`, `c.razon_social`, `c.rut`, `cot.codigo`],
  alcance: ALCANCE_OT,
};

export const BASES_Z26 = {
  ot_z26: BASE_OT_Z26,
  /** OT con su costo cotizado (estimado), su costo real (planillas) y los umbrales del semáforo. */
  costo_ot: {
    ...BASE_OT_Z26,
    from: `${BASE_OT_Z26.from}
    LEFT JOIN LATERAL (
      SELECT SUM(l.total) AS total,
             SUM(l.total) FILTER (WHERE l.categoria = 'horas_hombre') AS hh_monto,
             SUM(l.cantidad) FILTER (WHERE l.categoria = 'horas_hombre') AS hh,
             SUM(l.total) FILTER (WHERE l.categoria = 'reactivos') AS insumos,
             SUM(l.total) FILTER (WHERE l.categoria = 'equipos') AS equipos,
             SUM(l.total) FILTER (WHERE l.categoria IN ('otros', 'ot_interna', 'comision')) AS otros,
             COUNT(DISTINCT cr.id) AS planillas,
             COUNT(DISTINCT cr.id) FILTER (WHERE cr.estado = 'cerrada') AS cerradas
        FROM ot_costo_real cr LEFT JOIN ot_costo_real_linea l ON l.planilla_id = cr.id
       WHERE cr.ot_id = o.id
    ) rz ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(cot.costos_directos_total, 0),
                      (SELECT NULLIF(SUM(sc.costo_directo), 0) FROM solicitud_costeo sc WHERE sc.cotizacion_id = cot.id AND sc.deleted_at IS NULL),
                      NULLIF(o.costo_estimado, 0)) AS costo,
             COALESCE((SELECT NULLIF(SUM(sc.horas_hombre), 0) FROM solicitud_costeo sc WHERE sc.cotizacion_id = cot.id AND sc.deleted_at IS NULL),
                      NULLIF(o.horas_hombre, 0)) AS hh
    ) ez ON TRUE
    ${LATERAL_UMBRALES}`,
  },
  orden_interna_z26: {
    from: `orden_interna oi
      JOIN orden_trabajo o ON o.id = oi.ot_id
      LEFT JOIN cliente c ON c.id = o.cliente_id
      LEFT JOIN unidad uo ON uo.id = oi.origen_lab
      LEFT JOIN unidad ud ON ud.id = oi.destino_lab`,
    donde: `oi.tenant_id = $1::uuid AND oi.deleted_at IS NULL`,
    fecha: `oi.created_at`,
    unidad: (p) => `(oi.origen_lab = ${p} OR oi.destino_lab = ${p})`,
    estado: `oi.estado`,
    texto: [`oi.numero`, `o.codigo`, `c.razon_social`, `oi.detalle`],
    alcance: (k) => `(oi.origen_lab = ANY(${k}) OR oi.destino_lab = ANY(${k}))`,
  },
  /** Ensayos (resultados) de cada OT. */
  resultado_ot: {
    from: `resultado r
      JOIN muestra m ON m.id = r.muestra_id
      JOIN orden_trabajo o ON o.id = COALESCE(r.ot_id, m.ot_id)
      LEFT JOIN cliente c ON c.id = o.cliente_id
      LEFT JOIN unidad u ON u.id = o.unidad_principal
      LEFT JOIN centro_costo cc ON cc.id = o.centro_costo_id
      LEFT JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
      LEFT JOIN cat_ensayo ce ON ce.id = cm.ensayo_id
      LEFT JOIN cat_familia fa ON fa.id = ce.familia_id
      LEFT JOIN equipo eq ON eq.id = r.equipo_id
      LEFT JOIN usuario ua ON ua.id = COALESCE(r.analista_id, r.capturado_por)`,
    donde: `r.tenant_id = $1::uuid AND r.deleted_at IS NULL`,
    fecha: `COALESCE(o.fecha_recepcion, o.created_at)`,
    unidad: (p) => `o.unidad_principal = ${p}`,
    centroCosto: `o.centro_costo_id`,
    estado: `r.estado`,
    texto: [`o.codigo`, `m.codigo`, `ce.codigo`, `ce.nombre`, `cm.codigo`, `c.razon_social`],
    alcance: ALCANCE_OT,
  },
  /** Líneas de las planillas de costos reales (recursos usados por OT). */
  costo_linea: {
    from: `ot_costo_real_linea l
      JOIN ot_costo_real cr ON cr.id = l.planilla_id
      JOIN orden_trabajo o ON o.id = cr.ot_id
      LEFT JOIN cliente c ON c.id = o.cliente_id
      LEFT JOIN unidad u ON u.id = cr.unidad_id
      LEFT JOIN centro_costo cc ON cc.id = o.centro_costo_id
      LEFT JOIN equipo eq ON eq.id = l.equipo_id`,
    donde: `cr.tenant_id = $1::uuid`,
    fecha: `COALESCE(o.fecha_recepcion, o.created_at)`,
    unidad: (p) => `cr.unidad_id = ${p}`,
    centroCosto: `o.centro_costo_id`,
    estado: `cr.estado`,
    texto: [`o.codigo`, `l.descripcion`, `l.cargo`, `eq.codigo`, `eq.nombre`],
    alcance: (k) => `cr.unidad_id = ANY(${k})`,
  },
  /** Catálogo de ensayos con su laboratorio, método y recursos del método. */
  ensayo_z26: {
    from: `cat_ensayo e
      LEFT JOIN cat_metodo m ON m.ensayo_id = e.id AND m.deleted_at IS NULL
      LEFT JOIN cat_familia fa ON fa.id = e.familia_id`,
    donde: `e.tenant_id = $1::uuid AND e.deleted_at IS NULL`,
    fecha: `e.created_at`,
    texto: [`e.codigo`, `e.nombre`, `m.codigo`, `m.nombre`, `m.instrumento`, `fa.laboratorio`, `fa.nombre`],
    alcance: null,
  },
  equipo_z26: {
    // Tarifa HM vigente del equipo: por el equipo o por su código EQ### (como la planilla de costos).
    from: `equipo eq LEFT JOIN unidad u ON u.id = eq.unidad_id
      LEFT JOIN LATERAL (
        SELECT h.valor_hora_clp AS valor FROM hora_maquina_catalogo h
         WHERE h.tenant_id = eq.tenant_id AND h.activo
           AND (h.equipo_id = eq.id OR (h.equipo_id IS NULL AND upper(h.codigo) = upper(eq.codigo)))
           AND h.vigente_desde <= ${SQL_HOY} AND (h.vigente_hasta IS NULL OR h.vigente_hasta >= ${SQL_HOY})
         ORDER BY (h.equipo_id IS NOT NULL) DESC, h.vigente_desde DESC LIMIT 1
      ) hm ON TRUE`,
    donde: `eq.tenant_id = $1::uuid AND eq.deleted_at IS NULL`,
    fecha: `COALESCE(eq.fecha_adquisicion, eq.created_at::date)`,
    unidad: (p) => `eq.unidad_id = ${p}`,
    estado: `eq.estado`,
    texto: [`eq.codigo`, `eq.nombre`, `eq.descripcion`, `eq.fabricante`, `eq.modelo`, `eq.serie`],
    alcance: (k) => `eq.unidad_id = ANY(${k})`,
  },
  tarifa_hh: {
    from: `hora_hombre_catalogo h`,
    donde: `h.tenant_id = $1::uuid`,
    fecha: `h.vigente_desde`,
    texto: [`h.categoria`, `h.descripcion`],
    alcance: null,
  },
  consumible_z26: {
    from: `consumible co
      LEFT JOIN LATERAL (
        SELECT SUM(l.cantidad_actual) AS stock,
               SUM(l.cantidad_actual * COALESCE(l.costo_unitario_clp, NULLIF(co.costo_unitario_clp, 0))) AS valor,
               COUNT(*) FILTER (WHERE l.cantidad_actual > 0 AND l.costo_unitario_clp IS NULL AND NULLIF(co.costo_unitario_clp, 0) IS NULL) AS sin_costo,
               COUNT(*) FILTER (WHERE l.cantidad_actual > 0) AS lotes
          FROM lote_consumible l WHERE l.consumible_id = co.id
      ) st ON TRUE`,
    donde: `co.tenant_id = $1::uuid`,
    fecha: `CURRENT_DATE`,
    texto: [`co.codigo`, `co.nombre`, `co.tipo`],
    alcance: null,
  },
  vehiculo_z26: {
    from: `tarifa_vehiculo tv`,
    donde: `tv.tenant_id = $1::uuid`,
    fecha: `tv.vigente_desde`,
    texto: [`tv.categoria`, `tv.descripcion`],
    alcance: null,
  },
  /** Lotes con stock por bodega (central y sub-bodegas). */
  lote_bodega: {
    from: `lote_consumible l
      JOIN consumible co ON co.id = l.consumible_id
      LEFT JOIN bodega b ON b.id = l.bodega_id
      LEFT JOIN unidad u ON u.id = b.unidad_id`,
    donde: `l.tenant_id = $1::uuid AND l.cantidad_actual > 0`,
    fecha: `COALESCE(l.fecha_recepcion, CURRENT_DATE)`,
    unidad: (p) => `b.unidad_id = ${p}`,
    estado: `l.estado`,
    texto: [`co.codigo`, `co.nombre`, `l.numero_lote`, `b.codigo`, `b.nombre`],
    alcance: (k) => `(b.unidad_id = ANY(${k}) OR b.tipo = 'central' OR b.id IS NULL)`,
  },
  /** Consumos del kardex con su ensayo, OT, bodega y costo del lote. */
  consumo: {
    from: `movimiento_consumible mc
      JOIN lote_consumible l ON l.id = mc.lote_id
      JOIN consumible co ON co.id = l.consumible_id
      LEFT JOIN bodega b ON b.id = l.bodega_id
      LEFT JOIN muestra m ON m.id = mc.muestra_id
      LEFT JOIN orden_trabajo o ON o.id = COALESCE(mc.ot_id, m.ot_id)
      LEFT JOIN cliente c ON c.id = o.cliente_id
      LEFT JOIN unidad u ON u.id = COALESCE(b.unidad_id, o.unidad_principal)
      LEFT JOIN centro_costo cc ON cc.id = o.centro_costo_id
      LEFT JOIN cat_metodo cm ON cm.id = mc.cat_metodo_id
      LEFT JOIN cat_ensayo ce ON ce.id = cm.ensayo_id`,
    donde: `mc.tenant_id = $1::uuid AND mc.tipo = 'consumo'`,
    fecha: `mc.created_at`,
    unidad: (p) => `(b.unidad_id = ${p} OR o.unidad_principal = ${p})`,
    centroCosto: `o.centro_costo_id`,
    texto: [`o.codigo`, `m.codigo`, `co.codigo`, `co.nombre`, `l.numero_lote`, `ce.codigo`, `ce.nombre`],
    alcance: (k) => `(b.unidad_id = ANY(${k}) OR o.unidad_principal = ANY(${k}))`,
  },
} satisfies Record<string, Base>;

type ClaveZ26 = keyof typeof BASES_Z26 | "cotizacion";
export type InformeZ26 = Omit<InformeFijo, "base"> & { base: ClaveZ26 };

const TODOS = ["fecha", "laboratorio", "centroCosto", "estado", "texto"] as InformeFijo["filtros"];
const ANALISTA_SVT = `(SELECT us.nombre_completo FROM usuario us WHERE us.id = COALESCE(cot.ejecutivo_id, cot.created_by))`;
const DETALLE_COT = `(SELECT string_agg(COALESCE(lc.ensayo_codigo || ' ', '') || COALESCE(lc.descripcion, ''), '; ' ORDER BY lc.orden) FROM linea_cotizacion lc WHERE lc.cotizacion_id = cot.id)`;
const OI_DE_OT = (ot: string) => `(SELECT string_agg(oiz.numero, ', ' ORDER BY oiz.numero) FROM orden_interna oiz WHERE oiz.ot_id = ${ot} AND oiz.deleted_at IS NULL)`;
const CARGO = `COALESCE((SELECT ps.etiqueta FROM parametro_sistema ps WHERE ps.tenant_id = cr.tenant_id AND ps.categoria = 'cargo_costo' AND ps.codigo = l.cargo),
  (SELECT 'Tarifa HH · ' || COALESCE(h.descripcion, h.categoria) FROM hora_hombre_catalogo h WHERE h.tenant_id = cr.tenant_id AND 'HH:' || h.categoria = l.cargo ORDER BY h.vigente_desde DESC LIMIT 1),
  l.cargo)`;
const HOY = SQL_HOY;
const VIGENTE = (t: string) => `${t}.activo AND ${t}.vigente_desde <= ${HOY} AND (${t}.vigente_hasta IS NULL OR ${t}.vigente_hasta >= ${HOY})`;

export const INFORMES_Z26: InformeZ26[] = [
  // ---------------------------------------------------------------- 01 · Cotizaciones
  {
    clave: "z26-cotizaciones",
    titulo: "Base de cotizaciones",
    area: AREA_Z26,
    descripcion:
      "Z26 · 01: cotizaciones con requirente y tipo, laboratorio o sucursal, fechas, plazo, estado, detalle del trabajo, precio, analista SVT, OT asociada y su estado, OT internas y factura.",
    legado: [],
    pedido: `${PEDIDO} (01)`,
    permiso: "reporte.comercial.ver",
    base: "cotizacion",
    filtros: TODOS,
    columnas: [
      { clave: "cotizacion", titulo: "N° cotización", tipo: "texto" },
      { clave: "requirente", titulo: "Requirente", tipo: "texto" },
      { clave: "tipo_requirente", titulo: "Tipo de requirente", tipo: "estado" },
      { clave: "laboratorio", titulo: "Laboratorio o sucursal", tipo: "texto" },
      { clave: "creacion", titulo: "Fecha de creación", tipo: "fecha" },
      { clave: "solicitud", titulo: "Fecha de solicitud", tipo: "fecha" },
      { clave: "aceptacion", titulo: "Fecha de aceptación", tipo: "fecha" },
      { clave: "plazo", titulo: "Plazo (días)", tipo: "numero" },
      { clave: "estado", titulo: "Estado cotización", tipo: "estado" },
      { clave: "detalle", titulo: "Ensayo o detalle del trabajo", tipo: "texto" },
      { clave: "precio", titulo: "Precio cotizado (neto)", tipo: "monto", total: true },
      { clave: "analista", titulo: "Analista responsable SVT", tipo: "texto" },
      { clave: "ot", titulo: "OT asociada", tipo: "texto" },
      { clave: "estado_ot", titulo: "Estado de la OT", tipo: "estado" },
      { clave: "considera_oi", titulo: "Considera OT internas", tipo: "si_no" },
      { clave: "factura", titulo: "N° factura", tipo: "texto" },
      { clave: "fecha_factura", titulo: "Fecha factura", tipo: "fecha" },
      { clave: "monto_factura", titulo: "Monto factura", tipo: "monto", total: true },
    ],
    select: `cot.codigo AS cotizacion, c.razon_social AS requirente, COALESCE(cot.tipo_cliente_codigo, c.tipo) AS tipo_requirente,
      COALESCE(${LAB}, ${CC}) AS laboratorio, cot.created_at AS creacion, COALESCE(cot.solicitud_fecha, cot.fecha_emision) AS solicitud,
      COALESCE(cot.aceptacion_fecha, cot.aceptada_at::date) AS aceptacion, cot.plazo_entrega_dias AS plazo, cot.estado AS estado,
      ${DETALLE_COT} AS detalle, cot.neto AS precio, ${ANALISTA_SVT} AS analista,
      (SELECT ox.codigo FROM orden_trabajo ox WHERE ox.id = cot.ot_id) AS ot, (SELECT ox.estado FROM orden_trabajo ox WHERE ox.id = cot.ot_id) AS estado_ot,
      EXISTS (SELECT 1 FROM orden_interna oiz WHERE oiz.ot_id = cot.ot_id AND oiz.deleted_at IS NULL) AS considera_oi,
      ${SEL_FACTURA("cot.ot_id", "cot.id")}`,
    orden: "cot.created_at DESC, cot.codigo",
  },
  // ---------------------------------------------------------------- 02 · OT externas e interlaboratorio
  {
    clave: "z26-ot-externas",
    titulo: "Base de OT externas e interlaboratorio",
    area: AREA_Z26,
    descripcion:
      "Z26 · 02: cada OT con requirente y tipo, laboratorio, fechas, plazo, clasificación, estado, detalle, precio y estado de la cotización, analista SVT, OT internas asociadas, costo real y factura.",
    legado: [],
    pedido: `${PEDIDO} (02)`,
    permiso: "reporte.comercial.ver",
    base: "ot_z26",
    filtros: TODOS,
    columnas: [
      { clave: "ot", titulo: "N° OT", tipo: "texto" },
      { clave: "requirente", titulo: "Requirente", tipo: "texto" },
      { clave: "tipo_requirente", titulo: "Tipo de requirente", tipo: "estado" },
      { clave: "laboratorio", titulo: "Laboratorio o sucursal", tipo: "texto" },
      { clave: "origen", titulo: "Origen", tipo: "estado" },
      { clave: "creacion", titulo: "Fecha de creación", tipo: "fecha" },
      { clave: "solicitud", titulo: "Fecha de solicitud", tipo: "fecha" },
      { clave: "aceptacion", titulo: "Fecha de aceptación", tipo: "fecha" },
      { clave: "plazo", titulo: "Plazo comprometido", tipo: "fecha" },
      { clave: "clasificacion", titulo: "Clasificación (tipo de trabajo)", tipo: "estado" },
      { clave: "estado", titulo: "Estado de la OT", tipo: "estado" },
      { clave: "detalle", titulo: "Ensayo o detalle del trabajo", tipo: "texto" },
      { clave: "cotizacion", titulo: "Cotización", tipo: "texto" },
      { clave: "estado_cotizacion", titulo: "Estado cotización", tipo: "estado" },
      { clave: "precio", titulo: "Precio cotizado (neto)", tipo: "monto", total: true },
      { clave: "analista", titulo: "Analista responsable SVT", tipo: "texto" },
      { clave: "ot_internas", titulo: "OT internas asociadas", tipo: "texto" },
      { clave: "costo_real", titulo: "Costo real", tipo: "monto", total: true },
      { clave: "factura", titulo: "N° factura", tipo: "texto" },
      { clave: "fecha_factura", titulo: "Fecha factura", tipo: "fecha" },
      { clave: "monto_factura", titulo: "Monto factura", tipo: "monto", total: true },
    ],
    select: `o.codigo AS ot, c.razon_social AS requirente, COALESCE(cot.tipo_cliente_codigo, c.tipo) AS tipo_requirente, ${LAB} AS laboratorio,
      o.origen_trabajo AS origen, o.created_at AS creacion, COALESCE(cot.solicitud_fecha, cot.fecha_emision) AS solicitud,
      COALESCE(cot.aceptacion_fecha, cot.aceptada_at::date) AS aceptacion, o.fecha_compromiso AS plazo, o.tipo_trabajo AS clasificacion,
      o.estado AS estado, COALESCE(NULLIF(o.descripcion_trabajo, ''), ${DETALLE_COT}) AS detalle, cot.codigo AS cotizacion,
      cot.estado AS estado_cotizacion, COALESCE(cot.neto, o.costo_estimado) AS precio, ${ANALISTA_SVT} AS analista,
      ${OI_DE_OT("o.id")} AS ot_internas, ${COSTO_REAL_OT("o.id")} AS costo_real, ${SEL_FACTURA("o.id", "o.cotizacion_id")}`,
    orden: "COALESCE(o.fecha_recepcion, o.created_at) DESC, o.codigo",
  },
  // ---------------------------------------------------------------- 03 · OT internas
  {
    clave: "z26-ot-internas",
    titulo: "Base de OT internas",
    area: AREA_Z26,
    descripcion:
      "Z26 · 03: órdenes internas con laboratorio requirente y destino, fechas, plazo, estado, detalle, costo directo respondido, costo real del laboratorio de destino y factura de la OT.",
    legado: [],
    pedido: `${PEDIDO} (03)`,
    permiso: "reporte.comercial.ver",
    base: "orden_interna_z26",
    filtros: ["fecha", "laboratorio", "estado", "texto"],
    columnas: [
      { clave: "numero", titulo: "N° OT interna", tipo: "texto" },
      { clave: "ot", titulo: "OT", tipo: "texto" },
      { clave: "requirente", titulo: "Laboratorio o sucursal requirente", tipo: "texto" },
      { clave: "destino", titulo: "Laboratorio que la ejecuta", tipo: "texto" },
      { clave: "creacion", titulo: "Fecha de creación", tipo: "fecha" },
      { clave: "plazo", titulo: "Plazo (compromiso de la OT)", tipo: "fecha" },
      { clave: "estado", titulo: "Estado", tipo: "estado" },
      { clave: "detalle", titulo: "Detalle del trabajo", tipo: "texto" },
      { clave: "horas", titulo: "Horas respondidas", tipo: "numero", total: true },
      { clave: "costo_directo", titulo: "Costo directo respondido", tipo: "monto", total: true },
      { clave: "costo_real", titulo: "Costo real (planilla del laboratorio)", tipo: "monto", total: true },
      { clave: "factura", titulo: "N° factura", tipo: "texto" },
      { clave: "fecha_factura", titulo: "Fecha factura", tipo: "fecha" },
      { clave: "monto_factura", titulo: "Monto factura", tipo: "monto", total: true },
    ],
    select: `oi.numero AS numero, o.codigo AS ot, COALESCE(uo.sigla, uo.nombre) AS requirente, COALESCE(ud.sigla, ud.nombre) AS destino,
      oi.created_at AS creacion, o.fecha_compromiso AS plazo, oi.estado AS estado, COALESCE(oi.detalle, array_to_string(oi.ensayos, ', ')) AS detalle,
      oi.respuesta_horas AS horas, oi.costo_directo AS costo_directo,
      (SELECT SUM(lz.total) FROM ot_costo_real crz JOIN ot_costo_real_linea lz ON lz.planilla_id = crz.id WHERE crz.ot_id = o.id AND crz.unidad_id = oi.destino_lab) AS costo_real,
      ${SEL_FACTURA("o.id", "o.cotizacion_id")}`,
    orden: "oi.created_at DESC",
  },
  // ---------------------------------------------------------------- 04 · Ensayos (catálogo y por OT)
  {
    clave: "z26-ensayos",
    titulo: "Base de ensayos y sus recursos",
    area: AREA_Z26,
    descripcion:
      "Z26 · 04: ensayos del catálogo con laboratorio, método, equipos o instrumentos e insumos por determinación. El personal y los vehículos requeridos por ensayo no constan en el catálogo: Pendiente del IDIC (ficha de servicios).",
    legado: [],
    pedido: `${PEDIDO} (04)`,
    permiso: "reporte.ver",
    base: "ensayo_z26",
    filtros: ["texto"],
    columnas: [
      { clave: "codigo", titulo: "Código ensayo", tipo: "texto" },
      { clave: "ensayo", titulo: "Nombre ensayo", tipo: "texto" },
      { clave: "laboratorio", titulo: "Laboratorio asociado", tipo: "texto" },
      { clave: "metodo", titulo: "Método", tipo: "texto" },
      { clave: "equipos", titulo: "Equipos y maquinarias requeridos", tipo: "texto" },
      { clave: "requiere_equipo", titulo: "Exige registrar el equipo", tipo: "si_no" },
      { clave: "insumos", titulo: "Insumos y accesorios requeridos", tipo: "texto" },
      { clave: "personal", titulo: "Personal requerido", tipo: "texto" },
      { clave: "vehiculos", titulo: "Vehículos requeridos", tipo: "texto" },
      { clave: "precio", titulo: "Precio (ficha)", tipo: "monto" },
      { clave: "activo", titulo: "Activo", tipo: "si_no" },
    ],
    select: `e.codigo AS codigo, e.nombre AS ensayo, COALESCE(fa.laboratorio, fa.nombre) AS laboratorio,
      NULLIF(TRIM(COALESCE(m.codigo, '') || ' ' || COALESCE(m.nombre, '')), '') AS metodo, m.instrumento AS equipos, COALESCE(m.equipo_requerido, FALSE) AS requiere_equipo,
      (SELECT string_agg(cz.codigo || ' ' || cz.nombre || ' (' || mcz.cantidad::text || COALESCE(' ' || cz.unidad_medida, '') || ' por ' || mcz.por || ')', '; ')
         FROM cat_metodo_consumible mcz JOIN consumible cz ON cz.id = mcz.consumible_id WHERE mcz.cat_metodo_id = m.id) AS insumos,
      'Pendiente del IDIC'::text AS personal, 'Pendiente del IDIC'::text AS vehiculos,
      e.precio AS precio, (e.activo AND COALESCE(m.activo, TRUE)) AS activo`,
    orden: "e.codigo, m.codigo",
  },
  {
    clave: "z26-ensayos-por-ot",
    titulo: "Ensayos por OT",
    area: AREA_Z26,
    descripcion: "Cada ensayo de cada OT: muestra, ensayo y método, laboratorio, equipo usado, analista, estado, veredicto y fechas de captura y aprobación.",
    legado: [],
    pedido: `${PEDIDO} (04) · reuniones R2 y R9`,
    permiso: "reporte.ver",
    base: "resultado_ot",
    filtros: TODOS,
    columnas: [
      { clave: "ot", titulo: "OT", tipo: "texto" },
      { clave: "cliente", titulo: "Cliente", tipo: "texto" },
      { clave: "laboratorio", titulo: "Laboratorio responsable", tipo: "texto" },
      { clave: "laboratorio_ensayo", titulo: "Laboratorio del ensayo", tipo: "texto" },
      { clave: "muestra", titulo: "Muestra", tipo: "texto" },
      { clave: "codigo", titulo: "Código ensayo", tipo: "texto" },
      { clave: "ensayo", titulo: "Ensayo", tipo: "texto" },
      { clave: "metodo", titulo: "Método", tipo: "texto" },
      { clave: "equipo", titulo: "Equipo usado", tipo: "texto" },
      { clave: "analista", titulo: "Analista", tipo: "texto" },
      { clave: "estado", titulo: "Estado", tipo: "estado" },
      { clave: "veredicto", titulo: "Veredicto", tipo: "estado" },
      { clave: "capturado", titulo: "Capturado", tipo: "fechahora" },
      { clave: "aprobado", titulo: "Aprobado", tipo: "fechahora" },
      { clave: "cantidad", titulo: "Ensayos", tipo: "numero", total: true },
    ],
    select: `o.codigo AS ot, c.razon_social AS cliente, ${LAB} AS laboratorio, COALESCE(fa.laboratorio, fa.nombre) AS laboratorio_ensayo, m.codigo AS muestra,
      ce.codigo AS codigo, ce.nombre AS ensayo, cm.codigo AS metodo, NULLIF(TRIM(COALESCE(eq.codigo, '') || ' ' || COALESCE(eq.nombre, '')), '') AS equipo,
      ua.nombre_completo AS analista, r.estado AS estado, r.veredicto AS veredicto, r.capturado_at AS capturado, r.aprobado_at AS aprobado, 1 AS cantidad`,
    orden: "COALESCE(o.fecha_recepcion, o.created_at) DESC, o.codigo, m.codigo, ce.codigo",
  },
  // ---------------------------------------------------------------- 05 · Recursos y costos
  {
    clave: "z26-costo-cotizado-real",
    titulo: "Costo cotizado frente a costo real por OT",
    area: AREA_Z26,
    descripcion:
      "Por OT: costo directo estimado en la cotización frente al costo real de las planillas de sus laboratorios (horas hombre, insumos, equipos y otros), desviación, semáforo y margen sobre el neto cotizado. Umbrales del semáforo en Parámetros › Costo real.",
    legado: ["OTGENERICA-COSTOS.rpt"],
    pedido: `${PEDIDO} (05) · reuniones R2, R9 y R10`,
    permiso: "costo_real.ver",
    base: "costo_ot",
    filtros: TODOS,
    columnas: [
      { clave: "ot", titulo: "OT", tipo: "texto" },
      { clave: "cliente", titulo: "Cliente", tipo: "texto" },
      { clave: "laboratorio", titulo: "Laboratorio", tipo: "texto" },
      { clave: "estado", titulo: "Estado de la OT", tipo: "estado" },
      { clave: "cotizacion", titulo: "Cotización", tipo: "texto" },
      { clave: "neto", titulo: "Neto cotizado", tipo: "monto", total: true },
      { clave: "costo_estimado", titulo: "Costo directo estimado", tipo: "monto", total: true },
      { clave: "hh_estimadas", titulo: "HH estimadas", tipo: "numero", total: true },
      { clave: "hh_reales", titulo: "HH reales", tipo: "numero", total: true },
      { clave: "costo_hh", titulo: "Costo HH real", tipo: "monto", total: true },
      { clave: "costo_insumos", titulo: "Costo insumos real", tipo: "monto", total: true },
      { clave: "costo_equipos", titulo: "Costo equipos real", tipo: "monto", total: true },
      { clave: "costo_otros", titulo: "Otros, OT internas y comisión", tipo: "monto", total: true },
      { clave: "costo_real", titulo: "Costo real total", tipo: "monto", total: true },
      { clave: "diferencia", titulo: "Real − estimado", tipo: "monto", total: true },
      { clave: "desviacion", titulo: "Desviación %", tipo: "numero" },
      { clave: "semaforo", titulo: "Semáforo", tipo: "estado" },
      { clave: "margen", titulo: "Neto − costo real", tipo: "monto", total: true },
      { clave: "planillas", titulo: "Planillas cerradas / registradas", tipo: "texto" },
    ],
    select: `o.codigo AS ot, c.razon_social AS cliente, ${LAB} AS laboratorio, o.estado AS estado, cot.codigo AS cotizacion, cot.neto AS neto,
      ez.costo AS costo_estimado, ez.hh AS hh_estimadas, rz.hh AS hh_reales, rz.hh_monto AS costo_hh, rz.insumos AS costo_insumos,
      rz.equipos AS costo_equipos, rz.otros AS costo_otros, rz.total AS costo_real,
      CASE WHEN ez.costo > 0 AND rz.total IS NOT NULL THEN rz.total - ez.costo END AS diferencia,
      CASE WHEN ez.costo > 0 AND rz.total > 0 THEN ROUND((rz.total - ez.costo) / ez.costo * 100, 2) END AS desviacion,
      CASE WHEN NOT (ez.costo > 0) OR ez.costo IS NULL OR NOT (rz.total > 0) OR rz.total IS NULL THEN 'sin_dato'
           WHEN (rz.total - ez.costo) / ez.costo * 100 >= um.rojo THEN 'rojo'
           WHEN (rz.total - ez.costo) / ez.costo * 100 >= um.amarillo THEN 'amarillo'
           ELSE 'verde' END AS semaforo,
      CASE WHEN cot.neto IS NOT NULL AND rz.total IS NOT NULL THEN cot.neto - rz.total END AS margen,
      CASE WHEN rz.planillas > 0 THEN rz.cerradas || ' / ' || rz.planillas END AS planillas`,
    orden: "COALESCE(o.fecha_recepcion, o.created_at) DESC, o.codigo",
  },
  {
    clave: "z26-recursos-ot",
    titulo: "Recursos usados por OT (horas hombre y equipos)",
    area: AREA_Z26,
    descripcion: "Horas hombre por cargo o categoría de tarifa y horas máquina por equipo registradas en la planilla de costos reales de cada laboratorio, con su valor.",
    legado: [],
    pedido: `${PEDIDO} (05) · reuniones R2 y R10`,
    permiso: "costo_real.ver",
    base: "costo_linea",
    filtros: TODOS,
    columnas: [
      { clave: "ot", titulo: "OT", tipo: "texto" },
      { clave: "laboratorio", titulo: "Laboratorio", tipo: "texto" },
      { clave: "recurso_tipo", titulo: "Tipo de recurso", tipo: "texto" },
      { clave: "recurso", titulo: "Recurso", tipo: "texto" },
      { clave: "detalle", titulo: "Detalle", tipo: "texto" },
      { clave: "horas", titulo: "Horas", tipo: "numero", total: true },
      { clave: "valor_hora", titulo: "$ / hora", tipo: "monto" },
      { clave: "total", titulo: "Total", tipo: "monto", total: true },
      { clave: "estado", titulo: "Planilla", tipo: "estado" },
    ],
    select: `o.codigo AS ot, ${LAB} AS laboratorio, CASE l.categoria WHEN 'horas_hombre' THEN 'Horas hombre' ELSE 'Equipo (horas máquina)' END AS recurso_tipo,
      CASE WHEN l.categoria = 'horas_hombre' THEN ${CARGO} ELSE NULLIF(TRIM(COALESCE(eq.codigo, '') || ' ' || COALESCE(eq.nombre, '')), '') END AS recurso,
      l.descripcion AS detalle, l.cantidad AS horas, l.costo_unitario AS valor_hora, l.total AS total, cr.estado AS estado`,
    donde: `l.categoria IN ('horas_hombre', 'equipos')`,
    orden: "COALESCE(o.fecha_recepcion, o.created_at) DESC, o.codigo, l.categoria, l.orden",
  },
  {
    clave: "z26-equipos",
    titulo: "Base de equipos y maquinarias (costos)",
    area: AREA_Z26,
    descripcion:
      "Z26 · 05: equipos con laboratorio, estado, datos de fabricación, valor hora máquina vigente y horas registradas en planillas de costos. El valor hora de cada equipo aún no lo entrega el IDIC: sin tarifa queda «Pendiente del IDIC».",
    legado: [],
    pedido: `${PEDIDO} (05 · Equipos y maquinarias)`,
    permiso: "reporte.ver",
    base: "equipo_z26",
    filtros: ["fecha", "laboratorio", "estado", "texto"],
    columnas: [
      { clave: "codigo", titulo: "Código", tipo: "texto" },
      { clave: "equipo", titulo: "Equipo", tipo: "texto" },
      { clave: "laboratorio", titulo: "Laboratorio", tipo: "texto" },
      { clave: "estado", titulo: "Estado", tipo: "estado" },
      { clave: "fabricante", titulo: "Fabricante", tipo: "texto" },
      { clave: "modelo", titulo: "Modelo", tipo: "texto" },
      { clave: "serie", titulo: "Serie", tipo: "texto" },
      { clave: "adquisicion", titulo: "Adquisición", tipo: "fecha" },
      { clave: "vida_util", titulo: "Vida útil (años)", tipo: "numero" },
      { clave: "proxima_calibracion", titulo: "Próxima calibración", tipo: "fecha" },
      { clave: "valor_hora", titulo: "Valor hora máquina", tipo: "monto" },
      { clave: "tarifa", titulo: "Tarifa HM", tipo: "texto" },
      { clave: "horas", titulo: "Horas en planillas", tipo: "numero", total: true },
      { clave: "costo", titulo: "Costo en planillas", tipo: "monto", total: true },
    ],
    select: `eq.codigo AS codigo, COALESCE(eq.nombre, eq.descripcion) AS equipo, ${LAB} AS laboratorio, eq.estado AS estado, eq.fabricante AS fabricante,
      eq.modelo AS modelo, eq.serie AS serie, eq.fecha_adquisicion AS adquisicion, eq.vida_util_anos AS vida_util, eq.proxima_calibracion AS proxima_calibracion,
      hm.valor AS valor_hora, CASE WHEN hm.valor IS NULL THEN 'Pendiente del IDIC' ELSE 'Vigente' END AS tarifa,
      (SELECT SUM(lz.cantidad) FROM ot_costo_real_linea lz WHERE lz.equipo_id = eq.id AND lz.categoria = 'equipos') AS horas,
      (SELECT SUM(lz.total) FROM ot_costo_real_linea lz WHERE lz.equipo_id = eq.id AND lz.categoria = 'equipos') AS costo`,
    orden: "eq.codigo",
  },
  {
    clave: "z26-personal",
    titulo: "Base de personal (horas hombre por categoría)",
    area: AREA_Z26,
    descripcion:
      "Z26 · 05: categorías de la hora hombre con su valor y vigencia (Tablas maestras › Tarifas HH) y las horas registradas con cada una en las planillas de costos. Por protección de datos no se listan personas ni remuneraciones.",
    legado: [],
    pedido: `${PEDIDO} (05 · Personal)`,
    permiso: "reporte.comercial.ver",
    base: "tarifa_hh",
    filtros: ["fecha", "texto"],
    columnas: [
      { clave: "categoria", titulo: "Categoría", tipo: "texto" },
      { clave: "descripcion", titulo: "Descripción", tipo: "texto" },
      { clave: "valor_hora", titulo: "Valor hora", tipo: "monto" },
      { clave: "desde", titulo: "Vigente desde", tipo: "fecha" },
      { clave: "hasta", titulo: "Vigente hasta", tipo: "fecha" },
      { clave: "vigente", titulo: "Vigente hoy", tipo: "si_no" },
      { clave: "horas", titulo: "Horas en planillas", tipo: "numero", total: true },
      { clave: "costo", titulo: "Costo en planillas", tipo: "monto", total: true },
    ],
    select: `h.categoria AS categoria, h.descripcion AS descripcion, h.valor_hora_clp AS valor_hora, h.vigente_desde AS desde, h.vigente_hasta AS hasta,
      (${VIGENTE("h")}) AS vigente,
      (SELECT SUM(lz.cantidad) FROM ot_costo_real_linea lz JOIN ot_costo_real crz ON crz.id = lz.planilla_id
        WHERE crz.tenant_id = h.tenant_id AND lz.categoria = 'horas_hombre' AND lz.cargo = 'HH:' || h.categoria
          AND crz.created_at::date >= h.vigente_desde AND (h.vigente_hasta IS NULL OR crz.created_at::date <= h.vigente_hasta)) AS horas,
      (SELECT SUM(lz.total) FROM ot_costo_real_linea lz JOIN ot_costo_real crz ON crz.id = lz.planilla_id
        WHERE crz.tenant_id = h.tenant_id AND lz.categoria = 'horas_hombre' AND lz.cargo = 'HH:' || h.categoria
          AND crz.created_at::date >= h.vigente_desde AND (h.vigente_hasta IS NULL OR crz.created_at::date <= h.vigente_hasta)) AS costo`,
    orden: "h.categoria, h.vigente_desde DESC",
  },
  {
    clave: "z26-insumos",
    titulo: "Base de insumos y accesorios (stock valorizado)",
    area: AREA_Z26,
    descripcion:
      "Z26 · 05: consumibles con tipo, unidad, costo de referencia, stock en todas las bodegas, valor del stock y consumo registrado. El costo de los insumos aún no lo entrega el IDIC: los lotes sin costo se cuentan aparte.",
    legado: [],
    pedido: `${PEDIDO} (05 · Insumos y accesorios)`,
    permiso: "reporte.ver",
    base: "consumible_z26",
    filtros: ["texto"],
    columnas: [
      { clave: "codigo", titulo: "Código", tipo: "texto" },
      { clave: "insumo", titulo: "Insumo o accesorio", tipo: "texto" },
      { clave: "tipo", titulo: "Tipo", tipo: "texto" },
      { clave: "unidad", titulo: "Unidad", tipo: "texto" },
      { clave: "costo_referencia", titulo: "Costo de referencia", tipo: "monto" },
      { clave: "lotes", titulo: "Lotes con stock", tipo: "numero", total: true },
      { clave: "stock", titulo: "Stock", tipo: "numero" },
      { clave: "valor", titulo: "Valor del stock", tipo: "monto", total: true },
      { clave: "sin_costo", titulo: "Lotes sin costo (Pendiente del IDIC)", tipo: "numero", total: true },
      { clave: "consumido", titulo: "Consumido (total)", tipo: "numero" },
      { clave: "activo", titulo: "Activo", tipo: "si_no" },
    ],
    select: `co.codigo AS codigo, co.nombre AS insumo, co.tipo AS tipo, co.unidad_medida AS unidad, NULLIF(co.costo_unitario_clp, 0) AS costo_referencia,
      st.lotes AS lotes, st.stock AS stock, st.valor AS valor, st.sin_costo AS sin_costo,
      (SELECT SUM(mz.cantidad) FROM movimiento_consumible mz JOIN lote_consumible lz ON lz.id = mz.lote_id WHERE lz.consumible_id = co.id AND mz.tipo = 'consumo') AS consumido,
      COALESCE(co.activo, TRUE) AS activo`,
    orden: "co.codigo",
  },
  {
    clave: "z26-vehiculos",
    titulo: "Base de vehículos (costo por kilómetro)",
    area: AREA_Z26,
    descripcion: "Z26 · 05: costo por kilómetro por categoría de vehículo (Tablas maestras › Vehículos), su vigencia y los kilómetros cargados como gasto «vehículo institucional» en las planillas de costos.",
    legado: [],
    pedido: `${PEDIDO} (05 · Vehículos)`,
    permiso: "reporte.comercial.ver",
    base: "vehiculo_z26",
    filtros: ["fecha", "texto"],
    columnas: [
      { clave: "categoria", titulo: "Categoría", tipo: "texto" },
      { clave: "descripcion", titulo: "Descripción", tipo: "texto" },
      { clave: "costo_km", titulo: "Costo por km", tipo: "monto" },
      { clave: "desde", titulo: "Vigente desde", tipo: "fecha" },
      { clave: "hasta", titulo: "Vigente hasta", tipo: "fecha" },
      { clave: "vigente", titulo: "Vigente hoy", tipo: "si_no" },
      { clave: "km", titulo: "Km en planillas (vehículo institucional)", tipo: "numero", total: true },
      { clave: "costo", titulo: "Costo en planillas", tipo: "monto", total: true },
    ],
    select: `tv.categoria AS categoria, tv.descripcion AS descripcion, tv.costo_km_clp AS costo_km, tv.vigente_desde AS desde, tv.vigente_hasta AS hasta,
      (${VIGENTE("tv")}) AS vigente,
      (SELECT SUM(lz.cantidad) FROM ot_costo_real_linea lz JOIN ot_costo_real crz ON crz.id = lz.planilla_id
        WHERE crz.tenant_id = tv.tenant_id AND lz.categoria = 'comision' AND lz.tipo_gasto = 'vehiculo' AND lz.costo_unitario = tv.costo_km_clp) AS km,
      (SELECT SUM(lz.total) FROM ot_costo_real_linea lz JOIN ot_costo_real crz ON crz.id = lz.planilla_id
        WHERE crz.tenant_id = tv.tenant_id AND lz.categoria = 'comision' AND lz.tipo_gasto = 'vehiculo' AND lz.costo_unitario = tv.costo_km_clp) AS costo`,
    orden: "tv.categoria, tv.vigente_desde DESC",
  },
  // ---------------------------------------------------------------- Bodegas (R1, R5)
  {
    clave: "inventario-bodega",
    titulo: "Inventario valorizado por bodega y lote",
    area: AREA_Z26,
    descripcion:
      "Lotes con stock en la bodega central y en cada sub-bodega de laboratorio, con caducidad, costo unitario (del lote o de referencia) y valor. Un lote sin costo queda «Pendiente del IDIC».",
    legado: [],
    pedido: "Reuniones R1 y R5 (Abastecimiento) · contrato 4.4.4",
    permiso: "reporte.ver",
    base: "lote_bodega",
    filtros: ["fecha", "laboratorio", "estado", "texto"],
    columnas: [
      { clave: "bodega", titulo: "Bodega", tipo: "texto" },
      { clave: "laboratorio", titulo: "Laboratorio", tipo: "texto" },
      { clave: "codigo", titulo: "Código", tipo: "texto" },
      { clave: "insumo", titulo: "Insumo", tipo: "texto" },
      { clave: "lote", titulo: "Lote", tipo: "texto" },
      { clave: "recepcion", titulo: "Recepción", tipo: "fecha" },
      { clave: "vencimiento", titulo: "Vencimiento", tipo: "fecha" },
      { clave: "stock", titulo: "Stock", tipo: "numero" },
      { clave: "unidad", titulo: "Unidad", tipo: "texto" },
      { clave: "costo_unitario", titulo: "Costo unitario", tipo: "monto" },
      { clave: "fuente_costo", titulo: "Costo tomado de", tipo: "texto" },
      { clave: "valor", titulo: "Valor", tipo: "monto", total: true },
      { clave: "estado", titulo: "Estado", tipo: "estado" },
    ],
    select: `COALESCE(b.codigo || ' · ' || b.nombre, 'Sin bodega') AS bodega, ${LAB} AS laboratorio, co.codigo AS codigo, co.nombre AS insumo, l.numero_lote AS lote,
      l.fecha_recepcion AS recepcion, l.fecha_vencimiento AS vencimiento, l.cantidad_actual AS stock, co.unidad_medida AS unidad,
      COALESCE(l.costo_unitario_clp, NULLIF(co.costo_unitario_clp, 0)) AS costo_unitario,
      CASE WHEN l.costo_unitario_clp IS NOT NULL THEN 'Precio del lote' WHEN NULLIF(co.costo_unitario_clp, 0) IS NOT NULL THEN 'Costo de referencia' ELSE 'Pendiente del IDIC' END AS fuente_costo,
      l.cantidad_actual * COALESCE(l.costo_unitario_clp, NULLIF(co.costo_unitario_clp, 0)) AS valor, l.estado AS estado`,
    orden: "(b.tipo = 'central') DESC, b.codigo, co.codigo, l.fecha_vencimiento NULLS LAST",
  },
  {
    clave: "consumos-valorizados",
    titulo: "Consumos valorizados por OT y ensayo",
    area: AREA_Z26,
    descripcion: "Cada consumo del kardex con su OT, muestra, ensayo y método, la bodega y el lote de donde salió y su costo (precio del lote o costo de referencia).",
    legado: [],
    pedido: "Reuniones R1 y R5 (Abastecimiento) · contrato 4.4.5",
    permiso: "reporte.ver",
    base: "consumo",
    filtros: ["fecha", "laboratorio", "centroCosto", "texto"],
    columnas: [
      { clave: "fecha", titulo: "Fecha", tipo: "fechahora" },
      { clave: "ot", titulo: "OT", tipo: "texto" },
      { clave: "muestra", titulo: "Muestra", tipo: "texto" },
      { clave: "ensayo", titulo: "Ensayo", tipo: "texto" },
      { clave: "metodo", titulo: "Método", tipo: "texto" },
      { clave: "bodega", titulo: "Bodega", tipo: "texto" },
      { clave: "insumo", titulo: "Insumo", tipo: "texto" },
      { clave: "lote", titulo: "Lote", tipo: "texto" },
      { clave: "cantidad", titulo: "Cantidad", tipo: "numero" },
      { clave: "unidad", titulo: "Unidad", tipo: "texto" },
      { clave: "costo_unitario", titulo: "Costo unitario", tipo: "monto" },
      { clave: "costo", titulo: "Costo", tipo: "monto", total: true },
      { clave: "automatico", titulo: "Descuento automático", tipo: "si_no" },
    ],
    select: `mc.created_at AS fecha, o.codigo AS ot, m.codigo AS muestra, NULLIF(TRIM(COALESCE(ce.codigo, '') || ' ' || COALESCE(ce.nombre, '')), '') AS ensayo,
      cm.codigo AS metodo, b.codigo AS bodega, co.codigo || ' · ' || co.nombre AS insumo, l.numero_lote AS lote, mc.cantidad AS cantidad, co.unidad_medida AS unidad,
      COALESCE(l.costo_unitario_clp, NULLIF(co.costo_unitario_clp, 0)) AS costo_unitario,
      mc.cantidad * COALESCE(l.costo_unitario_clp, NULLIF(co.costo_unitario_clp, 0)) AS costo, mc.automatico AS automatico`,
    orden: "mc.created_at DESC",
  },
];
