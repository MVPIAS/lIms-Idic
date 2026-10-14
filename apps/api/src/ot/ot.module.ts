import { Module } from "@nestjs/common";
import { OtController } from "./ot.controller";
import { FlujoModule } from "../flujo/flujo.module";
import { LaboratorioOtModule } from "./laboratorio-ot.service";

// FlujoModule exporta FlujoService: la OT lo usa para instanciar el flujo BPM
// al crearse (flujoDefId/flujoVersionId) o al adjuntarlo vía POST /ot/:id/flujo.
// LaboratorioOtModule es @Global: al importarlo aquí, LaboratorioOtService
// queda disponible también para Cotización (aceptar) y el puente de captura.
@Module({ imports: [FlujoModule, LaboratorioOtModule], controllers: [OtController] })
export class OtModule {}
