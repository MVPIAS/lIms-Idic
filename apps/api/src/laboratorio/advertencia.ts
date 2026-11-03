/**
 * Dictamen «advertencia» y re-análisis automático (contrato §4.2.6 / §4.3.9) ·
 * funciones PURAS, probadas en advertencia.spec.ts.
 *
 * Advertencia: el resultado CUMPLE, pero queda tan cerca de un límite que
 * conviene mirarlo (zona de alerta). El margen es un porcentaje:
 *   · con Mín y Máx, del ancho del intervalo (Máx − Mín);
 *   · con un solo límite, del valor absoluto de ese límite.
 * Margen 0 = sin advertencias. El veredicto no cambia (sigue «cumple»): la
 * advertencia es una marca aparte que se ve en pantalla y en la bandeja.
 *
 * Re-análisis: según el parámetro `resultados.reanalisis_automatico`, un No
 * cumple (y, si se pide, una advertencia) abre una solicitud de re-análisis
 * que impide revisar y aprobar el ensayo hasta que se repita (nueva captura) o
 * la jefatura la descarte con motivo.
 */

export const MODOS_REANALISIS = ["no", "no_cumple", "no_cumple_y_advertencia"] as const;
export type ModoReanalisis = (typeof MODOS_REANALISIS)[number];

export interface ConfigResultados {
  /** Margen de advertencia en % (0–50); 0 = sin advertencias. */
  margenPct: number;
  reanalisis: ModoReanalisis;
  /** Avisar por correo las advertencias al capturar (los No cumple se avisan al aprobar). */
  avisarAdvertencia: boolean;
}

export const CONFIG_RESULTADOS_DEFECTO: ConfigResultados = { margenPct: 10, reanalisis: "no_cumple", avisarAdvertencia: true };

const numero = (v: string | number | null | undefined): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = v.trim().replace(/\s/g, "");
  if (!/^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/.test(t)) return null;
  return Number(t.replace(",", "."));
};

/** Lee la categoría `resultados` de parametro_sistema (filas inactivas = valor por defecto). */
export function configResultados(filas: { codigo: string; valor: string | null; activo?: boolean }[]): ConfigResultados {
  const d = CONFIG_RESULTADOS_DEFECTO;
  const v = (c: string) => filas.find((f) => f.codigo === c && f.activo !== false)?.valor ?? null;
  const m = numero(v("advertencia_margen_pct"));
  const modo = String(v("reanalisis_automatico") ?? "").trim() as ModoReanalisis;
  const aviso = String(v("advertencia_correo") ?? "").trim().toLowerCase();
  return {
    margenPct: m != null && m >= 0 && m <= 50 ? m : d.margenPct,
    reanalisis: (MODOS_REANALISIS as readonly string[]).includes(modo) ? modo : d.reanalisis,
    avisarAdvertencia: ["no", "false", "0"].includes(aviso) ? false : ["si", "sí", "true", "1"].includes(aviso) ? true : d.avisarAdvertencia,
  };
}

const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6).replace(".", ",");

/**
 * ¿Un valor que CUMPLE queda en la zona de advertencia? Devuelve el motivo
 * legible o null. `margenMetodo` (del método) manda sobre el general.
 */
export function advertenciaNumerica(
  valor: number | null | undefined,
  limiteInf: string | number | null | undefined,
  limiteSup: string | number | null | undefined,
  margenPct: number,
  margenMetodo?: number | null,
): string | null {
  const pct = margenMetodo != null && margenMetodo >= 0 ? margenMetodo : margenPct;
  if (valor == null || !Number.isFinite(valor) || !(pct > 0)) return null;
  const inf = numero(limiteInf);
  const sup = numero(limiteSup);
  if (inf == null && sup == null) return null;
  // Solo para lo que cumple: fuera de límites ya es No cumple.
  if ((inf != null && valor < inf) || (sup != null && valor > sup)) return null;
  const margen = inf != null && sup != null ? ((sup - inf) * pct) / 100 : (Math.abs((inf ?? sup)!) * pct) / 100;
  if (!(margen > 0)) return null;
  const cerca: string[] = [];
  if (inf != null && valor - inf <= margen + 1e-9) cerca.push(`a ${fmt(valor - inf)} del Mín ${fmt(inf)}`);
  if (sup != null && sup - valor <= margen + 1e-9) cerca.push(`a ${fmt(sup - valor)} del Máx ${fmt(sup)}`);
  if (!cerca.length) return null;
  return `Cumple, pero ${cerca.join(" y ")} (margen de advertencia ${fmt(pct)} %).`;
}

/** ¿Este dictamen abre un re-análisis automático? */
export function debeReanalizar(veredicto: string | null | undefined, advertencia: boolean, modo: ModoReanalisis): boolean {
  if (modo === "no") return false;
  if (veredicto === "no_cumple") return true;
  return modo === "no_cumple_y_advertencia" && advertencia && veredicto === "cumple";
}

/** Motivo de bloqueo de revisar/aprobar un ensayo con re-análisis abierto. */
export function motivoReanalisisAbierto(r: { motivo: string; origen: string } | null | undefined): string | null {
  if (!r) return null;
  return (
    `Este ensayo tiene un re-análisis ${r.origen === "automatico" ? "automático " : ""}pendiente (${r.motivo}). ` +
    "Repita la determinación y capture el nuevo valor, o que la jefatura descarte el re-análisis con su motivo."
  );
}
