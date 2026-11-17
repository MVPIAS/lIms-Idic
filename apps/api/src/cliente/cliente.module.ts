import { Module } from "@nestjs/common";
import { ClienteController } from "./cliente.controller";
import { ClienteService } from "./cliente.service";
import { MoraClienteService } from "./mora.service";

@Module({
  controllers: [ClienteController],
  providers: [ClienteService, MoraClienteService],
  exports: [ClienteService, MoraClienteService],
})
export class ClienteModule {}
