/**
 * Zona de informes · catálogo de REPORTES FIJOS (reglas PURAS, probadas en
 * catalogo.spec.ts).
 *
 * El IDIC usaba 379 informes Crystal Reports 8.5 sobre StarLIMS. No se usa
 * Crystal: los listados y reportes de gestión se reconstruyen aquí como
 * consultas fijas con filtros, y cada uno guarda en `legado` los archivos .rpt
 * del sistema anterior a los que reemplaza, para que el usuario los reconozca.
 * Los documentos por OT (certificados, informes, IVC, boletines…) no van aquí:
 * se emiten con el repositorio de plantillas (legado-documentos.ts).
 *
 * SEGURIDAD: todo el texto SQL sale de este fichero. La entrada del usuario
 * (fechas, laboratorio, centro de costo, estado, texto) se valida y viaja SIEMPRE
 * como parámetro posicional ($n); nunca se interpola.
 */
import { SQL_HOY, sqlDia } from "../common/fecha-chile";
import { AREA_Z26, BASES_Z26, INFORMES_Z26 } from "./catalogo-z26";

export type TipoColumna = "texto" | "fecha" | "fechahora" | "numero" | "monto" | "dias" | "estado" | "si_no";

export interface Columna {
  clave: string;
  titulo: string;
  tipo: TipoColumna;
  /** Se suma en la fila de totales. */
  total?: boolean;
}

export type FiltroClave = "fecha" | "laboratorio" | "centroCosto" | "estado" | "texto";

export const AREAS = [
  "Órdenes de trabajo",
  "Comercial y facturación",
  "BPCH · tasa de internación",
  "Laboratorio y calidad",
  "Catálogo de ensayos",
  AREA_Z26,
] as const;
export type Area = (typeof AREAS)[number];

/** Origen de los datos: FROM, inquilino y expresiones para filtros y alcance. */
export interface Base {
  from: string;
  /** Condición fija (inquilino y borrado lógico); $1 = tenant. */
  donde: string;
  fecha: string;
  /** Condición de laboratorio para un parámetro (`p` = `$n::uuid`). */
  unidad?: (p: string) => string;
  centroCosto?: string;
  estado?: string;
  /** Expresiones donde busca el filtro de texto. */
  texto?: string[];
  /** Alcance por laboratorio para un arreglo (`k` = `$n::uuid[]`); null = datos comunes. */
  alcance: ((k: string) => string) | null;
}

const CC = `COALESCE(NULLIF(TRIM(COALESCE(cc.codigo, '') || ' · ' || COALESCE(cc.nombre, cc.descripcion, '')), '·'), cc.sigla)`;
const LAB = `COALESCE(u.sigla, u.nombre)`;
const MONTO_OT = `COALESCE(cot.total, o.costo_estimado)`;

const BASE_OT: Base = {
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
  texto: [`o.codigo`, `c.razon_social`, `c.rut`],
  alcance: (k) => `o.unidad_principal = ANY(${k})`,
};

const BASE_FACTURA: Base = {
  from: `factura f
    LEFT JOIN cliente c ON c.id = f.cliente_id
    LEFT JOIN orden_trabajo o ON o.id = f.ot_id
    LEFT JOIN unidad u ON u.id = o.unidad_principal
    LEFT JOIN centro_costo cc ON cc.id = COALESCE(f.centro_costo_id, o.centro_costo_id)`,
  donde: `f.tenant_id = $1::uuid AND f.deleted_at IS NULL`,
  fecha: `f.fecha_emision`,
  unidad: (p) => `o.unidad_principal = ${p}`,
  centroCosto: `COALESCE(f.centro_costo_id, o.centro_costo_id)`,
  estado: `f.estado`,
  texto: [`f.numero`, `f.codigo`, `o.codigo`, `c.razon_social`, `c.rut`],
  alcance: (k) => `o.unidad_principal = ANY(${k})`,
};

