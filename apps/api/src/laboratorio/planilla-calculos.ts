/**
 * Planilla de registros y cálculos de una OT (vista auditable, de solo lectura)
 * · LIMS IDIC. Depto. Químico, 15-10-2026: «se debe agregar una vista de
 * planilla de registros y de cálculos (son auditables)».
 *
 * Reglas PURAS (sin BD), probadas en planilla-calculos.spec.ts: arman, para cada
 * ensayo, los datos primarios (lecturas, réplicas, variables), la fórmula
 * aplicada y de dónde viene, el factor, el resultado y su historial de cambios,
 * y lo exportan a CSV para Excel (punto y coma, coma decimal, BOM UTF-8).
 */

export interface CambioHistorial {
  fecha: string | Date;
  usuario: string | null;
  campo: string;
  anterior: unknown;
  nuevo: unknown;
  motivo: string | null;
  origen: string | null;
}

export interface EnsayoPlanilla {
  resultadoId: string;
  muestra: string;
  muestraNombre: string | null;
  ensayo: string;
  metodo: string | null;
  norma: string | null;
  unidad: string | null;
  estado: string;
  veredicto: string | null;
  campos: { nombre: string; unidad: string | null }[];
  lecturas: Record<string, number>[];
  replicas: number[];
  variables: Record<string, number>;
  formula: string | null;
  formulaOrigen: "orden" | "catalogo" | "sin_formula";
  formulaCatalogo: string | null;
  formulaAplicada: string | null;
  factor: {
    valor: number; operacion: string; origen: string | null; descripcion: string | null; editadoPor: string | null; editadoAt: string | Date | null; motivo: string | null;
    /** true = aplicado al resultado; false = el valor se ingresó directo y el factor NO se aplicó; null = aún sin valor. */
    aplicado?: boolean | null;
  } | null;
  valorSinFactor: number | null;
  resultado: string | null;
  promedio: number | null;
  desviacion: number | null;
  cv: number | null;
  limiteInf: string | null;
  nominal: string | null;
  limiteSup: string | null;
  requisito: string | null;
  analista: string | null;
  revisor: string | null;
  aprobador: string | null;
  fecha: string | Date | null;
  historial: CambioHistorial[];
}

/** Nombre legible de cada campo del historial. */
export const ETIQUETA_CAMPO: Record<string, string> = {
  alta: "Alta del ensayo",
  baja: "Eliminación del ensayo",
  valor_numerico: "Valor",
  valor_texto: "Valor (texto)",
  replicas: "Réplicas",
  lecturas: "Lecturas",
  variables: "Variables",
  promedio: "Promedio",
  resultado_final: "Resultado de la fórmula",
  valor_sin_factor: "Valor sin factor",
  formula: "Fórmula",
  formula_aplicada: "Fórmula aplicada",
  factor_valor: "Factor",
  factor_operacion: "Operación del factor",
  limite_inf: "Mín",
  nominal: "Nominal",
  limite_sup: "Máx",
  unidad: "Unidad",
  requisito: "Requisito",
  tipo_dato: "Tipo de dato",
  veredicto: "Veredicto",
  estado: "Estado",
  observacion: "Observación",
  equipo_id: "Equipo",
  deleted_at: "Eliminado",
};

/** Origen legible del cambio. */
export const ETIQUETA_ORIGEN: Record<string, string> = {
  registro: "Registro de la muestra",
  captura: "Captura",
  captura_replicas: "Captura por réplicas",
  correccion: "Corrección",
  especificacion: "Especificación de la orden",
  factor: "Ajuste del factor",
  revision: "Revisión",
  aprobacion: "Aprobación",
  devolucion: "Devolución",
  reapertura: "Reapertura",
  veredicto_manual: "Veredicto del revisor",
  edicion_manual: "Edición manual",
  eliminacion: "Eliminación",
  sistema: "Sistema",
};

/** Formato chileno: coma decimal, sin separador de miles, hasta 6 decimales. */
export function numeroCl(v: unknown, dec = 6): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return String(Number(n.toFixed(dec))).replace(".", ",");
}

