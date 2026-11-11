/**
 * Bodegas de consumibles · reglas PURAS (sin BD), probadas en bodegas.spec.ts.
 *
 * Contrato 4.4.4 y 4.4.5; reuniones R1 (Comercial) y R5 (Abastecimiento):
 *   · Una bodega central (Abastecimiento) y una sub-bodega por laboratorio.
 *   · Cada lote de consumible está en una bodega; el inventario se valoriza por
 *     lote (precio de compra del lote o, si falta, costo de referencia del
 *     consumible). El IDIC aún no entrega el costo de los insumos: un lote sin
 *     costo queda «sin valorizar» (Pendiente del IDIC) en vez de valer cero.
 *   · El consumo de un ensayo sale primero de la sub-bodega de su laboratorio
 *     (parámetro consumibles.bodega_consumo) y queda ligado al ensayo y a la OT.
 *   · Un traspaso entre bodegas mueve stock de un lote a otro lote con el mismo
 *     número en la bodega de destino.
 */

export const TIPOS_BODEGA = ["central", "laboratorio"] as const;
export type TipoBodega = (typeof TIPOS_BODEGA)[number];

export const MODOS_CONSUMO = ["laboratorio_primero", "solo_laboratorio", "todas"] as const;
export type ModoConsumo = (typeof MODOS_CONSUMO)[number];

export const ETIQUETA_MODO_CONSUMO: Record<ModoConsumo, string> = {
  laboratorio_primero: "Primero la sub-bodega del laboratorio y luego la bodega central",
  solo_laboratorio: "Solo la sub-bodega del laboratorio",
  todas: "Cualquier bodega (sin preferencia)",
};

export function modoConsumo(valor: unknown): ModoConsumo {
  const v = String(valor ?? "").trim().toLowerCase();
  return (MODOS_CONSUMO as readonly string[]).includes(v) ? (v as ModoConsumo) : "laboratorio_primero";
}

export interface BodegaDeLote {
  tipo: TipoBodega | null;
  unidadId: string | null;
}

/**
 * Prioridad de un lote para un consumo (menor = antes; null = no se usa).
 * `labs` = laboratorios del ensayo (el del método y el responsable de la OT);
 * vacío si no se sabe.
 *   0 · sub-bodega de uno de esos laboratorios
 *   1 · bodega central o lote sin bodega
 *   2 · sub-bodega de otro laboratorio (solo si no se sabe el laboratorio o el modo es «todas»)
 */
export function prioridadLote(b: BodegaDeLote, labs: string[], modo: ModoConsumo): number | null {
  if (modo === "todas") return 0;
  const propia = b.tipo === "laboratorio" && !!b.unidadId && labs.includes(b.unidadId);
  if (propia) return 0;
  const central = b.tipo !== "laboratorio";
  if (modo === "solo_laboratorio") return labs.length === 0 && central ? 1 : null;
  if (central) return 1;
  return labs.length === 0 ? 2 : null;
}

/**
 * Ordena los lotes (ya en orden FIFO de caducidad) por bodega, sin romper el
 * FIFO dentro de cada prioridad, y descarta los que no corresponden.
 */
