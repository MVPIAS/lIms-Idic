// =============================================================================
// format.ts · Formateo canónico de campos para el LIMS IDIC (convención Chile es-CL)
// -----------------------------------------------------------------------------
// Un ÚNICO lugar para monedas, números, porcentajes, fechas y RUT, para que toda
// la app muestre los mismos separadores (miles ".", decimales ",") y formatos.
// Reglas Chile:
//   · Peso chileno (CLP): sin decimales, miles con punto  ->  $ 1.234.567
//   · Dólar (USD):        2 decimales, coma decimal       ->  US$ 1.234,50
//   · Números:            miles ".", decimales ","         ->  1.234,5
//   · Porcentajes:        hasta 2 decimales + " %"         ->  19 %  /  12,5 %
//   · Fechas:             dd-mm-aaaa   ·  Fecha+hora: dd-mm-aaaa HH:MM
//   · RUT:                12.345.678-9
// Toda función tolera null/undefined/"" y strings numéricos (Prisma serializa
// Decimal como string), devolviendo un guion "—" cuando no hay dato.
// =============================================================================

const NBSP = " "; // espacio fino no separable entre símbolo y número
const GUION = "—";

/** Convierte a number admitiendo string ("1234.50"), coma decimal o null. */
function aNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s/g, "");
  // Si viene con formato local "1.234,56" lo normaliza; si es "1234.56" lo deja.
  const norm = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

/** Moneda. moneda: "CLP" (por defecto, 0 decimales) | "USD" (2 decimales). */
export function money(v: unknown, moneda: "CLP" | "USD" = "CLP"): string {
  const n = aNumero(v);
  if (n === null) return GUION;
  if (moneda === "USD") {
    return "US$" + NBSP + n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return "$" + NBSP + n.toLocaleString("es-CL", { maximumFractionDigits: 0 });
}

/** Alias corto para peso chileno. */
export const clp = (v: unknown): string => money(v, "CLP");
/** Dólar estadounidense. */
export const usd = (v: unknown): string => money(v, "USD");

/**
 * Moneda según código dinámico (columna `moneda` de la fila). Cualquier valor
 * que no sea USD se trata como CLP.
 */
export function monto(v: unknown, codigoMoneda?: string | null): string {
  return money(v, (codigoMoneda ?? "CLP").toUpperCase() === "USD" ? "USD" : "CLP");
}

/** Número genérico con decimales opcionales (miles ".", decimal ","). */
export function num(v: unknown, decimales = 0): string {
  const n = aNumero(v);
  if (n === null) return GUION;
  return n.toLocaleString("es-CL", { minimumFractionDigits: decimales, maximumFractionDigits: Math.max(decimales, 2) });
}

/** Porcentaje: "19 %" / "12,5 %". `v` es el valor ya en porcentaje (no fracción). */
export function pct(v: unknown, decimales = 0): string {
  const n = aNumero(v);
  if (n === null) return GUION;
  const s = n.toLocaleString("es-CL", { minimumFractionDigits: decimales, maximumFractionDigits: 2 });
  return s + NBSP + "%";
}

/**
 * ¿Es una fecha de CALENDARIO (sin hora)? «aaaa-mm-dd» o como Prisma serializa
 * las columnas DATE: «aaaa-mm-ddT00:00:00.000Z». Esas no se convierten a la hora
 * de Chile: si no, en UTC−3/−4 se mostraban un día antes (recorrido MP-06, D06-01:
 * resolución del 20-10 vista como 19-10).
 */
const SOLO_DIA = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/;

/** Hoy en Chile como «aaaa-mm-dd» (valor por defecto de los <input type="date">). */
export function hoyISO(): string {
  try {
    return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
  } catch {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
}

/** Fecha dd-mm-aaaa. Acepta Date, ISO string o "aaaa-mm-dd" (las fechas sin hora, tal cual). */
export function fecha(v: unknown): string {
  if (!v) return GUION;
  if (typeof v === "string") {
    const m = SOLO_DIA.exec(v.trim());
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) {
    // fallback: si viene "aaaa-mm-dd..." lo reordena sin construir Date (evita TZ).
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : GUION;
  }
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/** Fecha con hora: dd-mm-aaaa HH:MM. */
/**
 * Fecha de CALENDARIO (columnas DATE: válida hasta, fecha OPI…). Prisma las
 * serializa como "aaaa-mm-ddT00:00:00.000Z"; con `fecha()` en Chile (UTC−3/−4)
 * saldrían un día antes. Aquí se toma la parte aaaa-mm-dd tal cual.
 */
export function fechaDia(v: unknown): string {
  if (!v) return GUION;
  const m = String(v instanceof Date ? v.toISOString() : v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : fecha(v);
}

export function fechaHora(v: unknown): string {
  if (!v) return GUION;
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return fecha(v);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${fecha(d)} ${hh}:${mi}`;
}

/** RUT chileno formateado 12.345.678-9 a partir de dígitos + DV. */
export function rut(v: unknown): string {
  if (!v) return GUION;
  const limpio = String(v).replace(/[^0-9kK]/g, "").toUpperCase();
  if (limpio.length < 2) return String(v);
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  const conMiles = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${conMiles}-${dv}`;
}
