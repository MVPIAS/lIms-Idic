// Estados del equipo y su etiqueta (RF-D04). Fuente única para las pantallas
// Equipos y Mantención; la API usa las mismas etiquetas en el reporte de
// gestión (apps/api/src/equipos/plan-mantencion.ts › ETIQUETA_ESTADO_EQUIPO).

export const ESTADOS_EQUIPO: { key: string; label: string; pill: string }[] = [
  { key: "operativo", label: "Operativo", pill: "green" },
  { key: "en_calibracion", label: "En calibración", pill: "amber" },
  { key: "fuera_servicio", label: "Fuera de servicio", pill: "red" },
];
export const ESTADO_EQUIPO_META: Record<string, { key: string; label: string; pill: string }> = Object.fromEntries(ESTADOS_EQUIPO.map((e) => [e.key, e]));
