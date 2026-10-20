import { Module } from "@nestjs/common";
import { CotizacionController } from "./cotizacion.controller";
import { CotizacionService } from "./cotizacion.service";
import { CosteoService } from "./costeo.service";
import { CircuitoCotizacionController } from "./circuito.controller";
import { CircuitoCotizacionService } from "./circuito.service";
import { RbacModule } from "../rbac/rbac.module";
import { MensajeriaModule } from "../mensajeria/mensajeria.module";

@Module({
  // RbacModule: resolver de la matriz de firmas (firma COTIZACION y V°B°).
  // MensajeriaModule: envío de la cotización por correo con su PDF.
  imports: [RbacModule, MensajeriaModule],
  // El circuito va primero: sus rutas fijas no deben caer en GET /cotizaciones/:id.
  controllers: [CircuitoCotizacionController, CotizacionController],
  providers: [CotizacionService, CosteoService, CircuitoCotizacionService],
  exports: [CosteoService],
})
export class CotizacionModule {}
