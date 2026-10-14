import { Module } from "@nestjs/common";
import { OtController } from "./ot.controller";
import { OtCierreController, OtCierreService } from "./ot-cierre.controller";
import { FlujoModule } from "../flujo/flujo.module";
import { FacturacionModule } from "../facturacion/facturacion.module";
import { LaboratorioOtModule } from "./laboratorio-ot.service";

// FlujoModule exporta FlujoService: la OT lo usa para instanciar el flujo BPM
// al crearse (flujoDefId/flujoVersionId) o al adjuntarlo vía POST /ot/:id/flujo.
// FacturacionModule exporta FacturaService: el cierre crea la factura en borrador.
// LaboratorioOtModule es @Global: al importarlo aquí, LaboratorioOtService
// queda disponible también para Cotización (aceptar) y el puente de captura.
// OtCierreController va PRIMERO: su GET /ot/plazos debe registrarse antes que
// el GET /ot/:id (ParseUUIDPipe) de OtController.
@Module({
  imports: [FlujoModule, FacturacionModule, LaboratorioOtModule],
  controllers: [OtCierreController, OtController],
  providers: [OtCierreService],
})
export class OtModule {}
