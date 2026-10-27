// =============================================================================
// fecha-chile.ts · Regla ÚNICA de fechas de la web (frente f8)
// -----------------------------------------------------------------------------
// El IDIC trabaja en hora de Chile (America/Santiago, con horario de verano).
// Pasadas las 21:00 (verano, UTC−3) o las 20:00 (invierno, UTC−4) en UTC ya es
// el día siguiente. Por eso:
//   · «hoy», el día de un instante, el mes y el año se calculan SIEMPRE en la
//     zona del IDIC con estas funciones, sea cual sea la zona del equipo del
//     usuario o del servidor Next (que pre-renderiza en UTC);
//   · prohibido `toISOString().slice(0, 10)` sobre un instante, `getFullYear()`,
//     `getDate()`, `setDate()`, `getHours()` locales y `toLocaleDateString` sin
//     `timeZone` (lo vigila apps/api/src/common/fecha-chile.regla.spec.ts);
//   · las fechas de CALENDARIO (columnas DATE: «aaaa-mm-dd» o
//     «aaaa-mm-ddT00:00:00.000Z») se toman tal cual, sin convertir.
// Es el equivalente de apps/api/src/common/fecha-chile.ts.
//
// Zona configurable en la construcción con NEXT_PUBLIC_ZONA_HORARIA (por defecto
// America/Santiago); una zona no válida se ignora.
// =============================================================================

export const ZONA_POR_DEFECTO = "America/Santiago";

function zonaValida(z: unknown): z is string {
  if (typeof z !== "string" || !/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+){0,2}$/.test(z)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

/** Zona horaria del IDIC en la web. */
export const ZONA_CHILE: string = (() => {
  const z = (process.env.NEXT_PUBLIC_ZONA_HORARIA ?? "").trim();
  return z && zonaValida(z) ? z : ZONA_POR_DEFECTO;
})();

const SOLO_DIA = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/;
const dos = (n: number) => String(n).padStart(2, "0");

export interface PartesChile {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
}

let FORMATO: Intl.DateTimeFormat | null = null;
/** Año, mes, día, hora y minuto de un instante en la hora del IDIC. */
export function partesChile(d: Date): PartesChile {
  FORMATO ??= new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_CHILE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const p = Object.fromEntries(FORMATO.formatToParts(d).map((x) => [x.type, x.value]));
  return { anio: Number(p.year), mes: Number(p.month), dia: Number(p.day), hora: Number(p.hour) % 24, minuto: Number(p.minute) };
}

/** ¿Es una fecha de calendario (DATE)? «aaaa-mm-dd» o medianoche UTC exacta. */
export function esFechaCalendario(v: unknown): boolean {
  if (typeof v === "string") return SOLO_DIA.test(v.trim());
  if (v instanceof Date && !Number.isNaN(v.getTime()))
    return v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0 && v.getUTCMilliseconds() === 0;
  return false;
}

/** Hoy en Chile como «aaaa-mm-dd» (valor por defecto de los <input type="date">). */
export function hoyChile(ahora: Date = new Date()): string {
  const p = partesChile(ahora);
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)}`;
}

/** Año en curso en Chile (el 31-12 a las 23:59 sigue siendo el año que termina). */
export function anioChile(ahora: Date = new Date()): number {
  return partesChile(ahora).anio;
}

/** Mes en curso en Chile, «aaaa-mm». */
export function mesChile(ahora: Date = new Date()): string {
  const p = partesChile(ahora);
  return `${p.anio}-${dos(p.mes)}`;
}

/** Hora (0–23) en Chile. */
export function horaChile(ahora: Date = new Date()): number {
  return partesChile(ahora).hora;
}

/** «aaaa-mm-ddTHH:MM» de un instante en Chile (valor de un <input type="datetime-local">). */
export function ahoraInputChile(ahora: Date = new Date()): string {
  const p = partesChile(ahora);
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)}T${dos(p.hora)}:${dos(p.minuto)}`;
}

/**
 * Día de calendario «aaaa-mm-dd» en Chile: una fecha de calendario se toma tal
 * cual; un instante (timestamptz) se convierte a la hora de Chile.
 */
export function diaChile(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") {
    const m = SOLO_DIA.exec(v.trim());
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  if (esFechaCalendario(d)) return d.toISOString().slice(0, 10);
  return hoyChile(d);
}

/** Suma días de calendario a «aaaa-mm-dd» (aritmética de calendario, sin zona). */
export function sumarDiasCalendario(dia: string, n: number): string {
  const d = new Date(`${dia.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
