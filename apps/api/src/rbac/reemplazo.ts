/**
 * Reemplazos temporales (sesión LME del 02-11-2026, R8: «si un analista reemplaza al
 * jefe para cotizar, el administrador podrá darle permisos temporales»).
 *
 * El administrador indica quién reemplaza a quién, desde y hasta cuándo y por qué. El
 * LIMS copia al reemplazante, con esa vigencia, los roles VIGENTES del reemplazado en
 * sus unidades y, si es jefe titular o subrogante de una unidad (Administración ›
 * Estructura), el rol de jefatura de esa unidad. Al vencer la vigencia, los permisos
 * dejan de valer solos (las asignaciones ya se filtran por vigencia en todo el LIMS:
 * permisos, alcance y matriz de firmas). Se puede terminar antes («revocar»).
 *
 * Funciones PURAS: reemplazo.spec.ts.
 */

export interface AsignacionOrigen { rolId: string; rolCodigo: string; unidadId: string | null; vigenteDesde?: Date | string | null; vigenteHasta?: Date | string | null }
export interface JefaturaOrigen { unidadId: string; unidadTipo: string | null }
export interface FilaReemplazo { rolId: string; rolCodigo: string; unidadId: string | null; origen: "rol" | "jefatura" }

/** Rol de jefatura que corresponde al tipo de unidad del organigrama. */
export const ROL_JEFATURA_POR_TIPO: Record<string, string> = {
  LABORATORIO: "JEFE_LAB",
  SECCION: "JEFE_SECCION",
  DEPARTAMENTO: "JEFE_DEPTO",
};

/** Roles que no se traspasan nunca por reemplazo (administración del sistema). */
export const ROLES_NO_TRASPASABLES = ["SUPERADMIN", "ADMIN"];

const vigenteEn = (a: AsignacionOrigen, ahora: Date) => {
  const d = a.vigenteDesde ? new Date(a.vigenteDesde) : null;
  const h = a.vigenteHasta ? new Date(a.vigenteHasta) : null;
  return (!d || d <= ahora) && (!h || h > ahora);
};
const clave = (rolId: string, unidadId: string | null) => `${rolId}|${unidadId ?? ""}`;

/**
 * Filas de usuario_rol que se crean para el reemplazante: roles vigentes del
 * reemplazado (sin los de administración) y la jefatura de las unidades que dirige,
 * sin repetir lo que el reemplazante ya tiene en la misma unidad.
 */
export function filasReemplazo(p: {
  asignaciones: AsignacionOrigen[];
  jefaturas: JefaturaOrigen[];
  rolesPorCodigo: Map<string, string>;
  yaTiene: { rolId: string; unidadId: string | null }[];
  ahora?: Date;
}): FilaReemplazo[] {
  const ahora = p.ahora ?? new Date();
  const ya = new Set(p.yaTiene.map((x) => clave(x.rolId, x.unidadId)));
  const out: FilaReemplazo[] = [];
  const agregar = (f: FilaReemplazo) => {
    const k = clave(f.rolId, f.unidadId);
    if (ya.has(k)) return;
    ya.add(k);
    out.push(f);
  };
  for (const a of p.asignaciones) {
    if (ROLES_NO_TRASPASABLES.includes(a.rolCodigo) || !vigenteEn(a, ahora)) continue;
    agregar({ rolId: a.rolId, rolCodigo: a.rolCodigo, unidadId: a.unidadId, origen: "rol" });
  }
  for (const j of p.jefaturas) {
    const codigo = j.unidadTipo ? ROL_JEFATURA_POR_TIPO[j.unidadTipo] : undefined;
    const rolId = codigo ? p.rolesPorCodigo.get(codigo) : undefined;
    if (codigo && rolId) agregar({ rolId, rolCodigo: codigo, unidadId: j.unidadId, origen: "jefatura" });
  }
  return out;
}

/** Errores de lo pedido (lista vacía = válido). */
export function erroresReemplazo(d: { reemplazanteId: string; reemplazadoId: string; desde: Date; hasta: Date; motivo: string }, ahora: Date = new Date()): string[] {
  const e: string[] = [];
  if (d.reemplazanteId === d.reemplazadoId) e.push("Una persona no se reemplaza a sí misma.");
  if (!(d.hasta > d.desde)) e.push("La fecha de término debe ser posterior a la de inicio.");
  if (d.hasta <= ahora) e.push("La fecha de término ya pasó.");
  const dias = (d.hasta.getTime() - d.desde.getTime()) / 86_400_000;
  if (dias > 366) e.push("Un reemplazo temporal dura como máximo un año.");
  if (d.motivo.trim().length < 5) e.push("Indique el motivo del reemplazo (mínimo 5 caracteres).");
  return e;
}
