/**
 * Vínculo de un movimiento de consumible con el trabajo del laboratorio
 * (contrato §4.4.5) · funciones PURAS, probadas en vinculo-movimiento.spec.ts.
 *
 * Todo movimiento de un lote (manual o automático) puede quedar ligado a una
 * OT, a una muestra, a un método y a una actividad. El descuento automático
 * de la captura lo hace siempre (muestra + método + OT de la muestra +
 * «análisis»); en el registro manual el vínculo es opcional.
 */

/** Actividades en que se usa un consumible (CHECK ck_mov_consumible_actividad). */
export const ACTIVIDADES = {
  analisis: "Análisis",
  preparacion: "Preparación de muestras o soluciones",
  control_calidad: "Control de calidad",
  calibracion: "Calibración / verificación de equipos",
  mantencion: "Mantención de equipos",
  limpieza: "Limpieza",
  muestreo: "Muestreo",
  otro: "Otro",
} as const;
export type Actividad = keyof typeof ACTIVIDADES;
export const CODIGOS_ACTIVIDAD = Object.keys(ACTIVIDADES) as Actividad[];

/** Lo que se sabe de la muestra elegida (su OT). */
export interface MuestraVinculo {
  id: string;
  codigo: string;
  otId: string | null;
  otCodigo: string | null;
}

export class VinculoError extends Error {}

/**
 * OT efectiva del movimiento: la indicada o, si no se indicó, la de la muestra.
 * Si se indican las dos, la muestra tiene que ser de esa OT.
 */
export function otDelMovimiento(otId: string | null | undefined, muestra: MuestraVinculo | null): string | null {
  if (!muestra) return otId ?? null;
  if (otId && muestra.otId && otId !== muestra.otId)
    throw new VinculoError(`La muestra ${muestra.codigo} es de la OT ${muestra.otCodigo ?? "—"}, no de la OT elegida.`);
  return otId ?? muestra.otId ?? null;
}

/**
 * Regla de la actividad: un consumo ligado a una muestra o a un método es, por
 * defecto, de análisis; un movimiento sin vínculo puede quedar sin actividad.
 */
export function actividadDelMovimiento(
  actividad: string | null | undefined,
  vinculo: { muestraId?: string | null; catMetodoId?: string | null },
): Actividad | null {
  if (actividad) {
    if (!(CODIGOS_ACTIVIDAD as string[]).includes(actividad))
      throw new VinculoError(`Actividad desconocida «${actividad}». Elija una de la lista.`);
    return actividad as Actividad;
  }
  return vinculo.muestraId || vinculo.catMetodoId ? "analisis" : null;
}

/** Total consumido por consumible en una OT (solo los asientos de «consumo»). */
export function resumenConsumos(
  movimientos: { tipo: string; cantidad: number | string; consumible_codigo: string; consumible_nombre: string; unidad_medida: string | null }[],
): { consumible: string; unidad: string | null; cantidad: number; movimientos: number }[] {
  const porConsumible = new Map<string, { consumible: string; unidad: string | null; cantidad: number; movimientos: number }>();
  for (const m of movimientos) {
    if (m.tipo !== "consumo") continue;
    const t = porConsumible.get(m.consumible_codigo) ?? { consumible: `${m.consumible_codigo} · ${m.consumible_nombre}`, unidad: m.unidad_medida, cantidad: 0, movimientos: 0 };
    t.cantidad = Math.round((t.cantidad + Number(m.cantidad)) * 1e6) / 1e6;
    t.movimientos++;
    porConsumible.set(m.consumible_codigo, t);
  }
  return [...porConsumible.values()].sort((a, b) => a.consumible.localeCompare(b.consumible, "es"));
}
