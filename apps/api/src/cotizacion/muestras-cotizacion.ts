/**
 * Cotización por muestra (Depto. Químico, reunión 5 · 29-10-2026).
 *
 * Desde la cotización se registra cuántas muestras trae el cliente y, por cada
 * una, qué ensayos se le harán. Cada muestra puede indicar su producto (eje
 * Producto del catálogo, `cat_elemento`), elegido ANTES que sus ensayos
 * (reunión 3), y su plazo propio. Los plazos se cuentan desde la llegada de la
 * muestra al laboratorio: las fechas comprometidas quedan condicionadas a que
 * el cliente entregue las muestras a tiempo.
 *
 *  · La cotización sin muestras sigue funcionando como antes (líneas sueltas).
 *  · Una línea con `muestraN` pertenece a esa muestra; sin él es general
 *    (gastos, o un ensayo que el laboratorio agregó sin asignarlo a una muestra).
 *  · El mismo ensayo puede ir en varias muestras, pero no dos veces en la misma.
 *
 * Funciones PURAS (sin BD): muestras-cotizacion.spec.ts.
 */

export const MAX_MUESTRAS = 200;

export interface MuestraEntrada {
  descripcion?: string | null;
  /** Producto del catálogo (cat_elemento). */
  catElementoId?: string | null;
  /** Nombre del producto tal como se mostró al elegirlo (o escrito si no está en el catálogo). */
  productoTexto?: string | null;
  /** Plazo propio de esta muestra, en días corridos desde su llegada. */
  plazoDias?: number | null;
}

export interface Muestra {
  n: number;
  descripcion: string;
  catElementoId: string | null;
  productoTexto: string | null;
  plazoDias: number | null;
}

/** Numera las muestras 1..N en el orden recibido y limpia los textos. */
export function normalizarMuestras(entrada: MuestraEntrada[] | null | undefined): { muestras: Muestra[]; error?: string } {
  const lista = Array.isArray(entrada) ? entrada : [];
  if (lista.length > MAX_MUESTRAS) return { muestras: [], error: `Máximo ${MAX_MUESTRAS} muestras por cotización.` };
  const muestras: Muestra[] = [];
  for (let i = 0; i < lista.length; i++) {
    const m = lista[i] ?? {};
    const plazo = m.plazoDias == null || (m.plazoDias as any) === "" ? null : Number(m.plazoDias);
    if (plazo !== null && !(Number.isInteger(plazo) && plazo >= 1 && plazo <= 730))
      return { muestras: [], error: `Muestra ${i + 1}: el plazo debe ser un número entero de días entre 1 y 730.` };
    const producto = (m.productoTexto ?? "").trim().slice(0, 300) || null;
    muestras.push({
      n: i + 1,
      descripcion: (m.descripcion ?? "").trim().slice(0, 300) || `Muestra ${i + 1}`,
      catElementoId: m.catElementoId || null,
      productoTexto: producto,
      plazoDias: plazo,
    });
  }
  return { muestras };
}

export interface LineaConMuestra {
  catEnsayoId?: string | null;
  ensayoCodigo?: string | null;
  descripcion?: string | null;
  muestraN?: number | null;
}

/**
 * Revisa que cada línea apunte a una muestra existente y que un ensayo no se
 * repita dentro de la misma muestra. Devuelve el primer error en palabras del
 * usuario, o null.
 */
export function validarLineasMuestras(lineas: LineaConMuestra[], nMuestras: number): string | null {
  const vistos = new Set<string>();
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    const m = l.muestraN;
    if (m == null) continue;
    if (!Number.isInteger(m) || m < 1) return `Línea ${i + 1}: la muestra indicada no es válida.`;
    if (nMuestras === 0) return `Línea ${i + 1}: indica la muestra ${m}, pero la cotización no tiene muestras registradas.`;
    if (m > nMuestras) return `Línea ${i + 1}: indica la muestra ${m}, pero la cotización tiene ${nMuestras} muestra${nMuestras === 1 ? "" : "s"}.`;
    if (l.catEnsayoId) {
      const clave = `${l.catEnsayoId}|${m}`;
      if (vistos.has(clave)) return `Línea ${i + 1}: el ensayo${l.ensayoCodigo ? ` ${l.ensayoCodigo}` : ""} ya está cotizado para la muestra ${m}.`;
      vistos.add(clave);
    }
  }
  return null;
}

/** Clave para no duplicar un ensayo al agregarlo (cotización compartida): ensayo + muestra. */
export const claveEnsayoMuestra = (catEnsayoId: string, muestraN?: number | null) => `${catEnsayoId}|${muestraN ?? ""}`;

/** «Muestra 2 · Agua potable» (o solo «Muestra 2»). */
export function etiquetaMuestra(m: Pick<Muestra, "n" | "descripcion" | "productoTexto">): string {
  const base = `Muestra ${m.n}`;
  const extra = [m.descripcion && m.descripcion !== base ? m.descripcion : null, m.productoTexto].filter(Boolean);
  return extra.length ? `${base} · ${extra.join(" · ")}` : base;
}

export interface ResumenMuestra {
  n: number;
  etiqueta: string;
  ensayos: number;
  subtotal: number;
  plazoDias: number | null;
}

/** Ensayos y subtotal de cada muestra (las líneas generales no cuentan en ninguna). */
export function resumenPorMuestra(muestras: Muestra[], lineas: { muestraN?: number | null; subtotal: number | string; catEnsayoId?: string | null }[]): ResumenMuestra[] {
  return muestras.map((m) => {
    const de = lineas.filter((l) => l.muestraN === m.n);
    return {
      n: m.n,
      etiqueta: etiquetaMuestra(m),
      ensayos: de.filter((l) => l.catEnsayoId).length,
      subtotal: de.reduce((s, l) => s + (Number(l.subtotal) || 0), 0),
      plazoDias: m.plazoDias,
    };
  });
}

/**
 * Texto del plazo para el documento y la pantalla. El plazo general y el de
 * cada muestra se cuentan desde la llegada de la muestra al laboratorio.
 */
export function textoPlazo(plazoDias: number | null | undefined, muestras: Pick<Muestra, "n" | "plazoDias">[] = []): string {
  const propios = muestras.filter((m) => m.plazoDias);
  if (!plazoDias && !propios.length) return "";
  const partes: string[] = [];
  if (plazoDias) partes.push(`${plazoDias} días corridos desde la llegada de la muestra al laboratorio`);
  for (const m of propios) partes.push(`muestra ${m.n}: ${m.plazoDias} días`);
  return `${partes.join("; ")}. Las fechas comprometidas quedan condicionadas a la entrega oportuna de las muestras.`;
}
