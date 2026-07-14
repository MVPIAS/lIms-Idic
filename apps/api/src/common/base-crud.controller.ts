import { Body, Delete, Get, Param, Patch, Post, Query, Req, ParseUUIDPipe } from "@nestjs/common";
import { ZodTypeAny } from "zod";
import { BaseCrudService } from "./base-crud.service";

/** Extrae el tenant del usuario autenticado (lo inyecta JwtStrategy en req.user). */
function tenantDe(req: any): string | undefined {
  return req?.user?.tenantId;
}

/**
 * Controlador CRUD base. Las subclases decoran con @Controller/@UseGuards y
 * proveen su servicio + esquemas Zod. Las rutas (@Get/@Post/…) se heredan.
 *   GET  /       · listar (paginado + ?search)
 *   GET  /:id    · detalle
 *   POST /       · crear   (valida createSchema)
 *   PATCH /:id   · actualizar (valida updateSchema)
 *   DELETE /:id  · eliminar (soft delete)
 */
export abstract class BaseCrudController {
  protected abstract svc: BaseCrudService;
  protected createSchema?: ZodTypeAny;
  protected updateSchema?: ZodTypeAny;

  @Get()
  listar(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("search") search?: string,
    @Req() req?: any,
  ) {
    return this.svc.listar({ page: parseInt(page), limit: parseInt(limit), search }, tenantDe(req));
  }

  @Get(":id")
  detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(id, tenantDe(req));
  }

  @Post()
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crear(this.createSchema ? this.createSchema.parse(body) : body, tenantDe(req));
  }

  @Patch(":id")
  actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.actualizar(id, this.updateSchema ? this.updateSchema.parse(body) : body, tenantDe(req));
  }

  @Delete(":id")
  eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.eliminar(id, tenantDe(req));
  }
}
