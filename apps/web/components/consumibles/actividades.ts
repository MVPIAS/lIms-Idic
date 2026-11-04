// Actividades en que se usa un consumible (contrato §4.4.5). Misma lista que
// apps/api/src/consumibles/vinculo-movimiento.ts (CHECK ck_mov_consumible_actividad).
export const ACTIVIDADES: Record<string, string> = {
  analisis: "Análisis",
  preparacion: "Preparación de muestras o soluciones",
  control_calidad: "Control de calidad",
  calibracion: "Calibración / verificación de equipos",
  mantencion: "Mantención de equipos",
  limpieza: "Limpieza",
  muestreo: "Muestreo",
  otro: "Otro",
};

/** OT · muestra · método de un asiento del kardex, en una línea. */
export function textoVinculo(m: { ot_codigo?: string | null; muestra_codigo?: string | null; metodo_codigo?: string | null; metodo_nombre?: string | null }): string {
  return [
    m.ot_codigo ? `OT ${m.ot_codigo}` : null,
    m.muestra_codigo ? `muestra ${m.muestra_codigo}` : null,
    m.metodo_codigo || m.metodo_nombre ? `método ${[m.metodo_codigo, m.metodo_nombre].filter(Boolean).join(" · ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
