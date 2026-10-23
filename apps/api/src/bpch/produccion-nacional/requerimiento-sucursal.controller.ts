/**
 * Requerimiento técnico a la sucursal en Producción Nacional (EP-07 7.14,
 * BL-157, frente r4c). La SCC registra el requerimiento en la correlación
 * («No conforme»); el Jefe de la Sucursal que inspeccionó la O/C lo ve en
 * Mi bandeja y responde aquí con su informe y la fecha, en vez de que la SCC
 * teclee la respuesta. Responde quien es jefe (titular, subrogante o rol
 * JEFE_LAB) de una sucursal con inspecciones de la O/C, o quien gestiona PN.
 */
import { Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { PrismaService } from "../../common/prisma.service";
import { AvisosService } from "../../avisos/avisos.service";
import { hoyCl } from "../../ot/plazos";

const Respuesta = z.object({
  respuesta: z.string().trim().min(5, "Escriba la respuesta de la sucursal (al menos 5 caracteres)").max(4000),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").optional(),
});

@Injectable()
export class RequerimientoSucursalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly avisos: AvisosService,
  ) {}

  private async datos(id: string, req: any) {
    const [c] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id, c.tenant_id, c.estado, c.requerimiento_sucursal, c.requerimiento_sucursal_at::text AS requerimiento_at,
              c.respuesta_sucursal, c.respuesta_sucursal_at::text AS respuesta_at, oc.numero AS oc, c.oc_id
         FROM bpch_pn_correlacion c JOIN bpch_oc_operativa oc ON oc.id = c.oc_id
        WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid`,
      id,
      req?.user?.tenantId,
    );
    if (!c) throw new NotFoundException("Correlación no encontrada.");
    const [jefe] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM bpch_pn_inspeccion i
        WHERE i.oc_id = $1::uuid AND NOT i.anulada
          AND (EXISTS (SELECT 1 FROM unidad_jefe j WHERE j.unidad_id = i.unidad_id AND j.usuario_id = $2::uuid)
               OR EXISTS (SELECT 1 FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id
                           WHERE ur.usuario_id = $2::uuid AND ur.unidad_id = i.unidad_id AND COALESCE(r.alias_de, r.codigo) = 'JEFE_LAB'))`,
      c.oc_id,
      req.user.sub,
    );
    const gestiona = (req.user.roles ?? []).includes("SUPERADMIN") || (req.user.permisos ?? []).includes("bpch.pn.gestionar");
    return { c, esJefeSucursal: Number(jefe?.n ?? 0) > 0, gestiona };
  }

  async vista(id: string, req: any) {
    const { c, esJefeSucursal, gestiona } = await this.datos(id, req);
    const pendiente = Boolean(c.requerimiento_sucursal?.trim()) && !c.respuesta_sucursal?.trim() && c.estado === "borrador";
    return {
      requerimiento: c.requerimiento_sucursal,
      requerimientoAt: c.requerimiento_at,
      respuesta: c.respuesta_sucursal,
      respuestaAt: c.respuesta_at,
      pendiente,
      puedoResponder: pendiente && (esJefeSucursal || gestiona),
    };
  }

  async responder(id: string, body: unknown, req: any) {
    const dto = Respuesta.parse(body ?? {});
    const { c, esJefeSucursal, gestiona } = await this.datos(id, req);
    if (!esJefeSucursal && !gestiona) throw new ForbiddenException("Responde el Jefe de la Sucursal que inspeccionó la O/C.");
    if (c.estado !== "borrador") throw new ConflictException("El informe técnico ya se emitió: la correlación no se modifica.");
    if (!c.requerimiento_sucursal?.trim()) throw new ConflictException("La SCC aún no registra un requerimiento a la sucursal.");
    if (c.respuesta_sucursal?.trim()) throw new ConflictException("El requerimiento ya tiene respuesta.");
    const fecha = dto.fecha ?? hoyCl();
    if (fecha > hoyCl()) throw new ConflictException("La fecha de la respuesta no puede ser futura.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_pn_correlacion SET respuesta_sucursal = $2, respuesta_sucursal_at = $3::date, updated_at = now() WHERE id = $1::uuid`,
      id,
      dto.respuesta,
      fecha,
    );
    // Aviso a la SCC: con la respuesta decide si responde al requerimiento.
    await this.avisos
      .emitir(
        c.tenant_id,
        {
          tipo: "despacho",
          titulo: `Respuesta de la sucursal · O/C ${c.oc}`,
          mensaje: `La sucursal respondió el requerimiento técnico de la correlación de la O/C ${c.oc}: indique si responde al requerimiento.`,
          ruta: `/bpch/produccion-nacional/correlacion/${id}`,
          clave: `requerimiento_respondido:${id}`,
          creadoPor: req.user.sub,
          severidad: "info",
        },
        { roles: [{ rol: "JEFE_SECCION", unidadCodigo: "SCC" }, { rol: "INSPECTOR", unidadCodigo: "SCC" }] },
      )
      .catch(() => undefined);
    return this.vista(id, req);
  }
}

@ApiTags("bpch")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("bpch/pn/correlaciones")
export class RequerimientoSucursalController {
  constructor(private readonly svc: RequerimientoSucursalService) {}

  @Get(":id/requerimiento")
  @RequierePermiso("bpch.pn.ver")
  vista(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.vista(id, req);
  }

  @Post(":id/responder-requerimiento")
  @RequierePermiso("bpch.pn.ver")
  @ApiOperation({ summary: "El Jefe de la Sucursal responde el requerimiento técnico (EP-07 7.14)" })
  responder(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.responder(id, body, req);
  }
}
