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
import { calcularITM03 } from "./masa-nn";
import { calcularITV05 } from "./micropipeta";
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
/**
 * Corrección propuesta a la planilla. `decision` recoge la respuesta del LMT del
 * 15-10-2026 (Respuesta Laboratorio.xlsx): «aplicar» = el laboratorio la pidió y
 * va activada por defecto en las calibraciones nuevas; «rechazada» = el
 * laboratorio mantiene su criterio y no se puede activar; «pendiente» = sin
 * respuesta clara, desactivada y a elección del metrólogo.
 */
export interface OpcionMotor {
  clave: string; hallazgo: string; etiqueta: string;
  decision?: "aplicar" | "rechazada" | "pendiente";
  /** Respuesta textual del laboratorio (o motivo de la decisión). */
  respuesta?: string;
}
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
  extra?: { uCert?: (r: any) => number | null; conforme?: (row: any) => boolean | null; clase?: (row: any) => string | undefined },
) {
  return (r: any): ResumenMotor => {
    const puntos: PuntoResumen[] = r.rows.map((row: any) => ({
      nominal: row[cols.nominal ?? "nom"],
      error: cols.error ? row[cols.error] : null,
      uc: cols.uc ? row[cols.uc] : null,
      U: row[cols.U],
      Ucert: cols.Ucert ? row[cols.Ucert] : null,
      conforme: extra?.conforme ? extra.conforme(row) : null,
      ...(extra?.clase ? { clase: extra.clase(row) } : {}),
    }));
    const uCert = extra?.uCert ? extra.uCert(r) : cols.Ucert ? maxOf(puntos.map((p) => p.Ucert as number)) : null;
    const conf = puntos.map((p) => p.conforme).filter((c): c is boolean => c !== null);
    return { puntos, uMax: maxOf(puntos.map((p) => p.U)), uCert, conforme: conf.length ? conf.every(Boolean) : null };
  };
}

