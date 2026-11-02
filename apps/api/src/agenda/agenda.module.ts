import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AgendaService } from "./agenda.service";

// ===========================================================================
// Agenda de recursos y eventos (contrato §4.5.8, §4.5.9): catálogo de recursos
// con costos, calendario día/semana/mes, disponibilidad valorizada y eventos
// únicos o recurrentes con participantes y recursos. Reglas en agenda.service.ts.
// ===========================================================================

const UUID = new ParseUUIDPipe({ version: "4", errorHttpStatusCode: 400 });

interface Rango {
  vista?: string;
  fecha?: string;
  desde?: string;
  hasta?: string;
}

@ApiTags("agenda")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("agenda")
export class AgendaController {
  constructor(private readonly a: AgendaService) {}

  @Get("recursos")
  @RequierePermiso("agenda.ver")
  recursos(@Query("inactivos") inactivos: string | undefined, @Req() req: any) {
    return this.a.listarRecursos(req, inactivos);
  }

  @Get("recursos/origenes")
  @RequierePermiso("recurso.gestionar")
  origenes(@Query("tipo") tipo: string, @Query("q") q: string | undefined, @Req() req: any) {
    return this.a.origenes(req, tipo, q);
  }

  @Post("recursos")
  @RequierePermiso("recurso.gestionar")
  crearRecurso(@Body() b: any, @Req() req: any) {
    return this.a.crearRecurso(req, b);
  }

  @Patch("recursos/:id")
  @RequierePermiso("recurso.gestionar")
  editarRecurso(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.a.editarRecurso(req, id, b);
  }

  @Delete("recursos/:id")
  @RequierePermiso("recurso.gestionar")
  borrarRecurso(@Param("id", UUID) id: string, @Req() req: any) {
    return this.a.borrarRecurso(req, id);
  }

  @Get("calendario")
  @RequierePermiso("agenda.ver")
  calendario(@Query() q: Rango & { recursoId?: string; soloMios?: string }, @Req() req: any) {
    return this.a.calendario(req, q);
  }

  @Get("disponibilidad")
  @RequierePermiso("agenda.ver")
  disponibilidad(@Query() q: Rango & { tipo?: string }, @Req() req: any) {
    return this.a.disponibilidad(req, q);
  }

  @Get("usuarios")
  @RequierePermiso("agenda.crear")
  usuarios(@Query("q") q: string | undefined, @Req() req: any) {
    return this.a.usuarios(req, q);
  }

  @Get("eventos/:id")
  @RequierePermiso("agenda.ver")
  ficha(@Param("id", UUID) id: string, @Req() req: any) {
    return this.a.ficha(req, id);
  }

  @Post("eventos")
  @RequierePermiso("agenda.crear")
  crearEvento(@Body() b: any, @Req() req: any) {
    return this.a.crearEvento(req, b);
  }

  @Patch("eventos/:id")
  @RequierePermiso("agenda.crear")
  editarEvento(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.a.editarEvento(req, id, b);
  }

  @Post("eventos/:id/anular-ocurrencia")
  @RequierePermiso("agenda.crear")
  anular(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.a.anularOcurrencia(req, id, b?.fecha);
  }

  @Post("eventos/:id/respuesta")
  @RequierePermiso("agenda.ver")
  responder(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.a.responder(req, id, b?.respuesta);
  }

  @Delete("eventos/:id")
  @RequierePermiso("agenda.crear")
  borrarEvento(@Param("id", UUID) id: string, @Req() req: any) {
    return this.a.borrarEvento(req, id);
  }
}

@Module({
  controllers: [AgendaController],
  providers: [AgendaService],
})
export class AgendaModule {}
