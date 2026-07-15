import { Module } from "@nestjs/common";
import { OtController } from "./ot.controller";
import { FlujoModule } from "../flujo/flujo.module";

// FlujoModule exporta FlujoService: la OT lo usa para instanciar el flujo BPM
// al crearse (flujoDefId/flujoVersionId) o al adjuntarlo vía POST /ot/:id/flujo.
@Module({ imports: [FlujoModule], controllers: [OtController] })
export class OtModule {}
