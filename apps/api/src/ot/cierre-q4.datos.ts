/**
 * Lecturas de BD del cierre de la OT · lote 4 (reglas en reglas-cierre-q4.ts).
 * Las columnas vienen de align_q4_cierre_ot.sql (fuera del modelo Prisma): si
 * la BD aún no lo tiene, todo se lee como «sin registrar» y nada se bloquea.
 */
import { CATEGORIA_CIERRE_OT, configCierreOt, laboratorioEn, type ConfigCierreOt, type EtapaCierre } from "./reglas-cierre-q4";
import { SQL_OT_TERMINADA_EL } from "./lista-cierre";

type Db = { $queryRawUnsafe<T = unknown>(sql: string, ...args: unknown[]): Promise<T> };

export async function configCierreDe(db: Db, tenantId: string): Promise<ConfigCierreOt> {
  const filas = await db
    .$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
      `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = $2`,
      tenantId,
      CATEGORIA_CIERRE_OT,
    )
    .catch(() => []);
  return configCierreOt(filas);
}

export interface RegistroCierre {
  at: Date | string;
  porId: string | null;
  por: string | null;
}

export interface HechosCierreQ4 {
  laboratorio: string | null;
  laboratorioId: string | null;
  etapas: Record<EtapaCierre, RegistroCierre | null>;
  incumplimiento: (RegistroCierre & { motivo: string | null }) | null;
  /** Resultados vivos por estado. */
  porEstado: Record<string, number>;
  /** Aprobados con veredicto No cumple. */
  noCumpleAprobados: number;
  /** Estado de la planilla de costos reales del laboratorio responsable (null = no existe). */
  estadoPlanilla: string | null;
  /** Día en que la OT quedó terminada (último documento entregado o recepción en el DCO). */
  terminadaEl: string | null;
}

const reg = (at: any, porId: any, por: any): RegistroCierre | null => (at ? { at, porId: porId ?? null, por: por ?? null } : null);

/** Hechos del cierre de la OT (lote 4). */
export async function hechosCierreQ4(db: Db, otId: string): Promise<HechosCierreQ4> {
  const [o] = await db.$queryRawUnsafe<any[]>(
    `SELECT u.codigo AS laboratorio, o.unidad_principal AS "laboratorioId",
            to_char(${SQL_OT_TERMINADA_EL}, 'YYYY-MM-DD') AS "terminadaEl"
       FROM orden_trabajo o LEFT JOIN unidad u ON u.id = o.unidad_principal
      WHERE o.id = $1::uuid`,
    otId,
  );
  const estados = await db.$queryRawUnsafe<{ estado: string; n: number; nc: number }[]>(
    `SELECT estado, count(*)::int AS n,
            count(*) FILTER (WHERE estado = 'aprobado' AND lower(COALESCE(veredicto, '')) IN ('no_cumple', 'no cumple'))::int AS nc
       FROM resultado WHERE ot_id = $1::uuid AND deleted_at IS NULL GROUP BY estado`,
    otId,
  );
  const porEstado: Record<string, number> = {};
  let noCumpleAprobados = 0;
  for (const e of estados) {
    porEstado[e.estado ?? "pendiente"] = Number(e.n);
    noCumpleAprobados += Number(e.nc);
  }
  let c: any = {};
  try {
    [c] = await db.$queryRawUnsafe<any[]>(
      `SELECT o.cierre_analista_at, o.cierre_analista_por, ua.nombre_completo AS cierre_analista_nombre,
              o.cierre_jefe_lab_at, o.cierre_jefe_lab_por, ul.nombre_completo AS cierre_jefe_lab_nombre,
              o.cierre_jefe_depto_at, o.cierre_jefe_depto_por, ud.nombre_completo AS cierre_jefe_depto_nombre,
              o.incumplimiento_cerrado_at, o.incumplimiento_cerrado_por, ui.nombre_completo AS incumplimiento_nombre,
              o.incumplimiento_cerrado_motivo
         FROM orden_trabajo o
         LEFT JOIN usuario ua ON ua.id = o.cierre_analista_por
         LEFT JOIN usuario ul ON ul.id = o.cierre_jefe_lab_por
         LEFT JOIN usuario ud ON ud.id = o.cierre_jefe_depto_por
         LEFT JOIN usuario ui ON ui.id = o.incumplimiento_cerrado_por
        WHERE o.id = $1::uuid`,
      otId,
    );
  } catch {
    c = {}; // BD sin align_q4_cierre_ot.sql
  }
  let estadoPlanilla: string | null = null;
  if (o?.laboratorioId) {
    try {
      const [p] = await db.$queryRawUnsafe<{ estado: string }[]>(
        `SELECT estado FROM ot_costo_real WHERE ot_id = $1::uuid AND unidad_id = $2::uuid`,
        otId,
        o.laboratorioId,
      );
      estadoPlanilla = p?.estado ?? null;
    } catch {
      estadoPlanilla = null; // BD sin planillas de costos reales
    }
  }
  return {
    laboratorio: o?.laboratorio ?? null,
    laboratorioId: o?.laboratorioId ?? null,
    etapas: {
      analista: reg(c?.cierre_analista_at, c?.cierre_analista_por, c?.cierre_analista_nombre),
      jefe_lab: reg(c?.cierre_jefe_lab_at, c?.cierre_jefe_lab_por, c?.cierre_jefe_lab_nombre),
      jefe_depto: reg(c?.cierre_jefe_depto_at, c?.cierre_jefe_depto_por, c?.cierre_jefe_depto_nombre),
    },
    incumplimiento: c?.incumplimiento_cerrado_at
      ? { at: c.incumplimiento_cerrado_at, porId: c.incumplimiento_cerrado_por ?? null, por: c.incumplimiento_nombre ?? null, motivo: c.incumplimiento_cerrado_motivo ?? null }
      : null,
    porEstado,
    noCumpleAprobados,
    estadoPlanilla,
    terminadaEl: o?.terminadaEl ?? null,
  };
}

/** Cuentas derivadas de los estados. */
export function cuentasResultados(porEstado: Record<string, number>) {
  const n = (...es: string[]) => es.reduce((s, e) => s + (porEstado[e] ?? 0), 0);
  const total = Object.values(porEstado).reduce((s, x) => s + x, 0);
  return {
    total,
    aprobados: n("aprobado"),
    noEjecutados: n("no_ejecutado"),
    sinCapturar: n("pendiente", "devuelto", "rechazado"),
    /** Ni aprobados ni «No ejecutado». */
    sinTerminar: total - n("aprobado", "no_ejecutado"),
  };
}

export function hechasDe(h: HechosCierreQ4): Record<EtapaCierre, boolean> {
  return { analista: !!h.etapas.analista, jefe_lab: !!h.etapas.jefe_lab, jefe_depto: !!h.etapas.jefe_depto };
}

export function exigePlanilla(cfg: ConfigCierreOt, laboratorio: string | null): boolean {
  return laboratorioEn(cfg.planillaCostosLabs, laboratorio);
}
