import { ForbiddenException, NotFoundException } from "@nestjs/common";
/**
 * Alcance por laboratorio de las ESCRITURAS sobre cotizaciones (frente L · C2).
 * Regla pura, probada en alcance-cotizacion.spec.ts.
 *
 * La tabla `cotizacion` no tiene unidad responsable. Sus unidades son:
 *   · las de su OT y de las OT que nacieron de ella (laboratorio responsable),
 *   · la de su centro de costo,
 *   · las de los laboratorios a los que se pidió fecha y costo (solicitud_costeo,
 *     frente r1c: el laboratorio consultado abre la ficha para responder),
 *   · las de los laboratorios de los ensayos de sus líneas (familia del
 *     catálogo → unidad por CODSUCDEL),
 *   · y el Departamento Comercial (DCO), que emite todas las cotizaciones.
 * Aprobar, aceptar, anular, rechazar o editar una cotización exige tenerla en
 * el alcance de un rol que conceda ESE permiso (alcance por asignación): un
 * jefe de departamento técnico solo actúa sobre las de sus laboratorios, y la
 * jefatura del Departamento Comercial sobre todas. Ver cotizaciones queda para
 * la fase 1 (decisión del usuario).
 */

/** Unidades de una cotización (sin repetidos; los null se descartan). */
export const SQL_UNIDADES_COTIZACION = `
  SELECT DISTINCT x.u::text AS id FROM (
    SELECT o.unidad_principal AS u FROM cotizacion c JOIN orden_trabajo o ON o.id = c.ot_id WHERE c.id = $1::uuid
    UNION SELECT o.unidad_principal FROM orden_trabajo o WHERE o.cotizacion_id = $1::uuid
    UNION SELECT cc.unidad_id FROM cotizacion c JOIN centro_costo cc ON cc.id = c.centro_costo_id WHERE c.id = $1::uuid
    UNION SELECT s.unidad_id FROM solicitud_costeo s WHERE s.cotizacion_id = $1::uuid AND s.deleted_at IS NULL
    UNION SELECT un.id FROM linea_cotizacion l
            JOIN cat_ensayo e ON e.id = l.cat_ensayo_id
            JOIN cat_familia f ON f.id = e.familia_id
            JOIN unidad un ON un.tenant_id = f.tenant_id
                          AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(un.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))
           WHERE l.cotizacion_id = $1::uuid
  ) x WHERE x.u IS NOT NULL`;

/** ¿Puede actuar sobre la cotización? `visibles` null = alcance global para el permiso. */
export function cotizacionEnAlcance(visibles: string[] | null, unidadesCotizacion: string[], dcoId: string | null): boolean {
  if (visibles === null) return true;
  const propias = dcoId ? [...unidadesCotizacion, dcoId] : unidadesCotizacion;
  return propias.some((u) => visibles.includes(u));
}

/**
 * Escritura sobre una cotización existente: 404 si no existe en el tenant y 403
 * si sus unidades quedan fuera del alcance del permiso de la ruta (o del
 * indicado). Lo usan el controlador de cotizaciones y el circuito (costeo,
 * firma, envío). `prisma` = PrismaService, `alcance` = AlcanceService.
 */
export async function exigirCotizacionEnAlcance(
  prisma: any,
  alcance: { filtroUnidades(req: any, permiso?: string | null): Promise<string[] | null>; arbol(t?: string): Promise<{ porCodigo: Map<string, { id: string }> }> },
  req: any,
  id: string,
  permiso?: string,
): Promise<{ id: string; codigo: string }> {
  const tenantId: string | undefined = req?.user?.tenantId;
  const cot = await prisma.cotizacion.findFirst({
    where: { id, ...(tenantId ? { tenantId } : {}) },
    select: { id: true, codigo: true },
  });
  if (!cot) throw new NotFoundException("Cotización no encontrada");
  const visibles = await alcance.filtroUnidades(req, permiso ?? null);
  if (visibles === null) return cot;
  const filas: { id: string }[] = await prisma.$queryRawUnsafe(SQL_UNIDADES_COTIZACION, id);
  const dco = (await alcance.arbol(tenantId)).porCodigo.get("DCO")?.id ?? null;
  if (!cotizacionEnAlcance(visibles, filas.map((f) => f.id), dco)) {
    throw new ForbiddenException(
      `Fuera de su alcance: la cotización ${cot.codigo ?? ""} es de laboratorios que usted no tiene asignados.`.replace(/\s+/g, " "),
    );
  }
  return cot;
}