export const MOTORES: Record<string, Motor> = {
  ITM02: {
    it: "ITM02", magnitud: "masa", nombre: "Instrumentos de pesar (balanzas)", unidad: "g", unidadU: "g",
    opciones: [{ clave: "fix", hallazgo: "M1", etiqueta: "Usar la deriva propia de la masa de 50 g", decision: "aplicar", respuesta: "«Corregir»" }],
    calcular: calcularITM02, resumen: porFilas({ error: "E", uc: "M", U: "O", Ucert: "Uc" }),
  },
  ITM01: {
    it: "ITM01", magnitud: "masa", nombre: "Masas patrón por comparación", unidad: "mg", unidadU: "mg",
    opciones: [
      { clave: "corr", hallazgo: "M6", etiqueta: "Densidad del aire con las condiciones corregidas", decision: "aplicar", respuesta: "«Sí, se debe usar la condición corregida por los certificados del termohigrómetro y barómetro»" },
      { clave: "avg", hallazgo: "M7", etiqueta: "Corrección por empuje con la densidad del aire promedio", decision: "aplicar", respuesta: "«Confirmado»" },
    ],
    calcular: calcularITM01,
    resumen: (r, d) => ({
      // C1: el LMT no evalúa conformidad; la verificación de clase (r.ok) queda solo en el detalle.
      puntos: [{ nominal: d.nomT * 1000, error: r.dev, uc: r.uc, U: r.U, Ucert: r.asig, conforme: null }],
      uMax: r.U, uCert: r.asig, conforme: null,
    }),
  },
  ITP02: {
    it: "ITP02", magnitud: "presion", nombre: "Manómetro vs manómetro patrón", unidad: "bar", unidadU: "bar",
    opciones: [
      { clave: "der", hallazgo: "P2", etiqueta: "Sumar la deriva del patrón", decision: "aplicar", respuesta: "«Corregir»" },
      { clave: "dh", hallazgo: "P3", etiqueta: "Aplicar el divisor √3 a la diferencia de altura", decision: "aplicar", respuesta: "«Rectangular, raíz de 3»" },
    ],
    calcular: calcularITP02, resumen: porFilas({ nominal: "C", error: "D", uc: "K", U: "L", Ucert: "Uc" }),
  },
  ITP01: {
    it: "ITP01", magnitud: "presion", nombre: "Manómetros con balanza de pesos muertos", unidad: "MPa", unidadU: "MPa",
    opciones: [{ clave: "altBal", hallazgo: "P10", etiqueta: "Incertidumbre de altura de 1 mm del balance", decision: "rechazada", respuesta: "«5 mm» (se mantiene la incertidumbre de altura de la tabla)" }],
    calcular: calcularITP01, resumen: porFilas({ error: "D", uc: "Gc", U: "Hc", Ucert: "Uc" }),
  },
  ITL01: {
    it: "ITL01", magnitud: "longitud", nombre: "Pie de metro", unidad: "mm", unidadU: "mm",
    opciones: [{ clave: "fixT", hallazgo: "L1", etiqueta: "Convertir a número las temperaturas escritas como texto", decision: "aplicar", respuesta: "«Es el promedio de los 6 valores, con un decimal»" }],
    calcular: calcularITL01, resumen: porFilas({ error: "E", uc: "I", U: "J", Ucert: "Uc" }),
  },
  ITL02: {
    it: "ITL02", magnitud: "longitud", nombre: "Micrómetro de exteriores", unidad: "mm", unidadU: "mm",
    opciones: [{ clave: "der", hallazgo: "L8", etiqueta: "Sumar la deriva del patrón", decision: "rechazada", respuesta: "«No se confirma. El laboratorio no utiliza como fuente de incertidumbre la deriva de los bloques patrones»" }],
    calcular: calcularITL02, resumen: porFilas({ error: "I", uc: "K", U: "L", Ucert: "Uc" }),
  },
  ITL06: {
    it: "ITL06", magnitud: "longitud", nombre: "Regla graduada", unidad: "mm", unidadU: "mm",
    opciones: [{ clave: "fixHR", hallazgo: "T1", etiqueta: "Restar la corrección del termohigrómetro", decision: "aplicar", respuesta: "T1: «Sí (definición de acuerdo al VIM)»: la corrección siempre se resta" }],
    calcular: calcularITL06, resumen: porFilas({ error: "I", uc: "K", U: "L", Ucert: null }, { uCert: (r) => r.K64 }),
  },
  ITL07: {
    it: "ITL07", magnitud: "longitud", nombre: "Flexómetro (cinta métrica)", unidad: "mm", unidadU: "mm",
    opciones: [
      { clave: "sqrt", hallazgo: "L17", etiqueta: "Sumar los empalmes de 3 m en cuadratura (√k)", decision: "rechazada", respuesta: "«Criterio del laboratorio»" },
      { clave: "full", hallazgo: "L18", etiqueta: "Incluir alineación y deriva en cada punto", decision: "aplicar", respuesta: "«Se confirma»" },
    ],
    calcular: calcularITL07, resumen: porFilas({ error: "G", uc: "I", U: "J", Ucert: "Ucert" }),
  },
  ITV02: {
    it: "ITV02", magnitud: "volumen", nombre: "Material volumétrico (graduado y aforado)", unidad: "mL", unidadU: "mL",
    opciones: [
      { clave: "fixBal", hallazgo: "V5", etiqueta: "Corrección de la balanza en todos los puntos", decision: "aplicar", respuesta: "«La corrección se aplica a todos los puntos»" },
      { clave: "fixEv", hallazgo: "V8", etiqueta: "Evaporación con signo correcto y solo filas con datos", decision: "rechazada", respuesta: "«Confirmada. Fórmula de acuerdo a ISO 8655-6:2022»" },
      { clave: "dRho", hallazgo: "V2", etiqueta: "Propagar dρ/dt del agua al presupuesto", decision: "pendiente", respuesta: "«Modelo de incertidumbre de acuerdo a Euramet cg14 2025» (no dice si se propaga dρ/dt)" },
    ],
    calcular: calcularITV02, resumen: porFilas({ error: "J", uc: "L", U: "M", Ucert: "Ucert" }),
  },
  ITT01: {
    it: "ITT01", magnitud: "temperatura", nombre: "Termómetros por comparación", unidad: "°C", unidadU: "°C",
    opciones: [{ clave: "fixAmb", hallazgo: "T1", etiqueta: "Restar el error del termohigrómetro", decision: "aplicar", respuesta: "T1: «Sí (definición de acuerdo al VIM)»: la corrección siempre se resta" }],
    calcular: calcularITT01, resumen: porFilas({ error: "I", uc: "M", U: "N", Ucert: "Ucert" }),
  },
  ITT02: {
    it: "ITT02", magnitud: "temperatura", nombre: "Medios isotermos (baños)", unidad: "°C", unidadU: "°C",
    opciones: [{ clave: "corr", hallazgo: "T5a", etiqueta: "Gradiente y estabilidad con lecturas corregidas", decision: "rechazada", respuesta: "«NO»" }],
    calcular: calcularITT02, resumen: porFilas({ error: "D", uc: "L", U: "M", Ucert: null }, { uCert: (r) => maxOf(r.rows.map((x: any) => x.M)) }),
  },
  ITF01: {
    it: "ITF01", magnitud: "fuerza", nombre: "Máquinas de ensayos con transductor", unidad: "kgf", unidadU: "%",
    opciones: [
      { clave: "derSet", hallazgo: "F1", etiqueta: "Usar la deriva de la curva usada en cada punto", decision: "pendiente", respuesta: "«La deriva debe ser la del patrón; si se usa más de un patrón, la máxima» (F-1556 usa un solo transductor con dos curvas)" },
      { clave: "absF0", hallazgo: "F3", etiqueta: "Error de cero en valor absoluto", decision: "aplicar", respuesta: "«Corregir»" },
      { clave: "fixCls", hallazgo: "F4", etiqueta: "Clase 4 como número", decision: "aplicar", respuesta: "«Corregir»" },
    ],
    calcular: calcularITF01,
    // C1: sin «cumple / no cumple»; se informa la clase ISO 7500-1 (NCh2598/1) de cada punto.
    resumen: porFilas({ error: "L", uc: "Lc", U: "P", Ucert: "P" }, { clase: (row) => String(row.cls) }),
  },
  ITF03: {
    it: "ITF03", magnitud: "fuerza", nombre: "Dinamómetros con pesos muertos", unidad: "kg", unidadU: "%",
    opciones: [
      { clave: "realMass", hallazgo: "F9", etiqueta: "Usar la masa real de las pesas", decision: "aplicar", respuesta: "«Confirmado. Se utiliza la masa real»" },
      { clave: "absF", hallazgo: "F8", etiqueta: "Control de fuerza aplicada en valor absoluto", decision: "pendiente", respuesta: "«La IT no lo establece. Esta condición está considerada en la norma de referencia NCh-ISO 2598-1»" },
      { clave: "units", hallazgo: "F10", etiqueta: "Dividir por la fuerza en N", decision: "aplicar", respuesta: "«Corregir planilla»" },
    ],
    calcular: calcularITF03,
    resumen: porFilas({ error: "L", uc: "P", U: "Q", Ucert: "Q" }, { clase: (row) => String(row.cls) }),
  },
  ITPT01: {
    it: "ITPT01", magnitud: "par", nombre: "Llaves de torque (ISO 6789)", unidad: "lbf·ft", unidadU: "%",
    opciones: [{ clave: "derSet", hallazgo: "PT3", etiqueta: "Usar la deriva del transductor usado", decision: "rechazada", respuesta: "«Sí, se utiliza la mayor»" }],
    // C1: el LMT no evalúa la conformidad ISO 6789-1 (la tolerancia queda en el detalle, sin veredicto).
    calcular: calcularITPT01, resumen: porFilas({ error: "I", uc: "M", U: "N", Ucert: "N" }),
  },
};