const BASES = {
  ot: BASE_OT,
  factura: BASE_FACTURA,
  nota_credito: {
    from: `nota_credito nc
      JOIN factura f ON f.id = nc.factura_id
      LEFT JOIN cliente c ON c.id = f.cliente_id
      LEFT JOIN orden_trabajo o ON o.id = f.ot_id
      LEFT JOIN unidad u ON u.id = o.unidad_principal
      LEFT JOIN centro_costo cc ON cc.id = COALESCE(f.centro_costo_id, o.centro_costo_id)`,
    donde: `nc.tenant_id = $1::uuid AND f.deleted_at IS NULL`,
    fecha: `nc.fecha`,
    unidad: BASE_FACTURA.unidad,
    centroCosto: BASE_FACTURA.centroCosto,
    texto: [`nc.numero`, `nc.codigo`, `f.numero`, `c.razon_social`],
    alcance: BASE_FACTURA.alcance,
  },
  pago: {
    from: `pago p
      JOIN factura f ON f.id = p.factura_id
      LEFT JOIN cliente c ON c.id = f.cliente_id
      LEFT JOIN orden_trabajo o ON o.id = f.ot_id
      LEFT JOIN unidad u ON u.id = o.unidad_principal
      LEFT JOIN centro_costo cc ON cc.id = COALESCE(f.centro_costo_id, o.centro_costo_id)`,
    donde: `f.tenant_id = $1::uuid AND f.deleted_at IS NULL`,
    fecha: `p.fecha`,
    unidad: BASE_FACTURA.unidad,
    centroCosto: BASE_FACTURA.centroCosto,
    texto: [`f.numero`, `p.referencia`, `o.codigo`, `c.razon_social`],
    alcance: BASE_FACTURA.alcance,
  },
  cotizacion: {
    from: `cotizacion cot
      LEFT JOIN cliente c ON c.id = cot.cliente_id
      LEFT JOIN centro_costo cc ON cc.id = cot.centro_costo_id
      LEFT JOIN unidad u ON u.id = cc.unidad_id`,
    donde: `cot.tenant_id = $1::uuid`,
    fecha: `COALESCE(cot.fecha_emision, cot.created_at::date)`,
    unidad: (p) => `cc.unidad_id = ${p}`,
    centroCosto: `cot.centro_costo_id`,
    estado: `cot.estado`,
    texto: [`cot.codigo`, `c.razon_social`, `c.rut`],
    alcance: (k) =>
      `(EXISTS (SELECT 1 FROM orden_trabajo ox WHERE ox.cotizacion_id = cot.id AND ox.unidad_principal = ANY(${k}))` +
      ` OR cc.unidad_id = ANY(${k}))`,
  },
  orden_interna: {
    from: `orden_interna oi
      JOIN orden_trabajo o ON o.id = oi.ot_id
      LEFT JOIN cliente c ON c.id = o.cliente_id
      LEFT JOIN unidad uo ON uo.id = oi.origen_lab
      LEFT JOIN unidad ud ON ud.id = oi.destino_lab`,
    donde: `oi.tenant_id = $1::uuid AND oi.deleted_at IS NULL`,
    fecha: `oi.created_at`,
    unidad: (p) => `(oi.origen_lab = ${p} OR oi.destino_lab = ${p})`,
    estado: `oi.estado`,
    texto: [`oi.numero`, `o.codigo`, `c.razon_social`],
    alcance: (k) => `(oi.origen_lab = ANY(${k}) OR oi.destino_lab = ANY(${k}))`,
  },
  tasa: {
    from: `calculo_tasa_internacion t
      JOIN orden_trabajo o ON o.id = t.ot_id
      LEFT JOIN cliente c ON c.id = COALESCE(t.cliente_id, o.cliente_id)
      LEFT JOIN unidad u ON u.id = o.unidad_principal
      LEFT JOIN centro_costo cc ON cc.id = o.centro_costo_id
      LEFT JOIN factura f ON f.id = t.factura_id`,
    donde: `t.tenant_id = $1::uuid`,
    fecha: `t.calculado_at`,
    unidad: BASE_OT.unidad,
    centroCosto: `o.centro_costo_id`,
    texto: [`o.codigo`, `c.razon_social`, `f.numero`],
    alcance: BASE_OT.alcance,
  },
  no_conformidad: {
    from: `no_conformidad nc
      LEFT JOIN unidad u ON u.id = nc.unidad_id
      LEFT JOIN orden_trabajo o ON o.id = nc.ot_id
      LEFT JOIN cliente c ON c.id = COALESCE(nc.cliente_id, o.cliente_id)`,
    donde: `nc.tenant_id = $1::uuid`,
    fecha: `nc.detectado_at`,
    unidad: (p) => `nc.unidad_id = ${p}`,
    estado: `nc.estado`,
    texto: [`nc.codigo`, `nc.titulo`, `o.codigo`, `c.razon_social`],
    alcance: (k) => `nc.unidad_id = ANY(${k})`,
  },
  certificado: {
    from: `certificado ce
      LEFT JOIN orden_trabajo o ON o.id = ce.ot_id
      LEFT JOIN cliente c ON c.id = o.cliente_id
      LEFT JOIN unidad u ON u.id = COALESCE(ce.unidad_id, o.unidad_principal)`,
    donde: `ce.tenant_id = $1::uuid AND ce.deleted_at IS NULL`,
    fecha: `COALESCE(ce.emitido_at, ce.created_at)`,
    unidad: (p) => `COALESCE(ce.unidad_id, o.unidad_principal) = ${p}`,
    estado: `ce.estado`,
    texto: [`ce.numero`, `ce.codigo`, `o.codigo`, `c.razon_social`],
    alcance: (k) => `COALESCE(ce.unidad_id, o.unidad_principal) = ANY(${k})`,
  },
  ensayo: {
    from: `cat_ensayo e
      LEFT JOIN cat_metodo m ON m.ensayo_id = e.id AND m.deleted_at IS NULL`,
    donde: `e.tenant_id = $1::uuid AND e.deleted_at IS NULL`,
    fecha: `e.created_at`,
    texto: [`e.codigo`, `e.nombre`, `m.codigo`, `m.nombre`, `m.norma`, `e.instruccion_trabajo`],
    alcance: null,
  },
  // Frente S4 · bases del documento Z26 (catalogo-z26.ts).
  ...BASES_Z26,
} satisfies Record<string, Base>;

export type BaseClave = keyof typeof BASES;

export interface InformeFijo {
  clave: string;
  titulo: string;
  area: Area;
  descripcion: string;
  /** Archivos .rpt del sistema anterior que reemplaza. */
  legado: string[];
  /** Pedido que origina un informe sin antecedente en Crystal (p. ej. documento Z26 del IDIC). */
  pedido?: string;
  /** Permiso además de iniciar sesión. */
  permiso: "reporte.ver" | "reporte.comercial.ver" | "costo_real.ver";
  base: BaseClave;
  filtros: FiltroClave[];
  columnas: Columna[];
  /** Lista SELECT; cada alias es la clave de una columna. */
  select: string;
  /** Condición fija adicional. */
  donde?: string;
  /** Columna de fecha si no es la de la base. */
  fecha?: string;
  /** GROUP BY (posiciones o expresiones). */
  agrupar?: string;
  orden: string;
}

const COLS_OT: Columna[] = [
  { clave: "ot", titulo: "OT", tipo: "texto" },
  { clave: "recepcion", titulo: "Recepción", tipo: "fecha" },
  { clave: "cliente", titulo: "Cliente", tipo: "texto" },
  { clave: "laboratorio", titulo: "Laboratorio", tipo: "texto" },
  { clave: "centro_costo", titulo: "Centro de costo", tipo: "texto" },
  { clave: "tipo_trabajo", titulo: "Tipo de trabajo", tipo: "texto" },
  { clave: "estado", titulo: "Estado", tipo: "estado" },
  { clave: "compromiso", titulo: "Compromiso", tipo: "fecha" },
  { clave: "cierre", titulo: "Cierre", tipo: "fecha" },
];
const SEL_OT = `o.codigo AS ot, o.fecha_recepcion AS recepcion, c.razon_social AS cliente, ${LAB} AS laboratorio,
  ${CC} AS centro_costo, o.tipo_trabajo AS tipo_trabajo, o.estado AS estado, o.fecha_compromiso AS compromiso, o.fecha_cierre AS cierre`;
const ORDEN_OT = `o.fecha_recepcion DESC NULLS LAST, o.codigo`;
const TODOS: FiltroClave[] = ["fecha", "laboratorio", "centroCosto", "estado", "texto"];
const CON_COBRO = `COALESCE(o.con_cobro, TRUE)`;
const HOY = SQL_HOY;

