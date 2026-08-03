import {
  Controller,
  Get,
  Module,
  Query,
  Req,
  UseGuards,
  Injectable,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermisoCrud } from "../auth/permisos.decorator";

/**
 * =============================================================================
 * PASOS / CAMPOS EDITABLES POR ENSAYO (método) · tabla `paso_metodo`.
 *
 * En el manual de StarLIMS, al crear la O/T se baja hasta el ENSAYO y ahí se
 * definen los PASOS/campos que el analista captura (p.ej. "Fuerza", "Area",
 * "Masa Inicial"). Aquí se gestiona esa DEFINICIÓN (no la captura de valores).
 *
 * DDL fuente: packages/db/align_pasos_metodo.sql. Siembra real desde ANALFIELDS
 * (packages/db/seed_pasos_metodo.sql, generado por 07_migracion/build_seed_pasos.py).
 * Modelo Prisma `PasoMetodo` (schema.prisma).
 *
 * Rutas bajo `pasos-metodo`:
 *   GET  /pasos-metodo?catMetodoId=  · lista los pasos de un método, en orden.
 *   GET  /pasos-metodo/:id           · detalle
 *   POST /pasos-metodo               · crear paso
 *   PATCH/pasos-metodo/:id           · editar paso (incl. instruccion libre)
 *   DELETE /pasos-metodo/:id         · eliminar (soft delete)
 *
 * Permisos, igual que el resto del catálogo v2: se LEE con `muestra.ver` (roles
 * operativos, para consultarlos en el wizard de O/T) y se GESTIONA/escribe con
 * `catalogo.gestionar`.
 * =============================================================================
 */

const PERMISOS_PASO = {
  ver: "muestra.ver",
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
} as const;

@Injectable()
export class PasoMetodoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "pasoMetodo",
      search: ["nombre", "instruccion"],
      orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      tenant: true,
      softDelete: true,
    });
  }
}

const PasoMetodoCreate = z.object({
  catMetodoId: z.string().uuid(),
  orden: z.coerce.number().int().default(0),
  nombre: z.string().min(1).max(200),
  tipoDato: z.enum(["numero", "texto", "seleccion"]).default("numero"),
  unidad: z.string().max(40).optional(),
  formato: z.string().max(40).optional(),
  instruccion: z.string().optional(),
  obligatorio: z.boolean().default(true),
  activo: z.boolean().default(true),
});

/** Tenant del usuario autenticado (lo inyecta JwtStrategy en req.user). */
function tenantDe(req: any): string | undefined {
  return req?.user?.tenantId;
}

@ApiTags("pasos-metodo")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("pasos-metodo")
@RequierePermisoCrud(PERMISOS_PASO)
export class PasoMetodoController extends BaseCrudController {
  protected createSchema = PasoMetodoCreate;
  // En update, catMetodoId no es reasignable desde el form (se omite en la UI),
  // pero se admite parcial por si acaso; BaseCrudService nunca toca el tenant.
  protected updateSchema = PasoMetodoCreate.partial();
  constructor(protected svc: PasoMetodoService) {
    super();
  }

  /**
   * Sobrescribe el listar heredado para admitir el filtro `?catMetodoId=`
   * (los pasos de un método concreto, ordenados), que es el uso principal:
   * la pantalla de gestión y el wizard de O/T piden los pasos de un método.
   */
  @Get()
  @ApiOperation({ summary: "Lista pasos de un método; filtra por ?catMetodoId= y ?activo=true" })
  override listar(
    @Query("page") page = "1",
    @Query("limit") limit = "100",
    @Query("search") search?: string,
    @Query("catMetodoId") catMetodoId?: string,
    @Query("activo") activo?: string,
    @Req() req?: any,
  ) {
    const where: Record<string, unknown> = {};
    if (catMetodoId) where.catMetodoId = catMetodoId;
    if (activo === "true") where.activo = true;
    return this.svc.listar(
      { page: parseInt(page), limit: parseInt(limit), search, where },
      tenantDe(req),
    );
  }
}

@Module({
  controllers: [PasoMetodoController],
  providers: [PasoMetodoService],
})
export class PasoMetodoModule {}
