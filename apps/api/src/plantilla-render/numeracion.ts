/**
 * Numeración oficial de documentos · reglas PURAS (sin BD), probadas en
 * numeracion.spec.ts. Contrato: docs/FLUJO_NUMERACION_DOCUMENTOS.md.
 *
 * Una regla (`numeracion_documento`) dice, para una unidad (laboratorio) y un
 * tipo de documento, el FORMATO del número. Tokens:
 *
 *   {AAAA} año de emisión · {AA} año con dos cifras
 *   {N} correlativo de la regla (atómico) · {N:3} con ceros a la izquierda
 *   {OT} código de la OT · {OT_N} su parte numérica (OT-2026-0012 → 12) · {OT_N:5}
 *   {LAB} código de la unidad del documento · {CODSUCDEL} su código StarLIMS
 *   {MUESTRA} código de la primera muestra del documento · {MUESTRA_N} su parte numérica
 *   {NI} número de la orden interna · {NI_N} su parte numérica (respuesta a una orden interna)
 *   {NUM_INFORME} número del Informe de Inspección de la OT (certificado e incumplimiento BPCH)
 *
 * Una unidad usa la regla más específica: la suya o la del ancestro más
 * cercano (por tipo de documento antes que «todos los tipos»), y si no hay,
 * la regla general (sin unidad). Sin regla aplicable: CERT-AAAA-NNNN de siempre.
 */

import { anioChile } from "../common/fecha-chile";

/** Tipos de documento que se numeran: los de la matriz de firmas y la respuesta a una orden interna. */
export const TIPOS_NUMERABLES = [
  "INFORME_ENSAYO",
  "IVC",
  "INFORME_TECNICO",
  "CERTIFICADO_CALIBRACION",
  "INFORME_INSPECCION",
  "CERTIFICADO_CONFORMIDAD",
  "INFORME_INCUMPLIMIENTO",
  "RESPUESTA_OI",
] as const;

export const NOMBRE_TIPO_NUMERABLE: Record<string, string> = {
  INFORME_ENSAYO: "Informe de ensayo",
  IVC: "Informe de verificación de calidad (IVC)",
  INFORME_TECNICO: "Informe técnico",
  CERTIFICADO_CALIBRACION: "Certificado de calibración",
  INFORME_INSPECCION: "Informe de inspección",
  CERTIFICADO_CONFORMIDAD: "Certificado de conformidad",
  INFORME_INCUMPLIMIENTO: "Informe de incumplimiento",
  RESPUESTA_OI: "Respuesta a una orden interna",
};

/** Tokens admitidos (nombre → descripción), para validar y para la ayuda de la pantalla. */
export const TOKENS: Record<string, string> = {
  AAAA: "Año de emisión (2026)",
  AA: "Año con dos cifras (26)",
  N: "Correlativo de la regla; {N:3} rellena con ceros (001)",
  OT: "Código de la OT",
  OT_N: "Número de la OT sin prefijo (OT-2026-0012 → 12); {OT_N:5} rellena con ceros",
  LAB: "Código de la unidad que emite (LPN, SSTGO…)",
  CODSUCDEL: "Código StarLIMS de la unidad (7004, 3000…)",
  MUESTRA: "Código de la primera muestra del documento",
  MUESTRA_N: "Número de esa muestra sin prefijo; {MUESTRA_N:6} rellena con ceros",
  NI: "Número de la orden interna (solo respuesta a una orden interna)",
  NI_N: "Número de la orden interna sin prefijo (OI-2026-0003 → 3)",
  NUM_INFORME: "Número del Informe de Inspección de la OT (certificado e incumplimiento BPCH)",
};

/** Tokens que cambian de un documento a otro (sin ninguno, todos los números serían iguales). */
const TOKENS_VARIABLES = new Set(["N", "OT", "OT_N", "MUESTRA", "MUESTRA_N", "NI", "NI_N", "NUM_INFORME"]);

const RE_TOKEN = /\{([A-Z_]+)(?::(\d{1,2}))?\}/g;
export const LARGO_MAX_NUMERO = 70; // deja sitio al sufijo de versión (-V2) en certificado.numero (80)

export interface Regla {
  id: string;
  unidadId: string | null;
  tipoDocumento: string | null;
  formato: string;
  reinicio: "anual" | "continuo";
  correlativoPorUnidad: boolean;
  activo?: boolean;
}

export interface VariablesNumero {
  fecha: Date;
  n?: number | null;
  ot?: string | null;
  lab?: string | null;
  codsucdel?: string | null;
  muestra?: string | null;
  ni?: string | null;
  numInforme?: string | null;
}

/** Tokens que usa un formato (sin repetir). */
export function tokensDe(formato: string): string[] {
  return [...new Set([...String(formato ?? "").matchAll(RE_TOKEN)].map((m) => m[1]))];
}

/** ¿El formato pide el correlativo {N}? */
export const usaCorrelativo = (formato: string) => tokensDe(formato).includes("N");

