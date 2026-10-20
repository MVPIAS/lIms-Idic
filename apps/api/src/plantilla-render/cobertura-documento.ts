/**
 * Varios documentos vigentes por OT · reglas PURAS (sin BD), probadas en
 * cobertura-documento.spec.ts. Contrato: docs/FLUJO_DOCUMENTOS_POR_OT.md.
 *
 * Un documento cubre toda la OT, una MUESTRA (LQC: un informe por muestra),
 * un PRODUCTO (LPN: un IE por producto = las muestras de un mismo elemento del
 * catálogo) o un LABORATORIO (Alimentos: los resultados de LQA, LMB o LES). La
 * OT puede tener varios documentos vigentes de la misma plantilla si sus
 * coberturas no se solapan; cada uno con sus firmas, su entrega y su cuenta
 * para el cierre.
 */

export const COBERTURAS = ["ot", "muestra", "producto", "laboratorio"] as const;
export type Cobertura = (typeof COBERTURAS)[number];

export const NOMBRE_COBERTURA: Record<Cobertura, string> = {
  ot: "Toda la OT",
  muestra: "Una muestra",
  producto: "Un producto",
  laboratorio: "Un laboratorio",
};

export interface CoberturaDoc {
  cobertura: Cobertura;
  muestraIds: string[];
  unidadId: string | null;
}

/** Normaliza lo que llega (sin cobertura = toda la OT; sin repetidos). */
export function normalizarCobertura(c?: { cobertura?: string | null; muestraIds?: string[] | null; unidadId?: string | null } | null): CoberturaDoc {
  const cobertura = (COBERTURAS as readonly string[]).includes(c?.cobertura ?? "") ? (c!.cobertura as Cobertura) : "ot";
  return {
    cobertura,
    muestraIds: cobertura === "muestra" || cobertura === "producto" ? [...new Set((c?.muestraIds ?? []).filter(Boolean))] : [],
    unidadId: cobertura === "laboratorio" ? c?.unidadId ?? null : null,
  };
}

export interface MuestraCobertura {
  id: string;
  codigo: string;
  /** Producto (cat_elemento) de la muestra, si se registró. */
  elementoId: string | null;
  elementoNombre?: string | null;
}

/** Errores de la cobertura pedida para esta OT (lista vacía = válida). */
export function erroresCobertura(c: CoberturaDoc, ctx: { muestras: MuestraCobertura[]; laboratorios: string[] }): string[] {
  const e: string[] = [];
  const deOt = new Map(ctx.muestras.map((m) => [m.id, m]));
  if (c.cobertura === "muestra") {
    if (c.muestraIds.length !== 1) e.push("Un documento por muestra cubre exactamente una muestra: elíjala.");
  }
  if (c.cobertura === "producto") {
    if (!c.muestraIds.length) e.push("Elija el producto (sus muestras) que cubre el documento.");
    const elems = new Set(c.muestraIds.map((id) => deOt.get(id)?.elementoId ?? `sin:${id}`));
    if (elems.size > 1) e.push("Las muestras de un documento por producto deben ser del mismo producto.");
  }
  if (c.cobertura === "muestra" || c.cobertura === "producto") {
    const ajenas = c.muestraIds.filter((id) => !deOt.has(id));
    if (ajenas.length) e.push(`${ajenas.length} muestra(s) no son de esta OT.`);
  }
  if (c.cobertura === "laboratorio") {
    if (!c.unidadId) e.push("Elija el laboratorio que cubre el documento.");
    else if (!ctx.laboratorios.includes(c.unidadId)) e.push("Ese laboratorio no trabaja en esta OT.");
  }
  return e;
}

/**
 * ¿Se solapan dos documentos? Toda la OT se solapa con cualquiera; dos por
 * muestra o producto, si comparten una muestra; dos por laboratorio, si es el
 * mismo; uno por laboratorio con uno por muestra o producto, siempre (cubren
 * resultados cruzados y se confundirían).
 */
