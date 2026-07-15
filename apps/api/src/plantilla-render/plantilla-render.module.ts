import { Body, Controller, Module, Param, Post, Req, UseGuards, ParseUUIDPipe } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PlantillaRenderService } from "./plantilla-render.service";

const PreviewSchema = z.object({ otId: z.string().uuid(), plantillaId: z.string().uuid() });
const EmitirSchema = PreviewSchema.extend({ codigo: z.string().min(1).max(40) });

@ApiTags("informes")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("informes")
export class PlantillaRenderController {
  constructor(private readonly svc: PlantillaRenderService) {}

  /** Contexto de datos de una OT (para el autorelleno). */
  @Post("contexto/:otId")
  contexto(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.contexto(otId, req?.user?.tenantId);
  }

  /** Previsualiza el informe relleno (HTML + HASH), sin emitir. */
  @Post("previsualizar")
  previsualizar(@Body() body: unknown, @Req() req: any) {
    const { otId, plantillaId } = PreviewSchema.parse(body);
    return this.svc.previsualizar(otId, plantillaId, req?.user?.tenantId);
  }

  /** Emite el informe/certificado: rellena, sella con HASH y registra Certificado. */
  @Post("emitir")
  emitir(@Body() body: unknown, @Req() req: any) {
    const { otId, plantillaId, codigo } = EmitirSchema.parse(body);
    // El Certificado se crea con el tenant del usuario autenticado (no DEV_TENANT).
    return this.svc.emitir(otId, plantillaId, codigo, req?.user?.tenantId);
  }
}

@Module({
  controllers: [PlantillaRenderController],
  providers: [PlantillaRenderService],
})
export class PlantillaRenderModule {}
