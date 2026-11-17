/**
 * Hoja de control del Laboratorio Nacional de Fuerza (LCPNF-IT01, ISO 376) ·
 * ajustes pedidos en la sesión del 03-11-2026 (R9). Funciones PURAS
 * (hoja-lnf.reglas.spec.ts); el motor validado (motores/lnf.ts) no cambia.
 *
 *   · Columna SMP: señal que da el sistema de medición patrón (transductor de
 *     referencia) en cada fuerza, según la ecuación de su certificado
 *     S = a·F + b·F² + c·F³ (maestro de patrones, coeficientes). Es la columna
 *     «SMP» de la pestaña TID de LCPNF-000.00 rev 23. Informativa: no entra al cálculo.
 *   · Unidad de la resolución del indicador configurable (no siempre mV/V).
 *   · Validación ambiental con el dato y su unidad.
 *   · Lo cotizado (sentido y puntos del ítem de la OT) frente a lo que se calibra.
 */

/** Coeficientes de la ecuación S = a·F + b·F² + c·F³ del certificado del patrón. */
export interface CoefSmp { a: number; b: number; c: number }

const finito = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Coeficientes del maestro de patrones (columna `coeficientes`); null si no están completos. */
export function coeficientesSmp(coef: unknown): CoefSmp | null {
  const k = coef && typeof coef === "object" ? (coef as Record<string, unknown>) : null;
  if (!k) return null;
  const [a, b, c] = [Number(k.a), Number(k.b), Number(k.c)];
  return [a, b, c].every(Number.isFinite) && (a !== 0 || b !== 0 || c !== 0) ? { a, b, c } : null;
}

/** Señal del patrón para una fuerza (redondeada a 10 cifras significativas, como la planilla). */
export function smpPorFuerza(k: CoefSmp | null, F: unknown): number | null {
  if (!k || !finito(F)) return null;
  const s = k.a * F + k.b * F ** 2 + k.c * F ** 3;
  return Number(s.toPrecision(10));
}

/** Columna SMP para todos los puntos de la hoja (null donde no hay fuerza o coeficientes). */
export function columnaSmp(k: CoefSmp | null, puntos: { F?: unknown }[]): (number | null)[] {
  return puntos.map((p) => smpPorFuerza(k, p?.F));
}

/** Unidad de la resolución del indicador (y de las lecturas): la escrita en la hoja o mV/V. */
export function unidadIndicador(datos: { uRes?: unknown } | null | undefined): string {
  const u = String(datos?.uRes ?? "").trim();
  return u ? u.slice(0, 20) : "mV/V";
}

/* ---------------------------------------------------- validación ambiental --- */
/** Rangos de lectura válidos (los mismos de los equipos auxiliares del maestro). */
export const RANGOS_AMBIENTE = {
  temp: { min: -50, max: 150, unidad: "°C" },
  hum: { min: 0, max: 100, unidad: "%HR" },
  pres: { min: 300, max: 1200, unidad: "hPa" },
} as const;
/** ISO 376: la calibración se hace entre 18 y 28 °C, con una variación de ±1 °C por serie. */
export const ISO376_TEMP = { min: 18, max: 28 };

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : null);
const fmt = (x: number) => String(Number(x.toPrecision(6))).replace(".", ",");

/**
 * Errores (bloquean) y avisos (no bloquean) de las condiciones de la hoja del LNF.
 * Cada mensaje dice qué dato, el valor escrito y su unidad.
 */
