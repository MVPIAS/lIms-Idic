/**
 * Código del proyecto (quinto envío IDIC, lote 3): «PROY/001/2026» =
 * PROY / correlativo / año. Reglas puras en `configNumeracionProyecto` y
 * `formatearCodigoProyecto` (numeracion-proyecto.spec.ts); el correlativo sale
 * de un contador atómico por tenant y serie (`proyecto_correlativo`,
 * align_q3_proyecto.sql), con la misma técnica que la OT y la cotización.
 *
 * Valores PROVISIONALES (el IDIC aún no responde los detalles), editables en
 * Administración › Parámetros del sistema › «Numeración de proyectos»
 * (categoría `numeracion_proyecto`):
 *   · formato  «PROY/{N}/{AAAA}»  ({N} = correlativo, {AAAA} = año de creación)
 *   · digitos  3                  (relleno con ceros: 001)
 *   · reinicio anual | global     (anual: cada año vuelve a 1)
 */
import { anioChile } from "../common/fecha-chile";

export interface ConfigNumeracionProyecto {
  formato: string;
  digitos: number;
  reinicio: "anual" | "global";
}

export const NUMERACION_PROYECTO_DEF: ConfigNumeracionProyecto = { formato: "PROY/{N}/{AAAA}", digitos: 3, reinicio: "anual" };

/** Normaliza los valores leídos de parametro_sistema (texto) con sus valores por defecto. */
export function configNumeracionProyecto(valores: Record<string, string | null | undefined>): ConfigNumeracionProyecto {
  const formato = String(valores.formato ?? "").trim();
  const digitos = Number(valores.digitos);
  const reinicio = String(valores.reinicio ?? "").trim().toLowerCase();
  return {
    formato: (formato.match(/\{N\}/g) ?? []).length === 1 ? formato.slice(0, 40) : NUMERACION_PROYECTO_DEF.formato,
    digitos: Number.isInteger(digitos) && digitos >= 1 && digitos <= 10 ? digitos : NUMERACION_PROYECTO_DEF.digitos,
    reinicio: reinicio === "anual" || reinicio === "global" ? reinicio : NUMERACION_PROYECTO_DEF.reinicio,
  };
}

/** Serie del contador: una por año (reinicio anual) o una sola. */
export function serieProyecto(cfg: ConfigNumeracionProyecto, anio: number): string {
  return cfg.reinicio === "anual" ? String(anio) : "global";
}

/** «PROY/{N}/{AAAA}» con n = 1 y año 2026 → «PROY/001/2026». */
export function formatearCodigoProyecto(cfg: ConfigNumeracionProyecto, anio: number, n: number): string {
  return cfg.formato.replace(/\{AAAA\}/g, String(anio)).replace(/\{N\}/g, String(n).padStart(cfg.digitos, "0"));
}

/** Texto del proyecto en la OT y en los informes: «PROY/001/2026 · Nombre» (máx. 200, el largo de ot_encargo.proyecto). */
export function textoProyecto(codigo: string | null | undefined, nombre: string | null | undefined): string | null {
  const t = [codigo, nombre].map((x) => String(x ?? "").trim()).filter(Boolean).join(" · ");
  return t ? t.slice(0, 200) : null;
}

/**
 * Siguiente código de proyecto, atómico (INSERT … ON CONFLICT DO UPDATE …
 * RETURNING). `db` = PrismaService o una transacción. Si el código ya existe
 * (cargado a mano o migrado), toma el siguiente.
 */
export async function generarCodigoProyecto(db: any, tenantId: string, fecha: Date = new Date()): Promise<{ codigo: string; anio: number; correlativo: number }> {
  const filas: { codigo: string; valor: string | null }[] = await db.$queryRawUnsafe(
    `SELECT codigo, valor FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'numeracion_proyecto' AND activo`,
    tenantId,
  );
  const cfg = configNumeracionProyecto(Object.fromEntries(filas.map((f) => [f.codigo, f.valor])));
  const anio = anioChile(fecha);
  const serie = serieProyecto(cfg, anio);
  for (let intento = 0; intento < 50; intento++) {
    const r: { ultimo: number }[] = await db.$queryRawUnsafe(
      `INSERT INTO proyecto_correlativo (tenant_id, serie, ultimo) VALUES ($1::uuid, $2, 1)
       ON CONFLICT (tenant_id, serie) DO UPDATE SET ultimo = proyecto_correlativo.ultimo + 1, updated_at = now()
       RETURNING ultimo`,
      tenantId,
      serie,
    );
    const correlativo = Number(r[0]?.ultimo ?? 1);
    const codigo = formatearCodigoProyecto(cfg, anio, correlativo);
    const usado: unknown[] = await db.$queryRawUnsafe(`SELECT 1 FROM proyecto WHERE tenant_id = $1::uuid AND codigo = $2 LIMIT 1`, tenantId, codigo);
    if (!usado.length) return { codigo, anio, correlativo };
  }
  throw new Error("No se pudo obtener un código de proyecto libre: revise los parámetros numeracion_proyecto.");
}