/** Texto de un valor del historial (JSON) para personas. */
export function textoValor(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return numeroCl(v);
  if (typeof v === "string") return /^-?\d+(\.\d+)?$/.test(v) ? numeroCl(v) : v;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "number")) return v.map((x) => numeroCl(x)).join("; ");
    return v.map((x) => textoValor(x)).join(" | ");
  }
  if (typeof v === "object")
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}=${textoValor(x)}`)
      .join(" ");
  return String(v);
}

/** Lecturas en una línea: «L1: C1=0,156 C2=1 | L2: …». */
export function textoLecturas(lecturas: Record<string, number>[]): string {
  return lecturas.map((l, i) => `L${i + 1}: ${Object.entries(l).map(([k, v]) => `${k}=${numeroCl(v)}`).join(" ")}`).join(" | ");
}

/** De dónde sale la fórmula aplicada: la de la orden (editada) o la del catálogo. */
export function origenFormula(formula: string | null, especOrigen: string | null, catalogo: Record<string, any> | null): EnsayoPlanilla["formulaOrigen"] {
  if (!formula || !formula.trim()) return "sin_formula";
  const delCatalogo = catalogo?.formula ?? null;
  if (especOrigen === "orden" && (delCatalogo ?? "") !== formula) return "orden";
  return "catalogo";
}

/** Celda CSV segura: comillas, saltos de línea y fórmulas de Excel neutralizadas. */
export function celdaCsv(v: unknown): string {
  let s = v == null ? "" : String(v);
  // Inyección de fórmulas: =, +, @, tabulador, retorno o «-» salvo que la celda
  // entera sea un número («-0,5»); «-1+HYPERLINK(…)» se neutraliza.
  if (/^[=+@\t\r]/.test(s) || (s.startsWith("-") && !/^-\d+([.,]\d+)?$/.test(s))) s = `'${s}`;
  if (/[;"\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

const fila = (xs: unknown[]) => xs.map(celdaCsv).join(";");

const fechaTexto = (f: string | Date | null | undefined) => {
  if (!f) return "";
  const d = new Date(f);
  return Number.isNaN(d.getTime()) ? String(f) : d.toLocaleString("es-CL", { timeZone: "America/Santiago" });
};

/** CSV de la planilla (para abrir en Excel): cálculos y, debajo, el historial. */
export function csvPlanilla(otCodigo: string, ensayos: EnsayoPlanilla[]): string {
  const out: string[] = [];
  out.push(fila([`Planilla de registros y cálculos · OT ${otCodigo}`]));
  out.push("");
  out.push(fila([
    "Muestra", "Ensayo", "Método", "Norma", "Unidad", "Campos del método", "Lecturas", "Réplicas", "Variables",
    "Fórmula", "Origen de la fórmula", "Fórmula del catálogo", "Fórmula aplicada", "Factor", "Origen del factor",
    "Valor sin factor", "Resultado", "Promedio", "DE", "CV %", "Mín", "Nominal", "Máx", "Requisito",
    "Veredicto", "Estado", "Analista", "Revisó", "Aprobó", "Fecha de captura",
  ]));
  for (const e of ensayos) {
    out.push(fila([
      e.muestra, e.ensayo, e.metodo, e.norma, e.unidad,
      e.campos.map((c, i) => `C${i + 1}=${c.nombre}${c.unidad ? ` (${c.unidad})` : ""}`).join(" "),
      textoLecturas(e.lecturas), e.replicas.map((x) => numeroCl(x)).join("; "),
      Object.entries(e.variables).map(([k, v]) => `${k}=${numeroCl(v)}`).join(" "),
      e.formula, e.formulaOrigen === "orden" ? "Orden" : e.formulaOrigen === "catalogo" ? "Catálogo" : "Sin fórmula",
      e.formulaCatalogo, e.formulaAplicada,
      e.factor ? `${e.factor.operacion === "dividir" ? "÷" : "×"} ${numeroCl(e.factor.valor)}${e.factor.aplicado === false ? " (no aplicado: valor ingresado directo)" : ""}` : "",
      e.factor ? (e.factor.origen === "orden" ? "Orden" : "Método") : "",
      numeroCl(e.valorSinFactor), e.resultado, numeroCl(e.promedio), numeroCl(e.desviacion), numeroCl(e.cv, 2),
      e.limiteInf, e.nominal, e.limiteSup, e.requisito, e.veredicto, e.estado,
      e.analista, e.revisor, e.aprobador, fechaTexto(e.fecha),
    ]));
  }
  out.push("");
  out.push(fila(["Historial de cambios"]));
  out.push(fila(["Muestra", "Ensayo", "Fecha", "Usuario", "Qué cambió", "Valor anterior", "Valor nuevo", "Motivo", "Origen"]));
  for (const e of ensayos)
    for (const h of e.historial)
      out.push(fila([
        e.muestra, e.ensayo, fechaTexto(h.fecha), h.usuario ?? "Sin usuario identificado",
        ETIQUETA_CAMPO[h.campo] ?? h.campo, h.campo === "alta" ? "" : textoValor(h.anterior), textoValor(h.nuevo),
        h.motivo, ETIQUETA_ORIGEN[h.origen ?? ""] ?? h.origen,
      ]));
  return "﻿" + out.join("\r\n") + "\r\n";
}

/**
 * ¿Se aplicó el factor al resultado? Sí si se guardó el valor antes del factor;
 * no si hay valor pero no ese dato (se ingresó directo); null si aún no hay
 * valor. La planilla no presenta como aplicado un factor que no lo fue.
 */
export function factorAplicado(r: { valorSinFactor: unknown; tieneValor: boolean }): boolean | null {
  if (r.valorSinFactor != null) return true;
  return r.tieneValor ? false : null;
}
