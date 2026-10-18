/**
 * Reglas puras del certificado de calibración según la información del LMT del
 * 15-10-2026 (sin base de datos; se prueban en metrologia.reglas.spec.ts).
 *
 *  C3  numeración por magnitud y sin año (M-3948, PT-0091…)
 *  C4  habilitación del metrólogo por magnitud (registro de firmas autorizadas)
 *  C5  CMC del maestro versionado y U certificada = máx(U, CMC); «*» fuera del alcance
 *  C11 avisos de fechas (OT posterior a la recepción, recepción posterior a la calibración)
 *  C12 U con dos cifras significativas (redondeo hacia arriba, REDONDEAR.MAS)
 *  Patrones: vigencia a la fecha de calibración (bloqueo si vencido, aviso si vence pronto)
 */
import { randomInt } from "node:crypto";

/* ------------------------------------------------------------------ C3 --- */
/** Número del certificado: prefijo de la magnitud y correlativo sin año (relleno con ceros si corresponde). */
export const numeroCertificado = (prefijo: string, n: number, relleno = 0) => `${prefijo}-${String(n).padStart(relleno, "0")}`;

/** Código de verificación (Crockford base32 sin I/L/O/U, 10 caracteres en dos grupos). */
export function nuevoCodigoVerificacion(): string {
  const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let s = "";
  for (let i = 0; i < 10; i++) s += A[randomInt(A.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
/** Formato admitido por la verificación pública (evita consultas con texto arbitrario). */
export const codigoVerificacionValido = (c: string) => /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(c);

/* ----------------------------------------------------------------- C12 --- */
/** U con dos cifras significativas, redondeada hacia arriba (nunca informa menos de lo calculado). */
export function u2cs(U: number | null | undefined): number | null {
  if (U == null || !Number.isFinite(U)) return null;
  if (U === 0) return 0;
  const e = Math.floor(Math.log10(Math.abs(U))) - 1; // exponente de la 2.ª cifra
  const f = 10 ** -e;
  const y = Number((Math.abs(U) * f).toPrecision(15));
  return (Math.sign(U) * Math.ceil(y)) / f;
}
/** Decimales con los que se escribe un valor de dos cifras significativas (0,00030 → 5). */
export function decimales2cs(U: number | null | undefined): number {
  if (U == null || !Number.isFinite(U) || U === 0) return 0;
  return Math.max(0, 1 - Math.floor(Math.log10(Math.abs(U))));
}

/* ----------------------------------------------------------------- C11 --- */
export interface FechasCal { fechaOt?: string | null; fechaRecepcion?: string | null; fechaCalibracion?: string | null }
const iso = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
/** Avisos (no bloquean): la OT debe ser igual o anterior a la recepción; la recepción, anterior a la calibración. */
export function avisosFechas(f: FechasCal): string[] {
  const ot = iso(f.fechaOt), rec = iso(f.fechaRecepcion), cal = iso(f.fechaCalibracion);
  const av: string[] = [];
  if (ot && rec && ot > rec)
    av.push(`La fecha de la OT (${dmy(ot)}) es posterior a la de recepción del instrumento (${dmy(rec)}): según el laboratorio, la OT debe ser igual o anterior a la recepción.`);
  if (rec && cal && rec > cal)
    av.push(`La fecha de recepción (${dmy(rec)}) es posterior a la de calibración (${dmy(cal)}): revise las fechas.`);
  return av;
}

/* ------------------------------------------------------------------ C4 --- */
export interface Firmante {
  funcion: string; magnitudes: string[]; laboratorios: string[]; usuarioId: string | null; activo: boolean; iniciales?: string;
}
/**
 * Motivo por el que el usuario NO puede firmar como metrólogo la calibración, o null.
 * Solo se exige si el registro declara la magnitud para ese laboratorio (el LNF y las
 * magnitudes que no figuran en el registro no se controlan).
 */
export function motivoHabilitacion(registro: Firmante[], usuarioId: string, laboratorio: string | null, magnitud: string): string | null {
  const metro = registro.filter((r) => r.activo && r.funcion === "METROLOGO");
  const cubre = (r: Firmante) => !!laboratorio && r.laboratorios.includes(laboratorio) && r.magnitudes.includes(magnitud);
  if (!metro.some(cubre)) return null;
  if (metro.some((r) => cubre(r) && r.usuarioId === usuarioId)) return null;
  return `No figura en el registro de firmas autorizadas del laboratorio para la magnitud «${magnitud}» (LMT-PG01 Anexo 11): no puede firmar esta calibración como metrólogo.`;
}

/* --------------------------------------------------------- Patrones ------ */
export type EstadoPatron = "vigente" | "por_vencer" | "vencido" | "sin_fecha";
/** Estado del patrón a una fecha (por vencer = menos de 30 días). */
export function estadoPatron(vence: string | Date | null | undefined, fecha: string): EstadoPatron {
  if (!vence) return "sin_fecha";
  const v = (vence instanceof Date ? vence.toISOString() : String(vence)).slice(0, 10);
  if (v < fecha) return "vencido";
  const lim = new Date(Date.parse(fecha + "T12:00:00Z") + 30 * 86400000).toISOString().slice(0, 10);
  return v <= lim ? "por_vencer" : "vigente";
}
export interface PatronRef { id: string; codigo?: string | null; nombre: string; vence?: string | Date | null; activo?: boolean }
/** Bloqueos (patrón vencido o dado de baja, más de 3, repetidos) y avisos (vence en menos de 30 días). */
export function revisarPatrones(patrones: PatronRef[], pedidos: string[], fecha: string): { errores: string[]; avisos: string[] } {
  const errores: string[] = [], avisos: string[] = [];
  if (pedidos.length > 3) errores.push("Se pueden declarar como máximo 3 patrones por calibración.");
  if (new Set(pedidos).size !== pedidos.length) errores.push("Hay patrones repetidos.");
  for (const id of pedidos) {
    const p = patrones.find((x) => x.id === id);
    if (!p || p.activo === false) { errores.push("Uno de los patrones no existe o está dado de baja en el maestro."); continue; }
    const e = estadoPatron(p.vence ?? null, fecha);
    const nom = `${p.codigo ? p.codigo + " · " : ""}${p.nombre}`;
    const v = p.vence ? dmy((p.vence instanceof Date ? p.vence.toISOString() : String(p.vence)).slice(0, 10)) : "";
    if (e === "vencido") errores.push(`El patrón ${nom} venció el ${v}, antes de la fecha de calibración (${dmy(fecha)}): no se puede usar.`);
    else if (e === "por_vencer") avisos.push(`El patrón ${nom} vence el ${v} (menos de 30 días).`);
    else if (e === "sin_fecha") avisos.push(`El patrón ${nom} no tiene fecha de vencimiento en el maestro.`);
  }
  return { errores, avisos };
}

/* ------------------------------------------------------------------ C5 --- */
export interface FilaCmc {
  proceso_codigo: string; acreditacion: string | null; version: string; vigente_desde: string | Date; vigente_hasta: string | Date | null;
  rango_min: number; rango_max: number; incluye_min: boolean; unidad_rango: string; resolucion: number | null;
  tipo: "valor" | "lineal" | "raiz"; a: number; b: number | null; unidad_cmc: string; variante?: string | null;
}
const KN: Record<string, number> = { kN: 1, N: 0.001, kgf: 0.00980665, kg: 0.00980665, MN: 1000 };
const FACTOR: Record<string, Record<string, number>> = {
  masa: { mg: 1e-3, g: 1, kg: 1000 }, longitud: { "µm": 1e-3, um: 1e-3, mm: 1, m: 1000 }, volumen: { "µL": 1e-3, uL: 1e-3, mL: 1, L: 1000 }, fuerza: KN,
};
/** Convierte entre unidades de una misma familia (null si no se sabe). */
export function convertir(x: number, de: string, a: string): number | null {
  if (de === a) return x;
  for (const fam of Object.values(FACTOR)) if (fam[de] != null && fam[a] != null) return (x * fam[de]) / fam[a];
  return null;
}
const fechaTxt = (d: string | Date | null) => (d == null ? null : (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10));
/**
 * CMC aplicable a un punto (en la unidad de la U), o null si el punto no está en el alcance.
 * Entre filas que se solapan (varios patrones en el mismo rango) se toma la menor: la mejor
 * capacidad del laboratorio. Con resolución del instrumento, solo las filas de esa resolución.
 */
export function cmcPara(filas: FilaCmc[], p: { proceso: string; fecha: string; nominal: number; unidad: string; unidadU: string; resolucion?: number | null }): { cmc: number; fila: FilaCmc } | null {
  const candidatas = filas.filter((f) => {
    if (f.proceso_codigo !== p.proceso) return false;
    const d = fechaTxt(f.vigente_desde)!, h = fechaTxt(f.vigente_hasta);
    if (d > p.fecha || (h && h < p.fecha)) return false;
    const x = convertir(p.nominal, p.unidad, f.unidad_rango);
    if (x == null) return false;
    const dentro = (f.incluye_min ? x >= f.rango_min - 1e-12 : x > f.rango_min) && x <= f.rango_max + 1e-12;
    if (!dentro) return false;
    if (f.resolucion != null) {
      if (p.resolucion == null) return false;
      const r = convertir(p.resolucion, p.unidad, f.unidad_rango);
      if (r == null || Math.abs(r - f.resolucion) > 1e-9) return false;
    }
    return true;
  });
  let mejor: { cmc: number; fila: FilaCmc } | null = null;
  for (const f of candidatas) {
    const L = convertir(p.nominal, p.unidad, f.unidad_rango)!;
    const bruto = f.tipo === "lineal" ? f.a * L + (f.b ?? 0) : f.tipo === "raiz" ? Math.sqrt(f.a * L + 0.333 * (p.resolucion ?? 0) ** 2) : f.a;
    const cmc = f.unidad_cmc === "%" || p.unidadU === "%" ? (f.unidad_cmc === p.unidadU ? bruto : null) : convertir(bruto, f.unidad_cmc, p.unidadU);
    if (cmc == null) continue;
    if (!mejor || cmc < mejor.cmc) mejor = { cmc, fila: f };
  }
  return mejor;
}

/** U que se certifica: máx(U del motor, CMC) y dos cifras significativas hacia arriba. */
export function uCertificada(uMotor: number | null | undefined, cmc: number | null | undefined): number | null {
  const base = uMotor == null || !Number.isFinite(uMotor) ? null : uMotor;
  const m = base == null ? cmc ?? null : cmc == null ? base : Math.max(base, cmc);
  return u2cs(m);
}
