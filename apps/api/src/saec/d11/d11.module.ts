import { Module } from "@nestjs/common";
import { FlujoRealModule } from "../../flujo-real/flujo-real.module";
import { PlantillaRenderModule } from "../../plantilla-render/plantilla-render.module";
import { D11Controller, MunicionD11Controller, MunicionLaboratorioController, ResolucionArmasController } from "./d11.controller";
import { MunicionService } from "./municion.service";
import { D11Service } from "./d11.service";

/**
 * Delegación Nº 11 · certificación de armas internadas (EP-11). Usa el registro
 * de muestras y la captura del flujo general (FlujoRealModule) y la emisión y
 * firma de documentos (PlantillaRenderModule).
 */
@Module({
  imports: [FlujoRealModule, PlantillaRenderModule],
  controllers: [D11Controller, ResolucionArmasController, MunicionD11Controller, MunicionLaboratorioController],
  providers: [D11Service, MunicionService],
})
export class D11Module {}
