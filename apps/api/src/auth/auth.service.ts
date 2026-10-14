import { Injectable, UnauthorizedException, BadRequestException, Inject } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { authenticator } from "otplib";
import * as QRCode from "qrcode";
import { createHash, timingSafeEqual } from "crypto";
import { AlcanceService } from "../rbac/alcance.service";
import { erroresNuevaClave } from "./clave";

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

/**
 * Accesos de prueba por perfil (docs/ACCESOS_DEMO.md). Solo existen cuando el
 * servidor declara ACCESOS_DEMO=true y una clave compartida de al menos 8
 * caracteres. Sin ambas, los usuarios de prueba (usuario.es_demo) son inertes.
 */
// Contraseña TEMPORAL común de los usuarios de prueba (fase de validación).
// Se muestra en la pantalla de ingreso y cada perfil la carga con un clic.
// ACCESOS_DEMO_CLAVE la sustituye. Antes de producción se elimina todo esto.
export const CLAVE_DEMO_EMBEBIDA = "LimsIdic2026";

export function accesosDemo(): { habilitado: boolean; clave: string; mostrarClave: boolean } {
  const clave = process.env.ACCESOS_DEMO_CLAVE || CLAVE_DEMO_EMBEBIDA;
  const habilitado = process.env.ACCESOS_DEMO === "true" && clave.length >= 8;
  // Visible por defecto; ACCESOS_DEMO_MOSTRAR_CLAVE=false la oculta.
  return { habilitado, clave, mostrarClave: habilitado && process.env.ACCESOS_DEMO_MOSTRAR_CLAVE !== "false" };
}

