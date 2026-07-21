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

// Bloqueo temporal de cuenta tras N intentos fallidos consecutivos. Complementa
// (no sustituye) al rate-limit por IP del ThrottlerGuard. El bloqueo se auto-
// expira pasada la ventana, evitando un DoS permanente sobre cuentas legítimas.
const MAX_INTENTOS_FALLIDOS = Number(process.env.AUTH_MAX_INTENTOS ?? 5);
const LOCK_MS = Number(process.env.AUTH_LOCK_MINUTES ?? 15) * 60_000;

// Hash argon2 "señuelo" (de un valor fijo sin uso real). Se verifica contra él
// cuando el usuario NO existe, para que el coste de CPU del login sea el mismo
// exista o no la cuenta y no se pueda enumerar usuarios por diferencia de tiempo.
const DUMMY_ARGON2_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$bVDEyHCefeYR8WDf7p86gw$yf0s5YZ7VZvWIUpUYXcFgjJuUjU3b+HRjR7uOA6usHc";

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
      // El usuario no existe: se realiza igualmente una verificación argon2
      // contra un hash señuelo para que el tiempo de respuesta sea equivalente
      // al de una cuenta real con contraseña incorrecta (evita enumeración por
      // temporización). El resultado se descarta.
      await argon2.verify(DUMMY_ARGON2_HASH, password).catch(() => false);
      throw new UnauthorizedException("Credenciales inválidas");
    }

    // Bloqueo temporal por fuerza bruta: si se superó el umbral de intentos
    // fallidos y aún estamos dentro de la ventana de bloqueo, se rechaza sin
    // evaluar la contraseña. Pasada la ventana, se permite reintentar.
    if (usuario.intentosFallidos >= MAX_INTENTOS_FALLIDOS) {
      const ultimoIntento = usuario.updatedAt?.getTime() ?? 0;
      if (Date.now() - ultimoIntento < LOCK_MS) {
        throw new UnauthorizedException(
          "Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intente nuevamente más tarde.",
        );
      }
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
          // `updatedAt` marca el instante del último fallo: sobre él se calcula
          // la ventana de bloqueo temporal en el siguiente intento.
          data: { intentosFallidos: { increment: 1 }, updatedAt: new Date() },
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
      // Versión de token: se incrementa en cada logout. El refresh token solo
      // renueva si su `tv` coincide con el actual del usuario (invalida sesiones
      // tras logout sin necesidad de blacklist en Redis).
      tv: (usuario as any).tokenVersion ?? 0,
    };

    const accessToken = this.jwt.sign(payload);
    // El refresh token se marca con `type: "refresh"`: JwtStrategy lo rechaza
    // como Bearer de API (solo sirve en /auth/refresh), de modo que este token
    // de larga duración (7d) no otorgue acceso completo a la API.
    const refreshToken = this.jwt.sign(
      { ...payload, type: "refresh" },
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d" },
    );

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
      // Solo un token de tipo refresh puede renovar. Impide encadenar access
      // tokens indefinidamente para mintear nuevos access tokens.
      if (payload.type !== "refresh") {
        throw new UnauthorizedException("Refresh token inválido");
      }
      // Invalidación por logout: si el usuario cerró sesión (tokenVersion++),
      // los refresh tokens previos dejan de renovar. Cierra la ventana de 7d.
      const usuario = await this.prisma.usuario.findFirst({
        where: { id: payload.sub, deletedAt: null, estado: "activo" },
        select: { tokenVersion: true },
      });
      if (!usuario || (usuario.tokenVersion ?? 0) !== (payload.tv ?? 0)) {
        throw new UnauthorizedException("Refresh token inválido");
      }
      const { roles, permisos } = await this.rolesYPermisos(payload.sub);
      const accessToken = this.jwt.sign({
        sub: payload.sub,
        username: payload.username,
        tenantId: payload.tenantId,
        roles,
        permisos,
        tv: usuario.tokenVersion ?? 0,
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
    // Invalida TODOS los refresh tokens previos del usuario incrementando su
    // tokenVersion: cualquier refresh con `tv` anterior deja de renovar. Los
    // access tokens ya emitidos caducan por su expiración corta. Sin Redis.
    await this.prisma.usuario.update({
      where: { id: usuarioId },
      data: { tokenVersion: { increment: 1 } },
    });
    return { ok: true };
  }
}
