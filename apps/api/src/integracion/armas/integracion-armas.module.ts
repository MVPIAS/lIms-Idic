import { Module } from "@nestjs/common";
import { AvisosModule } from "../../avisos/avisos.module";
import { BpchEntradaController, IntegracionArmasController } from "./integracion-armas.controller";
import { IntegracionArmasService } from "./integracion-armas.service";

/** Integración asíncrona con el software de armas del BPCH (apps/api/documentacion/integracion-armas-bpch). */
@Module({
  imports: [AvisosModule],
  controllers: [IntegracionArmasController, BpchEntradaController],
  providers: [IntegracionArmasService],
  exports: [IntegracionArmasService],
})
export class IntegracionArmasModule {}
