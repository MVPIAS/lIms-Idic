/**
 * Reglas puras del CRM (EP-00 0.3, BL-173) · probadas en reglas-crm.spec.ts.
 */

/** Código OPP-AAAA-NNNN con el año en curso (antes estaba fijo en 2026). */
export function siguienteCodigoOportunidad(ultimo: string | null | undefined, anio: number): string {
  const m = ultimo ? /^OPP-(\d{4})-(\d+)$/.exec(ultimo) : null;
  const n = m && Number(m[1]) === anio ? Number(m[2]) + 1 : 1;
  return `OPP-${anio}-${String(n).padStart(4, "0")}`;
}

/**
 * ¿Ve (o actúa sobre) la oportunidad? `visibles` null = alcance global. Quien
 * tiene el Departamento Comercial (DCO) en su alcance las ve todas, como las
 * cotizaciones; el resto, solo las de sus laboratorios. Una oportunidad sin
 * laboratorio es solo de Comercial.
 */
export function oportunidadEnAlcance(visibles: string[] | null, unidadId: string | null | undefined, dcoId: string | null): boolean {
  if (visibles === null) return true;
  if (dcoId && visibles.includes(dcoId)) return true;
  return !!unidadId && visibles.includes(unidadId);
}

/** Etapa y estado de la oportunidad cuando su cotización avanza. */
export function etapaPorCotizacion(evento: "creada" | "aceptada" | "anulada"): { etapa: string; estado: string } {
  if (evento === "aceptada") return { etapa: "ganada", estado: "ganada" };
  if (evento === "anulada") return { etapa: "negociacion", estado: "viva" };
  return { etapa: "propuesta", estado: "viva" };
}
