import { Body, Controller, Module, Param, Post, UseGuards, ParseUUIDPipe } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PlantillaRenderService } from "./plantilla-render.service";
import { DEV_TENANT } from "../common/base-crud.service";

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
  contexto(@Param("otId", ParseUUIDPipe) otId: string) {
    return this.svc.contexto(otId);
  }

  /** Previsualiza el informe relleno (HTML + HASH), sin emitir. */
  @Post("previsualizar")
  previsualizar(@Body() body: unknown) {
    const { otId, plantillaId } = PreviewSchema.parse(body);
    return this.svc.previsualizar(otId, plantillaId);
  }

  /** Emite el informe/certificado: rellena, sella con HASH y registra Certificado. */
  @Post("emitir")
  emitir(@Body() body: unknown) {
    const { otId, plantillaId, codigo } = EmitirSchema.parse(body);
    return this.svc.emitir(otId, plantillaId, codigo, DEV_TENANT);
  }
}

@Module({
  controllers: [PlantillaRenderController],
  providers: [PlantillaRenderService],
})
export class PlantillaRenderModule {}
