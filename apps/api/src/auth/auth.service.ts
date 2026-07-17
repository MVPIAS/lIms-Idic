import { Injectable, UnauthorizedException, BadRequestException, Inject } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { authenticator } from "otplib";
import * as QRCode from "qrcode";

// Ventana de tolerancia ±1 período (30 s) para compensar el desfase de reloj
// entre el servidor y la app autenticadora del usuario.
authenticator.options = { window: 1 };

const TOTP_ISSUER = "LIMS IDIC";

@Injectable()
export class AuthService {
  // En módulo real se inyecta PrismaService; aquí instanciamos para simplicidad
  private prisma = new PrismaClient();

  constructor(private readonly jwt: JwtService) {}

  async login(username: string, password: string, totp?: string) {
    const usuario = await this.prisma.usuario.findFirst({
      where: {
        username,
        deletedAt: null,
        estado: "activo",
      },
    });

    if (!usuario) {
      throw new UnauthorizedException("Credenciales inválidas");
    }

    // Verificación de credenciales:
    //  - Si el usuario tiene passwordHash local -> SIEMPRE se valida con argon2
    //    (esto cubre al admin y a usuarios locales, tanto en pre-prod como prod).
    //  - LDAP (ad.ejercito.cl) se resuelve en LdapStrategy por su ruta dedicada.
    //  - Solo en desarrollo sin hash se admite el atajo password="demo".
    const ldapEnabled = process.env.LDAP_ENABLED === "true";
    if (usuario.passwordHash) {
      const valid = await argon2.verify(usuario.passwordHash, password);
      if (!valid) {
        await this.prisma.usuario.update({
          where: { id: usuario.id },
          data: { intentosFallidos: { increment: 1 } },
        });
        throw new UnauthorizedException("Credenciales inválidas");
      }
    } else if (ldapEnabled) {
      throw new UnauthorizedException("Usuario sin credenciales locales; use el ingreso LDAP");
    } else if (process.env.NODE_ENV !== "production") {
      if (password !== "demo") throw new UnauthorizedException('En desarrollo: use la contraseña "demo"');
    } else {
      throw new UnauthorizedException("Usuario sin contraseña configurada");
    }

    // Segundo factor (TOTP). Solo se exige a usuarios con 2FA activo, por lo que
    // el flujo de quienes no lo tienen (p. ej. el admin actual) no cambia.
    if (usuario.totpActivo) {
      if (!usuario.totpSecret) {
        // Estado inconsistente: activo pero sin secreto. No se puede validar.
        throw new UnauthorizedException("2FA mal configurado; contacte al administrador");
      }
      if (!totp || !authenticator.verify({ token: String(totp), secret: usuario.totpSecret })) {
        // Contraseña correcta pero falta/ falla el segundo factor: el cliente
        // debe reintentar el login incluyendo el campo `totp`.
        throw new UnauthorizedException({
          statusCode: 401,
          requiere2fa: true,
          message: "Se requiere el código de verificación (2FA)",
        });
      }
    }

    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        ultimoLoginAt: new Date(),
        intentosFallidos: 0,
      },
    });

    // Cargar roles y permisos efectivos del usuario para el RBAC
    const { roles, permisos } = await this.rolesYPermisos(usuario.id);

    const payload = {
      sub: usuario.id,
      username: usuario.username,
      tenantId: usuario.tenantId,
      roles,
      permisos,
    };

    const accessToken = this.jwt.sign(payload);
    const refreshToken = this.jwt.sign(payload, {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: usuario.id,
        username: usuario.username,
        nombreCompleto: usuario.nombreCompleto,
        email: usuario.email,
        grado: usuario.grado,
        cargo: usuario.cargo,
      },
    };
  }

  /** Roles (códigos) y permisos efectivos de un usuario, para el RBAC del JWT. */
  async rolesYPermisos(usuarioId: string): Promise<{ roles: string[]; permisos: string[] }> {
    const usuarioRoles = await this.prisma.usuarioRol.findMany({
      where: { usuarioId },
      include: { rol: true },
    });
    const rolIds = usuarioRoles.map((ur) => ur.rolId);
    const roles = usuarioRoles.map((ur) => ur.rol.codigo);
    if (rolIds.length === 0) return { roles, permisos: [] };
    const rp = await this.prisma.rolPermiso.findMany({
      where: { rolId: { in: rolIds } },
      include: { permiso: true },
    });
    const permisos = [...new Set(rp.map((x) => x.permiso.codigo))];
    return { roles, permisos };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwt.verify(refreshToken);
      const { roles, permisos } = await this.rolesYPermisos(payload.sub);
      const accessToken = this.jwt.sign({
        sub: payload.sub,
        username: payload.username,
        tenantId: payload.tenantId,
        roles,
        permisos,
      });
      return { accessToken };
    } catch {
      throw new UnauthorizedException("Refresh token inválido");
    }
  }

  async getUserDetails(usuarioId: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: {
        id: true,
        username: true,
        email: true,
        nombreCompleto: true,
        grado: true,
        cargo: true,
        estado: true,
        // Nunca se expone `totpSecret`; solo el estado del segundo factor.
        totpActivo: true,
        usuarioRoles: {
          include: { rol: true },
        },
      },
    });
    if (!usuario) throw new UnauthorizedException();
    return usuario;
  }

  // ─── 2FA · TOTP ───────────────────────────────────────────────────────────

  /** Estado del segundo factor del usuario autenticado. */
  async estado2fa(usuarioId: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { totpActivo: true },
    });
    if (!usuario) throw new UnauthorizedException();
    return { activo: usuario.totpActivo };
  }

  /**
   * Genera (o regenera) un secreto TOTP para el usuario y lo persiste SIN
   * activarlo todavía. Devuelve el `otpauthUrl` y un QR en dataURL listo para
   * escanear con Google Authenticator / Aegis / Authy. El secreto no vuelve a
   * exponerse una vez activado el 2FA.
   */
  async setup2fa(usuarioId: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, username: true, totpActivo: true },
    });
    if (!usuario) throw new UnauthorizedException();
    if (usuario.totpActivo) {
      throw new BadRequestException("El 2FA ya está activo; desactívelo antes de regenerarlo");
    }

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(usuario.username, TOTP_ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    // Se guarda el secreto pero totpActivo sigue en false hasta confirmar código.
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: { totpSecret: secret, totpActivo: false },
    });

    return { otpauthUrl, qrDataUrl };
  }

  /**
   * Verifica el primer código TOTP contra el secreto guardado y, si es válido,
   * activa el segundo factor.
   */
  async activar2fa(usuarioId: string, codigo: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, totpSecret: true, totpActivo: true },
    });
    if (!usuario) throw new UnauthorizedException();
    if (usuario.totpActivo) throw new BadRequestException("El 2FA ya está activo");
    if (!usuario.totpSecret) {
      throw new BadRequestException("No hay un secreto pendiente; ejecute primero /auth/2fa/setup");
    }
    if (!authenticator.verify({ token: String(codigo), secret: usuario.totpSecret })) {
      throw new UnauthorizedException("Código 2FA inválido");
    }

    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: { totpActivo: true },
    });

    return { ok: true, activo: true };
  }

  /**
   * Verifica un código válido y desactiva el segundo factor, limpiando el
   * secreto para que no quede material sensible en la base.
   */
  async desactivar2fa(usuarioId: string, codigo: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, totpSecret: true, totpActivo: true },
    });
    if (!usuario) throw new UnauthorizedException();
    if (!usuario.totpActivo || !usuario.totpSecret) {
      throw new BadRequestException("El 2FA no está activo");
    }
    if (!authenticator.verify({ token: String(codigo), secret: usuario.totpSecret })) {
      throw new UnauthorizedException("Código 2FA inválido");
    }

    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: { totpActivo: false, totpSecret: null },
    });

    return { ok: true, activo: false };
  }

  async logout(usuarioId: string) {
    // TODO: invalidar refresh tokens en Redis (lista negra)
    return { ok: true };
  }
}
