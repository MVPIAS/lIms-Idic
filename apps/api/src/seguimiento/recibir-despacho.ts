/**
 * fx5-c · F015 · Quién da por recibido un despacho · regla PURA
 * (recibir-despacho.spec.ts).
 *
 * El documento final del BPCH se remite a DCO y lo entrega Comercial (sesión
 * R4): «Dar por recibido el despacho» lo registra el destino, no quien remitió.
 *  · DCO: Comercial (roles Comercial o Planificación, o quien tiene el
 *    Departamento Comercial en su alcance);
 *  · BPCH: la Sección Certificación de la Conformidad (o la jefatura del BPCH);
 *  · laboratorio solicitante: quien tiene esa unidad en su alcance;
 *  · cliente u otro destino: quien entrega (permiso certificado.entregar).
 * Siempre hace falta además certificado.entregar (lo exige la ruta).
 */

export const UNIDADES_COMERCIAL = ["DCO", "COM"] as const;
export const ROLES_COMERCIAL = ["COMERCIAL", "PLANIFICACION"] as const;

export interface Receptor {
  roles: string[];
  /** Códigos de las unidades visibles del usuario. */
  unidades: string[];
}

export function puedeRecibirDespacho(destino: string | null | undefined, u: Receptor, unidadDestino?: string | null): boolean {
  if (u.roles.includes("SUPERADMIN")) return true;
  const tiene = (cods: readonly string[]) => u.unidades.some((c) => cods.includes(c.toUpperCase()));
  switch (destino) {
    case "DCO":
      return u.roles.some((r) => (ROLES_COMERCIAL as readonly string[]).includes(r)) || tiene(UNIDADES_COMERCIAL);
    case "BPCH":
      return tiene(["SCC", "BPCH"]);
    case "LAB_SOLICITANTE":
      return !!unidadDestino && tiene([unidadDestino.toUpperCase()]);
    default:
      return true;
  }
}

export const MSG_RECIBIR_DESPACHO: Record<string, string> = {
  DCO: "El despacho a DCO lo da por recibido Comercial, que luego entrega el documento al cliente.",
  BPCH: "El despacho al Banco de Pruebas lo da por recibido la Sección Certificación de la Conformidad.",
  LAB_SOLICITANTE: "El despacho lo da por recibido el laboratorio solicitante.",
};
