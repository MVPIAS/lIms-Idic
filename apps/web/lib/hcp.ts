/**
 * Hoja de Control de Pruebas (HCP) por vehículo · reglas de pantalla. El servidor
 * (apps/api/src/formularios/hcp.ts › evaluarVehiculo) decide; aquí solo se adelanta
 * lo que va a rechazar para llevar al usuario al campo (F087).
 */
export interface ItemHcpPantalla { item: string; min: number | null; max: number | null }
export interface RespuestaHcp { resultado?: "C" | "NC" | null; valor?: number | null; valorTxt?: string; observacion?: string | null }

const leer = (r: RespuestaHcp): number | null => {
  if (r.valorTxt !== undefined) {
    const t = r.valorTxt.trim().replace(/\s/g, "");
    return /^-?\d+([.,]\d+)?$/.test(t) ? Number(t.replace(",", ".")) : null;
  }
  return r.valor ?? null;
};

/** ¿El ítem no cumple? Cuantitativo: el valor fuera de Mín/Máx; cualitativo: marcado N/C. */
export function itemNoCumple(it: ItemHcpPantalla, r: RespuestaHcp | undefined): boolean {
  if (!r) return false;
  if (it.min != null || it.max != null) {
    const v = leer(r);
    return v != null && Number.isFinite(v) && !((it.min == null || v >= it.min) && (it.max == null || v <= it.max));
  }
  return r.resultado === "NC";
}

/** ¿Falta la observación obligatoria del ítem que no cumple? */
export const faltaObservacion = (it: ItemHcpPantalla, r: RespuestaHcp | undefined) => itemNoCumple(it, r) && !String(r?.observacion ?? "").trim();

/** Primer ítem (en el orden de la hoja) que no cumple y no tiene observación, o null. */
export function primerItemSinObservacion(items: ItemHcpPantalla[], res: Record<string, RespuestaHcp | undefined>): string | null {
  return items.find((it) => faltaObservacion(it, res[it.item]))?.item ?? null;
}