export function ordenarLotesPorBodega<T extends BodegaDeLote>(lotes: T[], labs: string[], modo: ModoConsumo): T[] {
  return lotes
    .map((l, i) => ({ l, i, p: prioridadLote(l, labs, modo) }))
    .filter((x) => x.p !== null)
    .sort((a, b) => (a.p as number) - (b.p as number) || a.i - b.i)
    .map((x) => x.l);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface LoteValorizable {
  cantidad: number;
  /** Precio de compra del lote (CLP por unidad de consumo). */
  costoLote: number | null;
  /** Costo de referencia del consumible. */
  costoConsumible: number | null;
}

export type FuenteCosto = "lote" | "consumible" | "pendiente";

/** Costo unitario con el que se valoriza un lote y de dónde sale. */
export function costoUnitarioLote(l: Pick<LoteValorizable, "costoLote" | "costoConsumible">): { costo: number | null; fuente: FuenteCosto } {
  const ok = (v: unknown) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;
  if (ok(l.costoLote)) return { costo: Number(l.costoLote), fuente: "lote" };
  if (ok(l.costoConsumible) && Number(l.costoConsumible) > 0) return { costo: Number(l.costoConsumible), fuente: "consumible" };
  return { costo: null, fuente: "pendiente" };
}

export function valorLote(l: LoteValorizable): { costoUnitario: number | null; fuente: FuenteCosto; valor: number | null } {
  const { costo, fuente } = costoUnitarioLote(l);
  return { costoUnitario: costo, fuente, valor: costo === null ? null : r2(Math.max(0, Number(l.cantidad) || 0) * costo) };
}

export interface ResumenInventario {
  lotes: number;
  valorizado: number;
  /** Lotes con stock y sin costo (ni del lote ni del consumible): Pendiente del IDIC. */
  sinCosto: number;
}

export function resumenInventario(lotes: LoteValorizable[]): ResumenInventario {
  let valorizado = 0;
  let sinCosto = 0;
  for (const l of lotes) {
    const v = valorLote(l);
    if (v.valor === null) {
      if ((Number(l.cantidad) || 0) > 0) sinCosto++;
    } else valorizado += v.valor;
  }
  return { lotes: lotes.length, valorizado: r2(valorizado), sinCosto };
}

/**
 * Costo de los consumos de una OT o de un ensayo: Σ cantidad × costo del lote
 * del que salió. Devuelve también cuánto quedó sin valorizar.
 */
export function costoConsumos(consumos: (LoteValorizable & { cantidad: number })[]): { total: number; cantidad: number; sinCosto: number; costoPromedio: number | null } {
  let total = 0;
  let cantidad = 0;
  let cantValorizada = 0;
  let sinCosto = 0;
  for (const c of consumos) {
    const q = Math.abs(Number(c.cantidad) || 0);
    cantidad += q;
    const { costo } = costoUnitarioLote(c);
    if (costo === null) sinCosto += q;
    else {
      total += q * costo;
      cantValorizada += q;
    }
  }
  return {
    total: r2(total),
    cantidad: Math.round(cantidad * 1e6) / 1e6,
    sinCosto: Math.round(sinCosto * 1e6) / 1e6,
    costoPromedio: cantValorizada > 0 ? r2(total / cantValorizada) : null,
  };
}

export interface Traspaso {
  cantidad: number;
  stockOrigen: number;
  bodegaOrigenId: string | null;
  bodegaDestinoId: string;
  destinoActiva: boolean;
  loteVencido: boolean;
}

/** Errores de un traspaso entre bodegas (lista vacía = se puede). */
export function erroresTraspaso(t: Traspaso): string[] {
  const e: string[] = [];
  if (!Number.isFinite(t.cantidad) || t.cantidad <= 0) e.push("La cantidad a traspasar debe ser mayor que cero.");
  else if (t.cantidad > t.stockOrigen + 1e-9) e.push(`El lote solo tiene ${t.stockOrigen} en la bodega de origen.`);
  if (t.bodegaOrigenId && t.bodegaOrigenId === t.bodegaDestinoId) e.push("La bodega de destino es la misma del lote.");
  if (!t.destinoActiva) e.push("La bodega de destino está inactiva.");
  if (t.loteVencido) e.push("El lote está vencido: no se traspasa (dé de baja el stock con un ajuste).");
  return e;
}

/** Errores del alta o la edición de una bodega. */
export function erroresBodega(b: { tipo?: string; unidadId?: string | null; codigo?: string; nombre?: string }, yaHayCentral: boolean): string[] {
  const e: string[] = [];
  if (b.tipo !== undefined && !(TIPOS_BODEGA as readonly string[]).includes(b.tipo)) e.push("Tipo de bodega: central o laboratorio.");
  if (b.tipo === "laboratorio" && !b.unidadId) e.push("Una sub-bodega indica su laboratorio.");
  if (b.tipo === "central" && b.unidadId) e.push("La bodega central no pertenece a un laboratorio.");
  if (b.tipo === "central" && yaHayCentral) e.push("Ya existe la bodega central: solo hay una.");
  if (b.codigo !== undefined && !b.codigo.trim()) e.push("Indique el código de la bodega.");
  if (b.nombre !== undefined && !b.nombre.trim()) e.push("Indique el nombre de la bodega.");
  return e;
}
