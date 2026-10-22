/**
 * SVM · Hoja de Control de Pruebas por vehículo (EP-05 4.6), pruebas dinámicas
 * (4.7), resumen de novedades (4.8) y regla de lote por clase (5.3) · reglas
 * PURAS, probadas en hcp.spec.ts.
 *
 *   · La HCP es una plantilla por tipo de vehículo (LVM-PG01-IT03-FORM02): ítems
 *     agrupados con su clase de defecto A (crítico) · B (mayor) · C (menor). Es
 *     configuración (Parámetros de la operación, `hcp_plantilla`); se siembra la
 *     del VLCB, la única recibida (EP-05 P16).
 *   · Cada vehículo seleccionado es una muestra de la OT: cabecera (inspectores,
 *     chasis, motor, km…) y un resultado C / N/C por ítem; N/C exige
 *     observación. Un ítem cuantitativo (giro, frenado, pendientes) se decide
 *     con su valor medido contra Mín/Máx.
 *   · Lote: por clase, se cuentan los vehículos con al menos una N/C de esa
 *     clase y se comparan con Ac/Re del plan NCh 44 (nivel y AQL por clase son
 *     parámetros, EP-05 P15). Clase A: una N/C rechaza el lote.
 *   · Cada grupo de la plantilla puede llevar el código del método del
 *     catálogo: el veredicto de esos ítems se lleva al resultado de ese método
 *     en la muestra (vehículo), y la captura estándar sigue igual para el resto.
 */
import { planDeClase, type Clase, type Nivel } from "./aql";

export type Veredicto = "cumple" | "no_cumple" | "pendiente";

export interface ItemHcp {
  item: string;
  grupo: string;
  subgrupo: string | null;
  requisito: string;
  cantidad: string | null;
  clase: Clase;
  /** Código del método del catálogo al que se lleva el veredicto (opcional). */
  metodo: string | null;
  /** Ítem cuantitativo: se decide con el valor contra Mín/Máx. */
  min: number | null;
  max: number | null;
  unidad: string | null;
}

export interface ResultadoItem {
  /** C (conforme) | NC (no conforme) */
  resultado?: "C" | "NC" | null;
  valor?: number | null;
  observacion?: string | null;
}

export interface CabeceraVehiculo {
  inspectores: string[];
  chasis: string;
  motor: string;
  anio?: number | null;
  lugar?: string | null;
  kmSalida?: number | null;
  kmLlegada?: number | null;
  fechaInicio?: string | null;
  fechaTermino?: string | null;
}

export interface InspeccionVehiculo {
  /** Nº del vehículo en la muestra (1..n). */
  numero: number;
  cabecera: CabeceraVehiculo;
  items: Record<string, ResultadoItem>;
}

/* --------------------------------------------------------------- plantilla --- */

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Lee una plantilla guardada como tabla (JSON). Filas sin ítem, requisito o clase válida se descartan. */
export function leerPlantilla(json: string | null | undefined): ItemHcp[] {
  if (!json) return [];
  let filas: unknown;
  try {
    filas = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(filas)) return [];
  const vistos = new Set<string>();
  const out: ItemHcp[] = [];
  for (const f of filas as any[]) {
    const item = String(f?.item ?? "").trim();
    const clase = String(f?.clase ?? "").trim().toUpperCase();
    const requisito = String(f?.requisito ?? "").trim();
    if (!item || !requisito || !["A", "B", "C"].includes(clase) || vistos.has(item)) continue;
    vistos.add(item);
    out.push({
      item,
      grupo: String(f?.grupo ?? "").trim() || "Sin grupo",
      subgrupo: String(f?.subgrupo ?? "").trim() || null,
      requisito,
      cantidad: String(f?.cantidad ?? "").trim() || null,
      clase: clase as Clase,
      metodo: String(f?.metodo ?? "").trim() || null,
      min: num(f?.min),
      max: num(f?.max),
      unidad: String(f?.unidad ?? "").trim() || null,
    });
  }
  return out;
}

export const esCuantitativo = (i: ItemHcp) => i.min != null || i.max != null;

/* --------------------------------------------------------------- vehículo --- */

export interface ItemEvaluado extends ItemHcp {
  resultado: "C" | "NC" | null;
  valor: number | null;
  observacion: string | null;
}

