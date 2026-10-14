/**
 * Motor GUM de metrología para la vista previa en vivo (espejo exacto del
 * backend apps/api/src/metrologia/metrologia.calc.ts). El servidor recalcula al
 * guardar; esto es solo para mostrar resultados mientras se escribe.
 */
export type Componente = { simbolo: string; nombre: string; distribucion: string; fuente: string; orden?: number };
export type Divisores = Record<string, number>;
export type Punto = { nominal: number; correccion: number; uPatron: number; deriva: number; lecturas: number[] };
export type CompCalc = Componente & { valor: number; divisor: number; ui: number };
export type PuntoCalc = Punto & {
  media: number; repetibilidad: number; referencia: number; error: number;
  uc: number; uExp: number; en: number; dentro: boolean; componentes: CompCalc[];
};

const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stdev = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = avg(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

export function calcPunto(comps: Componente[], divs: Divisores, cond: Record<string, number>, p: Punto): PuntoCalc {
  const lect = (p.lecturas || []).map(Number).filter((x) => !Number.isNaN(x));
  const media = avg(lect);
  const rep = stdev(lect);
  const referencia = Number(p.nominal) + Number(p.correccion || 0);
  const error = media - referencia;
  const hist = lect.length >= 2 ? Math.abs(Math.max(...lect) - Math.min(...lect)) : 0;
  const src = (f: string): number =>
    f === "uPatron" ? Number(p.uPatron || 0)
    : f === "rep" ? rep
    : f === "deriva" ? Number(p.deriva || 0)
    : f === "hist" ? hist
    : Number(cond[f] || 0);
  const componentes: CompCalc[] = comps.map((c) => {
    const valor = src(c.fuente);
    const divisor = divs[c.distribucion] || 1;
    return { ...c, valor, divisor, ui: Math.abs(valor) / divisor };
  });
  const uc = Math.sqrt(componentes.reduce((a, c) => a + c.ui * c.ui, 0));
  const uExp = 2 * uc;
  const uPat = Number(p.uPatron || 0);
  const en = Math.abs(error) / Math.sqrt(uExp * uExp + uPat * uPat || 1e-30);
  const mpe = Number(cond.mpe);
  const dentro = Number.isFinite(mpe) && mpe > 0 ? Math.abs(error) + uExp <= mpe : true;
  return { ...p, media, repetibilidad: rep, referencia, error, uc, uExp, en, dentro, componentes };
}

export function calcularCalibracion(comps: Componente[], divs: Divisores, cond: Record<string, number>, puntos: Punto[]) {
  const res = puntos.map((p) => calcPunto(comps, divs, cond, p));
  const uMax = res.length ? Math.max(...res.map((r) => r.uExp)) : 0;
  const enMax = res.length ? Math.max(...res.map((r) => r.en)) : 0;
  const conforme = res.every((r) => r.dentro);
  return { puntos: res, uMax, enMax, conforme };
}

export const nd = (v: unknown) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isNaN(n) ? 0 : n; };
export const fmtN = (x: unknown, d = 3) =>
  x == null || Number.isNaN(Number(x)) ? "—" : Number(x).toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d });

// ─── Motores validados por instrucción de trabajo (cálculo en el servidor) ────
export type OpcionMotor = { clave: string; hallazgo: string; etiqueta: string };
export type MotorInfo = {
  it: string; magnitud: string; nombre: string; unidad: string; unidadU: string;
  /** false = cálculo estándar sin planilla real con la que compararse (formulario por puntos). */
  validado?: boolean;
  opciones: OpcionMotor[]; casos: { caso: string; instrumento: string }[];
};
export type PuntoResumen = {
  nominal: number; error: number | null; uc: number | null; U: number; Ucert: number | null; conforme: boolean | null;
  /** Clase ISO 376 del rango que empieza en el punto (LNF). */
  clase?: string;
  /** Unidad propia del punto (formulario por puntos). */
  unidad?: string;
};
export type CalculoMotor = {
  motor: string;
  resultado: any;
  resumen: { puntos: PuntoResumen[]; uMax: number; uCert: number | null; conforme: boolean | null; extra?: { etiqueta: string; valor: string }[] };
};

/** Motor de un proceso: el que indica el servidor o, si no, por código (ITV02a/g/c comparten ITV02). */
export const motorDe = (motores: MotorInfo[], codigo: string, it?: string | null) =>
  (it ? motores.find((m) => m.it === it) : undefined) ??
  motores.find((m) => m.it === codigo) ?? motores.find((m) => m.it === codigo.replace(/[a-z]$/, ""));

/** Nombre visible de cada laboratorio de la Sección Metrología. */
export const LAB_NOMBRE: Record<string, string> = {
  LMT: "LMT · Calibración Área Mecánica", LMTE: "LMTE · Calibración Área Eléctrica",
  LNF: "LNF · Laboratorio Nacional de Fuerza", LCAD: "LCAD · Metrología",
};

