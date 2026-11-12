/**
 * Plantilla que se propone al emitir el informe de una OT (F063). Las
 * plantillas no guardan su laboratorio, así que se deduce, en este orden:
 *   1. la plantilla propia del laboratorio por su código («PG09A2-LQC» → LQC);
 *   2. la que más ha usado el laboratorio en sus documentos emitidos;
 *   3. ninguna (el usuario la elige, como hasta ahora).
 * Una asociación oficial plantilla ↔ laboratorio queda pendiente del IDIC.
 */
export interface PlantillaCandidata {
  id: string;
  repid: string;
  activo?: boolean | null;
}

export function elegirPlantillaSugerida(
  laboratorio: string | null | undefined,
  plantillas: PlantillaCandidata[],
  usadas: { plantillaId: string; veces: number }[],
): { plantillaId: string; motivo: "codigo" | "uso" } | null {
  const vigentes = plantillas.filter((p) => p.activo !== false);
  const lab = String(laboratorio ?? "").trim().toUpperCase();
  if (lab) {
    const propia = vigentes.find((p) => String(p.repid ?? "").trim().toUpperCase().endsWith(`-${lab}`));
    if (propia) return { plantillaId: propia.id, motivo: "codigo" };
  }
  const ids = new Set(vigentes.map((p) => p.id));
  const mas = [...usadas].filter((u) => ids.has(u.plantillaId)).sort((a, b) => b.veces - a.veces)[0];
  return mas ? { plantillaId: mas.plantillaId, motivo: "uso" } : null;
}
