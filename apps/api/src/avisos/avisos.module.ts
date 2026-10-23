import { Body, Controller, Get, Global, Module, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { PrismaService } from "../common/prisma.service";
import { ConfiguracionModule } from "../configuracion/configuracion.module";
import { AvisosService } from "./avisos.service";

const Avisar = z.object({ otIds: z.array(z.string().uuid()).max(500).optional() });

/**
 * Avisos de la persona («Mi bandeja › Avisos»): no exigen permiso, cada uno ve
 * solo los suyos. «Avisar →» (plazos) exige ot.seguimiento y se acota al alcance.
 */
@ApiTags("avisos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("avisos")
export class AvisosController {
  constructor(
    private readonly svc: AvisosService,
    private readonly alcance: AlcanceService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  mios(@Req() req: any, @Query("noLeidos") noLeidos?: string, @Query("limite") limite?: string) {
    return this.svc.mios(req.user.sub, req.user.tenantId, noLeidos === "1" || noLeidos === "true", Number(limite) || 50);
  }

  @Post("leidos")
  todosLeidos(@Req() req: any) {
    return this.svc.marcarLeido(req.user.sub, req.user.tenantId, null);
  }

  @Post(":id/leido")
  leido(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.marcarLeido(req.user.sub, req.user.tenantId, id);
  }

  /** EP-00 6.2 «Avisar →»: avisa ahora las OT vencidas o por vencer (todas las de su alcance o las indicadas). */
  @Post("plazos")
  @RequierePermiso("ot.seguimiento")
  async avisarPlazos(@Body() body: unknown, @Req() req: any) {
    const dto = Avisar.parse(body ?? {});
    const filtro = await this.alcance.filtroUnidades(req);
    const ids = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM orden_trabajo WHERE tenant_id = $1::uuid AND estado NOT IN ('cerrada', 'anulada')
          AND ($2::uuid[] IS NULL OR unidad_principal = ANY($2::uuid[])) AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))`,
      req.user.tenantId,
      filtro,
      dto.otIds?.length ? dto.otIds : null,
    );
    if (!ids.length) return { vencidas: 0, porVencer: 0, personas: 0 };
    return this.svc.revisarPlazos(req.user.tenantId, { otIds: ids.map((x) => x.id), usuarioId: req.user.sub, forzar: Boolean(dto.otIds?.length) });
  }
}

@Global()
@Module({
  imports: [ConfiguracionModule],
  controllers: [AvisosController],
  providers: [AvisosService],
  exports: [AvisosService],
})
export class AvisosModule {}