/** Número con 6 cifras significativas y coma decimal. */
export const fmtG = (x: unknown) =>
  x == null || Number.isNaN(Number(x)) ? "—" : Number(x).toLocaleString("es-CL", { maximumSignificantDigits: 6 });

/** Texto del input → número si es numérico (acepta coma), null si vacío; si no, se conserva como texto. */
export const parseEntrada = (t: string): number | string | null => {
  const s = t.trim();
  if (s === "") return null;
  return /^-?\d+([.,]\d+)?([eE][-+]?\d+)?$/.test(s) ? Number(s.replace(",", ".")) : s;
};
export const verEntrada = (v: unknown) => (v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v));

/** Nombres de las entradas de las planillas del LMT (la clave técnica se muestra al lado). */
export const ETIQUETA_ENTRADA: Record<string, string> = {
  temp: "Temperatura ambiente (°C)", hum: "Humedad relativa (%)", patm: "Presión atmosférica (hPa)",
  et: "Error del termómetro ambiental", eh: "Error del higrómetro", ebar: "Error del barómetro",
  tcorr: "Corrección de temperatura", hcorr: "Corrección de humedad", res: "Resolución", div: "División de escala",
  pU: "U del patrón", pU2: "U del patrón 2", der: "Deriva del patrón", pDer: "Deriva de los patrones", Up: "U del patrón",
  pts: "Puntos", nom: "Nominal", s: "Lectura", p: "Patrón", comp: "Masa patrón", ecc: "Excentricidad (A–E)", cero: "Cero inicial / final",
  pat: "Masas patrón", mcm: "CMC por rango", tipo: "Tipo", medio: "Medio de transmisión", fac: "Factor bar/MPa", pres: "Resolución del patrón",
  pi0: "Cero inicial", asc: "Ascendente", desc: "Descendente", perr: "Error del patrón", hP: "Altura patrón (mm)", hI: "Altura instrumento (mm)",
  gl: "Gravedad local (m/s²)", uAlt: "U de altura", A0: "Área efectiva A0", lam: "Coef. de distorsión λ", alpha: "Coef. de dilatación α",
  urel: "U relativa de la balanza", umin: "U mínima", rhoN2: "Densidad del nitrógeno", rhoM: "Densidad de las masas", tp: "Temperatura del pistón",
  pieces: "Masas del juego", r: "Serie 1 y 2 (asc / desc)", par: "Paralelismo", int: "Interiores", prof: "Profundidad", esc: "Escalón",
  tolPar: "Tolerancia de paralelismo", tolPla: "Tolerancia de planitud", alin: "Alineación", n: "Lectura", c: "Corrección de la regla",
  cap: "Capacidad", empty: "Recipiente vacío (g)", berr: "Error de la balanza", Ta: "T aire (°C)", Tw: "T agua (°C)", HR: "Humedad (%)", P: "Presión (hPa)",
  ev: "Evaporación (g)", h: "Alturas del menisco", thA: "Termómetro de aire", thW: "Termómetro de agua", hr: "Higrómetro", pr: "Barómetro", bal: "Balanza",
  hi: "Punto de hielo inicial", hf: "Punto de hielo final", blocks: "Puntos", B: "Display", E: "Termocupla centro", G: "Termocupla auxiliar",
  eE: "Error termocupla centro", eG: "Error termocupla auxiliar", zero: "Cero por serie", f0: "Retorno a cero",
  UP: "U del patrón", pcl: "Clase del patrón", rep: "Reproducibilidad", lp: "Punto de carga", geo: "Efectos geométricos", itf: "Interfaz",
  curve: "Curva del transductor", WP: "W del patrón", cmc: "CMC", nomT: "Nominal (g)", L: "Lecturas p-m-m-p", cls: "Clase declarada",
  T: "Temperatura inicio / término", H: "Humedad inicio / término", dmp: "Corrección de la masa de referencia", dev: "Desviación de la masa",
};

/** Nombres propios de las entradas de un motor (tienen prioridad sobre ETIQUETA_ENTRADA). */
export const ETIQUETA_MOTOR: Record<string, Record<string, string>> = {
  "LCPNF-IT01": {
    sentido: "Sentido (TRACCIÓN / COMPRESIÓN)", resInd: "Resolución del indicador (mV/V)", div: "N° de divisiones",
    decRes: "Decimales de la resolución", conv: "Conversión a kN", fmin: "Rango mínimo (kN)", fmax: "Rango máximo (kN)",
    urelSmp: "U relativa del SMP (UREL95)", grado: "Grado de interpolación (1, 2 o 3)", interp: "Incluir error de interpolación (SI / NO)",
    dec: "Decimales de los promedios", tIni: "Temperatura al inicio (°C)", hr: "Humedad relativa (%)", hrU: "U de la humedad (%)",
    temp: "Temperatura al final de cada serie (°C)", pre: "Precargas: 0 / Fmáx / 0 (mV/V)",
    z0: "Cero inicial de I1, I2, I3 e I5 (mV/V)", zf: "Cero final de I1, I2 y tras I4 e I6 (mV/V)",
    F: "Fuerza (kN)", s: "Serie I",
  },
};
