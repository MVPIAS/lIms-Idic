/**
 * Parámetros del circuito de la cotización (Administración › Parámetros,
 * categoría `circuito_cotizacion`, sembrados en align_cotizacion_circuito.sql).
 * Todos están POR CONFIRMAR con el IDIC (EP-00 §10 P1–P2); los valores por
 * defecto siguen la EP: V°B° del laboratorio y del departamento, firma del Jefe
 * DCO obligatoria para aceptar, consulta al laboratorio opcional.
 */
import { nivelesVb, siNo, type ConfigCircuito } from "./circuito-cotizacion";

export type PrecioEjercito = "ficha" | "costo_directo" | "costo_total" | "neto";

export interface ConfigCircuitoCompleta extends ConfigCircuito {
  /** Costo indirecto (CI) sobre el costo directo, %. Lista oficial 2026: 20. */
  cfaPct: number;
  /** Recargo del precio particular sobre el costo total, %. Lista oficial 2026: 30. */
  margenParticularPct: number;
  /** IVA sobre el neto, %. */
  ivaPct: number;
  /** Qué precio de la lista vigente toma un cliente Ejército (POR CONFIRMAR): ficha = no usa la lista. */
  precioEjercito: PrecioEjercito;
  /**
   * Tipos de cliente que pagan el precio institucional (el de `precioEjercito`) y no el
   * neto particular. Respuesta del IDIC del 24-11-2026 (checklist Comercial SVT 30):
   * Ejército, Carabineros, Fuerza Aérea, Armada, PDI y Gendarmería.
   */
  tiposPrecioInstitucional: string[];
}

/** Valores por defecto de la fórmula oficial (lista de precios IDIC 2026). */
export const CI_PCT_DEF = 20;
export const RECARGO_PCT_DEF = 30;
export const IVA_PCT_DEF = 19;
/** COM-36 (IDIC 17-11-2026): «en general costo directo (para todas las FF.AA. y de Orden)». */
export const precioEjercitoDe = (v: string | null | undefined): PrecioEjercito =>
  v === "ficha" || v === "costo_total" || v === "neto" ? v : "costo_directo";

/** Checklist Comercial SVT 30 (IDIC 24-11-2026): «solo se cobra el Costo Directo» a estas instituciones. */
export const TIPOS_PRECIO_INSTITUCIONAL_DEF = ["ejercito", "carabineros", "fuerza_aerea", "armada", "pdi", "gendarmeria"];

/** Lista de códigos separada por comas; vacía o ausente = la lista por defecto. */
export function tiposPrecioInstitucionalDe(v: string | null | undefined): string[] {
  if (v == null || !String(v).trim()) return [...TIPOS_PRECIO_INSTITUCIONAL_DEF];
  return [...new Set(String(v).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Regla de PRECIO de una cotización. La validez sigue su propia configuración
 * (validez-config.ts); el precio institucional se decide por el tipo de cliente
 * elegido en la cotización: si está en la lista, toma la columna del parámetro
 * `precio_ejercito`; si no, la regla del tipo de cliente (`tipo_cliente.valor`).
 * El código legado «institucional» se trata como Ejército.
 */
export function reglaPrecioDe(tipoCliente: string | null | undefined, base: "EJERCITO" | "PARTICULAR", tipos: string[]): "EJERCITO" | "PARTICULAR" {
  const t = (tipoCliente ?? "").trim().toLowerCase();
  if (!t) return base;
  if (tipos.includes(t) || (t === "institucional" && tipos.includes("ejercito"))) return "EJERCITO";
  return base;
}

const pct = (v: string | null | undefined, def: number) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : def;
};

export function configDesdeValores(v: Record<string, string | null | undefined>): ConfigCircuitoCompleta {
  return {
    niveles: nivelesVb(v.vb_niveles),
    // COM-09 (IDIC 17-11-2026): el V°B° del Jefe de Laboratorio es requisito para emitir.
    exigirConsulta: siNo(v.exigir_consulta_laboratorio, true),
    exigirFirma: siNo(v.exigir_firma_para_aceptar, true),
    cfaPct: pct(v.cfa_pct, CI_PCT_DEF),
    margenParticularPct: pct(v.margen_particular_pct, RECARGO_PCT_DEF),
    ivaPct: pct(v.iva_pct, IVA_PCT_DEF),
    precioEjercito: precioEjercitoDe(v.precio_ejercito),
    tiposPrecioInstitucional: tiposPrecioInstitucionalDe(v.tipos_precio_institucional),
  };
}

export async function leerConfigCircuito(db: any, tenantId: string): Promise<ConfigCircuitoCompleta> {
  let filas: { codigo: string; valor: string | null }[] = [];
  try {
    filas = await db.$queryRawUnsafe(
      `SELECT codigo, valor FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'circuito_cotizacion' AND activo`,
      tenantId,
    );
  } catch {
    filas = [];
  }
  return configDesdeValores(Object.fromEntries(filas.map((f) => [f.codigo, f.valor])));
}

/** Columnas del circuito de una cotización (fuera del modelo Prisma). */
export interface EstadoCircuito {
  circuito: string | null;
  firmaEstado: "pendiente" | "firmada" | "devuelta" | null;
  firmadaAt: Date | null;
  firmadaPorNombre: string | null;
  firmaDevueltaMotivo: string | null;
  enviadaAt: Date | null;
  enviadaMedio: string | null;
  enviadaDestinatarios: string | null;
}

export async function estadoCircuitoDe(db: any, ids: string[]): Promise<Map<string, EstadoCircuito>> {
  if (!ids.length) return new Map();
  const filas: (EstadoCircuito & { id: string })[] = await db.$queryRawUnsafe(
    `SELECT c.id, c.circuito, c.firma_estado AS "firmaEstado", c.firmada_at AS "firmadaAt",
            u.nombre_completo AS "firmadaPorNombre", c.firma_devuelta_motivo AS "firmaDevueltaMotivo",
            c.enviada_at AS "enviadaAt", c.enviada_medio AS "enviadaMedio", c.enviada_destinatarios AS "enviadaDestinatarios"
       FROM cotizacion c LEFT JOIN usuario u ON u.id = c.firmada_por
      WHERE c.id = ANY($1::uuid[])`,
    ids,
  );
  return new Map(filas.map(({ id, ...r }) => [id, r]));
}
