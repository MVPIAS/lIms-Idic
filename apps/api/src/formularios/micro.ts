/**
 * LMB · siembra, incubación con lecturas programadas, lectura y expresión, y
 * plan del RSA n, c, m, M (EP-02 3.3–3.5, §5) · reglas PURAS (micro.spec.ts).
 *
 * Variante que se activa por método (Parámetros de la operación); queda
 * inactiva hasta que el IDIC decida si quiere las etapas o solo el resultado
 * consolidado (EP-02 P1). Lo que no consta en las fuentes es configurable:
 * horas de lectura (P3) y los planes n, c, m, M por ensayo y producto (P2).
 *
 *   · Recuento en placa (ISO 7218): N = ΣC / (V · (n1 + 0,1·n2) · d), con las
 *     placas de dos diluciones sucesivas en el rango contable (≤ 300 colonias);
 *     redondeo a 2 cifras significativas. Sin placas contables: «< 1/(V·d)»
 *     de la dilución más baja (p. ej. «< 10»).
 *   · NMP: el valor se lee de la tabla NMP (se registra la combinación de tubos).
 *   · Presencia / ausencia: «Ausencia en 25 g» cumple.
 *   · Plan de 3 clases: no cumple si alguna unidad > M o más de c unidades
 *     están entre m y M; de 2 clases (sin M): no cumple si más de c > m. Sin
 *     plan: un solo máximo (el «Máx» del ensayo), como «según RSA vigente».
 */

export type TipoMicro = "recuento" | "nmp" | "presencia";
export type Veredicto = "cumple" | "no_cumple" | "pendiente";

export interface Siembra {
  fecha: string | null;
  medio: string | null;
  loteMedio: string | null;
  /** Diluciones sembradas como exponente negativo (1 = 10⁻¹). */
  diluciones: number[];
  volumenMl: number | null;
  tecnica: string | null;
}

export interface Incubacion {
  equipoId: string | null;
  temperatura: number | null;
  inicio: string | null;
}

export interface Lectura {
  /** Hora programada (24, 48, 72…). */
  horas: number;
  realizada: string | null;
  /** Colonias por placa en cada dilución: { "1": [120, 115], "2": [14, 12] }. */
  colonias?: Record<string, number[]>;
  /** NMP leído de la tabla (por g o por 100 mL) y la combinación de tubos. */
  nmp?: number | null;
  combinacion?: string | null;
  presencia?: "presencia" | "ausencia" | null;
  observacion?: string | null;
}

export interface RegistroMicro {
  tipo: TipoMicro;
  siembra: Siembra;
  incubacion: Incubacion;
  lecturas: Lectura[];
  /** Resultados de las n unidades (si el plan pide más de una), en ufc/g o NMP. */
  unidades?: (number | string)[];
  cantidadAnalizada?: string | null;
}

/* ------------------------------------------------- lecturas programadas --- */

export interface LecturaProgramada {
  horas: number;
  programada: string;
  estado: "registrada" | "pendiente" | "vencida";
}

/** Horas de lectura configuradas («24,48,72»). */
export function leerHoras(v: string | null | undefined): number[] {
  const h = String(v ?? "").split(/[,;\s]+/).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0 && x <= 720);
  return h.length ? [...new Set(h)].sort((a, b) => a - b) : [24, 48, 72];
}

/** Lecturas programadas desde el inicio de la incubación, con su estado frente a «ahora». */
export function lecturasProgramadas(inicio: string | null, horas: number[], lecturas: Lectura[], ahora: Date): LecturaProgramada[] {
  if (!inicio) return [];
  const t0 = new Date(inicio).getTime();
  if (!Number.isFinite(t0)) return [];
  return horas.map((h) => {
    const programada = new Date(t0 + h * 3600_000);
    const hecha = lecturas.some((l) => l.horas === h && l.realizada);
    return { horas: h, programada: programada.toISOString(), estado: hecha ? "registrada" : programada.getTime() < ahora.getTime() ? "vencida" : "pendiente" };
  });
}

/* ------------------------------------------------------------- cálculo --- */

export const MAX_CONTABLE = 300;

/** 2 cifras significativas (ISO 7218). */
export function dosCifras(n: number): number {
  if (n === 0) return 0;
  const e = Math.floor(Math.log10(Math.abs(n))) - 1;
  return Math.round(n / 10 ** e) * 10 ** e;
}

