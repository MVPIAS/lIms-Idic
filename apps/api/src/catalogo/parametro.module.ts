import { Controller, Get, Module, Query, Req, UseGuards, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermisoCrud } from "../auth/permisos.decorator";

/**
 * PARÁMETROS DE NEGOCIO (§5). Maestra genérica y editable de los combos que
 * antes estaban hardcodeados en el frontend (tipo_cliente, forma_pago,
 * prioridad, tipo_linea_costeo, tipo_inspeccion). Tabla `parametro_sistema`.
 */
@Injectable()
export class ParametroSistemaService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "parametroSistema",
      search: ["categoria", "codigo", "etiqueta"],
      softDelete: false,
      // Orden natural del combo: por categoría y, dentro de ella, por `orden`.
      orderBy: [{ categoria: "asc" }, { orden: "asc" }],
    });
  }
}

const ParametroCreate = z.object({
  categoria: z.string().min(1).max(60),
  codigo: z.string().min(1).max(60),
  etiqueta: z.string().min(1).max(160),
  // El form envía `orden` como número (input number) o lo omite.
  orden: z.coerce.number().int().default(0),
  activo: z.boolean().default(true),
});

/** Tenant del usuario autenticado (lo inyecta JwtStrategy en req.user). */
function tenantDe(req: any): string | undefined {
  return req?.user?.tenantId;
}

/**
 * CRUD de parámetros de negocio.
 *
 * GET (listar/detalle) NO declara permiso `ver`: es de lectura interna para
 * cualquier usuario autenticado, porque los formularios de negocio (p. ej. el
 * alta de clientes, que gestionan roles comerciales sin `catalogo.gestionar`)
 * necesitan leer sus combos. La ESCRITURA sí exige `catalogo.gestionar`.
 *
 * `?categoria=` filtra un combo concreto (lo usan los formularios); `?activo=true`
 * devuelve solo los valores ofrecibles. Sin filtros, lista todo (pantalla de
 * gestión /catalogo/parametros).
 */
@ApiTags("parametros")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("parametros")
@RequierePermisoCrud({
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
})
export class ParametroSistemaController extends BaseCrudController {
  protected createSchema = ParametroCreate;
  protected updateSchema = ParametroCreate.partial();
  constructor(protected svc: ParametroSistemaService) {
    super();
  }

  /**
   * Sobrescribe el listar heredado para admitir los filtros `categoria` y
   * `activo`, que BaseCrudController no contempla.
   */
  @Get()
  @ApiOperation({ summary: "Lista parámetros; filtra por ?categoria= y ?activo=true" })
  override listar(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("search") search?: string,
    @Query("categoria") categoria?: string,
    @Query("activo") activo?: string,
    @Req() req?: any,
  ) {
    const where: Record<string, unknown> = {};
    if (categoria) where.categoria = categoria;
    if (activo === "true") where.activo = true;
    return this.svc.listar(
      { page: parseInt(page), limit: parseInt(limit), search, where },
      tenantDe(req),
    );
  }
}

@Module({
  controllers: [ParametroSistemaController],
  providers: [ParametroSistemaService],
})
export class ParametroModule {}