/** Comparación en tiempo constante (sobre SHA-256, para igualar longitudes). */
function mismaClave(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export interface AccesoDemo {
  username: string;
  nombre: string;
  cargo: string | null;
  rol: string;
  rolNombre: string;
  unidad: string | null;
  unidadNombre: string | null;
  unidadTipo: string | null;
  /** Departamento (o unidad de apoyo) del que cuelga la unidad; null = sin unidad. */
  grupo: string | null;
  grupoNombre: string | null;
}

@Injectable()
export class AuthService {
  // En módulo real se inyecta PrismaService; aquí instanciamos para simplicidad
  private prisma = new PrismaClient();

  // AlcanceService (AlcanceModule @Global) calcula unidades visibles y perfil.
  constructor(
    private readonly jwt: JwtService,
    private readonly alcance: AlcanceService,
  ) {}

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
    const demo = accesosDemo();
    if (!usuario.passwordHash && demo.habilitado && (await this.esUsuarioDemo(usuario.id))) {
      // Usuario de prueba: sin contraseña propia, entra con la clave compartida
      // del servidor. Fuera de un entorno con ACCESOS_DEMO esta rama no existe.
      if (!mismaClave(password, demo.clave)) {
        await this.prisma.usuario.update({
          where: { id: usuario.id },
          data: { intentosFallidos: { increment: 1 }, updatedAt: new Date() },
        });
        throw new UnauthorizedException("Credenciales inválidas");
      }
    } else if (usuario.passwordHash) {
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

    return this.emitirSesion(usuario);
  }

  /**
   * JWT de acceso + refresh y datos del usuario. Lo usan el login y el cambio de
   * contraseña (que re-emite la sesión ya sin la marca de cambio pendiente).
   */
  private async emitirSesion(usuario: {
    id: string;
    username: string;
    tenantId: string;
    nombreCompleto: string;
    email: string | null;
    grado: string | null;
    cargo: string | null;
    tokenVersion?: number | null;
    debeCambiarPassword?: boolean | null;
  }) {
    // Cargar roles y permisos efectivos del usuario para el RBAC
    const { roles, permisos, unidades, unidadGlobal, perfil } = await this.rolesYPermisos(usuario.id, usuario.tenantId);
    const cambioClave = usuario.debeCambiarPassword === true;

    const payload = {
      sub: usuario.id,
      username: usuario.username,
      tenantId: usuario.tenantId,
      roles,
      permisos,
      // Alcance por laboratorio: los ids de unidad a los que el usuario está
      // acotado. Si `unidadGlobal` es true (rol global o transversal) ve todo.
      unidades,
      unidadGlobal,
      // Perfil de bandeja (DIRECTOR, JEFE_DEPTO, ..., ANALISTA, ADMIN, LECTOR).
      perfil,
      // Contraseña temporal: hasta cambiarla, PermisoGuard solo deja usar las
      // rutas de cambio de contraseña (@PermiteCambioClavePendiente).
      ...(cambioClave ? { cambioClave: true } : {}),
      // Versión de token: se incrementa en cada logout. El refresh token solo
      // renueva si su `tv` coincide con el actual del usuario (invalida sesiones
      // tras logout sin necesidad de blacklist en Redis).
      tv: usuario.tokenVersion ?? 0,
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
      // La pantalla de ingreso pide el cambio antes de entrar al sistema.
      debeCambiarPassword: cambioClave,
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

  /**
   * Cambio de contraseña por el propio usuario (Mi perfil y primer ingreso).
   * Exige la contraseña actual y las reglas mínimas (auth/clave.ts). Quita la
   * marca de cambio obligatorio, invalida los refresh tokens anteriores
   * (tokenVersion++) y devuelve una sesión nueva.
   */
  async cambiarPassword(usuarioId: string, actual: string, nueva: string) {
    const usuario = await this.prisma.usuario.findFirst({ where: { id: usuarioId, deletedAt: null, estado: "activo" } });
    if (!usuario) throw new UnauthorizedException();
    if (!usuario.passwordHash) {
      if (await this.esUsuarioDemo(usuario.id)) {
        throw new BadRequestException("Los usuarios de prueba comparten una contraseña fija y no pueden cambiarla.");
      }
      throw new BadRequestException(
        "Su cuenta no tiene contraseña local (ingresa con la cuenta institucional): cámbiela en el directorio del Ejército.",
      );
    }
    if (!(await argon2.verify(usuario.passwordHash, actual))) {
      await this.prisma.usuario.update({
        where: { id: usuario.id },
        data: { intentosFallidos: { increment: 1 }, updatedAt: new Date() },
      });
      throw new BadRequestException("La contraseña actual no es correcta.");
    }
    const errores = erroresNuevaClave(nueva, { actual, username: usuario.username });
    if (errores.length) throw new BadRequestException({ statusCode: 400, message: errores.join(" "), errores });

    const actualizado = await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        passwordHash: await argon2.hash(nueva),
        debeCambiarPassword: false,
        passwordCambiadaAt: new Date(),
        intentosFallidos: 0,
        tokenVersion: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    return { ok: true, mensaje: "Contraseña actualizada.", ...(await this.emitirSesion(actualizado)) };
  }

  /** ¿Es un usuario de prueba? Tolera bases sin align_accesos_demo.sql. */
  private async esUsuarioDemo(usuarioId: string): Promise<boolean> {
    try {
      const filas = await this.prisma.$queryRaw<Array<{ es_demo: boolean }>>`
        SELECT es_demo FROM usuario WHERE id = ${usuarioId}::uuid`;
      return filas[0]?.es_demo === true;
    } catch {
      return false;
    }
  }

  /**
   * Lista pública de accesos de prueba para la pantalla de ingreso. Vacía y
   * `habilitado: false` cuando el servidor no los tiene activados. La clave solo
   * se devuelve si además se pidió expresamente mostrarla.
   */
  async accesosDemo(): Promise<{ habilitado: boolean; clave?: string; usuarios: AccesoDemo[] }> {
    const cfg = accesosDemo();
    if (!cfg.habilitado) return { habilitado: false, usuarios: [] };
    let usuarios: AccesoDemo[] = [];
    try {
      usuarios = await this.prisma.$queryRaw<AccesoDemo[]>`
        WITH RECURSIVE sube AS (
          SELECT u.id AS origen, u.id, u.padre_id, u.codigo, u.nombre, u.tipo, 0 AS nivel
            FROM unidad u
          UNION ALL
          SELECT s.origen, p.id, p.padre_id, p.codigo, p.nombre, p.tipo, s.nivel + 1
            FROM sube s JOIN unidad p ON p.id = s.padre_id
           WHERE s.nivel < 8
        ), grupo AS (
          -- El grupo es el ancestro de tipo DEPARTAMENTO o APOYO (o la propia unidad).
          SELECT DISTINCT ON (origen) origen, codigo, nombre
            FROM sube
           WHERE tipo IN ('DEPARTAMENTO', 'APOYO', 'DIRECCION')
           ORDER BY origen, (tipo = 'DIRECCION'), nivel
        )
        SELECT us.username::text       AS username,
               us.nombre_completo      AS nombre,
               us.cargo                AS cargo,
               r.codigo                AS rol,
               r.nombre                AS "rolNombre",
               un.codigo               AS unidad,
               un.nombre               AS "unidadNombre",
               un.tipo                 AS "unidadTipo",
               g.codigo                AS grupo,
               g.nombre                AS "grupoNombre"
          FROM usuario us
          JOIN usuario_rol ur ON ur.usuario_id = us.id
          JOIN rol r          ON r.id = ur.rol_id
          LEFT JOIN unidad un ON un.id = ur.unidad_id
          LEFT JOIN grupo g   ON g.origen = un.id
         WHERE us.es_demo AND us.deleted_at IS NULL AND us.estado = 'activo'
         ORDER BY g.codigo NULLS FIRST, un.codigo NULLS FIRST, r.orden NULLS LAST, us.username`;
    } catch {
      usuarios = [];
    }
    return { habilitado: true, ...(cfg.mostrarClave ? { clave: cfg.clave } : {}), usuarios };
  }

  /**
   * Roles (códigos), permisos y alcance por unidad del usuario, para el JWT.
   * Solo cuentan las asignaciones VIGENTES (vigente_desde/hasta). El alcance lo
   * calcula AlcanceService con la misma regla que se aplica en vivo en /ot:
   *   · unidades     = unidades VISIBLES (unidad, o unidad + descendencia para
   *                    roles DESCENDENCIA y jefaturas). Vacío si unidadGlobal.
   *   · unidadGlobal = rol GLOBAL (SUPERADMIN/ADMIN/DIRECTOR/... ) o asignación
   *                    legada sin unidad.
   */
  async rolesYPermisos(
    usuarioId: string,
    tenantId?: string,
  ): Promise<{ roles: string[]; permisos: string[]; unidades: string[]; unidadGlobal: boolean; perfil: string }> {
    const ctx = await this.alcance.contexto(usuarioId, tenantId);
    const vigentes = ctx.asignacionesVigentes;
    const roles = [...new Set(vigentes.map((a) => a.rolCodigo))];
    const rolIds = [...new Set(vigentes.map((a) => a.rolId))];
    if (rolIds.length === 0) {
      // Sin roles: sin permisos. Se mantiene unidadGlobal=true como antes para
      // no alterar el comportamiento de tokens sin RBAC (no tiene permisos igual).
      return { roles, permisos: [], unidades: ctx.unidadIds, unidadGlobal: ctx.esGlobal || ctx.unidadIds.length === 0, perfil: ctx.perfil };
    }
    const rp = await this.prisma.rolPermiso.findMany({
      where: { rolId: { in: rolIds } },
      include: { permiso: true },
    });
    const permisos = [...new Set(rp.map((x) => x.permiso.codigo))];
    return { roles, permisos, unidades: ctx.esGlobal ? [] : ctx.unidadIds, unidadGlobal: ctx.esGlobal, perfil: ctx.perfil };
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
        select: { tokenVersion: true, debeCambiarPassword: true },
      });
      if (!usuario || (usuario.tokenVersion ?? 0) !== (payload.tv ?? 0)) {
        throw new UnauthorizedException("Refresh token inválido");
      }
      const { roles, permisos, unidades, unidadGlobal, perfil } = await this.rolesYPermisos(payload.sub, payload.tenantId);
      const accessToken = this.jwt.sign({
        sub: payload.sub,
        username: payload.username,
        tenantId: payload.tenantId,
        roles,
        permisos,
        unidades,
        unidadGlobal,
        perfil,
        ...(usuario.debeCambiarPassword ? { cambioClave: true } : {}),
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
        debeCambiarPassword: true,
        passwordCambiadaAt: true,
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