const sci = (x: number) => x.toExponential(12).replace(".", ",");

/** Motor del Laboratorio Nacional de Fuerza (ISO 376), validado contra la planilla LCPNF-010.26. */
export const MOTOR_LNF: Motor = {
  it: "LCPNF-IT01", magnitud: "fuerza", nombre: "Instrumentos de medida de fuerza (ISO 376)", unidad: "kN", unidadU: "%",
  opciones: [
    { clave: "k2", hallazgo: "G3", etiqueta: "Usar k = 2, como declara el texto del certificado", decision: "pendiente", respuesta: "Sin respuesta del LNF" },
    { clave: "creep", hallazgo: "G4", etiqueta: "Fluencia estimada sin el /100 adicional", decision: "pendiente", respuesta: "Sin respuesta del LNF" },
    { clave: "umin", hallazgo: "G6", etiqueta: "U mínima por clase leída de la fila correcta", decision: "pendiente", respuesta: "Sin respuesta del LNF" },
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
        { etiqueta: "Comparación con la tolerancia (informativa)", valor: r.regla === "simple" ? "|ē| ≤ tolerancia" : "|ē| + U ≤ tolerancia" },
        ...FORMULA_PUNTOS.map((f, i) => ({ etiqueta: i === 0 ? "Fórmula" : "", valor: f })),
      ],
    };
  },
};

