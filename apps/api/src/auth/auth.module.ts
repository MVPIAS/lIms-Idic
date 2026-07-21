import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { LdapStrategy } from "./ldap.strategy";
import { getJwtSecret } from "../common/jwt-secret";

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: getJwtSecret(),
      // Se fija explícitamente el algoritmo de firma (HS256, simétrico). Evita
      // que un cambio de configuración o un token manipulado use otro algoritmo
      // (p. ej. alg=none o confusión HS/RS). La verificación fija el mismo
      // algoritmo en JwtStrategy (`algorithms: ["HS256"]`).
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? "8h", algorithm: "HS256" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LdapStrategy],
  exports: [AuthService],
})
export class AuthModule {}