export function solapan(a: CoberturaDoc, b: CoberturaDoc): boolean {
  if (a.cobertura === "ot" || b.cobertura === "ot") return true;
  const porMuestra = (x: CoberturaDoc) => x.cobertura === "muestra" || x.cobertura === "producto";
  if (porMuestra(a) && porMuestra(b)) return a.muestraIds.some((id) => b.muestraIds.includes(id));
  if (a.cobertura === "laboratorio" && b.cobertura === "laboratorio") return a.unidadId === b.unidadId;
  return true;
}

const VIGENTES = ["en_firma", "oficial", "emitido"];

/** Documento vigente de la misma plantilla que choca con el nuevo (o null). Un «no emitido» también ocupa su cobertura. */
export function documentoEnConflicto<D extends CoberturaDoc & { estado: string; noEmitido?: boolean }>(nuevo: CoberturaDoc, existentes: D[]): D | null {
  return existentes.find((d) => (VIGENTES.includes(d.estado) || d.noEmitido) && solapan(nuevo, d)) ?? null;
}

/** Texto de la cobertura para listas, títulos y bitácora. */
export function etiquetaCobertura(
  c: CoberturaDoc,
  nombres: { muestras?: Map<string, MuestraCobertura>; laboratorio?: string | null } = {},
): string {
  switch (c.cobertura) {
    case "muestra":
      return `Muestra ${c.muestraIds.map((id) => nombres.muestras?.get(id)?.codigo ?? "—").join(", ")}`;
    case "producto": {
      const m = c.muestraIds.map((id) => nombres.muestras?.get(id)).filter(Boolean) as MuestraCobertura[];
      const prod = m[0]?.elementoNombre ?? m[0]?.codigo ?? "—";
      return `Producto ${prod} (${m.length === 1 ? `muestra ${m[0].codigo}` : `${m.length} muestras`})`;
    }
    case "laboratorio":
      return `Laboratorio ${nombres.laboratorio ?? "—"}`;
    default:
      return "Toda la OT";
  }
}

/**
 * Qué falta cubrir para cerrar la OT cuando se emite por muestra, producto o
 * laboratorio: cada muestra (o laboratorio) con resultados debe tener su
 * documento vigente o registrado como «no emitido». Si hay un documento de
 * toda la OT, no falta nada. Sin documentos, la regla general del cierre ya lo dice.
 */
export function pendientesCobertura(p: {
  muestras: { id: string; codigo: string; conResultados: boolean }[];
  laboratorios: { id: string; codigo: string; conResultados: boolean }[];
  documentos: (CoberturaDoc & { estado: string; noEmitido?: boolean })[];
}): string[] {
  const cuentan = p.documentos.filter((d) => (d.estado !== "anulado" && d.estado !== "devuelto") || d.noEmitido);
  if (!cuentan.length || cuentan.some((d) => d.cobertura === "ot")) return [];
  const f: string[] = [];
  if (cuentan.some((d) => d.cobertura === "muestra" || d.cobertura === "producto")) {
    const cubiertas = new Set(cuentan.flatMap((d) => d.muestraIds));
    for (const m of p.muestras)
      if (m.conResultados && !cubiertas.has(m.id))
        f.push(`La muestra ${m.codigo} no tiene documento: emítalo o registre que no se emite, con su motivo.`);
  }
  if (cuentan.some((d) => d.cobertura === "laboratorio")) {
    const cubiertos = new Set(cuentan.map((d) => d.unidadId));
    for (const l of p.laboratorios)
      if (l.conResultados && !cubiertos.has(l.id)) f.push(`El laboratorio ${l.codigo} no tiene su documento en esta OT.`);
  }
  return f;
}

/** Motivo de un «no emitido»: obligatorio y explicado. */
export function motivoNoEmitido(motivo: string | null | undefined): string | null {
  return (motivo ?? "").trim().length >= 5 ? null : "Indique por qué no se emite el documento (mínimo 5 caracteres).";
}