/**
 * Motores de las planillas entregadas por el LMT el 15-10-2026 (casos reales
 * M-3947 e V-5920). Se validan aparte (paridad-1510.ts) para no alterar el
 * recuento de las 14 instrucciones originales (1531/1531).
 */
export const MOTORES_1510: Record<string, Motor> = {
  ITM03: {
    it: "ITM03", magnitud: "masa", nombre: "Masas no normalizadas por comparación", unidad: "mg", unidadU: "mg",
    opciones: [
      { clave: "corr", hallazgo: "M6", etiqueta: "Densidad del aire con las condiciones corregidas", decision: "aplicar",
        respuesta: "M6 (ITM01): «Sí, se debe usar la condición corregida»; la planilla ITM03 usa las lecturas sin corregir" },
      { clave: "avgRho", hallazgo: "M7", etiqueta: "Corrección por empuje con la densidad del aire promedio", decision: "aplicar", respuesta: "M7 (ITM01): «Confirmado»" },
      { clave: "ucMg", hallazgo: "M10", etiqueta: "Incertidumbre por empuje en mg también en el primer ítem", decision: "pendiente",
        respuesta: "Hallazgo nuevo en M-3947: la primera tabla usa F97·L79 y las demás F97·F98 (efecto < 0,02 mg)" },
      { clave: "uRegla", hallazgo: "C5", etiqueta: "Nominal no normalizado: U asignada con el nominal OIML inmediatamente superior", decision: "pendiente",
        respuesta: "En M-3947 la U de 300 g y 475 g se escribió a mano (25 mg); falta confirmar la regla" },
    ],
    calcular: calcularITM03,
    resumen: (r) => {
      const puntos: PuntoResumen[] = r.rows.map((x: any) => ({
        nominal: x.nom * (x.unidad === "kg" ? 1e6 : x.unidad === "mg" ? 1 : 1000), error: x.J58, uc: x.K93, U: x.K94, Ucert: x.uAsig, conforme: null,
      }));
      return {
        puntos, uMax: Math.max(...puntos.map((p) => p.U)), uCert: Math.max(...puntos.map((p) => p.Ucert as number)), conforme: null,
        extra: [
          ...r.rows.map((x: any) => ({ etiqueta: `Ítem ${x.id ?? x.nominal}`, valor: `${String(x.L77).replace(".", ",")} ${x.unidad} · U asignada ${x.certU} (${x.origenU}) · U calculada ${x.K94.toFixed(3).replace(".", ",")} mg` })),
          { etiqueta: "Condiciones (corregidas)", valor: `${r.Y5.toFixed(1).replace(".", ",")} °C · ${r.Y6.toFixed(1).replace(".", ",")} % · ${String(r.Y7).replace(".", ",")} hPa` },
        ],
      };
    },
  },
  ITV05: {
    it: "ITV05", magnitud: "volumen", nombre: "Instrumentos por pistón (micropipetas)", unidad: "mL", unidadU: "mL",
    opciones: [
      { clave: "evap", hallazgo: "V8", etiqueta: "Evaporación sumada a la masa medida (la planilla la resta)", decision: "pendiente",
        respuesta: "V8 (ITV02): «Confirmada. Fórmula de acuerdo a ISO 8655-6:2022»; falta confirmar el signo en ITV05" },
      { clave: "kBal", hallazgo: "V1", etiqueta: "k = 2 también en el balance del primer punto (la planilla usa 2,15)", decision: "pendiente",
        respuesta: "V1: «k = 2,15 está conforme a la Euramet cg14»; el certificado declara k = 2" },
    ],
    calcular: calcularITV05,
    resumen: (r) => {
      const puntos: PuntoResumen[] = r.rows.map((x: any) => ({ nominal: x.nom, error: x.J, uc: x.L, U: 2 * x.L, Ucert: x.M, conforme: null }));
      return {
        puntos, uMax: Math.max(...puntos.map((p) => p.U)), uCert: Math.max(...puntos.map((p) => p.Ucert as number)), conforme: null,
        extra: [
          ...r.rows.map((x: any) => ({ etiqueta: `${String(x.cD).replace(".", ",")} µL`, valor: `V = ${String(x.cC).replace(".", ",")} µL · E = ${x.cE.toFixed(2).replace(".", ",")} µL · U = ${String(x.cF).replace(".", ",")} µL · CV ${String(x.cH).replace(".", ",")} %` })),
          { etiqueta: "Factor Z", valor: r.Z.toFixed(7).replace(".", ",") },
        ],
      };
    },
  },
};

