import { Module } from "@nestjs/common";
import { CotizacionController } from "./cotizacion.controller";
import { CotizacionService } from "./cotizacion.service";

@Module({
  controllers: [CotizacionController],
  providers: [CotizacionService],
})
export class CotizacionModule {}