export function validarAmbienteLnf(d: { tIni?: unknown; hr?: unknown; hrU?: unknown; temp?: unknown }): { errores: string[]; avisos: string[] } {
  const errores: string[] = [];
  const avisos: string[] = [];
  const T = RANGOS_AMBIENTE.temp, H = RANGOS_AMBIENTE.hum;
  const revisarT = (v: unknown, etiqueta: string) => {
    const x = num(v);
    if (x == null) return;
    if (!Number.isFinite(x)) errores.push(`${etiqueta}: «${String(v)}» no es un número (use °C).`);
    else if (x < T.min || x > T.max) errores.push(`${etiqueta}: ${fmt(x)} °C está fuera del rango válido (${T.min} a ${T.max} °C).`);
    else if (x < ISO376_TEMP.min || x > ISO376_TEMP.max)
      avisos.push(`${etiqueta}: ${fmt(x)} °C está fuera de lo que pide la ISO 376 (${ISO376_TEMP.min} a ${ISO376_TEMP.max} °C).`);
  };
  revisarT(d.tIni, "Temperatura al inicio");
  const temps = Array.isArray(d.temp) ? d.temp : [];
  temps.forEach((v, i) => revisarT(v, `Temperatura al final de la serie ${i + 1}`));
  for (const [v, etiqueta] of [[d.hr, "Humedad relativa"], [d.hrU, "U de la humedad"]] as const) {
    const x = num(v);
    if (x == null) continue;
    if (!Number.isFinite(x)) errores.push(`${etiqueta}: «${String(v)}» no es un número (use %HR).`);
    else if (x < H.min || x > H.max) errores.push(`${etiqueta}: ${fmt(x)} %HR está fuera del rango válido (${H.min} a ${H.max} %HR).`);
  }
  return { errores, avisos };
}

/* --------------------------------------------------------- lo cotizado --- */
const SENTIDO: Record<string, string> = { T: "TRACCIÓN", C: "COMPRESIÓN", "T+C": "TRACCIÓN y COMPRESIÓN" };

/** Sentido de la hoja («TRACCIÓN», «compresion», «T»…) normalizado a T o C; null si no se entiende. */
export function sentidoDeHoja(x: unknown): "T" | "C" | null {
  const s = String(x ?? "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!s) return null;
  if (s === "T" || s.startsWith("TRAC")) return "T";
  if (s === "C" || s.startsWith("COMP")) return "C";
  return null;
}

/** Fuerzas que se leen de un texto de puntos cotizados («300, 600 y 900 kN»). */
export function fuerzasDeTexto(t: unknown): number[] {
  const m = String(t ?? "").replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2").match(/\d+(?:[.,]\d+)?/g) ?? [];
  return m.map((x) => Number(x.replace(",", "."))).filter(Number.isFinite);
}

/**
 * Avisos de la hoja frente a lo cotizado en el ítem de la OT (sesión LNF: se trabajó
 * un ítem en tracción y otro en compresión sin ninguna alerta).
 */
export function avisosCotizadoLnf(
  item: { sentido?: string | null; puntos?: string | null; numero?: number | null },
  datos: { sentido?: unknown; pts?: { F?: unknown }[] } | null | undefined,
): string[] {
  const a: string[] = [];
  const del = item.numero != null ? ` del ítem ${item.numero}` : "";
  const cot = item.sentido && SENTIDO[item.sentido] ? item.sentido : null;
  const hoja = sentidoDeHoja(datos?.sentido);
  if (cot && cot !== "T+C" && hoja && hoja !== cot)
    a.push(`Lo cotizado${del} es ${SENTIDO[cot]} y la hoja de control está en ${SENTIDO[hoja]}: revise el sentido antes de enviar.`);
  // Puntos en % del alcance (no en kN) no se comparan.
  const cotizadas = /%/.test(String(item.puntos ?? "")) ? [] : fuerzasDeTexto(item.puntos);
  const hojaF = (datos?.pts ?? []).map((p) => (typeof p?.F === "number" ? p.F : NaN)).filter(Number.isFinite);
  if (cotizadas.length && hojaF.length) {
    const faltan = cotizadas.filter((f) => !hojaF.some((x) => Math.abs(x - f) <= 1e-9 * Math.max(1, f)));
    if (faltan.length) a.push(`Puntos cotizados${del} que no están en la hoja: ${faltan.map(fmt).join(", ")} kN.`);
  }
  return a;
}
