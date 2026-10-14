/**
 * Registro de los motores de cálculo validados del Laboratorio de Metrología.
 *
 * Cada motor reproduce número a número el libro Excel de su instrucción de
 * trabajo (IT). Las `opciones` son las correcciones propuestas en el documento
 * «Consultas y peticiones – Metrología»: apagadas dan exactamente el Excel;
 * encendidas aplican el criterio corregido, a la espera de la decisión del LMT.
 */
import { calcularITM01, calcularITM02 } from "./masa";
import { calcularITP01, calcularITP02 } from "./presion";
import { calcularITL01, calcularITL02, calcularITL06, calcularITL07 } from "./longitud";
import { calcularITV02 } from "./volumen";
import { calcularITT01, calcularITT02 } from "./temperatura";
import { calcularITF01, calcularITF03 } from "./fuerza";
import { calcularITPT01 } from "./par";
import { calcularLNF } from "./lnf";
import { calcularPuntos, FORMULA_PUNTOS } from "./puntos";
import type { Datos, Opciones } from "./util";

export type { Datos, Opciones } from "./util";

export interface PuntoResumen {
  nominal: number;
  error: number | null;
  uc: number | null;
  U: number;
  Ucert: number | null;
  conforme: boolean | null;
  /** Clase del rango que empieza en este punto (ISO 376). */
  clase?: string;
  /** Unidad propia del punto (formulario por puntos: cada punto puede ser de otra función). */
  unidad?: string;
}
export interface ResumenMotor {
  puntos: PuntoResumen[];
  uMax: number;
  uCert: number | null;
  conforme: boolean | null;
  /** Datos adicionales para mostrar y certificar (clase, coeficientes, fórmula…). */
  extra?: { etiqueta: string; valor: string }[];
}
export interface OpcionMotor { clave: string; hallazgo: string; etiqueta: string }
export interface Motor {
  it: string;
  magnitud: string;
  nombre: string;
  /** Unidad del nominal y del error. */
  unidad: string;
  /** Unidad de la incertidumbre (difiere en fuerza y par, donde es relativa). */
  unidadU: string;
  opciones: OpcionMotor[];
  /** false = cálculo estándar sin planilla real con la que compararse. */
  validado?: boolean;
  calcular: (d: Datos, opt?: Opciones) => any;
  resumen: (r: any, d: Datos) => ResumenMotor;
}

const maxOf = (a: number[]) => (a.length ? Math.max(...a) : 0);
/** Resumen genérico a partir de las columnas de la tabla de resultados de cada IT. */
function porFilas(
  cols: { error: string | null; uc: string | null; U: string; Ucert: string | null; nominal?: string },
  extra?: { uCert?: (r: any) => number | null; conforme?: (row: any) => boolean | null },
) {
  return (r: any): ResumenMotor => {
    const puntos: PuntoResumen[] = r.rows.map((row: any) => ({
      nominal: row[cols.nominal ?? "nom"],
      error: cols.error ? row[cols.error] : null,
      uc: cols.uc ? row[cols.uc] : null,
      U: row[cols.U],
      Ucert: cols.Ucert ? row[cols.Ucert] : null,
      conforme: extra?.conforme ? extra.conforme(row) : null,
    }));
    const uCert = extra?.uCert ? extra.uCert(r) : cols.Ucert ? maxOf(puntos.map((p) => p.Ucert as number)) : null;
    const conf = puntos.map((p) => p.conforme).filter((c): c is boolean => c !== null);
    return { puntos, uMax: maxOf(puntos.map((p) => p.U)), uCert, conforme: conf.length ? conf.every(Boolean) : null };
  };
}

