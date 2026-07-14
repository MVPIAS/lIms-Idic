import { Body, Controller, Post, UseGuards, Get, Req } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { ApiTags, ApiBearerAuth, ApiBody } from "@nestjs/swagger";
import { z } from "zod";

import { AuthService } from "./auth.service";

const LoginSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1),
});

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * POST /api/auth/login
   * Valida con LDAP si LDAP_ENABLED=true, sino con usuarios locales.
   * Devuelve JWT + datos del usuario.
   */
  @Post("login")
  // Límite estricto anti fuerza bruta: 5 intentos por minuto por IP.
  @Throttle({ login: { ttl: 60_000, limit: 5 } })
  @ApiBody({ schema: { example: { username: "c.vargas", password: "demo" } } })
  async login(@Body() body: unknown) {
    const { username, password } = LoginSchema.parse(body);
    return this.auth.login(username, password);
  }

  /**
   * POST /api/auth/refresh
   * Renueva el JWT usando el refresh token.
   */
  @Post("refresh")
  async refresh(@Body() body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  /**
   * GET /api/auth/me
   * Devuelve el usuario autenticado.
   */
  @Get("me")
  @UseGuards(AuthGuard("jwt"))
  @ApiBearerAuth()
  async me(@Req() req: any) {
    return this.auth.getUserDetails(req.user.sub);
  }

  /**
   * POST /api/auth/logout
   * Invalida el refresh token.
   */
  @Post("logout")
  @UseGuards(AuthGuard("jwt"))
  @ApiBearerAuth()
  async logout(@Req() req: any) {
    return this.auth.logout(req.user.sub);
  }
}
