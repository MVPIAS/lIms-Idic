/**
 * Costo real de la OT · lecturas de la base para la planilla (frente S4,
 * reuniones R2, R9 y R10). Integra lo que ya existe en Tablas maestras:
 *   · Tarifas HH por categoría (hora_hombre_catalogo) → $/h de las horas hombre.
 *   · Tarifas HM por equipo (hora_maquina_catalogo) → $/h de los equipos. El IDIC
 *     aún no entrega el valor hora de cada equipo: sin tarifa se indica
 *     «Pendiente del IDIC» y la jefatura lo escribe a mano.
 *   · Costo por km de vehículos (tarifa_vehiculo) → gasto «vehículo institucional».
 *   · Valorización de los consumos del kardex con el costo de cada lote (bodegas).
 *   · Umbrales del semáforo (parámetros costo_real.*).
 * Reglas puras en costos-reales.ts y consumibles/bodegas.ts.
 */
import { costoConsumos } from "../consumibles/bodegas";
import { diaChile } from "../common/fecha-chile";
import { PREFIJO_CATEGORIA_HH, tarifaVigente, umbralesDesde, type UmbralesSemaforo } from "./costos-reales";

type Db = { $queryRawUnsafe: <T = unknown>(q: string, ...p: unknown[]) => Promise<T> };

const dia = (v: unknown): string => (v instanceof Date ? diaChile(v) ?? "" : v == null ? "" : String(v).slice(0, 10));

export async function umbralesSemaforo(db: Db, tenantId: string): Promise<UmbralesSemaforo> {
  const filas = await db
    .$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
      `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'costo_real'`,
      tenantId,
    )
    .catch(() => [] as { codigo: string; valor: string | null; activo: boolean }[]);
  return umbralesDesde(filas);
}

export interface TarifasCosto {
  hh: { codigo: string; categoria: string; etiqueta: string; valorHora: number }[];
  hm: { equipoId: string | null; codigo: string | null; descripcion: string | null; valorHora: number }[];
  vehiculos: { categoria: string; descripcion: string | null; costoKm: number }[];
}

/** Tarifas vigentes hoy (HH por categoría, HM por equipo y costo por km). */
export async function tarifasVigentes(db: Db, tenantId: string, hoy: string): Promise<TarifasCosto> {
  const [hh, hm, veh] = await Promise.all([
    db.$queryRawUnsafe<any[]>(
      `SELECT categoria, descripcion, valor_hora_clp::float8 AS valor, vigente_desde AS "vigenteDesde", vigente_hasta AS "vigenteHasta", activo
         FROM hora_hombre_catalogo WHERE tenant_id = $1::uuid`,
      tenantId,
    ),
    db.$queryRawUnsafe<any[]>(
      `SELECT equipo_id AS "equipoId", codigo, descripcion, valor_hora_clp::float8 AS valor, vigente_desde AS "vigenteDesde", vigente_hasta AS "vigenteHasta", activo
         FROM hora_maquina_catalogo WHERE tenant_id = $1::uuid`,
      tenantId,
    ),
    db.$queryRawUnsafe<any[]>(
      `SELECT categoria, descripcion, costo_km_clp::float8 AS valor, vigente_desde AS "vigenteDesde", vigente_hasta AS "vigenteHasta", activo
         FROM tarifa_vehiculo WHERE tenant_id = $1::uuid`,
      tenantId,
    ),
  ]);
  const norm = (f: any) => ({ ...f, vigenteDesde: dia(f.vigenteDesde), vigenteHasta: f.vigenteHasta ? dia(f.vigenteHasta) : null, activo: !!f.activo });
  const porClave = <T>(filas: any[], clave: (f: any) => string) => {
    const g = new Map<string, any[]>();
    for (const f of filas.map(norm)) g.set(clave(f), [...(g.get(clave(f)) ?? []), f]);
    return [...g.values()].map((x) => tarifaVigente(x, hoy)).filter((x): x is any => !!x) as T[];
  };
  return {
    hh: porClave<any>(hh, (f) => f.categoria)
      .map((f) => ({ codigo: `${PREFIJO_CATEGORIA_HH}${f.categoria}`, categoria: f.categoria, etiqueta: `Tarifa HH · ${f.descripcion ?? f.categoria}`, valorHora: Number(f.valor) }))
      .sort((a, b) => a.categoria.localeCompare(b.categoria)),
    hm: porClave<any>(hm, (f) => f.equipoId ?? `cod:${f.codigo ?? ""}`).map((f) => ({ equipoId: f.equipoId ?? null, codigo: f.codigo ?? null, descripcion: f.descripcion ?? null, valorHora: Number(f.valor) })),
    vehiculos: porClave<any>(veh, (f) => f.categoria).map((f) => ({ categoria: f.categoria, descripcion: f.descripcion ?? null, costoKm: Number(f.valor) })),
  };
}

