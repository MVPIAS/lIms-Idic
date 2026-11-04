import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { documentoApi } from "./openapi-doc";
import { PERMISO_DOCUMENTACION, PERMISO_TOKENS } from "./token-integracion.reglas";
import { TokenIntegracionService } from "./token-integracion.service";

/**
 * Integración con otros sistemas (contrato §4.7.4):
 *   · GET  /integracion/openapi.json    especificación OpenAPI de toda la API
 *   · CRUD /integracion/tokens          tokens de integración (cuentas de servicio)
 */
@ApiTags("integracion")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("integracion")
export class IntegracionController {
  constructor(private readonly tokens: TokenIntegracionService) {}

  @Get("openapi.json")
  @RequierePermiso(PERMISO_DOCUMENTACION)
  @ApiOperation({
    summary: "Especificación OpenAPI de la API",
    description: "Documento OpenAPI 3 de todas las rutas, con el permiso que exige cada una. Lo pueden leer los administradores y cualquier token de integración.",
  })
  especificacion() {
    const doc = documentoApi();
    if (!doc) throw new NotFoundException("La documentación de la API aún no está disponible. Intente de nuevo en unos segundos.");
    return doc;
  }

  @Get("tokens")
  @RequierePermiso(PERMISO_TOKENS)
  @ApiOperation({ summary: "Listar los tokens de integración" })
  listar(@Req() req: any) {
    return this.tokens.listar(req);
  }

  @Get("tokens/opciones")
  @RequierePermiso(PERMISO_TOKENS)
  @ApiOperation({ summary: "Roles, unidades y vigencias que se pueden elegir al crear un token" })
  opciones(@Req() req: any) {
    return this.tokens.opciones(req);
  }

  @Post("tokens")
  @RequierePermiso(PERMISO_TOKENS)
  @ApiOperation({
    summary: "Crear un token de integración",
    description: "Crea la cuenta de servicio con el rol elegido y devuelve el token UNA sola vez (campo `token`). Solo se guarda su hash.",
  })
  crear(@Body() body: unknown, @Req() req: any) {
    return this.tokens.crear(body, req);
  }

  @Post("tokens/:id/revocar")
  @RequierePermiso(PERMISO_TOKENS)
  @ApiOperation({ summary: "Revocar un token de integración", description: "Deja de aceptarse de inmediato. No se puede deshacer." })
  revocar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.tokens.revocar(id, body, req);
  }
}
