import { Body, Controller, Post, UseGuards, Get, Req } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { ApiTags, ApiBearerAuth, ApiBody } from "@nestjs/swagger";
import { z } from "zod";

import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";
import { PermiteCambioClavePendiente } from "./cambio-clave.decorator";
import { CLAVE_MAX } from "./clave";

const LoginSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1),
  // Segundo factor opcional: solo lo envían usuarios con 2FA activo.
  totp: z.string().min(6).max(8).optional(),
});

// Código TOTP de 6 dígitos (se admite hasta 8 por si el issuer usa longitudes
// distintas). Se acepta string para no perder ceros a la izquierda.
// Cambio de contraseña por el propio usuario. Las reglas de la nueva (largo,
// letra + número, distinta, sin el usuario) las aplica el servicio (auth/clave.ts).
const CambiarPasswordSchema = z.object({
  actual: z.string().min(1, "Indique su contraseña actual.").max(CLAVE_MAX),
  nueva: z.string().min(1, "Indique la nueva contraseña.").max(CLAVE_MAX),
});

const CodigoSchema = z.object({
  codigo: z.string().min(6).max(8),
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
  @Public()
  // Límite estricto anti fuerza bruta: sobre-escribe el throttler "default" SOLO
  // en esta ruta a 5 intentos/min (por IP, ya que en login aún no hay JWT).
  // Con los accesos de prueba activos se sube a 30: quien valida permisos
  // cambia de perfil muchas veces seguidas.
  @Throttle({ default: { ttl: 60_000, limit: process.env.ACCESOS_DEMO === "true" ? 30 : 5 } })
  @ApiBody({ schema: { example: { username: "c.vargas", password: "demo", totp: "123456" } } })
  async login(@Body() body: unknown) {
    const { username, password, totp } = LoginSchema.parse(body);
    // Login en dos pasos NO disruptivo: si el usuario tiene 2FA activo y no
    // envía (o falla) `totp`, el service responde 401 con { requiere2fa: true }
    // y el cliente reintenta el mismo POST añadiendo el código.
    return this.auth.login(username, password, totp);
  }

  /**
   * GET /api/auth/accesos-demo
   * Usuarios de prueba por perfil para la pantalla de ingreso. Responde
   * { habilitado: false } salvo que el servidor defina ACCESOS_DEMO=true y
   * ACCESOS_DEMO_CLAVE (docs/ACCESOS_DEMO.md).
   */
  @Get("accesos-demo")
  @Public()
  async accesosDemo() {
    return this.auth.accesosDemo();
  }

  /**
   * POST /api/auth/refresh
   * Renueva el JWT usando el refresh token.
   */
  @Post("refresh")
  @Public()
  async refresh(@Body() body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  /**
   * GET /api/auth/me
   * Devuelve el usuario autenticado.
   */
  @Get("me")
  @PermiteCambioClavePendiente()
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
  @PermiteCambioClavePendiente()
  @UseGuards(AuthGuard("jwt"))
  @ApiBearerAuth()
  async logout(@Req() req: any) {
    return this.auth.logout(req.user.sub);
  }

  /**
   * POST /api/auth/cambiar-password  { actual, nueva }
   * Cambio de contraseña del usuario autenticado (Mi perfil, y obligatorio en el
   * primer ingreso o tras un restablecimiento). Devuelve una sesión nueva
   * (accessToken + refreshToken) sin la marca de cambio pendiente.
   */
  @Post("cambiar-password")
  @PermiteCambioClavePendiente()
  @UseGuards(AuthGuard("jwt"))
  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiBody({ schema: { example: { actual: "Temporal123456", nueva: "NuevaClave2026" } } })
  async cambiarPassword(@Req() req: any, @Body() body: unknown) {
    const { actual, nueva } = CambiarPasswordSchema.parse(body);
    return this.auth.cambiarPassword(req.user.sub, actual, nueva);
  }

  // ─── 2FA · TOTP ───────────────────────────────────────────────────────────

  /**
   * GET /api/auth/2fa/estado
   * Estado del segundo factor del usuario autenticado.
   */
  @Get("2fa/estado")
  @UseGuards(AuthGuard("jwt"))
  @ApiBearerAuth()
  async estado2fa(@Req() req: any) {
    return this.auth.estado2fa(req.user.sub);
  }

  /**
   * POST /api/auth/2fa/setup
   * Genera un secreto TOTP (aún inactivo) y devuelve el otpauthUrl + QR dataURL.
   */
  @Post("2fa/setup")
  @UseGuards(AuthGuard("jwt"))
  @ApiBearerAuth()
  async setup2fa(@Req() req: any) {
    return this.auth.setup2fa(req.user.sub);
  }

  /**
   * POST /api/auth/2fa/activar  { codigo }
   * Verifica el código y activa el segundo factor.
   */
  @Post("2fa/activar")
  @UseGuards(AuthGuard("jwt"))
  @ApiBearerAuth()
  @ApiBody({ schema: { example: { codigo: "123456" } } })
  async activar2fa(@Req() req: any, @Body() body: unknown) {
    const { codigo } = CodigoSchema.parse(body);
    return this.auth.activar2fa(req.user.sub, codigo);
  }

  /**
   * POST /api/auth/2fa/desactivar  { codigo }
   * Verifica el código, desactiva el 2FA y limpia el secreto.
   */
  @Post("2fa/desactivar")
  @UseGuards(AuthGuard("jwt"))
  @ApiBearerAuth()
  @ApiBody({ schema: { example: { codigo: "123456" } } })
  async desactivar2fa(@Req() req: any, @Body() body: unknown) {
    const { codigo } = CodigoSchema.parse(body);
    return this.auth.desactivar2fa(req.user.sub, codigo);
  }
}
