/**
 * Validez automática de la cotización · IT DCO-PG01-P01-IT02 (Depto. Comercial).
 *
 * Reglas acordadas con SVT (ronda 1, oct-2026):
 *   · PARTICULARES → 45 días corridos desde la emisión. Un laboratorio puede
 *     tener una validez propia mayor (p. ej. LRB, LMT): se configura en
 *     `centro_costo.validez_particular_dias`.
 *   · EJÉRCITO     → hasta el 31 de diciembre del año de emisión (año
 *     presupuestario). Si se emite en OCTUBRE, NOVIEMBRE o DICIEMBRE, la
 *     validez es de 6 meses desde la emisión (cruza al año siguiente).
 *
 * La regla de cada tipo de cliente es un PARÁMETRO (`parametro_sistema`,
 * categoría tipo_cliente, columna `valor` = EJERCITO | PARTICULAR); los números
 * (45 días, 6 meses) también (categoría validez_cotizacion). Aquí solo se fijan
 * los valores por defecto.
 *
 * Función PURA (sin BD ni reloj): todo se calcula en fechas de calendario UTC
 * (sin hora) para que no haya corrimientos por zona horaria.
 */

export type ReglaValidez = "EJERCITO" | "PARTICULAR";

export interface EntradaValidez {
  /** Fecha de emisión (se toma solo la parte de calendario). */
  fechaEmision: Date | string;
  regla: ReglaValidez;
  /** Días para particulares (parámetro general). Def. 45. */
  diasParticular?: number;
  /** Días propios del laboratorio para particulares (centro de costo). Tiene prioridad. */
  diasParticularLab?: number | null;
  /** Meses de validez del Ejército si se emite oct–dic. Def. 6. */
  mesesEjercitoOctDic?: number;
}

export interface ResultadoValidez {
  /** Fecha de vencimiento (inclusive), YYYY-MM-DD. */
  validaHasta: string;
  /** Días corridos entre emisión y vencimiento (para `validez_dias` legado). */
  dias: number;
  regla: ReglaValidez;
  /** Explicación legible para la UI. */
  explicacion: string;
}

export const DIAS_PARTICULAR_DEF = 45;
export const MESES_EJERCITO_OCT_DIC_DEF = 6;

/** Normaliza a fecha UTC a medianoche. Acepta Date o 'YYYY-MM-DD[...]'. */
export function soloFecha(d: Date | string): Date {
  if (typeof d === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    d = new Date(d);
  }
  if (Number.isNaN(d.getTime())) throw new Error("Fecha de emisión inválida");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function isoFecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Suma meses de calendario; si el día no existe en el mes destino, usa el último día (31-oct + 6m → 30-abr). */
export function sumarMeses(d: Date, meses: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + meses;
  const ultimoDia = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), ultimoDia)));
}

export function sumarDias(d: Date, dias: number): Date {
  return new Date(d.getTime() + dias * 86_400_000);
}

/** Regla de validez a partir del `valor` del parámetro tipo_cliente (o del código, si no hay valor). */
export function reglaDeTipoCliente(codigo?: string | null, valorParametro?: string | null): ReglaValidez {
  const v = (valorParametro ?? "").trim().toUpperCase();
  if (v === "EJERCITO" || v === "PARTICULAR") return v;
  // Sin parámetro: solo 'ejercito' (y el legado 'institucional') siguen la regla Ejército.
  return codigo === "ejercito" || codigo === "institucional" ? "EJERCITO" : "PARTICULAR";
}

const fmt = (d: Date) => {
  const [y, m, dd] = isoFecha(d).split("-");
  return `${dd}-${m}-${y}`;
};

export function calcularValidez(e: EntradaValidez): ResultadoValidez {
  const emision = soloFecha(e.fechaEmision);
  let hasta: Date;
  let explicacion: string;

  if (e.regla === "EJERCITO") {
    const meses = e.mesesEjercitoOctDic && e.mesesEjercitoOctDic > 0 ? e.mesesEjercitoOctDic : MESES_EJERCITO_OCT_DIC_DEF;
    const mes = emision.getUTCMonth(); // 0 = enero … 9 = octubre
    if (mes >= 9) {
      hasta = sumarMeses(emision, meses);
      explicacion = `Ejército: emitida en oct–dic → ${meses} meses desde la emisión (hasta el ${fmt(hasta)}).`;
    } else {
      hasta = new Date(Date.UTC(emision.getUTCFullYear(), 11, 31));
      explicacion = `Ejército: válida hasta el 31 de diciembre del año de emisión (${fmt(hasta)}).`;
    }
  } else {
    const lab = e.diasParticularLab && e.diasParticularLab > 0 ? e.diasParticularLab : null;
    const dias = lab ?? (e.diasParticular && e.diasParticular > 0 ? e.diasParticular : DIAS_PARTICULAR_DEF);
    hasta = sumarDias(emision, dias);
    explicacion = lab
      ? `Particular: ${dias} días (validez propia del laboratorio), hasta el ${fmt(hasta)}.`
      : `Particular: ${dias} días desde la emisión, hasta el ${fmt(hasta)}.`;
  }

  return {
    validaHasta: isoFecha(hasta),
    dias: Math.round((hasta.getTime() - emision.getTime()) / 86_400_000),
    regla: e.regla,
    explicacion,
  };
}

// ---------------------------------------------------------------------------
// Vencimiento (la cotización Abierta fuera de validez pasa a «Vencida»)
// ---------------------------------------------------------------------------

/** Zona horaria del IDIC: el «hoy» comercial es el de Chile, no el del servidor (UTC). */
export const ZONA_IDIC = "America/Santiago";

/** Fecha de calendario de hoy en Chile, como fecha UTC a medianoche (comparable con valida_hasta). */
export function hoyEnChile(ahora: Date = new Date()): Date {
  // en-CA formatea AAAA-MM-DD.
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_IDIC, year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
  return soloFecha(iso);
}

/**
 * ¿La validez ya terminó? `validaHasta` es INCLUSIVE: el último día de validez
 * aún se puede aceptar; vence al día siguiente. Sin fecha → no vence.
 */
export function estaVencida(validaHasta: Date | string | null | undefined, hoy: Date): boolean {
  if (!validaHasta) return false;
  return soloFecha(validaHasta).getTime() < soloFecha(hoy).getTime();
}

/** Estados que pueden vencer: la Abierta vigente y la 'enviada' del histórico. */
export const ESTADOS_QUE_VENCEN = ["abierta", "enviada"] as const;

/** Días que faltan para el vencimiento (0 = vence hoy; negativo = ya vencida). */
export function diasParaVencer(validaHasta: Date | string, hoy: Date): number {
  return Math.round((soloFecha(validaHasta).getTime() - soloFecha(hoy).getTime()) / 86_400_000);
}

/** Texto legible de una fecha de validez (dd-mm-aaaa). */
export function fechaLegible(d: Date | string): string {
  return fmt(soloFecha(d));
}