/** Categorías de tarifa HH activas (sirven como «cargo» de una línea de horas hombre). */
export async function categoriasHh(db: Db, tenantId: string): Promise<string[]> {
  const filas = await db.$queryRawUnsafe<{ categoria: string }[]>(
    `SELECT DISTINCT categoria FROM hora_hombre_catalogo WHERE tenant_id = $1::uuid AND activo`,
    tenantId,
  );
  return filas.map((f) => `${PREFIJO_CATEGORIA_HH}${f.categoria}`);
}

/** Tarifa HM de un equipo: por el equipo o por su código EQ###. */
export function tarifaDeEquipo(t: TarifasCosto["hm"], e: { id: string; codigo: string | null }): number | null {
  const x = t.find((h) => h.equipoId === e.id) ?? t.find((h) => !h.equipoId && h.codigo && e.codigo && h.codigo.toUpperCase() === e.codigo.toUpperCase());
  return x ? x.valorHora : null;
}

/** Consumos (kardex) de los ensayos de un laboratorio en la OT, valorizados con el costo de cada lote. */
export async function consumosValorizados(db: Db, otId: string, tenantId: string, resultados: string[]) {
  const filas = await db.$queryRawUnsafe<any[]>(
    `SELECT c.id, c.codigo, c.nombre, c.unidad_medida AS unidad, mc.cantidad::float8 AS cantidad,
            l.costo_unitario_clp::float8 AS "costoLote", c.costo_unitario_clp::float8 AS "costoConsumible"
       FROM movimiento_consumible mc JOIN lote_consumible l ON l.id = mc.lote_id
       JOIN consumible c ON c.id = l.consumible_id JOIN muestra m ON m.id = mc.muestra_id
      WHERE m.ot_id = $1::uuid AND mc.tipo = 'consumo' AND mc.tenant_id = $2::uuid
        AND m.id IN (SELECT r.muestra_id FROM resultado r WHERE r.id = ANY($3::uuid[]))
      ORDER BY c.codigo`,
    otId,
    tenantId,
    resultados,
  );
  const g = new Map<string, any[]>();
  for (const f of filas) g.set(f.id, [...(g.get(f.id) ?? []), f]);
  return [...g.values()].map((fs) => {
    const v = costoConsumos(fs.map((f) => ({ cantidad: Number(f.cantidad), costoLote: f.costoLote, costoConsumible: f.costoConsumible })));
    return { id: fs[0].id, codigo: fs[0].codigo, nombre: fs[0].nombre, unidad: fs[0].unidad, cantidad: v.cantidad, costoUnitario: v.costoPromedio, costoTotal: v.total, sinCosto: v.sinCosto };
  });
}

/** Total y horas hombre de cada planilla de costos de la OT (todos los laboratorios). */
export async function planillasDeOt(db: Db, otId: string) {
  const filas = await db.$queryRawUnsafe<any[]>(
    `SELECT c.unidad_id AS "unidadId", COALESCE(u.sigla, u.codigo, u.nombre) AS unidad, c.estado,
            COALESCE(SUM(l.total), 0)::float8 AS total,
            COALESCE(SUM(l.cantidad) FILTER (WHERE l.categoria = 'horas_hombre'), 0)::float8 AS "horasHombre"
       FROM ot_costo_real c
       LEFT JOIN ot_costo_real_linea l ON l.planilla_id = c.id
       LEFT JOIN unidad u ON u.id = c.unidad_id
      WHERE c.ot_id = $1::uuid
      GROUP BY c.unidad_id, u.sigla, u.codigo, u.nombre, c.estado
      ORDER BY 2`,
    otId,
  );
  return filas.map((f) => ({ unidadId: f.unidadId, unidad: f.unidad, estado: f.estado, total: Number(f.total), horasHombre: Number(f.horasHombre) }));
}
