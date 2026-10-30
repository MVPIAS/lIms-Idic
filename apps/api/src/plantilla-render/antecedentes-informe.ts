/**
 * Antecedentes del Informe de Ensayos ({{antecedentes.*}}) · reglas PURAS.
 *
 * Informe de Ensayos de Alimentos (IDIC-PG09-Anexo02-02 rev05; EP-02 5.1 y §6,
 * revisión 29-10-2026): el punto 1 imprime la fecha y hora de muestreo, la de
 * recepción del ítem y la del análisis; el punto 2, la temperatura de recepción
 * y el formulario de muestreo. Salen de la recepción de cada muestra
 * (temperatura_recepcion, fecha_toma_muestra, formulario_muestreo) y de la
 * fecha de ejecución de los ensayos (resultado.fecha_ensayo).
 *
 * Con varias muestras se toma lo más temprano (muestreo, recepción, análisis) y
 * los valores distintos de temperatura y formulario se listan separados por
 * « / ». Lo que falta se imprime «No aplica» (como en el formato real).
 */
import { fmtFechaHora, fmtNum } from "./html.util";

export const NO_APLICA = "No aplica";

export interface MuestraAntecedentes {
  fechaTomaMuestra?: Date | string | null;
  recepcionadaAt?: Date | string | null;
  temperaturaRecepcion?: unknown;
  formularioMuestreo?: string | null;
}

export interface Antecedentes {
  /** Fecha y hora de muestreo (la toma más temprana). */
  muestreo: string;
  /** Fecha y hora de recepción del ítem (la más temprana; si no, la de la OT). */
  recepcion: string;
  /** Fecha y hora del análisis (el primer ensayo ejecutado). */
  analisis: string;
  /** Temperatura de recepción: «3,8 °C» (varias, separadas por « / »). */
  temperatura: string;
  /** Formulario(s) de muestreo. */
  formulario: string;
  /** Teléfono de contacto: el del contacto principal del cliente o el del cliente. */
  contacto: string;
}

const instante = (v: Date | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = (v instanceof Date ? v : new Date(String(v))).getTime();
  return Number.isFinite(t) ? t : null;
};

/** El instante más temprano de la lista, formateado en hora de Chile; «No aplica» si no hay. */
function primero(valores: (Date | string | null | undefined)[]): string {
  const ts = valores.map(instante).filter((t): t is number => t !== null);
  return ts.length ? fmtFechaHora(new Date(Math.min(...ts))) : NO_APLICA;
}

/** Valores distintos, en el orden en que aparecen, separados por « / ». */
function distintos(valores: string[]): string {
  const u = [...new Set(valores.map((v) => v.trim()).filter(Boolean))];
  return u.length ? u.join(" / ") : NO_APLICA;
}

export function antecedentesInforme(
  muestras: MuestraAntecedentes[],
  fechasEnsayo: (Date | string | null | undefined)[],
  ot: { fechaRecepcion?: Date | string | null } = {},
  cliente: { contactoTelefono?: string | null; telefono?: string | null } | null = null,
): Antecedentes {
  const recep = muestras.map((m) => m.recepcionadaAt);
  const temperaturas = muestras
    .map((m) => (m.temperaturaRecepcion === null || m.temperaturaRecepcion === undefined || m.temperaturaRecepcion === "" ? "" : `${fmtNum(m.temperaturaRecepcion, 1)} °C`));
  return {
    muestreo: primero(muestras.map((m) => m.fechaTomaMuestra)),
    recepcion: recep.some((r) => instante(r) !== null) ? primero(recep) : primero([ot.fechaRecepcion]),
    analisis: primero(fechasEnsayo),
    temperatura: distintos(temperaturas),
    formulario: distintos(muestras.map((m) => m.formularioMuestreo ?? "")),
    contacto: cliente?.contactoTelefono?.trim() || cliente?.telefono?.trim() || NO_APLICA,
  };
}

/**
 * Datos de la recepción de UNA muestra para la identificación del informe
 * ({{identificacion_muestras}}): solo lo que tiene valor, con su etiqueta.
 */
export function datosRecepcionInforme(m: MuestraAntecedentes): { etiqueta: string; valor: string }[] {
  const d: { etiqueta: string; valor: string }[] = [];
  if (m.temperaturaRecepcion !== null && m.temperaturaRecepcion !== undefined && m.temperaturaRecepcion !== "")
    d.push({ etiqueta: "Temperatura de recepción", valor: `${fmtNum(m.temperaturaRecepcion, 1)} °C` });
  if (instante(m.fechaTomaMuestra) !== null) d.push({ etiqueta: "Fecha y hora de toma de muestra", valor: fmtFechaHora(m.fechaTomaMuestra) });
  if (m.formularioMuestreo?.trim()) d.push({ etiqueta: "Formulario de muestreo", valor: m.formularioMuestreo.trim() });
  return d;
}
