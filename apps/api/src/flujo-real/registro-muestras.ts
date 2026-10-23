/**
 * Registro de las muestras recibidas de una OT desde su expediente · LIMS IDIC.
 * Reglas PURAS (sin BD), probadas en registro-muestras.spec.ts.
 *
 * Una OT que nace al aceptar una cotización ya trae lo pedido por el cliente:
 * las líneas de la cotización son ENSAYOS del catálogo (cat_ensayo). Al recibir
 * las muestras, Recepción (o Planificación / la jefatura) elige qué MÉTODOS del
 * catálogo se aplican (cat_metodo, cada uno con sus analitos) y el sistema crea
 * las muestras y sus ensayos por analizar (`resultado` en estado pendiente),
 * con la especificación y la fórmula copiadas del catálogo.
 *
 *  · Ensayo con un solo método en el catálogo → el método se propone marcado.
 *  · Ensayo con varios métodos → se listan y hay que elegir (no se adivina).
 *  · Línea sin ensayo del catálogo (texto libre) → se informa; los métodos se
 *    buscan en el catálogo.
 *  · Códigos de muestra: <OT>-M1, <OT>-M2… sin repetir los que ya existen.
 */

export interface MetodoCatalogo {
  id: string;
  codigo: string;
  nombre: string;
  norma?: string | null;
  ensayoId: string | null;
  /** Analitos activos del método: sin analitos el método no genera ensayos. */
  analitos: number;
}

export interface LineaCotizacionRegistro {
  id: string;
  descripcion: string | null;
  cantidad: number;
  catEnsayoId: string | null;
  ensayoCodigo: string | null;
  ensayoNombre?: string | null;
  /** Tipo de la línea de la cotización («producto», «viatico», «pasaje», «otros»…). */
  tipo?: string | null;
}

/**
 * B-090 · Líneas de la cotización que NO son ensayos: gastos (viático, pasaje,
 * traslado u otro gasto) y horas. No se proponen en la recepción de muestras.
 */
export const TIPOS_LINEA_GASTO = ["viatico", "pasaje", "otros", "hora_hombre", "hora_maquina", "extension"] as const;
export const esLineaDeGasto = (l: { catEnsayoId?: string | null; tipo?: string | null }): boolean =>
  !l.catEnsayoId && (TIPOS_LINEA_GASTO as readonly string[]).includes(String(l.tipo ?? ""));

export interface LineaPropuesta {
  lineaId: string;
  descripcion: string;
  cantidad: number;
  ensayoId: string | null;
  ensayoCodigo: string | null;
  metodos: MetodoCatalogo[];
  /** Métodos que se proponen marcados (solo cuando no hay duda). */
  sugeridos: string[];
  /** Texto para la persona cuando la línea necesita una decisión. */
  aviso: string | null;
}

/** Propone, por cada línea de la cotización, los métodos que se aplicarían. */
export function proponerDesdeCotizacion(
  lineas: LineaCotizacionRegistro[],
  metodosPorEnsayo: Map<string, MetodoCatalogo[]>,
): LineaPropuesta[] {
  return lineas.filter((l) => !esLineaDeGasto(l)).map((l) => {
    const descripcion = (l.ensayoNombre ?? l.descripcion ?? l.ensayoCodigo ?? "Línea sin descripción").trim();
    if (!l.catEnsayoId) {
      return {
        lineaId: l.id,
        descripcion,
        cantidad: l.cantidad,
        ensayoId: null,
        ensayoCodigo: l.ensayoCodigo,
        metodos: [],
        sugeridos: [],
        aviso: "Línea sin ensayo del catálogo: busque el método en el catálogo.",
      };
    }
    const todos = metodosPorEnsayo.get(l.catEnsayoId) ?? [];
    const utiles = todos.filter((m) => m.analitos > 0);
    let aviso: string | null = null;
    if (!todos.length) aviso = "El ensayo no tiene métodos en el catálogo: búsquelo en el catálogo o pida a Calidad que lo complete.";
    else if (!utiles.length) aviso = "Los métodos de este ensayo no tienen analitos: no generarían ensayos por analizar.";
    else if (utiles.length > 1) aviso = `El ensayo tiene ${utiles.length} métodos: marque los que se aplicarán.`;
    return {
      lineaId: l.id,
      descripcion,
      cantidad: l.cantidad,
      ensayoId: l.catEnsayoId,
      ensayoCodigo: l.ensayoCodigo,
      metodos: todos,
      sugeridos: utiles.length === 1 ? [utiles[0].id] : [],
      aviso,
    };
  });
}

/**
 * Siguientes `n` códigos de muestra de la OT: <OT>-M<k>, empezando después del
 * mayor número ya usado y sin chocar con códigos existentes (30 caracteres).
 */
export function siguientesCodigos(otCodigo: string, existentes: string[], n: number): string[] {
  const base = (otCodigo || "OT").slice(0, 24);
  const usados = new Set(existentes.map((c) => c.toUpperCase()));
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-M(\\d+)$`, "i");
  let k = 0;
  for (const c of existentes) {
    const m = re.exec(c);
    if (m) k = Math.max(k, Number(m[1]));
  }
  const out: string[] = [];
  while (out.length < n) {
    k++;
    const codigo = `${base}-M${k}`.slice(0, 30);
    if (!usados.has(codigo.toUpperCase())) {
      out.push(codigo);
      usados.add(codigo.toUpperCase());
    }
  }
  return out;
}

export interface MuestraARegistrar {
  nombre: string;
  metodoIds: string[];
}

/**
 * Qué impide registrar (lista vacía = se puede): OT cerrada o anulada, muestras
 * sin nombre o sin métodos, y métodos que no existen o no tienen analitos.
 */
export function erroresRegistro(
  otEstado: string,
  muestras: MuestraARegistrar[],
  metodos: Map<string, MetodoCatalogo>,
): string[] {
  const errores: string[] = [];
  if (otEstado === "cerrada" || otEstado === "anulada")
    errores.push(`La OT está ${otEstado}: no admite nuevas muestras.`);
  if (!muestras.length) errores.push("Indique al menos una muestra.");
  muestras.forEach((m, i) => {
    const n = i + 1;
    if (!m.nombre?.trim()) errores.push(`Muestra ${n}: indique su nombre o descripción.`);
    if (!m.metodoIds?.length) errores.push(`Muestra ${n}: elija al menos un método.`);
  });
  const ids = new Set(muestras.flatMap((m) => m.metodoIds ?? []));
  for (const id of ids) {
    const m = metodos.get(id);
    if (!m) errores.push(`El método ${id} no existe en el catálogo o está inactivo.`);
    else if (m.analitos === 0)
      errores.push(`El método ${m.codigo} · ${m.nombre} no tiene analitos en el catálogo: no genera ensayos por analizar.`);
  }
  return errores;
}
