import { Injectable, UnauthorizedException, Inject } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

@Injectable()
export class AuthService {
  // En módulo real se inyecta PrismaService; aquí instanciamos para simplicidad
  private prisma = new PrismaClient();

  constructor(private readonly jwt: JwtService) {}

  async login(username: string, password: string) {
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
        usuarioRoles: {
          include: { rol: true },
        },
      },
    });
    if (!usuario) throw new UnauthorizedException();
    return usuario;
  }

  async logout(usuarioId: string) {
    // TODO: invalidar refresh tokens en Redis (lista negra)
    return { ok: true };
  }
}