export const MOTORES: Record<string, Motor> = {
  ITM02: {
    it: "ITM02", magnitud: "masa", nombre: "Instrumentos de pesar (balanzas)", unidad: "g", unidadU: "g",
    opciones: [{ clave: "fix", hallazgo: "M1", etiqueta: "Usar la deriva propia de la masa de 50 g" }],
    calcular: calcularITM02, resumen: porFilas({ error: "E", uc: "M", U: "O", Ucert: "Uc" }),
  },
  ITM01: {
    it: "ITM01", magnitud: "masa", nombre: "Masas patrón por comparación", unidad: "mg", unidadU: "mg",
    opciones: [
      { clave: "corr", hallazgo: "M6", etiqueta: "Densidad del aire con las condiciones corregidas" },
      { clave: "avg", hallazgo: "M7", etiqueta: "Corrección por empuje con la densidad del aire promedio" },
    ],
    calcular: calcularITM01,
    resumen: (r, d) => ({
      puntos: [{ nominal: d.nomT * 1000, error: r.dev, uc: r.uc, U: r.U, Ucert: r.asig, conforme: r.ok }],
      uMax: r.U, uCert: r.asig, conforme: r.ok,
    }),
  },
  ITP02: {
    it: "ITP02", magnitud: "presion", nombre: "Manómetro vs manómetro patrón", unidad: "bar", unidadU: "bar",
    opciones: [
      { clave: "der", hallazgo: "P2", etiqueta: "Sumar la deriva del patrón" },
      { clave: "dh", hallazgo: "P3", etiqueta: "Aplicar el divisor √3 a la diferencia de altura" },
    ],
    calcular: calcularITP02, resumen: porFilas({ nominal: "C", error: "D", uc: "K", U: "L", Ucert: "Uc" }),
  },
  ITP01: {
    it: "ITP01", magnitud: "presion", nombre: "Manómetros con balanza de pesos muertos", unidad: "MPa", unidadU: "MPa",
    opciones: [{ clave: "altBal", hallazgo: "P10", etiqueta: "Incertidumbre de altura de 1 mm del balance" }],
    calcular: calcularITP01, resumen: porFilas({ error: "D", uc: "Gc", U: "Hc", Ucert: "Uc" }),
  },
  ITL01: {
    it: "ITL01", magnitud: "longitud", nombre: "Pie de metro", unidad: "mm", unidadU: "mm",
    opciones: [{ clave: "fixT", hallazgo: "L1", etiqueta: "Convertir a número las temperaturas escritas como texto" }],
    calcular: calcularITL01, resumen: porFilas({ error: "E", uc: "I", U: "J", Ucert: "Uc" }),
  },
  ITL02: {
    it: "ITL02", magnitud: "longitud", nombre: "Micrómetro de exteriores", unidad: "mm", unidadU: "mm",
    opciones: [{ clave: "der", hallazgo: "L8", etiqueta: "Sumar la deriva del patrón" }],
    calcular: calcularITL02, resumen: porFilas({ error: "I", uc: "K", U: "L", Ucert: "Uc" }),
  },
  ITL06: {
    it: "ITL06", magnitud: "longitud", nombre: "Regla graduada", unidad: "mm", unidadU: "mm",
    opciones: [{ clave: "fixHR", hallazgo: "T1", etiqueta: "Restar la corrección del termohigrómetro" }],
    calcular: calcularITL06, resumen: porFilas({ error: "I", uc: "K", U: "L", Ucert: null }, { uCert: (r) => r.K64 }),
  },
  ITL07: {
    it: "ITL07", magnitud: "longitud", nombre: "Flexómetro (cinta métrica)", unidad: "mm", unidadU: "mm",
    opciones: [
      { clave: "sqrt", hallazgo: "L17", etiqueta: "Sumar los empalmes de 3 m en cuadratura (√k)" },
      { clave: "full", hallazgo: "L18", etiqueta: "Incluir alineación y deriva en cada punto" },
    ],
    calcular: calcularITL07, resumen: porFilas({ error: "G", uc: "I", U: "J", Ucert: "Ucert" }),
  },
  ITV02: {
    it: "ITV02", magnitud: "volumen", nombre: "Material volumétrico (graduado y aforado)", unidad: "mL", unidadU: "mL",
    opciones: [
      { clave: "fixBal", hallazgo: "V5", etiqueta: "Corrección de la balanza en todos los puntos" },
      { clave: "fixEv", hallazgo: "V8", etiqueta: "Evaporación con signo correcto y solo filas con datos" },
      { clave: "dRho", hallazgo: "V2", etiqueta: "Propagar dρ/dt del agua al presupuesto" },
    ],
    calcular: calcularITV02, resumen: porFilas({ error: "J", uc: "L", U: "M", Ucert: "Ucert" }),
  },
  ITT01: {
    it: "ITT01", magnitud: "temperatura", nombre: "Termómetros por comparación", unidad: "°C", unidadU: "°C",
    opciones: [{ clave: "fixAmb", hallazgo: "T1", etiqueta: "Restar el error del termohigrómetro" }],
    calcular: calcularITT01, resumen: porFilas({ error: "I", uc: "M", U: "N", Ucert: "Ucert" }),
  },
  ITT02: {
    it: "ITT02", magnitud: "temperatura", nombre: "Medios isotermos (baños)", unidad: "°C", unidadU: "°C",
    opciones: [{ clave: "corr", hallazgo: "T5a", etiqueta: "Gradiente y estabilidad con lecturas corregidas" }],
    calcular: calcularITT02, resumen: porFilas({ error: "D", uc: "L", U: "M", Ucert: null }, { uCert: (r) => maxOf(r.rows.map((x: any) => x.M)) }),
  },
  ITF01: {
    it: "ITF01", magnitud: "fuerza", nombre: "Máquinas de ensayos con transductor", unidad: "kgf", unidadU: "%",
    opciones: [
      { clave: "derSet", hallazgo: "F1", etiqueta: "Usar la deriva de la curva usada en cada punto" },
      { clave: "absF0", hallazgo: "F3", etiqueta: "Error de cero en valor absoluto" },
      { clave: "fixCls", hallazgo: "F4", etiqueta: "Clase 4 como número" },
    ],
    calcular: calcularITF01,
    resumen: porFilas({ error: "L", uc: "Lc", U: "P", Ucert: "P" }, { conforme: (row) => row.cls !== "N/C" }),
  },
  ITF03: {
    it: "ITF03", magnitud: "fuerza", nombre: "Dinamómetros con pesos muertos", unidad: "kg", unidadU: "%",
    opciones: [
      { clave: "realMass", hallazgo: "F9", etiqueta: "Usar la masa real de las pesas" },
      { clave: "absF", hallazgo: "F8", etiqueta: "Control de fuerza aplicada en valor absoluto" },
      { clave: "units", hallazgo: "F10", etiqueta: "Dividir por la fuerza en N" },
    ],
    calcular: calcularITF03,
    resumen: porFilas({ error: "L", uc: "P", U: "Q", Ucert: "Q" }, { conforme: (row) => row.cls !== "N/C" }),
  },
  ITPT01: {
    it: "ITPT01", magnitud: "par", nombre: "Llaves de torque (ISO 6789)", unidad: "lbf·ft", unidadU: "%",
    opciones: [{ clave: "derSet", hallazgo: "PT3", etiqueta: "Usar la deriva del transductor usado" }],
    calcular: calcularITPT01, resumen: porFilas({ error: "I", uc: "M", U: "N", Ucert: "N" }, { conforme: (row) => row.ok }),
  },
};

