import { Module } from "@nestjs/common";
import { CotizacionController } from "./cotizacion.controller";
import { CotizacionService } from "./cotizacion.service";
import { CosteoService } from "./costeo.service";

@Module({
  controllers: [CotizacionController],
  providers: [CotizacionService, CosteoService],
  exports: [CosteoService],
})
export class CotizacionModule {}