export const INFORMES: InformeFijo[] = [
  // ------------------------------------------------------------ Órdenes de trabajo
  {
    clave: "ot-listado",
    titulo: "Listado de órdenes de trabajo",
    area: "Órdenes de trabajo",
    descripcion: "Todas las OT con cliente, laboratorio, centro de costo, estado, plazos y monto.",
    legado: ["RESUMEN_OTS.rpt", "LISTAOTS_ORDEMP.rpt", "LISTAOTS_ORDFOL_BPCH.rpt", "Resumen_Cliente.rpt", "resumen.rpt", "resumen_detallado.rpt", "OT_Lab_Especial.rpt", "LISTADO_OT_MUESTREO_VALORIZADO.rpt"],
    permiso: "reporte.comercial.ver",
    base: "ot",
    filtros: TODOS,
    columnas: [...COLS_OT, { clave: "origen", titulo: "Origen", tipo: "texto" }, { clave: "monto", titulo: "Monto", tipo: "monto", total: true }],
    select: `${SEL_OT}, o.origen_trabajo AS origen, ${MONTO_OT} AS monto`,
    orden: ORDEN_OT,
  },
  {
    clave: "ot-cc-estado",
    titulo: "OT por centro de costo según estado",
    area: "Órdenes de trabajo",
    descripcion: "Cantidad de OT y monto por centro de costo y estado.",
    legado: ["Infgest04.rpt", "Infgest04-02.RPT", "Infgest05.RPT", "Infgest06.rpt", "Infgest06-ORIG.rpt", "Infgest06-det.rpt", "Infgest06-totales.rpt"],
    permiso: "reporte.comercial.ver",
    base: "ot",
    filtros: TODOS,
    columnas: [
      { clave: "centro_costo", titulo: "Centro de costo", tipo: "texto" },
      { clave: "estado", titulo: "Estado", tipo: "estado" },
      { clave: "cantidad", titulo: "Cantidad de OT", tipo: "numero", total: true },
      { clave: "monto", titulo: "Monto", tipo: "monto", total: true },
    ],
    select: `COALESCE(${CC}, 'Sin centro de costo') AS centro_costo, o.estado AS estado, COUNT(*)::int AS cantidad, SUM(${MONTO_OT}) AS monto`,
    agrupar: "1, 2",
    orden: "1, 2",
  },
  {
    clave: "ot-laboratorio-mes",
    titulo: "OT y muestras por laboratorio y mes",
    area: "Órdenes de trabajo",
    descripcion: "Cuántas OT y muestras entraron cada mes a cada laboratorio (base de los gráficos de carga).",
    legado: ["OTGRAPH.RPT", "OTGRAPH2.rpt", "OTGRAPH-LAB.RPT", "OTGRAPH-DEP.RPT", "Lmuestra.rpt"],
    permiso: "reporte.ver",
    base: "ot",
    filtros: ["fecha", "laboratorio", "centroCosto", "estado"],
    columnas: [
      { clave: "laboratorio", titulo: "Laboratorio", tipo: "texto" },
      { clave: "mes", titulo: "Mes", tipo: "texto" },
      { clave: "cantidad", titulo: "OT", tipo: "numero", total: true },
      { clave: "muestras", titulo: "Muestras", tipo: "numero", total: true },
    ],
    select: `COALESCE(${LAB}, 'Sin laboratorio') AS laboratorio, to_char(${sqlDia("COALESCE(o.fecha_recepcion, o.created_at)")}, 'YYYY-MM') AS mes,
      COUNT(*)::int AS cantidad, SUM((SELECT COUNT(*) FROM muestra m WHERE m.ot_id = o.id AND m.deleted_at IS NULL))::int AS muestras`,
    agrupar: "1, 2",
    orden: "1, 2",
  },
  {
    clave: "ot-tiempos",
    titulo: "Tiempos transcurridos por OT",
    area: "Órdenes de trabajo",
    descripcion: "Días desde la recepción hasta el cierre (o hasta hoy) y días de atraso contra la fecha comprometida.",
    legado: ["TIEMPOLAB.rpt", "tiempos_medios2.rpt", "CONTROL_DE_TIEMPO_OT.rpt", "CARGA_TRABAJO_OT.rpt", "Ciclo.rpt", "OTCERRADALAB.rpt"],
    permiso: "reporte.ver",
    base: "ot",
    filtros: TODOS,
    columnas: [
      { clave: "ot", titulo: "OT", tipo: "texto" },
      { clave: "laboratorio", titulo: "Laboratorio", tipo: "texto" },
      { clave: "cliente", titulo: "Cliente", tipo: "texto" },
      { clave: "estado", titulo: "Estado", tipo: "estado" },
      { clave: "recepcion", titulo: "Recepción", tipo: "fecha" },
      { clave: "compromiso", titulo: "Compromiso", tipo: "fecha" },
      { clave: "cierre", titulo: "Cierre", tipo: "fecha" },
      { clave: "dias", titulo: "Días transcurridos", tipo: "dias" },
      { clave: "atraso", titulo: "Días de atraso", tipo: "dias" },
    ],
    select: `o.codigo AS ot, ${LAB} AS laboratorio, c.razon_social AS cliente, o.estado AS estado, o.fecha_recepcion AS recepcion,
      o.fecha_compromiso AS compromiso, o.fecha_cierre AS cierre,
      (COALESCE(${sqlDia("o.fecha_cierre")}, ${HOY}) - ${sqlDia("o.fecha_recepcion")}) AS dias,
      CASE WHEN o.fecha_compromiso IS NULL THEN NULL
           ELSE GREATEST(0, COALESCE(${sqlDia("o.fecha_cierre")}, ${HOY}) - o.fecha_compromiso) END AS atraso`,
    orden: ORDEN_OT,
  },
  {
    clave: "ot-anuladas",
    titulo: "Órdenes de trabajo anuladas",
    area: "Órdenes de trabajo",
    descripcion: "OT en estado anulada.",
    legado: ["Ot_anuladas.rpt"],
    permiso: "reporte.ver",
    base: "ot",
    filtros: ["fecha", "laboratorio", "centroCosto", "texto"],
    columnas: [...COLS_OT, { clave: "notas", titulo: "Notas", tipo: "texto" }],
    select: `${SEL_OT}, o.notas AS notas`,
    donde: `o.estado = 'anulada'`,
    orden: ORDEN_OT,
  },
  {
    clave: "ot-sin-cobro",
    titulo: "OT sin cobro (valorizadas)",
    area: "Órdenes de trabajo",
    descripcion: "OT autorizadas sin cobro, con su costo estimado.",
    legado: ["Ot_SinCobro.rpt"],
    permiso: "reporte.comercial.ver",
    base: "ot",
    filtros: TODOS,
    columnas: [...COLS_OT, { clave: "valor", titulo: "Costo estimado", tipo: "monto", total: true }],
    select: `${SEL_OT}, o.costo_estimado AS valor`,
    donde: `o.con_cobro = FALSE`,
    orden: ORDEN_OT,
  },
  {
    clave: "ot-sin-monto",
    titulo: "OT sin monto",
    area: "Órdenes de trabajo",
    descripcion: "OT con cobro que no tienen monto de cotización ni costo estimado del laboratorio.",
    legado: ["LISTAOTS_SINMONTO.RPT", "Ot_SinMontoLab.rpt"],
    permiso: "reporte.ver",
    base: "ot",
    filtros: TODOS,
    columnas: COLS_OT,
    select: SEL_OT,
    donde: `${CON_COBRO} AND COALESCE(cot.total, 0) = 0 AND o.costo_estimado IS NULL AND o.estado <> 'anulada'`,
    orden: ORDEN_OT,
  },
  {
    clave: "ot-sin-plazo",
    titulo: "OT sin plazo comprometido",
    area: "Órdenes de trabajo",
    descripcion: "OT vigentes sin fecha de compromiso.",
    legado: ["LISTAOTS_SINFECTER.RPT"],
    permiso: "reporte.ver",
    base: "ot",
    filtros: TODOS,
    columnas: COLS_OT,
    select: SEL_OT,
    donde: `o.fecha_compromiso IS NULL AND o.estado <> 'anulada'`,
    orden: ORDEN_OT,
  },
  {
    clave: "ot-sin-cotizacion",
    titulo: "OT sin cotización",
    area: "Órdenes de trabajo",
    descripcion: "OT con cobro que no nacieron de una cotización.",
    legado: ["OTSINCOT.RPT"],
    permiso: "reporte.ver",
    base: "ot",
    filtros: TODOS,
    columnas: [...COLS_OT, { clave: "origen", titulo: "Origen", tipo: "texto" }],
    select: `${SEL_OT}, o.origen_trabajo AS origen`,
    donde: `o.cotizacion_id IS NULL AND ${CON_COBRO} AND o.estado <> 'anulada'`,
    orden: ORDEN_OT,
  },
  {
    clave: "ot-sin-facturar",
    titulo: "OT que no han sido facturadas",
    area: "Órdenes de trabajo",
    descripcion: "OT con cobro sin factura vigente. Filtre por estado «Cerrada» para ver las que ya deberían enviarse a facturar.",
    legado: ["Ot_Sin_Facturar.rpt", "Ot_Por_Facturar.rpt"],
    permiso: "reporte.comercial.ver",
    base: "ot",
    filtros: TODOS,
    columnas: [...COLS_OT, { clave: "monto", titulo: "Monto", tipo: "monto", total: true }],
    select: `${SEL_OT}, ${MONTO_OT} AS monto`,
    donde: `${CON_COBRO} AND o.estado <> 'anulada'
      AND NOT EXISTS (SELECT 1 FROM factura fx WHERE fx.ot_id = o.id AND fx.deleted_at IS NULL AND fx.estado <> 'anulada')`,
    orden: ORDEN_OT,
  },
  {
    clave: "ot-cerradas-sin-firma",
    titulo: "OT cerradas sin informe firmado",
    area: "Órdenes de trabajo",
    descripcion: "OT cerradas, informadas o finalizadas que no tienen ningún documento oficializado (firmado).",
    legado: ["SinFirmaJLab.rpt", "SinFirmaJDepto.rpt"],
    permiso: "reporte.ver",
    base: "ot",
    filtros: ["fecha", "laboratorio", "centroCosto", "texto"],
    columnas: [...COLS_OT, { clave: "sin_firma", titulo: "Documentos por firmar", tipo: "numero", total: true }],
    select: `${SEL_OT}, (SELECT COUNT(*) FROM certificado cx WHERE cx.ot_id = o.id AND cx.deleted_at IS NULL
      AND cx.oficial_at IS NULL AND cx.anulado_at IS NULL)::int AS sin_firma`,
    donde: `o.estado IN ('cerrada', 'informada', 'finalizada')
      AND NOT EXISTS (SELECT 1 FROM certificado cx WHERE cx.ot_id = o.id AND cx.deleted_at IS NULL AND cx.oficial_at IS NOT NULL)`,
    orden: ORDEN_OT,
  },
  {
    clave: "ordenes-internas",
    titulo: "Control de órdenes internas",
    area: "Órdenes de trabajo",
    descripcion: "Órdenes internas entre laboratorios: origen, destino, estado, horas y costo directo informados.",
    legado: ["OT_INTERNAS.rpt", "OT_INTERNAS2.rpt"],
    permiso: "reporte.ver",
    base: "orden_interna",
    filtros: ["fecha", "laboratorio", "estado", "texto"],
    columnas: [
      { clave: "numero", titulo: "Orden interna", tipo: "texto" },
      { clave: "tipo", titulo: "Tipo", tipo: "texto" },
      { clave: "ot", titulo: "OT", tipo: "texto" },
      { clave: "cliente", titulo: "Cliente", tipo: "texto" },
      { clave: "origen", titulo: "Laboratorio origen", tipo: "texto" },
      { clave: "destino", titulo: "Laboratorio destino", tipo: "texto" },
      { clave: "estado", titulo: "Estado", tipo: "estado" },
      { clave: "envio", titulo: "Envío", tipo: "fecha" },
      { clave: "respondida", titulo: "Respondida", tipo: "fechahora" },
      { clave: "horas", titulo: "Horas", tipo: "numero", total: true },
      { clave: "costo", titulo: "Costo directo", tipo: "monto", total: true },
    ],
    select: `oi.numero AS numero, oi.tipo AS tipo, o.codigo AS ot, c.razon_social AS cliente, COALESCE(uo.sigla, uo.nombre) AS origen,
      COALESCE(ud.sigla, ud.nombre) AS destino, oi.estado AS estado, oi.fecha_envio AS envio, oi.respondida_at AS respondida,
      oi.respuesta_horas AS horas, oi.costo_directo AS costo`,
    orden: "oi.created_at DESC",
  },
  // ------------------------------------------------------------ Comercial y facturación
  {
    clave: "montos-empresa-estado",
    titulo: "Montos por empresa según estado",
    area: "Comercial y facturación",
    descripcion: "Cantidad de OT y monto por cliente y estado de la OT.",
    legado: ["Infgest01.rpt"],
    permiso: "reporte.comercial.ver",
    base: "ot",
    filtros: TODOS,
    columnas: [
      { clave: "cliente", titulo: "Cliente", tipo: "texto" },
      { clave: "estado", titulo: "Estado", tipo: "estado" },
      { clave: "cantidad", titulo: "Cantidad de OT", tipo: "numero", total: true },
      { clave: "monto", titulo: "Monto", tipo: "monto", total: true },
    ],
    select: `COALESCE(c.razon_social, 'Sin cliente') AS cliente, o.estado AS estado, COUNT(*)::int AS cantidad, SUM(${MONTO_OT}) AS monto`,
    agrupar: "1, 2",
    orden: "1, 2",
  },
  {
    clave: "montos-tipo-cliente",
    titulo: "Montos por tipo de cliente según estado",
    area: "Comercial y facturación",
    descripcion: "Cantidad de OT y monto por tipo de cliente (Ejército, particular, gubernamental…) y estado.",
    legado: ["Infgest02.rpt"],
    permiso: "reporte.comercial.ver",
    base: "ot",
    filtros: TODOS,
    columnas: [
      { clave: "tipo_cliente", titulo: "Tipo de cliente", tipo: "estado" },
      { clave: "estado", titulo: "Estado", tipo: "estado" },
      { clave: "cantidad", titulo: "Cantidad de OT", tipo: "numero", total: true },
      { clave: "monto", titulo: "Monto", tipo: "monto", total: true },
    ],
    select: `COALESCE(c.tipo, 'sin_tipo') AS tipo_cliente, o.estado AS estado, COUNT(*)::int AS cantidad, SUM(${MONTO_OT}) AS monto`,
    agrupar: "1, 2",
    orden: "1, 2",
  },
  {
    clave: "montos-tipo-trabajo",
    titulo: "Montos por tipo de trabajo según estado",
    area: "Comercial y facturación",
    descripcion: "Cantidad de OT y monto por tipo de trabajo y estado.",
    legado: ["Infgest03.rpt"],
    permiso: "reporte.comercial.ver",
    base: "ot",
    filtros: TODOS,
    columnas: [
      { clave: "tipo_trabajo", titulo: "Tipo de trabajo", tipo: "estado" },
      { clave: "estado", titulo: "Estado", tipo: "estado" },
      { clave: "cantidad", titulo: "Cantidad de OT", tipo: "numero", total: true },
      { clave: "monto", titulo: "Monto", tipo: "monto", total: true },
    ],
    select: `COALESCE(o.tipo_trabajo, 'sin_tipo') AS tipo_trabajo, o.estado AS estado, COUNT(*)::int AS cantidad, SUM(${MONTO_OT}) AS monto`,
    agrupar: "1, 2",
    orden: "1, 2",
  },
  {
    clave: "historial-clientes",
    titulo: "Historial de clientes",
    area: "Comercial y facturación",
    descripcion: "Por cliente: cantidad de OT, monto, primera y última OT del período.",
    legado: ["CLIENTES_IDIC.rpt", "Infgest30.rpt"],
    permiso: "reporte.comercial.ver",
    base: "ot",
    filtros: TODOS,
    columnas: [
      { clave: "cliente", titulo: "Cliente", tipo: "texto" },
      { clave: "rut", titulo: "RUT", tipo: "texto" },
      { clave: "tipo_cliente", titulo: "Tipo", tipo: "estado" },
      { clave: "cantidad", titulo: "OT", tipo: "numero", total: true },
      { clave: "monto", titulo: "Monto", tipo: "monto", total: true },
      { clave: "primera", titulo: "Primera OT", tipo: "fecha" },
      { clave: "ultima", titulo: "Última OT", tipo: "fecha" },
    ],
    select: `COALESCE(c.razon_social, 'Sin cliente') AS cliente, c.rut AS rut, c.tipo AS tipo_cliente, COUNT(*)::int AS cantidad,
      SUM(${MONTO_OT}) AS monto, MIN(COALESCE(o.fecha_recepcion, o.created_at)) AS primera, MAX(COALESCE(o.fecha_recepcion, o.created_at)) AS ultima`,
    agrupar: "1, 2, 3",
    orden: "1",
  },
  {
    clave: "cotizaciones",
    titulo: "Listado de cotizaciones",
    area: "Comercial y facturación",
    descripcion: "Cotizaciones con cliente, centro de costo, estado, total, vigencia y OT generada.",
    legado: ["SCOTIZA.rpt", "Comparacion.rpt"],
    permiso: "reporte.comercial.ver",
    base: "cotizacion",
    filtros: TODOS,
    columnas: [
      { clave: "cotizacion", titulo: "Cotización", tipo: "texto" },
      { clave: "emision", titulo: "Emisión", tipo: "fecha" },
      { clave: "cliente", titulo: "Cliente", tipo: "texto" },
      { clave: "centro_costo", titulo: "Centro de costo", tipo: "texto" },
      { clave: "estado", titulo: "Estado", tipo: "estado" },
      { clave: "valida_hasta", titulo: "Válida hasta", tipo: "fecha" },
      { clave: "ot", titulo: "OT", tipo: "texto" },
      { clave: "total", titulo: "Total", tipo: "monto", total: true },
    ],
    select: `cot.codigo AS cotizacion, cot.fecha_emision AS emision, c.razon_social AS cliente, ${CC} AS centro_costo, cot.estado AS estado,
      COALESCE(cot.valida_hasta, cot.expira_at) AS valida_hasta, (SELECT ox.codigo FROM orden_trabajo ox WHERE ox.id = cot.ot_id) AS ot, cot.total AS total`,
    orden: "cot.fecha_emision DESC NULLS LAST, cot.codigo",
  },
  {
    clave: "facturas",
    titulo: "Libro de facturas",
    area: "Comercial y facturación",
    descripcion: "Facturas emitidas con OT, centro de costo, neto, IVA, total y saldo (en pesos o dólares).",
    legado: ["FACTURA.rpt", "LFACTURAS.rpt", "FACTPESOS.rpt", "FACTPESOSsinot.rpt", "FACTURADOLAR.rpt", "Infgest31.rpt"],
    permiso: "reporte.comercial.ver",
    base: "factura",
    filtros: TODOS,
    columnas: [
      { clave: "factura", titulo: "Factura", tipo: "texto" },
      { clave: "emision", titulo: "Emisión", tipo: "fecha" },
      { clave: "cliente", titulo: "Cliente", tipo: "texto" },
      { clave: "rut", titulo: "RUT", tipo: "texto" },
      { clave: "ot", titulo: "OT", tipo: "texto" },
      { clave: "centro_costo", titulo: "Centro de costo", tipo: "texto" },
      { clave: "moneda", titulo: "Moneda", tipo: "texto" },
      { clave: "neto", titulo: "Neto", tipo: "monto", total: true },
      { clave: "iva", titulo: "IVA", tipo: "monto", total: true },
      { clave: "total", titulo: "Total", tipo: "monto", total: true },
      { clave: "saldo", titulo: "Saldo", tipo: "monto", total: true },
      { clave: "estado", titulo: "Estado", tipo: "estado" },
    ],
    select: `COALESCE(f.numero, f.codigo) AS factura, f.fecha_emision AS emision, c.razon_social AS cliente, c.rut AS rut, o.codigo AS ot,
      ${CC} AS centro_costo, COALESCE(f.moneda, 'CLP') AS moneda, f.neto AS neto, f.iva_monto AS iva, f.total AS total, f.saldo AS saldo, f.estado AS estado`,
    orden: "f.fecha_emision DESC NULLS LAST, f.numero",
  },
  {
    clave: "facturacion-cc-empresa",
    titulo: "Facturación por empresa según centro de costo",
    area: "Comercial y facturación",
    descripcion: "Cantidad de facturas, neto y total por centro de costo y cliente (sin facturas anuladas).",
    legado: ["Infgest25.rpt", "CARO.rpt", "caro2.rpt"],
    permiso: "reporte.comercial.ver",
    base: "factura",
    filtros: ["fecha", "laboratorio", "centroCosto", "texto"],
    columnas: [
      { clave: "centro_costo", titulo: "Centro de costo", tipo: "texto" },
      { clave: "cliente", titulo: "Cliente", tipo: "texto" },
      { clave: "cantidad", titulo: "Facturas", tipo: "numero", total: true },
      { clave: "neto", titulo: "Neto", tipo: "monto", total: true },
      { clave: "total", titulo: "Total", tipo: "monto", total: true },
    ],
    select: `COALESCE(${CC}, 'Sin centro de costo') AS centro_costo, COALESCE(c.razon_social, 'Sin cliente') AS cliente, COUNT(*)::int AS cantidad,
      SUM(f.neto) AS neto, SUM(f.total) AS total`,
    donde: `f.estado <> 'anulada'`,
    agrupar: "1, 2",
    orden: "1, 2",
  },
  {
    clave: "notas-credito",
    titulo: "Notas de crédito",
    area: "Comercial y facturación",
    descripcion: "Notas de crédito con la factura que corrigen, cliente, motivo y monto.",
    legado: ["NCREDITO.rpt", "NCREDITODOLAR.rpt"],
    permiso: "reporte.comercial.ver",
    base: "nota_credito",
    filtros: ["fecha", "laboratorio", "centroCosto", "texto"],
    columnas: [
      { clave: "nota", titulo: "Nota de crédito", tipo: "texto" },
      { clave: "fecha", titulo: "Fecha", tipo: "fecha" },
      { clave: "factura", titulo: "Factura", tipo: "texto" },
      { clave: "cliente", titulo: "Cliente", tipo: "texto" },
      { clave: "ot", titulo: "OT", tipo: "texto" },
      { clave: "motivo", titulo: "Motivo", tipo: "texto" },
      { clave: "monto", titulo: "Monto", tipo: "monto", total: true },
    ],
    select: `COALESCE(nc.numero, nc.codigo) AS nota, nc.fecha AS fecha, COALESCE(f.numero, f.codigo) AS factura, c.razon_social AS cliente,
      o.codigo AS ot, nc.motivo AS motivo, nc.monto AS monto`,
    orden: "nc.fecha DESC NULLS LAST",
  },
  {
    clave: "deudores",
    titulo: "Deudores a la fecha",
    area: "Comercial y facturación",
    descripcion: "Facturas con saldo pendiente, días vencidos y saldo por cobrar.",
    legado: ["Infgest32.rpt"],
    permiso: "reporte.comercial.ver",
    base: "factura",
    filtros: ["fecha", "laboratorio", "centroCosto", "texto"],
    columnas: [
      { clave: "cliente", titulo: "Cliente", tipo: "texto" },
      { clave: "rut", titulo: "RUT", tipo: "texto" },
      { clave: "factura", titulo: "Factura", tipo: "texto" },
      { clave: "emision", titulo: "Emisión", tipo: "fecha" },
      { clave: "vencimiento", titulo: "Vencimiento", tipo: "fecha" },
      { clave: "dias_vencida", titulo: "Días vencida", tipo: "dias" },
      { clave: "total", titulo: "Total", tipo: "monto", total: true },
      { clave: "saldo", titulo: "Saldo", tipo: "monto", total: true },
    ],
    select: `c.razon_social AS cliente, c.rut AS rut, COALESCE(f.numero, f.codigo) AS factura, f.fecha_emision AS emision,
      f.fecha_vencimiento AS vencimiento, CASE WHEN f.fecha_vencimiento IS NULL THEN NULL ELSE GREATEST(0, ${HOY} - f.fecha_vencimiento) END AS dias_vencida,
      f.total AS total, f.saldo AS saldo`,
    donde: `COALESCE(f.saldo, 0) > 0 AND f.estado <> 'anulada'`,
    orden: "c.razon_social, f.fecha_vencimiento",
  },
  {
    clave: "recaudacion",
    titulo: "Recaudación (pagos recibidos)",
    area: "Comercial y facturación",
    descripcion: "Pagos registrados con su factura, OT, medio de pago y monto.",
    legado: ["Recaudacioncontable.rpt", "RecaudacionAsistenTecnica.rpt", "LISTAOTDEL11.rpt"],
    permiso: "reporte.comercial.ver",
    base: "pago",
    filtros: ["fecha", "laboratorio", "centroCosto", "texto"],
    columnas: [
      { clave: "fecha", titulo: "Fecha de pago", tipo: "fecha" },
      { clave: "factura", titulo: "Factura", tipo: "texto" },
      { clave: "cliente", titulo: "Cliente", tipo: "texto" },
      { clave: "ot", titulo: "OT", tipo: "texto" },
      { clave: "centro_costo", titulo: "Centro de costo", tipo: "texto" },
      { clave: "medio", titulo: "Medio", tipo: "estado" },
      { clave: "referencia", titulo: "Referencia", tipo: "texto" },
      { clave: "monto", titulo: "Monto", tipo: "monto", total: true },
    ],
    select: `p.fecha AS fecha, COALESCE(f.numero, f.codigo) AS factura, c.razon_social AS cliente, o.codigo AS ot, ${CC} AS centro_costo,
      p.medio AS medio, p.referencia AS referencia, p.monto AS monto`,
    orden: "p.fecha DESC NULLS LAST",
  },
  // ------------------------------------------------------------ BPCH · tasa
  {
    clave: "tasa-por-ot",
    titulo: "Cálculo de tasa por OT y factura",
    area: "BPCH · tasa de internación",
    descripcion: "Cada cálculo de la tasa de internación: CIF, paridad, tasa, IVA, total y factura asociada.",
    legado: ["CalcXAno-sinDetFac.rpt", "CalcXMes-conDetFac.rpt", "CalcXMes-sinDetFac.rpt", "CalcXMesDetFac.rpt", "CalcXMesDetFacSub.rpt", "desglose.rpt", "BPCH_CON_TASA.rpt"],
    permiso: "reporte.comercial.ver",
    base: "tasa",
    filtros: ["fecha", "laboratorio", "centroCosto", "texto"],
    columnas: [
      { clave: "ot", titulo: "OT", tipo: "texto" },
      { clave: "cliente", titulo: "Cliente", tipo: "texto" },
      { clave: "calculado", titulo: "Calculado", tipo: "fechahora" },
      { clave: "cif_usd", titulo: "CIF US$", tipo: "numero", total: true },
      { clave: "paridad", titulo: "Paridad", tipo: "numero" },
      { clave: "cif_clp", titulo: "CIF $", tipo: "monto", total: true },
      { clave: "tasa_pct", titulo: "Tasa %", tipo: "numero" },
      { clave: "tasa", titulo: "Monto tasa", tipo: "monto", total: true },
      { clave: "iva", titulo: "IVA", tipo: "monto", total: true },
      { clave: "total", titulo: "Total a cancelar", tipo: "monto", total: true },
      { clave: "factura", titulo: "Factura", tipo: "texto" },
    ],
    select: `o.codigo AS ot, c.razon_social AS cliente, t.calculado_at AS calculado, t.monto_cif_usd AS cif_usd, t.paridad_usd AS paridad,
      t.monto_cif_clp AS cif_clp, t.tasa_pct AS tasa_pct, t.monto_operacion AS tasa, t.iva_internacion AS iva, t.total_a_cancelar AS total,
      COALESCE(f.numero, f.codigo) AS factura`,
    orden: "t.calculado_at DESC",
  },
  {
    clave: "tasa-por-mes",
    titulo: "Tasa de internación por mes y centro de costo",
    area: "BPCH · tasa de internación",
    descripcion: "Totales mensuales de la tasa por centro de costo, con y sin factura.",
    legado: ["CalcXMes.rpt", "CalcXMesDetLab.rpt"],
    permiso: "reporte.comercial.ver",
    base: "tasa",
    filtros: ["fecha", "laboratorio", "centroCosto"],
    columnas: [
      { clave: "mes", titulo: "Mes", tipo: "texto" },
      { clave: "centro_costo", titulo: "Centro de costo", tipo: "texto" },
      { clave: "cantidad", titulo: "Cálculos", tipo: "numero", total: true },
      { clave: "con_factura", titulo: "Con factura", tipo: "numero", total: true },
      { clave: "cif_clp", titulo: "CIF $", tipo: "monto", total: true },
      { clave: "tasa", titulo: "Monto tasa", tipo: "monto", total: true },
      { clave: "total", titulo: "Total a cancelar", tipo: "monto", total: true },
    ],
    select: `to_char(${sqlDia("t.calculado_at")}, 'YYYY-MM') AS mes, COALESCE(${CC}, 'Sin centro de costo') AS centro_costo, COUNT(*)::int AS cantidad,
      COUNT(t.factura_id)::int AS con_factura, SUM(t.monto_cif_clp) AS cif_clp, SUM(t.monto_operacion) AS tasa, SUM(t.total_a_cancelar) AS total`,
    agrupar: "1, 2",
    orden: "1, 2",
  },
  // ------------------------------------------------------------ Laboratorio y calidad
  {
    clave: "documentos-emitidos",
    titulo: "Documentos emitidos",
    area: "Laboratorio y calidad",
    descripcion: "Informes, certificados, IVC y demás documentos emitidos, con su estado de firma y entrega.",
    legado: ["Cant_IVC.rpt", "DTCG_DOCUMENTACION.rpt"],
    permiso: "reporte.ver",
    base: "certificado",
    filtros: ["fecha", "laboratorio", "estado", "texto"],
    columnas: [
      { clave: "numero", titulo: "Número", tipo: "texto" },
      { clave: "tipo", titulo: "Tipo de documento", tipo: "estado" },
      { clave: "ot", titulo: "OT", tipo: "texto" },
      { clave: "cliente", titulo: "Cliente", tipo: "texto" },
      { clave: "laboratorio", titulo: "Laboratorio", tipo: "texto" },
      { clave: "emitido", titulo: "Emitido", tipo: "fechahora" },
      { clave: "oficial", titulo: "Firmado", tipo: "fechahora" },
      { clave: "entregado", titulo: "Entregado", tipo: "fechahora" },
      { clave: "estado", titulo: "Estado", tipo: "estado" },
    ],
    select: `COALESCE(ce.numero, ce.codigo) AS numero, COALESCE(ce.tipo_documento, ce.tipo) AS tipo, o.codigo AS ot, c.razon_social AS cliente,
      ${LAB} AS laboratorio, ce.emitido_at AS emitido, ce.oficial_at AS oficial, ce.entregado_at AS entregado, ce.estado AS estado`,
    orden: "COALESCE(ce.emitido_at, ce.created_at) DESC",
  },
  {
    clave: "documentos-por-tipo",
    titulo: "Cantidad de documentos por tipo y mes",
    area: "Laboratorio y calidad",
    descripcion: "Cuántos documentos de cada tipo emitió cada laboratorio por mes (incluye la cantidad de IVC).",
    legado: ["Cant_IVC.rpt"],
    permiso: "reporte.ver",
    base: "certificado",
    filtros: ["fecha", "laboratorio", "estado"],
    columnas: [
      { clave: "tipo", titulo: "Tipo de documento", tipo: "estado" },
      { clave: "laboratorio", titulo: "Laboratorio", tipo: "texto" },
      { clave: "mes", titulo: "Mes", tipo: "texto" },
      { clave: "cantidad", titulo: "Documentos", tipo: "numero", total: true },
      { clave: "firmados", titulo: "Firmados", tipo: "numero", total: true },
    ],
    select: `COALESCE(ce.tipo_documento, ce.tipo, 'sin_tipo') AS tipo, COALESCE(${LAB}, 'Sin laboratorio') AS laboratorio,
      to_char(${sqlDia("COALESCE(ce.emitido_at, ce.created_at)")}, 'YYYY-MM') AS mes, COUNT(*)::int AS cantidad, COUNT(ce.oficial_at)::int AS firmados`,
    agrupar: "1, 2, 3",
    orden: "1, 2, 3",
  },
  {
    clave: "no-conformidades",
    titulo: "Informe de no calidad (no conformidades)",
    area: "Laboratorio y calidad",
    descripcion: "No conformidades y reclamos con su laboratorio, OT, criticidad, estado, plazo y costo de no calidad.",
    legado: ["InfNoCalidad.rpt"],
    permiso: "reporte.ver",
    base: "no_conformidad",
    filtros: ["fecha", "laboratorio", "estado", "texto"],
    columnas: [
      { clave: "codigo", titulo: "Código", tipo: "texto" },
      { clave: "detectada", titulo: "Detectada", tipo: "fechahora" },
      { clave: "tipo", titulo: "Tipo", tipo: "estado" },
      { clave: "criticidad", titulo: "Criticidad", tipo: "estado" },
      { clave: "laboratorio", titulo: "Laboratorio", tipo: "texto" },
      { clave: "ot", titulo: "OT", tipo: "texto" },
      { clave: "titulo", titulo: "Título", tipo: "texto" },
      { clave: "estado", titulo: "Estado", tipo: "estado" },
      { clave: "plazo", titulo: "Plazo de cierre", tipo: "fecha" },
      { clave: "cerrada", titulo: "Cerrada", tipo: "fechahora" },
      { clave: "costo", titulo: "Costo de no calidad", tipo: "monto", total: true },
    ],
    select: `nc.codigo AS codigo, nc.detectado_at AS detectada, nc.tipo AS tipo, nc.criticidad AS criticidad, ${LAB} AS laboratorio, o.codigo AS ot,
      COALESCE(nc.titulo, LEFT(nc.descripcion, 120)) AS titulo, nc.estado AS estado, nc.plazo_cierre AS plazo, nc.cerrado_at AS cerrada,
      nc.costo_no_calidad AS costo`,
    orden: "nc.detectado_at DESC",
  },
  // ------------------------------------------------------------ Catálogo
  {
    clave: "catalogo-ensayos",
    titulo: "Listado de análisis y métodos",
    area: "Catálogo de ensayos",
    descripcion: "Ensayos del catálogo con su método, norma, instrucción de trabajo, versión y precio.",
    legado: ["Listado_ITs.rpt", "Listado_ITs2.rpt", "LISTADO_ANALISIS_GRAL.rpt", "Listado Analisis.rpt"],
    permiso: "reporte.ver",
    base: "ensayo",
    filtros: ["texto"],
    columnas: [
      { clave: "codigo", titulo: "Código", tipo: "texto" },
      { clave: "ensayo", titulo: "Ensayo", tipo: "texto" },
      { clave: "metodo_codigo", titulo: "Método", tipo: "texto" },
      { clave: "metodo", titulo: "Nombre del método", tipo: "texto" },
      { clave: "norma", titulo: "Norma", tipo: "texto" },
      { clave: "it", titulo: "Instrucción de trabajo", tipo: "texto" },
      { clave: "version", titulo: "Versión", tipo: "texto" },
      { clave: "activo", titulo: "Activo", tipo: "si_no" },
      { clave: "precio", titulo: "Precio", tipo: "monto" },
    ],
    select: `e.codigo AS codigo, e.nombre AS ensayo, m.codigo AS metodo_codigo, m.nombre AS metodo, m.norma AS norma, e.instruccion_trabajo AS it,
      m.version AS version, (e.activo AND COALESCE(m.activo, TRUE)) AS activo, e.precio AS precio`,
    orden: "e.codigo, m.codigo",
  },
  // ------------------------------------------------------------ Bases de datos y costos (Z26 · frente S4)
  ...INFORMES_Z26,
];