export interface VehiculoEvaluado {
  numero: number;
  items: ItemEvaluado[];
  respondidos: number;
  total: number;
  noConformes: ItemEvaluado[];
  ncPorClase: Record<Clase, number>;
  veredicto: Veredicto;
  /** inspeccionado | en_inspeccion | pendiente */
  estado: "inspeccionado" | "en_inspeccion" | "pendiente";
  errores: string[];
}

/** C/NC de un ítem: el cuantitativo se decide con su valor. */
function resolverItem(i: ItemHcp, r: ResultadoItem | undefined): Pick<ItemEvaluado, "resultado" | "valor" | "observacion"> {
  const valor = typeof r?.valor === "number" && Number.isFinite(r.valor) ? r.valor : null;
  const observacion = r?.observacion?.trim() || null;
  if (esCuantitativo(i) && valor != null) {
    const ok = (i.min == null || valor >= i.min) && (i.max == null || valor <= i.max);
    return { resultado: ok ? "C" : "NC", valor, observacion };
  }
  return { resultado: r?.resultado === "C" || r?.resultado === "NC" ? r.resultado : null, valor, observacion };
}

export function erroresCabecera(c: CabeceraVehiculo): string[] {
  const e: string[] = [];
  if (!c.inspectores?.filter((x) => x?.trim()).length) e.push("Indique los inspectores.");
  if (!c.chasis?.trim()) e.push("Indique el Nº de chasis.");
  if (!c.motor?.trim()) e.push("Indique el Nº de motor.");
  if (c.kmSalida != null && c.kmLlegada != null && c.kmLlegada < c.kmSalida) e.push("El kilometraje de llegada no puede ser menor que el de salida.");
  if (c.fechaInicio && c.fechaTermino && c.fechaTermino < c.fechaInicio) e.push("La fecha de término no puede ser anterior a la de inicio.");
  return e;
}

export function evaluarVehiculo(plantilla: ItemHcp[], v: InspeccionVehiculo): VehiculoEvaluado {
  const items: ItemEvaluado[] = plantilla.map((i) => ({ ...i, ...resolverItem(i, v.items[i.item]) }));
  const errores: string[] = [];
  for (const i of items) if (i.resultado === "NC" && !i.observacion) errores.push(`Ítem ${i.item}: la observación es obligatoria si no cumple.`);
  const desconocidos = Object.keys(v.items).filter((k) => !plantilla.some((i) => i.item === k));
  if (desconocidos.length) errores.push(`Ítems que no están en la plantilla: ${desconocidos.slice(0, 5).join(", ")}.`);
  const respondidos = items.filter((i) => i.resultado).length;
  const noConformes = items.filter((i) => i.resultado === "NC");
  const ncPorClase: Record<Clase, number> = { A: 0, B: 0, C: 0 };
  for (const i of noConformes) ncPorClase[i.clase]++;
  const completo = respondidos === items.length && items.length > 0;
  const veredicto: Veredicto = noConformes.length ? "no_cumple" : completo ? "cumple" : "pendiente";
  const cabeceraOk = erroresCabecera(v.cabecera).length === 0;
  const estado = completo && cabeceraOk && !errores.length ? "inspeccionado" : respondidos > 0 || cabeceraOk ? "en_inspeccion" : "pendiente";
  return { numero: v.numero, items, respondidos, total: items.length, noConformes, ncPorClase, veredicto, estado, errores };
}

/**
 * Veredicto de los ítems de un método en el vehículo (para llevarlo al
 * resultado de ese método en la muestra). null = la plantilla no liga ese método.
 */
export function veredictoMetodo(v: VehiculoEvaluado, metodo: string): { veredicto: Veredicto; observacion: string | null; items: number } | null {
  const propios = v.items.filter((i) => i.metodo === metodo);
  if (!propios.length) return null;
  const nc = propios.filter((i) => i.resultado === "NC");
  const completos = propios.every((i) => i.resultado);
  const veredicto: Veredicto = nc.length ? "no_cumple" : completos ? "cumple" : "pendiente";
  const observacion = nc.length
    ? `N/C en HCP: ${nc.map((i) => `${i.item} (clase ${i.clase}): ${i.observacion ?? i.requisito}`).join("; ")}`.slice(0, 1900)
    : completos ? `HCP: ${propios.length} ítem(s) conforme(s)` : null;
  return { veredicto, observacion, items: propios.length };
}

