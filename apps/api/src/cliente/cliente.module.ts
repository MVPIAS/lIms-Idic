import { Module } from "@nestjs/common";
import { ClienteController } from "./cliente.controller";
import { ClienteService } from "./cliente.service";
import { MoraClienteService } from "./mora.service";
import { PersonaNaturalController } from "./persona-natural.controller";

@Module({
  // PersonaNaturalController va ANTES: /clientes/personas-naturales no debe caer en /clientes/:id.
  controllers: [PersonaNaturalController, ClienteController],
  providers: [ClienteService, MoraClienteService],
  exports: [ClienteService, MoraClienteService],
})
export class ClienteModule {}
