/**
 * Personas para selectores (Entrega/Recibe de custodia, responsable de equipo,
 * firmas, responsable de una no conformidad…).
 *
 * Usa GET /personas: abierto a cualquier usuario autenticado, acotado a su
 * alcance (sus unidades + roles transversales) y sin datos sensibles. No usar
 * /usuarios para esto: exige admin.usuarios y los selectores salían vacíos.
 */
export const RECURSO_PERSONAS = "personas";
export const URL_PERSONAS = "/personas?limit=500";

export interface Persona {
  id: string;
  nombreCompleto: string;
  nombre?: string;
  username: string;
  cargo?: string | null;
  grado?: string | null;
  unidades?: { codigo: string; nombre: string }[];
}

/** «Nombre · cargo · LQC» para un combo. */
export function etiquetaPersona(p: Partial<Persona> | null | undefined): string {
  if (!p) return "—";
  const unidades = (p.unidades ?? []).map((u) => u.codigo).join(", ");
  return [p.nombreCompleto ?? p.nombre ?? p.username, p.cargo, unidades].filter(Boolean).join(" · ");
}
