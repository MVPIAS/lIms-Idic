/**
 * Lista de OT con búsqueda, filtros y paginación en el servidor · LIMS IDIC.
 * Antes `GET /ot` devolvía las 50 más recientes sin filtro: las tarjetas de
 * Mi bandeja («OT vencidas», «OT asignadas a mí»…) abrían la lista entera y las
 * OT antiguas no se podían encontrar. Función PURA: lista-ot.spec.ts.
 */

import { OT_ESTADOS_TERMINADOS, UMBRAL_POR_VENCER_DIAS, hoyCl, sumarDias } from "./plazos";

/** Estados de OT que ya no requieren trabajo de laboratorio (igual que la bandeja). */
export const OT_TERMINADAS = ["cerrada", "anulada", "finalizada", "informada"];

/**
 * Semáforo de la fecha de compromiso (ot/plazos.ts). Cuenta toda OT no
 * cerrada ni anulada y «hoy» es el día en Chile: mismos cortes que las
 * tarjetas «OT vencidas / por vencer» de Mi bandeja.
 */
export const SEMAFOROS_LISTA = ["vencida", "por_vencer", "en_plazo", "sin_fecha"] as const;
export type SemaforoLista = (typeof SEMAFOROS_LISTA)[number];

export interface QueryListaOt {
  q?: string;
  search?: string;
  estado?: string;
  /** id de unidad (uuid) ya resuelto desde el código si hacía falta */
  unidadId?: string | null;
  sinLaboratorio?: boolean;
  /** Semáforo de plazo; `vencidas`/`porVencer` son alias de vencida/por_vencer. */
  semaforo?: SemaforoLista | null;
  vencidas?: boolean;
  porVencer?: boolean;
  /** ids de OT listas para cerrar (documentos oficiales y entregados), ya calculados */
  idsListasCierre?: string[] | null;
  /** ids de OT cerradas con cobro y sin factura viva, ya calculados */
  idsSinFactura?: string[] | null;
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

const dia = (s: string) => new Date(`${s}T00:00:00Z`);

/** Semáforo pedido (el parámetro `semaforo` manda sobre los alias). */
export function semaforoPedido(q: Pick<QueryListaOt, "semaforo" | "vencidas" | "porVencer">): SemaforoLista | null {
  if (q.semaforo && (SEMAFOROS_LISTA as readonly string[]).includes(q.semaforo)) return q.semaforo;
  if (q.vencidas) return "vencida";
  if (q.porVencer) return "por_vencer";
  return null;
}

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

  const semaforo = semaforoPedido(q);
  if (semaforo) {
    const hoy = hoyCl(ctx.hoy);
    const limite = sumarDias(hoy, UMBRAL_POR_VENCER_DIAS);
    const abiertas = { estado: { notIn: [...OT_ESTADOS_TERMINADOS] } };
    if (semaforo === "vencida") and.push({ ...abiertas, fechaCompromiso: { lt: dia(hoy) } });
    else if (semaforo === "por_vencer") and.push({ ...abiertas, fechaCompromiso: { gte: dia(hoy), lte: dia(limite) } });
    else if (semaforo === "en_plazo") and.push({ ...abiertas, fechaCompromiso: { gt: dia(limite) } });
    else and.push({ ...abiertas, fechaCompromiso: null });
  }

  if (q.idsMias) and.push({ id: { in: q.idsMias } });
  if (q.idsConAnalista) and.push({ id: { notIn: q.idsConAnalista } });
  if (q.idsListasCierre) and.push({ id: { in: q.idsListasCierre } });
  if (q.idsSinFactura) and.push({ id: { in: q.idsSinFactura } });

  return and.length ? { AND: and } : {};
}

/** page/limit saneados: page ≥ 1, 1 ≤ limit ≤ 200 (por defecto 20). */
export function paginacion(page?: string | number, limit?: string | number): { page: number; limit: number; skip: number } {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const l = Math.min(200, Math.max(1, Math.floor(Number(limit) || 20)));
  return { page: p, limit: l, skip: (p - 1) * l };
}