const sci = (x: number) => x.toExponential(12).replace(".", ",");

/** Motor del Laboratorio Nacional de Fuerza (ISO 376), validado contra la planilla LCPNF-010.26. */
export const MOTOR_LNF: Motor = {
  it: "LCPNF-IT01", magnitud: "fuerza", nombre: "Instrumentos de medida de fuerza (ISO 376)", unidad: "kN", unidadU: "%",
  opciones: [
    { clave: "k2", hallazgo: "G3", etiqueta: "Usar k = 2, como declara el texto del certificado" },
    { clave: "creep", hallazgo: "G4", etiqueta: "Fluencia estimada sin el /100 adicional" },
    { clave: "umin", hallazgo: "G6", etiqueta: "U mínima por clase leída de la fila correcta" },
  ],
  calcular: calcularLNF,
  resumen: (r) => {
    const puntos: PuntoResumen[] = r.rows.map((x: any) => ({
      nominal: x.F, error: x.fc, uc: x.uc, U: x.U, Ucert: x.U, conforme: null, clase: x.etiqueta,
    }));
    const c = r.coef;
    return {
      puntos, uMax: Math.max(...puntos.map((p) => p.U)), uCert: Math.max(...puntos.map((p) => p.U)), conforme: null,
      extra: [
        { etiqueta: "Clase desde el primer punto", valor: r.clase },
        { etiqueta: "S = a·F + b·F² + c·F³", valor: `a = ${sci(c.S3[0])} · b = ${sci(c.S3[1])} · c = ${sci(c.S3[2])}` },
        { etiqueta: "F = t·S + u·S² + v·S³", valor: `t = ${sci(c.F3[0])} · u = ${sci(c.F3[1])} · v = ${sci(c.F3[2])}` },
        { etiqueta: "Error de cero f₀ máx.", valor: `${r.f0max.toFixed(6).replace(".", ",")} %` },
        { etiqueta: "Temperatura", valor: r.tMed == null ? "—" : `${String(r.tMed).replace(".", ",")} ± ${String(r.tRan).replace(".", ",")} °C · ${r.tEstado}` },
        { etiqueta: "Factor de cobertura", valor: String(r.k).replace(".", ",") },
      ],
    };
  },
};