/* --------------------------------------------------------------- lote ----- */

export interface ConfigLoteSvm {
  nivel: Nivel;
  aqlA: string;
  aqlB: string;
  aqlC: string;
}

export interface LoteSvm {
  tamanoLote: number;
  /** Vehículos que se deben inspeccionar (n de la muestra). */
  muestra: number;
  inspeccionados: number;
  clases: { clase: Clase; aql: string; ac: number; re: number; vehiculosConNc: number; decision: "acepta" | "rechaza"; texto: string }[];
  veredicto: Veredicto;
  regla: string;
  errores: string[];
}

/**
 * Regla del lote (propuesta de la maqueta, AQL y Ac/Re POR CONFIRMAR): por
 * clase se cuentan los vehículos con alguna N/C de esa clase y se deciden con
 * Ac/Re del plan NCh 44 del lote. El lote cumple si acepta en las tres clases
 * y ya se inspeccionaron los n vehículos de la muestra.
 */
export function evaluarLoteSvm(tamanoLote: number, muestra: number, vehiculos: VehiculoEvaluado[], cfg: ConfigLoteSvm): LoteSvm {
  const errores: string[] = [];
  if (!Number.isInteger(tamanoLote) || tamanoLote < 1) errores.push("Indique el tamaño del lote.");
  if (!Number.isInteger(muestra) || muestra < 1) errores.push("Indique cuántos vehículos se inspeccionan (n).");
  if (muestra > tamanoLote) errores.push("La muestra no puede superar el lote.");
  const inspeccionados = vehiculos.filter((v) => v.estado === "inspeccionado").length;
  const clases: LoteSvm["clases"] = [];
  if (!errores.length) {
    for (const [clase, aql] of [["A", cfg.aqlA], ["B", cfg.aqlB], ["C", cfg.aqlC]] as [Clase, string][]) {
      let plan: { ac: number; re: number; texto: string };
      try {
        plan = planDeClase(Math.max(tamanoLote, 2), cfg.nivel, aql);
      } catch (e) {
        errores.push(`Clase ${clase}: ${(e as Error).message}`);
        continue;
      }
      const vehiculosConNc = vehiculos.filter((v) => v.ncPorClase[clase] > 0).length;
      clases.push({ clase, aql, ac: plan.ac, re: plan.re, vehiculosConNc, decision: vehiculosConNc <= plan.ac ? "acepta" : "rechaza", texto: plan.texto });
    }
  }
  const rechaza = clases.some((c) => c.decision === "rechaza");
  const veredicto: Veredicto = errores.length ? "pendiente" : rechaza ? "no_cumple" : inspeccionados >= muestra ? "cumple" : "pendiente";
  const regla = clases.map((c) => `Clase ${c.clase}: ${c.vehiculosConNc} vehículo(s) con N/C · Ac ${c.ac} / Re ${c.re} → ${c.decision === "acepta" ? "acepta" : "rechaza"}`).join(" · ");
  return { tamanoLote, muestra, inspeccionados, clases, veredicto, regla, errores };
}

/* ---------------------------------------------------------- novedades ----- */

export interface Novedad {
  vehiculo: number;
  chasis: string | null;
  item: string;
  clase: Clase;
  descripcion: string;
  accionProveedor: string | null;
}

/** Acta de novedades del lote: una fila por N/C de la HCP (EP-05 4.8). */
export function novedades(vehiculos: { evaluado: VehiculoEvaluado; chasis: string | null }[], acciones: Record<string, string> = {}): Novedad[] {
  return vehiculos
    .flatMap(({ evaluado, chasis }) =>
      evaluado.noConformes.map((i) => ({
        vehiculo: evaluado.numero,
        chasis,
        item: i.item,
        clase: i.clase,
        descripcion: `${i.requisito}${i.observacion ? ` — ${i.observacion}` : ""}`,
        accionProveedor: acciones[`${evaluado.numero}:${i.item}`]?.trim() || null,
      })),
    )
    .sort((a, b) => a.vehiculo - b.vehiculo || a.clase.localeCompare(b.clase) || a.item.localeCompare(b.item, "es", { numeric: true }));
}
