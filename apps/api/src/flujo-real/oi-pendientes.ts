/**
 * Sesión R3 (BPCH y laboratorios): «cuando la muestra pasa a análisis en otro
 * laboratorio, corresponde generar una OT interna». El LIMS detecta lo que pasa
 * a otro laboratorio sin orden interna y la EXIGE (cierre de la OT) o la GENERA
 * con un botón:
 *
 *  · ensayos registrados en una muestra cuyo catálogo es de OTRO laboratorio
 *    (familia → unidad de tipo LABORATORIO distinta de la de la OT) y que
 *    ninguna orden interna viva deriva (lims_lab_de_resultado);
 *  · muestras recibidas con «¿Requiere ensayos de otros laboratorios? Sí» hacia
 *    un laboratorio al que la OT no emitió orden interna.
 *
 * Rutas (van antes que el CRUD de órdenes internas):
 *   GET  ordenes-internas/pendientes/:otId          · lo que falta derivar (ot.ver; OT en alcance)
 *   POST ordenes-internas/pendientes/:otId/generar  · una orden por muestra y laboratorio (orden_interna.emitir)
 *
 * Reglas puras: `agruparPendientes` y `faltantesOrdenInterna` (oi-pendientes.spec.ts).
 */
import { BadRequestException, Body, Controller, Get, Inject, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards, forwardRef } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { OrdenInternaService } from "./orden-interna";
import { hoyChile } from "../common/fecha-chile";

export { agruparPendientes, faltantesOrdenInterna, pendientesOrdenInterna } from "./oi-pendientes-datos";
export type { DerivacionDeclarada, EnsayoAjeno, GrupoPendiente } from "./oi-pendientes-datos";
import { faltantesOrdenInterna, pendientesOrdenInterna } from "./oi-pendientes-datos";

const GenerarBody = z
  .object({
    requisito: z.string({ required_error: "Indique el requisito y el punto de la especificación que debe evaluar el destino." }).trim().min(3, "Indique el requisito y el punto de la especificación que debe evaluar el destino.").max(2000),
    fechaEnvio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").optional(),
    /** Solo estas propuestas («muestraId|laboratorioId»); sin lista, todas las que tienen ensayos. */
    claves: z.array(z.string().max(80)).max(100).optional(),
  })
  .strict();

@Injectable()
export class OiPendientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    // Ciclo de importación con flujo-real.module (orden-interna lo importa): forwardRef.
    @Inject(forwardRef(() => OrdenInternaService)) private readonly ordenes: OrdenInternaService,
  ) {}

  private async ot(req: any, otId: string, permiso: string) {
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, tenantId: req?.user?.tenantId },
      select: { id: true, codigo: true, estado: true, unidadPrincipal: true },
    });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`, permiso);
    return ot;
  }

  async listar(req: any, otId: string) {
    const ot = await this.ot(req, otId, "ot.ver");
    const grupos = await pendientesOrdenInterna(this.prisma, otId);
    return { ot: { id: ot.id, codigo: ot.codigo }, pendientes: grupos.map((g) => ({ ...g, clave: `${g.muestraId}|${g.laboratorioId}` })), faltantes: faltantesOrdenInterna(grupos) };
  }

  async generar(req: any, otId: string, body: unknown) {
    const ot = await this.ot(req, otId, "orden_interna.emitir");
    if (["cerrada", "anulada"].includes(ot.estado)) throw new BadRequestException(`La OT ${ot.codigo} está ${ot.estado}.`);
    const d = GenerarBody.parse(body ?? {});
    const grupos = (await pendientesOrdenInterna(this.prisma, otId)).filter(
      (g) => g.familiaId && g.ensayos.length && (!d.claves || d.claves.includes(`${g.muestraId}|${g.laboratorioId}`)),
    );
    if (!grupos.length)
      throw new BadRequestException("No hay ensayos de otro laboratorio sin orden interna. Lo declarado en la recepción sin ensayos se emite a mano en «Órdenes internas».");
    const fechaEnvio = d.fechaEnvio ?? hoyChile();
    const creadas: { numero: string; muestra: string; laboratorio: string; ensayos: number }[] = [];
    for (const g of grupos) {
      const oi: any = await this.ordenes.crear(
        {
          otId,
          tipo: "interna",
          estado: "abierta",
          origenLab: undefined,
          destinoLab: g.familiaId,
          ensayos: g.ensayos.map((e) => e.id),
          muestraId: g.muestraId,
          requisito: d.requisito,
          fechaEnvio: new Date(`${fechaEnvio}T12:00:00Z`),
          detalle: `Generada por el LIMS: la muestra ${g.muestra} pasa a ${g.laboratorio} (${g.ensayos.map((e) => e.nombre).join(", ")}).`.slice(0, 4000),
        },
        req?.user?.tenantId,
        req?.user?.sub ?? null,
      );
      creadas.push({ numero: oi?.numero, muestra: g.muestra, laboratorio: g.laboratorio, ensayos: g.ensayos.length });
    }
    return { creadas, ...(await this.listar(req, otId)) };
  }
}

@ApiTags("ordenes-internas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ordenes-internas/pendientes")
export class OiPendientesController {
  constructor(private readonly svc: OiPendientesService) {}

  @Get(":otId")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "R3 · Muestras que pasan a otro laboratorio sin orden interna" })
  listar(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.listar(req, otId);
  }

  @Post(":otId/generar")
  @RequierePermiso("orden_interna.emitir")
  @ApiOperation({ summary: "R3 · Genera una orden interna por muestra y laboratorio de destino" })
  generar(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.generar(req, otId, body);
  }
}