/** Formulario estándar por puntos (eléctrica, tiempo y reserva para cualquier magnitud sin motor propio). */
export const MOTOR_PUNTOS: Motor = {
  it: "PUNTOS", magnitud: "general", nombre: "Calibración por puntos (formulario estándar)", unidad: "", unidadU: "",
  opciones: [], validado: false,
  calcular: calcularPuntos,
  resumen: (r) => {
    const puntos: PuntoResumen[] = r.rows.map((x: any) => ({
      nominal: x.nom, error: x.err, uc: x.uc, U: x.U, Ucert: x.U, conforme: x.conforme, unidad: x.unidad,
    }));
    const conf = puntos.map((p) => p.conforme).filter((c): c is boolean => c !== null);
    return {
      puntos, uMax: Math.max(...puntos.map((p) => p.U)), uCert: null, conforme: conf.length ? conf.every(Boolean) : null,
      extra: [
        { etiqueta: "Series por punto", valor: String(r.n) },
        { etiqueta: "Regla de decisión", valor: r.regla === "simple" ? "|ē| ≤ EMP" : "|ē| + U ≤ EMP" },
        ...FORMULA_PUNTOS.map((f, i) => ({ etiqueta: i === 0 ? "Fórmula" : "", valor: f })),
      ],
    };
  },
};

/** Todos los motores: los 14 del LMT validados por Excel + LNF + formulario por puntos. */
export const REGISTRO_MOTORES: Record<string, Motor> = { ...MOTORES, [MOTOR_LNF.it]: MOTOR_LNF, [MOTOR_PUNTOS.it]: MOTOR_PUNTOS };

/** Procesos sin planilla del IDIC que se calculan con el formulario estándar por puntos. */
export const PROCESOS_POR_PUNTOS = ["ITME01", "ITE03", "PTS01"];

/** Motor asociado a un código de proceso (ITV02a/g/c comparten ITV02). */
export function motorDeProceso(codigo: string): Motor | undefined {
  if (PROCESOS_POR_PUNTOS.includes(codigo)) return MOTOR_PUNTOS;
  return REGISTRO_MOTORES[codigo] ?? REGISTRO_MOTORES[codigo.replace(/[a-z]$/, "")];
}

/** Calcula con el motor y devuelve el detalle (como el Excel) y el resumen normalizado. */
export function calcularConMotor(it: string, datos: Datos, opciones: Opciones = {}) {
  const m = motorDeProceso(it);
  if (!m) throw new Error(`No hay motor validado para ${it}`);
  const resultado = m.calcular(datos, opciones);
  return { motor: m.it, resultado, resumen: m.resumen(resultado, datos) };
}
