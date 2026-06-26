import { Module } from "@nestjs/common";
import { OtController } from "./ot.controller";

@Module({ controllers: [OtController] })
export class OtModule {}
