/**
 * Lista de OT con búsqueda, filtros y paginación en el servidor · LIMS IDIC.
 * Antes `GET /ot` devolvía las 50 más recientes sin filtro: las tarjetas de
 * Mi bandeja («OT vencidas», «OT asignadas a mí»…) abrían la lista entera y las
 * OT antiguas no se podían encontrar. Función PURA: lista-ot.spec.ts.
 */

/** Estados de OT que ya no requieren trabajo de laboratorio (igual que la bandeja). */
export const OT_TERMINADAS = ["cerrada", "anulada", "finalizada", "informada"];

export interface QueryListaOt {
  q?: string;
  search?: string;
  estado?: string;
  /** id de unidad (uuid) ya resuelto desde el código si hacía falta */
  unidadId?: string | null;
  sinLaboratorio?: boolean;
  vencidas?: boolean;
  porVencer?: boolean;
  /** ids de OT asignadas al usuario (filtro «Mis OT»), ya calculados */
  idsMias?: string[] | null;
  /** ids de OT que YA tienen analista (filtro «sin analista»), ya calculados */
  idsConAnalista?: string[] | null;
}

export interface ContextoListaOt {
  tenantId?: string;
  /** null = sin filtro (alcance global) */
  unidadesVisibles: string[] | null;
  hoy: Date;
}

const dia = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** `where` de Prisma para la lista. Todas las condiciones se combinan con AND. */
export function filtroListaOt(q: QueryListaOt, ctx: ContextoListaOt): Record<string, any> {
  const and: Record<string, any>[] = [];
  if (ctx.tenantId) and.push({ tenantId: ctx.tenantId });
  if (ctx.unidadesVisibles) and.push({ unidadPrincipal: { in: ctx.unidadesVisibles } });

  const texto = (q.q ?? q.search ?? "").trim();
  if (texto) {
    const c = { contains: texto, mode: "insensitive" };
    and.push({
      OR: [
        { codigo: c },
        { cotizacionNumero: c },
        { numeroLey: c },
        { ocNumero: c },
        { cliente: { razonSocial: c } },
        { unidad: { codigo: c } },
      ],
    });
  }

  if (q.estado === "abiertas") and.push({ estado: { notIn: OT_TERMINADAS } });
  else if (q.estado) and.push({ estado: q.estado });

  if (q.sinLaboratorio) and.push({ unidadPrincipal: null });
  else if (q.unidadId) and.push({ unidadPrincipal: q.unidadId });

  const hoy = dia(ctx.hoy);
  if (q.vencidas) and.push({ estado: { notIn: OT_TERMINADAS }, fechaCompromiso: { lt: hoy } });
  if (q.porVencer) {
    const en3 = new Date(hoy.getTime() + 3 * 86_400_000);
    and.push({ estado: { notIn: OT_TERMINADAS }, fechaCompromiso: { gte: hoy, lte: en3 } });
  }

  if (q.idsMias) and.push({ id: { in: q.idsMias } });
  if (q.idsConAnalista) and.push({ id: { notIn: q.idsConAnalista } });

  return and.length ? { AND: and } : {};
}

/** page/limit saneados: page ≥ 1, 1 ≤ limit ≤ 200 (por defecto 20). */
export function paginacion(page?: string | number, limit?: string | number): { page: number; limit: number; skip: number } {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const l = Math.min(200, Math.max(1, Math.floor(Number(limit) || 20)));
  return { page: p, limit: l, skip: (p - 1) * l };
}