export interface CalculoMicro {
  valor: number | null;
  /** Texto del informe: «1,2 × 10³», «< 10», «Ausencia en 25 g». */
  texto: string;
  formula: string | null;
  errores: string[];
}

const sup = (n: number) => String(n).split("").map((c) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(c)] ?? c).join("");
export function notacion(v: number): string {
  if (v < 1000) return v.toLocaleString("es-CL");
  const e = Math.floor(Math.log10(v));
  const m = v / 10 ** e;
  return `${m.toLocaleString("es-CL", { maximumFractionDigits: 1 })} × 10${sup(e)}`;
}

/** Recuento en placa (ISO 7218) con las dos primeras diluciones sucesivas que tienen placas contables. */
export function recuento(colonias: Record<string, number[]>, volumenMl: number): CalculoMicro {
  const errores: string[] = [];
  if (!(volumenMl > 0)) return { valor: null, texto: "", formula: null, errores: ["Indique el volumen sembrado (mL)."] };
  const dils = Object.keys(colonias).map(Number).filter((d) => Number.isInteger(d) && d >= 0).sort((a, b) => a - b);
  for (const d of dils) for (const c of colonias[String(d)]) if (!Number.isInteger(c) || c < 0) errores.push(`Dilución 10⁻${d}: las colonias son enteros de 0 o más.`);
  if (errores.length || !dils.length) return { valor: null, texto: "", formula: null, errores: errores.length ? errores : ["Registre las colonias por placa y dilución."] };
  const contables = dils.filter((d) => colonias[String(d)].length && colonias[String(d)].some((c) => c > 0 && c <= MAX_CONTABLE));
  if (!contables.length) {
    const d0 = dils[0];
    const todasCero = dils.every((d) => colonias[String(d)].every((c) => c === 0));
    if (todasCero) {
      const ld = dosCifras(1 / (volumenMl * 10 ** -d0));
      return { valor: null, texto: `< ${ld.toLocaleString("es-CL")}`, formula: `< 1 / (V · 10⁻${d0})`, errores: [] };
    }
    return { valor: null, texto: `> ${notacion(dosCifras((MAX_CONTABLE * 10 ** dils[dils.length - 1]) / volumenMl))}`, formula: "Sobre el rango contable", errores: [] };
  }
  const d1 = contables[0];
  const d2 = contables.includes(d1 + 1) ? d1 + 1 : null;
  const p1 = colonias[String(d1)];
  const p2 = d2 != null ? colonias[String(d2)] : [];
  const suma = [...p1, ...p2].reduce((a, b) => a + b, 0);
  const n = suma / (volumenMl * (p1.length + 0.1 * p2.length) * 10 ** -d1);
  const valor = dosCifras(n);
  return { valor, texto: notacion(valor), formula: `ΣC / (V · (n1 + 0,1·n2) · 10⁻${d1}) = ${suma} / (${volumenMl} · (${p1.length} + 0,1·${p2.length}) · 10⁻${d1})`, errores: [] };
}

/** Resultado de la determinación desde su última lectura. */
export function calcularMicro(r: RegistroMicro): CalculoMicro {
  const ultima = [...r.lecturas].filter((l) => l.realizada).sort((a, b) => b.horas - a.horas)[0];
  if (!ultima) return { valor: null, texto: "", formula: null, errores: ["Registre al menos una lectura."] };
  if (r.tipo === "presencia") {
    if (!ultima.presencia) return { valor: null, texto: "", formula: null, errores: ["Indique presencia o ausencia."] };
    const cant = r.cantidadAnalizada?.trim() || "25 g";
    return { valor: null, texto: `${ultima.presencia === "ausencia" ? "Ausencia" : "Presencia"} en ${cant}`, formula: null, errores: [] };
  }
  if (r.tipo === "nmp") {
    if (ultima.nmp == null || !(ultima.nmp >= 0)) return { valor: null, texto: "", formula: null, errores: ["Indique el NMP leído de la tabla."] };
    return { valor: ultima.nmp, texto: ultima.nmp.toLocaleString("es-CL"), formula: ultima.combinacion ? `Tabla NMP · tubos ${ultima.combinacion}` : "Tabla NMP", errores: [] };
  }
  return recuento(ultima.colonias ?? {}, r.siembra.volumenMl ?? 0);
}

