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
  /** Muestra de la cotización a la que va la línea (null = toda la cotización). */
  muestraN?: number | null;
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
  /** Muestra de la cotización a la que va la línea (null = toda la cotización). */
  muestraN?: number | null;
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
        muestraN: l.muestraN ?? null,
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
      muestraN: l.muestraN ?? null,
    };
  });
}

/* ------------------------- recepción de una cotización por muestra (F026, F062) --- */

/** Muestra registrada en la cotización (cotizacion_muestra). */
export interface MuestraCotizacionRegistro {
  n: number;
  descripcion: string;
  catElementoId: string | null;
  productoNombre?: string | null;
  productoTexto?: string | null;
}

/**
 * Muestras que la recepción propone cuando la cotización se hizo por muestra:
 * una por cada muestra de la cotización, con su descripción, su producto y los
 * métodos sugeridos de sus ensayos (más los de las líneas de toda la cotización).
 */
export function muestrasPropuestas(muestras: MuestraCotizacionRegistro[], lineas: LineaPropuesta[]) {
  return muestras.map((m) => ({
    n: m.n,
    descripcion: m.descripcion,
    catElementoId: m.catElementoId,
    productoNombre: m.productoNombre ?? m.productoTexto ?? null,
    lineaIds: lineas.filter((l) => l.muestraN === m.n).map((l) => l.lineaId),
    sugeridos: [...new Set(lineas.filter((l) => l.muestraN == null || l.muestraN === m.n).flatMap((l) => l.sugeridos))],
  }));
}

/**
 * Métodos marcados que van a una muestra recibida (la pantalla aplica la misma
 * regla, lib/recepcion.ts): los de las líneas de SU muestra de la cotización y
 * los de las líneas de toda la cotización; un método agregado a mano (panel o
 * catálogo, sin línea) va a todas. Una fila sin muestra de la cotización lleva todos.
 */
export function metodosDeLaMuestra(
  muestraN: number | null | undefined,
  marcados: string[],
  lineas: Pick<LineaPropuesta, "muestraN" | "metodos">[],
): string[] {
  if (muestraN == null) return [...marcados];
  return marcados.filter((id) => {
    const deLineas = lineas.filter((l) => l.metodos.some((m) => m.id === id));
    if (!deLineas.length) return true;
    return deLineas.some((l) => l.muestraN == null || l.muestraN === muestraN);
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
  /**
   * Clase de custodia de la recepción (B-013): un testigo, una muestra en
   * custodia o una contramuestra van a bodega con su retención y pueden
   * registrarse SIN ensayos (LME-PG01-IT02, EP-01 6.4).
   */
  claseCustodia?: string | null;
}

/** Clases de custodia que se registran sin ensayos (van a bodega con su plazo de retención). */
export const CLASES_SIN_ENSAYOS = ["testigo", "custodia", "contramuestra"] as const;
export const admiteSinEnsayos = (clase?: string | null) => !!clase && (CLASES_SIN_ENSAYOS as readonly string[]).includes(clase);

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
    if (!m.metodoIds?.length && !admiteSinEnsayos(m.claseCustodia))
      errores.push(`Muestra ${n}: elija al menos un método (o márquela como testigo, en custodia o contramuestra si va a bodega sin ensayos).`);
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

/* ------------------- métodos agregados a una muestra ya recepcionada (F064) --- */

/** Perfiles de recepción que agregan métodos a una muestra recibida (además de las jefaturas, con ot.asignar). */
export const ROLES_RECEPCION = ["RECEPCION", "PLANIFICACION"] as const;

/** ¿Puede agregar métodos a una muestra ya recepcionada? Recepción o jefatura (con muestra.crear). */
export function puedeAgregarMetodos(u: { roles?: string[] | null; permisos?: string[] | null }): boolean {
  const roles = u.roles ?? [];
  const permisos = u.permisos ?? [];
  if (roles.includes("SUPERADMIN")) return true;
  if (!permisos.includes("muestra.crear")) return false;
  return permisos.includes("ot.asignar") || roles.some((r) => (ROLES_RECEPCION as readonly string[]).includes(r));
}

/** Qué impide agregar los métodos (lista vacía = se puede). */
export function erroresAgregarMetodos(
  otEstado: string,
  metodoIds: string[],
  yaEnMuestra: string[],
  metodos: Map<string, MetodoCatalogo>,
  motivo: string | null | undefined,
): string[] {
  const e: string[] = [];
  if (otEstado === "cerrada" || otEstado === "anulada") e.push(`La OT está ${otEstado}: no se agregan métodos a sus muestras.`);
  if (!metodoIds.length) e.push("Elija al menos un método.");
  if (!motivo || motivo.trim().length < 5) e.push("Indique el motivo (queda en el historial de la OT).");
  for (const id of metodoIds) {
    const m = metodos.get(id);
    if (!m) e.push(`El método ${id} no existe en el catálogo o está inactivo.`);
    else if (m.analitos === 0) e.push(`El método ${m.codigo} · ${m.nombre} no tiene analitos en el catálogo: no genera ensayos por analizar.`);
    else if (yaEnMuestra.includes(id)) e.push(`El método ${m.codigo} · ${m.nombre} ya está en la muestra.`);
  }
  return e;
}
