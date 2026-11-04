import { Module } from "@nestjs/common";
import { IntegracionController } from "./integracion.controller";
import { TokenIntegracionService } from "./token-integracion.service";

/**
 * API REST documentada e integración (contrato §4.7.4). Lo importa AuthModule:
 * JwtStrategy valida con TokenIntegracionService los tokens de integración.
 */
@Module({
  controllers: [IntegracionController],
  providers: [TokenIntegracionService],
  exports: [TokenIntegracionService],
})
export class IntegracionModule {}
