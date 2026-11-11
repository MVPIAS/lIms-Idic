/**
 * Selector de perfil para personas con jefaturas duales (Comercial, R1 del
 * 27-10-2026: «pantalla inicial para elegir perfil cuando una persona tiene
 * jefaturas duales»; p. ej. Jefe SVT que además subroga al Jefe DCO).
 *
 * Un «perfil» es una unidad del organigrama donde la persona tiene roles o una
 * jefatura. Con un perfil activo, el LIMS trabaja solo con las asignaciones de
 * esa unidad (más las que no dependen de una unidad, que valen en todos los
 * perfiles) y con su jefatura: permisos, alcance, bandeja y firmas quedan en ese
 * papel. Sin perfil activo, todo como siempre (la unión de sus asignaciones).
 *
 * Funciones PURAS: perfil-activo.spec.ts.
 */

export interface AsignacionPerfil { unidadId: string | null; rolCodigo: string; rolNombre?: string | null }
export interface JefaturaPerfil { unidadId: string; rol: string }
export interface UnidadPerfil { id: string; codigo: string; nombre: string; tipo?: string | null }

export interface OpcionPerfil {
  unidadId: string;
  codigo: string;
  nombre: string;
  /** Roles en la unidad (nombres) y jefatura (titular / subrogante) si la tiene. */
  roles: string[];
  jefatura: "titular" | "subrogante" | null;
  etiqueta: string;
}

/**
 * Perfiles que la persona puede elegir: uno por unidad con roles o jefatura. Solo
 * tiene sentido ofrecerlos si hay al menos dos (`hayVarios`).
 */
export function opcionesPerfil(asignaciones: AsignacionPerfil[], jefaturas: JefaturaPerfil[], unidad: (id: string) => UnidadPerfil | null | undefined): OpcionPerfil[] {
  const ids = new Set<string>();
  asignaciones.forEach((a) => a.unidadId && ids.add(a.unidadId));
  jefaturas.forEach((j) => ids.add(j.unidadId));
  const out: OpcionPerfil[] = [];
  for (const id of ids) {
    const u = unidad(id);
    if (!u) continue;
    const roles = [...new Set(asignaciones.filter((a) => a.unidadId === id).map((a) => a.rolNombre || a.rolCodigo))];
    const jf = jefaturas.find((j) => j.unidadId === id && j.rol === "titular") ?? jefaturas.find((j) => j.unidadId === id);
    const jefatura = jf ? (jf.rol === "titular" ? "titular" : "subrogante") : null;
    const papel = jefatura ? `Jefatura${jefatura === "subrogante" ? " (subrogante)" : ""}` : roles.join(", ");
    out.push({ unidadId: id, codigo: u.codigo, nombre: u.nombre, roles, jefatura, etiqueta: `${papel} · ${u.codigo} ${u.nombre}` });
  }
  // Primero las jefaturas titulares, luego subrogancias y el resto, por código.
  const peso = (o: OpcionPerfil) => (o.jefatura === "titular" ? 0 : o.jefatura === "subrogante" ? 1 : 2);
  return out.sort((a, b) => peso(a) - peso(b) || a.codigo.localeCompare(b.codigo));
}

export const hayVariosPerfiles = (opciones: OpcionPerfil[]) => opciones.length >= 2;

/**
 * Asignaciones y jefaturas que valen con el perfil activo. Si el perfil ya no
 * corresponde (le quitaron ese rol o esa jefatura), se ignora y vale todo.
 */
export function aplicarPerfil<A extends { unidadId: string | null }, J extends { unidadId: string }>(
  unidadActiva: string | null | undefined,
  asignaciones: A[],
  jefaturas: J[],
): { asignaciones: A[]; jefaturas: J[]; aplicado: boolean } {
  if (!unidadActiva) return { asignaciones, jefaturas, aplicado: false };
  const tiene = asignaciones.some((a) => a.unidadId === unidadActiva) || jefaturas.some((j) => j.unidadId === unidadActiva);
  if (!tiene) return { asignaciones, jefaturas, aplicado: false };
  return {
    asignaciones: asignaciones.filter((a) => a.unidadId === unidadActiva || a.unidadId == null),
    jefaturas: jefaturas.filter((j) => j.unidadId === unidadActiva),
    aplicado: true,
  };
}