/* ------------------------------------------------------------ plan RSA --- */

export interface PlanRsa {
  metodo: string;
  producto: string | null;
  n: number;
  c: number;
  m: number;
  M: number | null;
  articulo: string | null;
}

export function leerPlanes(json: string | null | undefined): PlanRsa[] {
  try {
    const f = JSON.parse(json ?? "[]");
    if (!Array.isArray(f)) return [];
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(String(v).replace(",", ".")));
    return f
      .map((x: any) => ({ metodo: String(x?.metodo ?? "").trim(), producto: String(x?.producto ?? "").trim() || null, n: Number(num(x?.n)), c: Number(num(x?.c)), m: Number(num(x?.m)), M: num(x?.M), articulo: String(x?.articulo ?? "").trim() || null }))
      .filter((p: PlanRsa) => p.metodo && Number.isInteger(p.n) && p.n >= 1 && Number.isInteger(p.c) && p.c >= 0 && p.c < p.n && Number.isFinite(p.m) && (p.M == null || p.M >= p.m));
  } catch {
    return [];
  }
}

/** Plan que aplica: el del método y producto; si no, el del método sin producto. */
export function planDe(planes: PlanRsa[], metodo: string | null, producto: string | null): PlanRsa | null {
  if (!metodo) return null;
  const delMetodo = planes.filter((p) => p.metodo === metodo);
  return delMetodo.find((p) => p.producto && producto && p.producto.toLowerCase() === producto.toLowerCase()) ?? delMetodo.find((p) => !p.producto) ?? null;
}

const valorUnidad = (v: number | string): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = v.trim();
  if (/^</.test(t)) return 0; // bajo el LD: por debajo de m
  const n = Number(t.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Veredicto del plan de 2 o 3 clases sobre las n unidades. */
export function evaluarPlan(plan: PlanRsa, unidades: (number | string)[]): { veredicto: Veredicto; texto: string; errores: string[] } {
  const vals = unidades.map(valorUnidad);
  if (vals.some((v) => v === null)) return { veredicto: "pendiente", texto: "", errores: ["Los resultados de las unidades deben ser números (o «< LD»)."] };
  if (vals.length < plan.n) return { veredicto: "pendiente", texto: `Faltan unidades: ${vals.length} de n = ${plan.n}.`, errores: [] };
  const v = vals.slice(0, plan.n) as number[];
  const sobreM = plan.M != null ? v.filter((x) => x > plan.M!).length : 0;
  const entre = v.filter((x) => x > plan.m && (plan.M == null || x <= plan.M)).length;
  const no = sobreM > 0 || entre > plan.c;
  const clases = plan.M != null ? `3 clases (n=${plan.n}, c=${plan.c}, m=${plan.m}, M=${plan.M})` : `2 clases (n=${plan.n}, c=${plan.c}, m=${plan.m})`;
  return {
    veredicto: no ? "no_cumple" : "cumple",
    texto: `Plan ${clases}${plan.articulo ? ` · ${plan.articulo}` : ""}: ${entre} unidad(es) entre m y M${plan.M != null ? `, ${sobreM} sobre M` : ""}.`,
    errores: [],
  };
}

/** Veredicto sin plan: un solo máximo (Máx del ensayo) o el requisito de presencia / ausencia. */
export function veredictoSimple(calc: CalculoMicro, tipo: TipoMicro, maximo: number | null, requisito: string | null): Veredicto {
  if (tipo === "presencia") {
    if (!calc.texto) return "pendiente";
    const pide = (requisito ?? "ausencia").toLowerCase().includes("presencia") ? "presencia" : "ausencia";
    return calc.texto.toLowerCase().startsWith(pide) ? "cumple" : "no_cumple";
  }
  if (calc.texto.startsWith("<")) {
    const ld = Number(calc.texto.replace(/[<\s.]/g, "").replace(",", "."));
    return maximo == null ? "pendiente" : ld <= maximo ? "cumple" : "pendiente";
  }
  if (calc.valor == null || maximo == null) return "pendiente";
  return calc.valor <= maximo ? "cumple" : "no_cumple";
}
