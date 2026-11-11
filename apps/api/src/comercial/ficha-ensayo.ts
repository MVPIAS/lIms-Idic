/**
 * Ficha de ensayo (Comercial, reunión 2 · 28-10-2026; modelo «Diseño de ficha de
 * ensayo.xlsx», EN202 Pinturas): el desglose de recursos de un ensayo del
 * catálogo en cinco bloques —personal, equipos, vehículos, insumos y otros
 * gastos— con cantidades, horas y valores. Se consulta y edita desde el
 * catálogo y se imprime en un PDF de formato estándar.
 *
 * La lista de precios 2026 trae solo el precio total; el desglose se completa
 * con el estudio de costos. Por eso los valores pueden quedar en blanco: la
 * ficha muestra entonces el costo directo como «incompleto» y no lo usa.
 *
 * Importe de un ítem = cantidad × horas (si las tiene) × valor unitario.
 * Costo directo = suma de los importes. Con él se arma la estructura oficial
 * del precio (estructura-precio.ts: CI 20 %, recargo 30 %, IVA 19 %).
 *
 * Funciones PURAS: ficha-ensayo.spec.ts.
 */
import { desdeCostoDirecto, type Estructura, type PctEstructura } from "../cotizacion/estructura-precio";

export const BLOQUES_FICHA = ["personal", "equipos", "vehiculos", "insumos", "otros"] as const;
export type BloqueFicha = (typeof BLOQUES_FICHA)[number];

export const TITULO_BLOQUE: Record<BloqueFicha, string> = {
  personal: "Personal (horas hombre)",
  equipos: "Equipos (horas máquina)",
  vehiculos: "Vehículos",
  insumos: "Insumos",
  otros: "Otros gastos",
};

export const MAX_ITEMS_FICHA = 200;

export interface ItemFicha {
  bloque: BloqueFicha | string;
  descripcion: string;
  /** Categoría HH, código de equipo, tipo de vehículo… */
  categoria?: string | null;
  cantidad?: number | null;
  unidad?: string | null;
  horas?: number | null;
  valorUnitario?: number | null;
}

const num = (v: unknown): number | null => (v === null || v === undefined || (v as any) === "" ? null : Number(v));

/** Errores de los ítems antes de guardar (vacío = OK). */
export function erroresFicha(items: ItemFicha[]): string[] {
  const e: string[] = [];
  if (items.length > MAX_ITEMS_FICHA) e.push(`Máximo ${MAX_ITEMS_FICHA} ítems por ficha.`);
  items.forEach((it, i) => {
    const n = `Ítem ${i + 1}`;
    if (!(BLOQUES_FICHA as readonly string[]).includes(it.bloque)) e.push(`${n}: bloque desconocido («${it.bloque}»).`);
    if (!(it.descripcion ?? "").trim()) e.push(`${n}: indique la descripción.`);
    const c = num(it.cantidad);
    if (c !== null && !(Number.isFinite(c) && c > 0)) e.push(`${n}: la cantidad debe ser mayor que 0.`);
    const h = num(it.horas);
    if (h !== null && !(Number.isFinite(h) && h >= 0)) e.push(`${n}: las horas no pueden ser negativas.`);
    const v = num(it.valorUnitario);
    if (v !== null && !(Number.isFinite(v) && v >= 0)) e.push(`${n}: el valor unitario no puede ser negativo.`);
  });
  return e;
}

/** Importe de un ítem, o null si falta el valor unitario. */
export function importeItem(it: ItemFicha): number | null {
  const v = num(it.valorUnitario);
  if (v === null) return null;
  const c = num(it.cantidad) ?? 1;
  const h = num(it.horas);
  return Math.round(c * (h === null ? 1 : h) * v * 100) / 100;
}

export interface TotalesFicha {
  porBloque: Record<BloqueFicha, { items: number; importe: number; sinValor: number }>;
  costoDirecto: number;
  /** Algún ítem sin valor: el costo directo está incompleto. */
  incompleto: boolean;
  /** Sin ningún ítem: la ficha aún no tiene desglose. */
  vacia: boolean;
  estructura: Estructura | null;
}

export function totalesFicha(items: ItemFicha[], pct?: PctEstructura): TotalesFicha {
  const porBloque = Object.fromEntries(BLOQUES_FICHA.map((b) => [b, { items: 0, importe: 0, sinValor: 0 }])) as TotalesFicha["porBloque"];
  let cd = 0;
  let sinValor = 0;
  for (const it of items) {
    const b = porBloque[it.bloque as BloqueFicha];
    if (!b) continue;
    b.items++;
    const imp = importeItem(it);
    if (imp === null) {
      b.sinValor++;
      sinValor++;
    } else {
      b.importe = Math.round((b.importe + imp) * 100) / 100;
      cd += imp;
    }
  }
  const costoDirecto = Math.round(cd * 100) / 100;
  const vacia = items.length === 0;
  const incompleto = sinValor > 0;
  return {
    porBloque,
    costoDirecto,
    incompleto,
    vacia,
    estructura: !vacia && !incompleto && costoDirecto > 0 ? desdeCostoDirecto(costoDirecto, pct) : null,
  };
}