/** Todos los motores: los 14 del LMT validados por Excel + ITM03/ITV05 + LNF + formulario por puntos. */
export const REGISTRO_MOTORES: Record<string, Motor> = { ...MOTORES, ...MOTORES_1510, [MOTOR_LNF.it]: MOTOR_LNF, [MOTOR_PUNTOS.it]: MOTOR_PUNTOS };

/** Procesos sin planilla del IDIC que se calculan con el formulario estándar por puntos (ITL05 e ITL10: LC 004, sin planilla). */
export const PROCESOS_POR_PUNTOS = ["ITME01", "ITE03", "PTS01", "ITL05", "ITL10"];

/** Correcciones activadas por defecto en una calibración nueva: las que el laboratorio pidió aplicar. */
export function opcionesPorDefecto(m: Motor): Record<string, boolean> {
  return Object.fromEntries(m.opciones.filter((o) => o.decision === "aplicar").map((o) => [o.clave, true]));
}

/** Motivo por el que no se aceptan las opciones (corrección rechazada por el laboratorio o desconocida), o null. */
export function motivoOpciones(m: Motor, opciones: Record<string, boolean>): string | null {
  for (const [k, v] of Object.entries(opciones ?? {})) {
    if (!v) continue;
    const o = m.opciones.find((x) => x.clave === k);
    if (!o) return `Corrección desconocida para ${m.it}: ${k}`;
    if (o.decision === "rechazada") return `La corrección ${o.hallazgo} («${o.etiqueta}») fue rechazada por el laboratorio: ${o.respuesta ?? ""}`.trim();
  }
  return null;
}

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
