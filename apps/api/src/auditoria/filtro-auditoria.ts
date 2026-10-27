import { inicioDiaChile, sumarDiasCalendario } from "../common/fecha-chile";
/**
 * Filtro de la bitácora (audit_log) · RF-H04.3. Función PURA: arma el `where`
 * de Prisma a partir de los filtros de pantalla y del alcance del usuario.
 *
 * Alcance: un perfil global (dirección, calidad, administración, lector) ve
 * toda la bitácora. Una jefatura acotada (jefe de laboratorio, sección o
 * departamento) ve SOLO lo que hicieron las personas de sus unidades visibles
 * (`usuariosAlcance`) y lo suyo propio; nunca las acciones del sistema ni las
 * de otras unidades.
 */
export interface FiltrosAuditoria {
  recurso?: string;
  usuarioId?: string;
  username?: string;
  accion?: string;
  entidadId?: string;
  entidadCodigo?: string;
  desde?: Date;
  hasta?: Date;
}

/** 'AAAA-MM-DD' en «desde» es el comienzo de ese día en Chile (frente f8). */
export function inicioDelDia(valor: string | Date): Date {
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return inicioDiaChile(valor)!;
  return valor instanceof Date ? valor : new Date(valor);
}

/** 'AAAA-MM-DD' en «hasta» significa todo ese día en Chile: se lleva a su último instante. */
export function finDelDia(valor: string | Date): Date {
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return new Date(inicioDiaChile(sumarDiasCalendario(valor, 1))!.getTime() - 1);
  }
  return valor instanceof Date ? valor : new Date(valor);
}

export function whereAuditoria(
  f: FiltrosAuditoria,
  tenantId: string | undefined,
  usuariosAlcance: string[] | null,
): Record<string, any> {
  const and: Record<string, any>[] = [];
  if (tenantId) and.push({ tenantId });
  if (f.recurso) and.push({ entidadTipo: f.recurso });
  if (f.usuarioId) and.push({ usuarioId: f.usuarioId });
  if (f.username) and.push({ username: { contains: f.username, mode: "insensitive" } });
  if (f.accion) and.push({ accion: f.accion });
  if (f.entidadId) and.push({ entidadId: f.entidadId });
  if (f.entidadCodigo) and.push({ entidadCodigo: { contains: f.entidadCodigo, mode: "insensitive" } });
  if (f.desde || f.hasta) {
    and.push({ ocurridoAt: { ...(f.desde ? { gte: f.desde } : {}), ...(f.hasta ? { lte: f.hasta } : {}) } });
  }
  // null = sin restricción (perfil global). [] = solo lo propio (el servicio añade al usuario).
  if (usuariosAlcance) and.push({ usuarioId: { in: usuariosAlcance } });
  return and.length ? { AND: and } : {};
}