/** Errores de un formato (lista vacía = válido). */
export function erroresFormato(formato: string | null | undefined): string[] {
  const f = String(formato ?? "").trim();
  const e: string[] = [];
  if (!f) return ["Indique el formato del número."];
  if (f.length > 120) e.push("El formato admite como máximo 120 caracteres.");
  const desconocidos = tokensDe(f).filter((t) => !(t in TOKENS));
  if (desconocidos.length) e.push(`Tokens desconocidos: ${desconocidos.map((t) => `{${t}}`).join(", ")}.`);
  const sueltas = f.replace(RE_TOKEN, "").match(/[{}]/g);
  if (sueltas) e.push("Hay una llave «{» o «}» sin cerrar o un token mal escrito.");
  if (!tokensDe(f).some((t) => TOKENS_VARIABLES.has(t)))
    e.push("El formato debe llevar al menos un dato que cambie por documento: {N}, {OT}, {OT_N}, {MUESTRA_N}, {NI_N} o {NUM_INFORME}.");
  if (/[\r\n\t]/.test(f)) e.push("El formato no puede tener saltos de línea ni tabulaciones.");
  return e;
}

/** Parte numérica final de un código (OT-2026-0012 → 12; M-2026-0003 → 3; 80339 → 80339). Sin dígitos, null. */
export function parteNumerica(codigo: string | null | undefined): number | null {
  const m = String(codigo ?? "").match(/(\d+)\D*$/);
  return m ? Number(m[1]) : null;
}

/** Primer código CODSUCDEL de la unidad («3009/3008» → 3009). */
export function primerCodsucdel(codsucdel: string | null | undefined): string | null {
  const p = String(codsucdel ?? "").split(/[\s,;/]+/).map((x) => x.trim()).filter(Boolean);
  return p[0] ?? null;
}

const relleno = (n: number, ancho?: string) => (ancho ? String(n).padStart(Number(ancho), "0") : String(n));

/**
 * Aplica el formato. Devuelve el número o, si falta un dato que el formato
 * pide (p. ej. {NUM_INFORME} sin Informe de Inspección), la lista de faltantes.
 */
export function formatearNumero(formato: string, v: VariablesNumero): { numero: string | null; faltan: string[] } {
  const faltan: string[] = [];
  const anio = anioChile(v.fecha);
  const numero = String(formato).replace(RE_TOKEN, (_m, token: string, ancho?: string) => {
    const texto = (x: string | null | undefined, nombre: string) => {
      if (x === null || x === undefined || String(x).trim() === "") {
        faltan.push(nombre);
        return "";
      }
      return String(x).trim();
    };
    const numerico = (x: number | null | undefined, nombre: string) => {
      if (x === null || x === undefined || !Number.isFinite(x)) {
        faltan.push(nombre);
        return "";
      }
      return relleno(x, ancho);
    };
    switch (token) {
      case "AAAA": return String(anio);
      case "AA": return String(anio).slice(-2);
      case "N": return numerico(v.n ?? null, "{N}");
      case "OT": return texto(v.ot, "{OT}");
      case "OT_N": return numerico(parteNumerica(v.ot), "{OT_N}");
      case "LAB": return texto(v.lab, "{LAB}");
      case "CODSUCDEL": return texto(primerCodsucdel(v.codsucdel), "{CODSUCDEL}");
      case "MUESTRA": return texto(v.muestra, "{MUESTRA}");
      case "MUESTRA_N": return numerico(parteNumerica(v.muestra), "{MUESTRA_N}");
      case "NI": return texto(v.ni, "{NI}");
      case "NI_N": return numerico(parteNumerica(v.ni), "{NI_N}");
      case "NUM_INFORME": return texto(v.numInforme, "{NUM_INFORME}");
      default:
        faltan.push(`{${token}}`);
        return "";
    }
  });
  if (faltan.length) return { numero: null, faltan: [...new Set(faltan)] };
  return { numero: numero.trim(), faltan: [] };
}

/**
 * Regla que se aplica a un documento de `tipo` emitido por la unidad cuyo
 * linaje es `cadena` (la propia unidad primero, luego sus ancestros).
 * Orden: unidad más cercana con ese tipo › unidad más cercana con «todos los
 * tipos» › general con ese tipo › general con «todos los tipos».
 */
export function elegirRegla<R extends Regla>(reglas: R[], cadena: string[], tipo: string): R | null {
  const activas = reglas.filter((r) => r.activo !== false);
  for (const unidad of cadena) {
    const deUnidad = activas.filter((r) => r.unidadId === unidad);
    const exacta = deUnidad.find((r) => r.tipoDocumento === tipo);
    if (exacta) return exacta;
    const todos = deUnidad.find((r) => r.tipoDocumento === null);
    if (todos) return todos;
  }
  const generales = activas.filter((r) => r.unidadId === null);
  return generales.find((r) => r.tipoDocumento === tipo) ?? generales.find((r) => r.tipoDocumento === null) ?? null;
}

/** Período del correlativo: el año si se reinicia cada año, 0 si es continuo. */
export const periodoDe = (r: Pick<Regla, "reinicio">, fecha: Date) => (r.reinicio === "continuo" ? 0 : anioChile(fecha));

/**
 * Número alternativo cuando el generado ya existe y el formato NO tiene {N}
 * (p. ej. «Nº = Nº de OT» y la OT tiene un segundo documento): se añade «-2»,
 * «-3»… (distinto del sufijo de versión «-V2» de una reemisión).
 */
export const conSufijo = (numero: string, k: number) => (k <= 1 ? numero : `${numero}-${k}`);

/** Número de la numeración general del instituto (sin regla): CERT-2026-0001. */
export const numeroGeneral = (anio: number, n: number) => `CERT-${anio}-${String(n).padStart(4, "0")}`;
