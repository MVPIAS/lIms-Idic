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
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? "8h" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LdapStrategy],
  exports: [AuthService],
})
export class AuthModule {}
