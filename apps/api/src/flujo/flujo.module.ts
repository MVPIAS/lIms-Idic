import { Module } from "@nestjs/common";
import { FlujoController } from "./flujo.controller";
import { FlujoService } from "./flujo.service";

@Module({
  controllers: [FlujoController],
  providers: [FlujoService],
  exports: [FlujoService],
})
export class FlujoModule {}