export const LIMITE_FILAS = 5000;

export function informePorClave(clave: string): InformeFijo | undefined {
  return INFORMES.find((i) => i.clave === clave);
}

// --------------------------------------------------------------- filtros

export interface FiltrosZona {
  desde?: string;
  hasta?: string;
  laboratorio?: string;
  centroCosto?: string;
  estado?: string;
  texto?: string;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTADO = /^[a-z0-9_]{1,40}$/;

/** Valida los filtros que admite el informe. Devuelve el mensaje de error o los filtros limpios. */
export function validarFiltros(def: InformeFijo, q: Record<string, unknown>): { error: string } | { filtros: FiltrosZona } {
  const s = (k: string) => {
    const v = q[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const f: FiltrosZona = {};
  const admite = new Set(def.filtros);
  for (const k of ["desde", "hasta"] as const) {
    const v = s(k);
    if (!v) continue;
    if (!admite.has("fecha")) return { error: "Este informe no se filtra por fecha." };
    if (!FECHA.test(v)) return { error: `«${k === "desde" ? "Desde" : "Hasta"}» debe tener el formato AAAA-MM-DD.` };
    f[k] = v;
  }
  if (f.desde && f.hasta && f.desde > f.hasta) return { error: "«Desde» no puede ser posterior a «Hasta»." };
  for (const [k, filtro] of [["laboratorio", "laboratorio"], ["centroCosto", "centroCosto"]] as const) {
    const v = s(k);
    if (!v) continue;
    if (!admite.has(filtro)) return { error: `Este informe no se filtra por ${k === "laboratorio" ? "laboratorio" : "centro de costo"}.` };
    if (!UUID.test(v)) return { error: `El ${k === "laboratorio" ? "laboratorio" : "centro de costo"} elegido no es válido.` };
    f[k] = v;
  }
  const estado = s("estado");
  if (estado) {
    if (!admite.has("estado")) return { error: "Este informe no se filtra por estado." };
    if (!ESTADO.test(estado)) return { error: "El estado elegido no es válido." };
    f.estado = estado;
  }
  const texto = s("texto");
  if (texto) {
    if (!admite.has("texto")) return { error: "Este informe no admite búsqueda por texto." };
    f.texto = texto.slice(0, 80);
  }
  return { filtros: f };
}

/**
 * Arma la consulta: SELECT fijo + condiciones con parámetros. `unidades` = null
 * para perfiles globales (sin filtro de alcance).
 */
export function armarConsulta(def: InformeFijo, filtros: FiltrosZona, tenantId: string, unidades: string[] | null): { sql: string; args: unknown[] } {
  const base: Base = BASES[def.base];
  const args: unknown[] = [tenantId];
  const p = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  const conds: string[] = [base.donde];
  if (def.donde) conds.push(`(${def.donde})`);
  const fecha = def.fecha ?? base.fecha;
  if (filtros.desde) conds.push(`${fecha} >= ${p(filtros.desde)}::date`);
  if (filtros.hasta) conds.push(`${fecha} < (${p(filtros.hasta)}::date + 1)`);
  if (filtros.laboratorio && base.unidad) conds.push(base.unidad(`${p(filtros.laboratorio)}::uuid`));
  if (filtros.centroCosto && base.centroCosto) conds.push(`${base.centroCosto} = ${p(filtros.centroCosto)}::uuid`);
  if (filtros.estado && base.estado) conds.push(`${base.estado} = ${p(filtros.estado)}`);
  if (filtros.texto && base.texto?.length) {
    const k = p(`%${filtros.texto.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    conds.push(`(${base.texto.map((e) => `${e} ILIKE ${k}`).join(" OR ")})`);
  }
  if (unidades && base.alcance) conds.push(base.alcance(`${p(unidades)}::uuid[]`));
  const sql =
    `SELECT ${def.select} FROM ${base.from} WHERE ${conds.join(" AND ")}` +
    (def.agrupar ? ` GROUP BY ${def.agrupar}` : "") +
    ` ORDER BY ${def.orden} LIMIT ${LIMITE_FILAS + 1}`;
  return { sql, args };
}

/** Valores de estado presentes en los datos del informe (para el filtro). Sin alcance: son solo códigos. */
export function consultaEstados(def: InformeFijo, tenantId: string): { sql: string; args: unknown[] } | null {
  const base: Base = BASES[def.base];
  if (!base.estado || !def.filtros.includes("estado")) return null;
  return {
    sql: `SELECT DISTINCT ${base.estado} AS estado FROM ${base.from} WHERE ${base.donde} AND ${base.estado} IS NOT NULL ORDER BY 1 LIMIT 60`,
    args: [tenantId],
  };
}

/** Totales de las columnas marcadas `total`. */
export function totales(def: InformeFijo, filas: Record<string, unknown>[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const c of def.columnas.filter((x) => x.total)) {
    t[c.clave] = filas.reduce((s, f) => {
      const v = f[c.clave];
      const n = v === null || v === undefined || v === "" ? 0 : Number(v);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
    t[c.clave] = Math.round(t[c.clave] * 100) / 100;
  }
  return t;
}

/** Texto legible de un código (estado, tipo…): «en_analisis» → «En analisis». */
export function textoCodigo(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
