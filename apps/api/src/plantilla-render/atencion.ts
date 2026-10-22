/**
 * «Atención» del informe ({{ot.solicitante}} / {{atencion}}) · regla PURA.
 *
 * Recorrido MP-02, D02-30: el campo salía vacío aunque el cliente tenía contacto
 * principal, porque solo se leía el solicitante de la OT y una OT nacida de una
 * cotización no lo trae. Orden de preferencia:
 *   1. el solicitante (contacto) indicado en la OT;
 *   2. el contacto principal de la ficha del cliente (contacto_nombre, EP-00 0.1);
 *   3. el contacto marcado como principal en la lista de contactos del cliente.
 * Si hay cargo, se añade tras una coma («J. P., Jefe de Calidad»).
 */
export interface FuentesAtencion {
  solicitanteOt?: string | null;
  fichaCliente?: { contactoNombre?: string | null; contactoCargo?: string | null } | null;
  contactoPrincipal?: { nombre?: string | null; cargo?: string | null } | null;
}

const limpio = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function atencionInforme(f: FuentesAtencion): string {
  const ot = limpio(f.solicitanteOt);
  if (ot) return ot;
  const conCargo = (nombre: string, cargo: string) => (cargo ? `${nombre}, ${cargo}` : nombre);
  const ficha = limpio(f.fichaCliente?.contactoNombre);
  if (ficha) return conCargo(ficha, limpio(f.fichaCliente?.contactoCargo));
  const principal = limpio(f.contactoPrincipal?.nombre);
  if (principal) return conCargo(principal, limpio(f.contactoPrincipal?.cargo));
  return "";
}
