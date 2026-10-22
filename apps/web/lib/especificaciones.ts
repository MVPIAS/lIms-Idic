/**
 * especificaciones.ts · vocabulario de pantalla de las especificaciones técnicas
 * del cliente (E.T.) y del muestreo NCh 43/44. Las reglas las impone el
 * servidor (apps/api/src/especificacion-tecnica y apps/api/src/muestreo);
 * aquí solo se nombra y se pinta. Contrato: docs/FLUJO_ESPECIFICACIONES_MUESTREO.md.
 */

export type EstadoEt = "borrador" | "vigente" | "reemplazada" | "anulada";
export const ESTADO_ET: Record<EstadoEt, { texto: string; pill: string; ayuda: string }> = {
  borrador: { texto: "Borrador", pill: "amber", ayuda: "Se edita; aún no se puede elegir en una OT." },
  vigente: { texto: "Vigente", pill: "green", ayuda: "Congelada: se elige en las OT. Para cambiarla, cree una nueva versión." },
  reemplazada: { texto: "Reemplazada", pill: "gray", ayuda: "Hay una versión posterior vigente. Las OT que la eligieron la conservan." },
  anulada: { texto: "Anulada", pill: "red", ayuda: "Ya no se puede elegir." },
};

export const ORIGEN_ET: Record<string, string> = {
  cliente: "E.T. del cliente",
  contrato: "Contrato",
  norma: "Norma",
  reglamento: "Reglamento (p. ej. RSA)",
};

export type TipoPunto = "numerico" | "atributo" | "inspeccion" | "clases";
export const TIPO_PUNTO: Record<TipoPunto, { texto: string; ayuda: string }> = {
  numerico: { texto: "Numérico", ayuda: "Mín ≤ resultado ≤ Máx. Admite una segunda condición en la misma fila («X kgf con Y mm»)." },
  atributo: { texto: "Atributo", ayuda: "Cumple / No cumple frente a un requisito en texto." },
  inspeccion: { texto: "Inspección", ayuda: "Checklist del producto (modelo, etiquetado, empaque…): no es una muestra." },
  clases: { texto: "Plan de clases", ayuda: "Plan de 2 o 3 clases (n, c, m, M) del RSA: cada réplica es una unidad." },
};

export type ClaseDefecto = "critico" | "mayor" | "menor";
export const CLASE_DEFECTO: Record<ClaseDefecto, { texto: string; pill: string }> = {
  critico: { texto: "Crítico", pill: "red" },
  mayor: { texto: "Mayor", pill: "amber" },
  menor: { texto: "Menor", pill: "blue" },
};

/** «1,5» desde 1.5 (números de pantalla con coma decimal). */
export const coma = (v: unknown) => (v == null || v === "" ? "" : String(v).replace(".", ","));

/** Lee un número escrito con coma o punto; null si está vacío o no se entiende. */
export function leerNumero(v: string): number | null {
  const s = v.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Requisito legible de un punto: «≥ 550 kgf con Alargamiento ≥ 12 mm», «48–55 HRC», «n 5 · c 2 · m 100 · M 1000». */
export function textoRequisito(p: {
  tipo?: string; limiteInf?: string | null; nominal?: string | null; limiteSup?: string | null; unidad?: string | null; requisito?: string | null;
  cond2Etiqueta?: string | null; cond2Inf?: number | null; cond2Sup?: number | null; cond2Unidad?: string | null;
  planN?: number | null; planC?: number | null; planM?: number | null; planMM?: number | null;
}): string {
  const u = p.unidad ? ` ${p.unidad}` : "";
  if (p.tipo === "clases")
    return `n ${p.planN ?? "—"} · c ${p.planC ?? "—"} · m ${coma(p.planM)}${p.planMM != null ? ` · M ${coma(p.planMM)}` : " (2 clases)"}${u}`;
  let t: string;
  const inf = p.limiteInf?.trim(), sup = p.limiteSup?.trim(), nom = p.nominal?.trim();
  if (inf && sup) t = `${coma(inf)}–${coma(sup)}${u}`;
  else if (inf) t = `≥ ${coma(inf)}${u}`;
  else if (sup) t = `≤ ${coma(sup)}${u}`;
  else if (nom) t = `${coma(nom)}${u}`;
  else t = p.requisito?.trim() || "—";
  if (p.cond2Etiqueta) {
    const u2 = p.cond2Unidad ? ` ${p.cond2Unidad}` : "";
    const c2 =
      p.cond2Inf != null && p.cond2Sup != null ? `${coma(p.cond2Inf)}–${coma(p.cond2Sup)}${u2}`
      : p.cond2Inf != null ? `≥ ${coma(p.cond2Inf)}${u2}` : `≤ ${coma(p.cond2Sup)}${u2}`;
    t += ` con ${p.cond2Etiqueta} ${c2}`;
  }
  return t;
}

/** Instante → «AAAA-MM-DDTHH:MM» en hora de Chile (valor de un <input type="datetime-local">). */
export function aLocalChile(v: unknown): string {
  if (!v) return "";
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/* -------------------------------------------------------------- muestreo --- */

export const ESTADO_MUESTREO: Record<string, { texto: string; pill: string }> = {
  borrador: { texto: "En preparación", pill: "amber" },
  registrado: { texto: "Entregado al laboratorio", pill: "blue" },
  recibido: { texto: "Recibido por el laboratorio", pill: "green" },
  anulado: { texto: "Anulado", pill: "red" },
};

export const AYUDA_FORMULARIO: Record<string, string> = {
  extraccion: "Sección Muestreo (EP-03 0.4): producto, proveedor, lote y muestra, sellos y registro fotográfico.",
  numform: "Alimentos (EP-02 1.1): producto, proveedor, cantidad, lote, devolución del excedente y quién lo solicita.",
  it01_form06: "Toma en terreno por el laboratorio (EP-01 1.1): lugar, fecha y hora, responsable, cantidad y envase.",
  planilla_nch44: "Lote con plan NCh 44 (EP-05 3.2, EP-10 10.4): identificación y tamaño del lote, plan y unidades seleccionadas.",
};
