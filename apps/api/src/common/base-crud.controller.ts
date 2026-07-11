import { Body, Delete, Get, Param, Patch, Post, Query, ParseUUIDPipe } from "@nestjs/common";
import { ZodTypeAny } from "zod";
import { BaseCrudService } from "./base-crud.service";

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
  ) {
    return this.svc.listar({ page: parseInt(page), limit: parseInt(limit), search });
  }

  @Get(":id")
  detalle(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.detalle(id);
  }

  @Post()
  crear(@Body() body: unknown) {
    return this.svc.crear(this.createSchema ? this.createSchema.parse(body) : body);
  }

  @Patch(":id")
  actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.svc.actualizar(id, this.updateSchema ? this.updateSchema.parse(body) : body);
  }

  @Delete(":id")
  eliminar(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.eliminar(id);
  }
}
