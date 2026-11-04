import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "crypto";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { getJwtSecret } from "../common/jwt-secret";
import { AlcanceService } from "../rbac/alcance.service";
import { alcanceDe } from "../rbac/alcance";
import { codigoCanonico } from "../rbac/rbac.constants";
import {
  ESTADO_CUENTA_SERVICIO,
  ROLES_PROHIBIDOS_TOKEN,
  TIPO_TOKEN_INTEGRACION,
  VIGENCIA_MAX_DIAS,
  VIGENCIA_MIN_DIAS,
  bearerDe,
  estadoToken,
  expiracion,
  hashToken,
  motivoRechazo,
  permisosToken,
  sufijoToken,
  usernameServicio,
} from "./token-integracion.reglas";

/** Alta de un token de integración (Administración › API e integración). */
export const TokenIntegracionCrear = z.object({
  nombre: z
    .string({ required_error: "Indique el nombre del sistema que usará el token." })
    .trim()
    .min(3, "El nombre debe tener al menos 3 caracteres.")
    .max(120, "El nombre admite como máximo 120 caracteres."),
  descripcion: z.string().trim().max(1000, "La descripción admite como máximo 1000 caracteres.").optional().nullable(),
  rolId: z.string({ required_error: "Elija el rol con el que actuará el token." }).uuid("Elija el rol con el que actuará el token."),
  unidadId: z.string().uuid("La unidad elegida no es válida.").optional().nullable().or(z.literal("")),
  diasVigencia: z.coerce
    .number({ invalid_type_error: "Indique la vigencia en días." })
    .int("La vigencia debe ser un número entero de días.")
    .min(VIGENCIA_MIN_DIAS, `La vigencia mínima es ${VIGENCIA_MIN_DIAS} día.`)
    .max(VIGENCIA_MAX_DIAS, `La vigencia máxima es ${VIGENCIA_MAX_DIAS} días (dos años).`),
});

export const TokenIntegracionRevocar = z.object({
  motivo: z.string().trim().max(500, "El motivo admite como máximo 500 caracteres.").optional().nullable(),
});

/** Usuario que JwtStrategy deja en req.user cuando la petición trae un token de integración. */
export interface UsuarioIntegracion {
  sub: string;
  username: string;
  tenantId: string;
  roles: string[];
  permisos: string[];
  unidades: string[];
  unidadGlobal: boolean;
  perfil: string;
  cambioClave: false;
  integracion: { tokenId: string; nombre: string; auditarLecturas: boolean };
}

interface FilaToken {
  id: string;
  tenant_id: string;
  nombre: string;
  usuario_id: string;
  token_hash: string;
  expira_at: Date;
  revocado_at: Date | null;
  usuario_estado: string | null;
  usuario_borrado: boolean;
  username: string;
}

const tenantDe = (req: any): string | undefined => req?.user?.tenantId;

/** Lecturas del parámetro «auditar consultas», cacheadas un minuto por tenant. */
const TTL_PARAMETRO_MS = 60_000;

@Injectable()
export class TokenIntegracionService {
  /** Firmador propio: sin la caducidad por defecto de las sesiones (8 h). */
  private readonly firmador = new JwtService({ secret: getJwtSecret() });
  private readonly cacheAuditar = new Map<string, { exp: number; valor: boolean }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  // ------------------------------------------------------------ pantalla ---

  async listar(req: any) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT t.id, t.nombre, t.descripcion, t.sufijo, t.expira_at, t.ultimo_uso_at,
              host(t.ultimo_uso_ip) AS ultimo_uso_ip, t.usos::int AS usos, t.created_at,
              t.revocado_at, t.motivo_revocacion,
              u.username AS cuenta,
              r.id AS rol_id, r.codigo AS rol_codigo, r.nombre AS rol_nombre,
              un.id AS unidad_id, un.codigo AS unidad_codigo, un.nombre AS unidad_nombre,
              c.username AS creado_por, rv.username AS revocado_por
         FROM token_integracion t
         JOIN usuario u ON u.id = t.usuario_id
         JOIN rol r ON r.id = t.rol_id
         LEFT JOIN unidad un ON un.id = t.unidad_id
         LEFT JOIN usuario c ON c.id = t.creado_por
         LEFT JOIN usuario rv ON rv.id = t.revocado_por
        WHERE t.tenant_id = $1::uuid
        ORDER BY (t.revocado_at IS NULL) DESC, t.created_at DESC`,
      tenantDe(req),
    );
    const ahora = new Date();
    return filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      descripcion: f.descripcion,
      sufijo: f.sufijo,
      cuenta: f.cuenta,
      rol: { id: f.rol_id, codigo: f.rol_codigo, nombre: f.rol_nombre },
      unidad: f.unidad_id ? { id: f.unidad_id, codigo: f.unidad_codigo, nombre: f.unidad_nombre } : null,
      expiraAt: f.expira_at,
      ultimoUsoAt: f.ultimo_uso_at,
      ultimoUsoIp: f.ultimo_uso_ip,
      usos: Number(f.usos ?? 0),
      creadoAt: f.created_at,
      creadoPor: f.creado_por,
      revocadoAt: f.revocado_at,
      revocadoPor: f.revocado_por,
      motivoRevocacion: f.motivo_revocacion,
      estado: estadoToken({ revocadoAt: f.revocado_at, expiraAt: f.expira_at }, ahora),
    }));
  }

  /** Roles y unidades que se pueden elegir al crear un token. */
  async opciones(req: any) {
    const tenantId = tenantDe(req);
    const [roles, unidades] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, codigo, nombre, alcance, alias_de FROM rol WHERE tenant_id = $1::uuid ORDER BY orden, nombre`,
        tenantId,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, codigo, nombre, tipo FROM unidad WHERE tenant_id = $1::uuid AND activa ORDER BY codigo`,
        tenantId,
      ),
    ]);
    return {
      roles: roles
        .filter((r) => !ROLES_PROHIBIDOS_TOKEN.includes(codigoCanonico(r.alias_de ?? r.codigo)))
        .map((r) => ({
          id: r.id,
          codigo: r.codigo,
          nombre: r.nombre,
          // Alcance efectivo sin unidad: GLOBAL no admite unidad; el resto la exige.
          alcance: alcanceDe({ rolCodigo: r.codigo, aliasDe: r.alias_de, alcance: r.alcance, unidadId: null }),
        })),
      unidades,
      vigencias: [30, 90, 180, 365, 730],
    };
  }

  /**
   * Crea la cuenta de servicio, le asigna el rol y emite el token. Devuelve el
   * token en claro UNA sola vez; en la BD queda solo su hash.
   */
  async crear(body: unknown, req: any) {
    const dto = TokenIntegracionCrear.parse(body);
    const tenantId = tenantDe(req);
    if (!tenantId) throw new UnauthorizedException("Sesión sin institución.");
    const unidadId = dto.unidadId ? dto.unidadId : null;

    const rol = await this.prisma.rol.findFirst({ where: { id: dto.rolId, tenantId } });
    if (!rol) throw new BadRequestException("El rol elegido no existe.");
    if (ROLES_PROHIBIDOS_TOKEN.includes(codigoCanonico(rol.aliasDe ?? rol.codigo))) {
      throw new BadRequestException(`El rol ${rol.nombre} no se puede asignar a un token de integración: elija un rol con permisos acotados.`);
    }
    const alcance = alcanceDe({ rolCodigo: rol.codigo, aliasDe: rol.aliasDe, alcance: rol.alcance, unidadId });
    if (alcance === "GLOBAL" && unidadId) {
      throw new BadRequestException(`El rol ${rol.nombre} es de alcance global: no se acota a una unidad. Deje la unidad en blanco.`);
    }
    if (alcance !== "GLOBAL" && !unidadId) {
      throw new BadRequestException(`El rol ${rol.nombre} trabaja por unidad: indique el laboratorio o la unidad en la que actuará el token.`);
    }
    if (unidadId) {
      const u = await this.prisma.unidad.findFirst({ where: { id: unidadId, tenantId } });
      if (!u) throw new BadRequestException("La unidad elegida no existe.");
      if (!u.activa) throw new BadRequestException(`La unidad ${u.codigo} está inactiva.`);
    }

    const username = await this.usernameLibre(usernameServicio(dto.nombre), tenantId);
    const tokenId = randomUUID();
    const ahora = new Date();
    const expira = expiracion(ahora, dto.diasVigencia);
    const creadoPor = uuidONull(req?.user?.sub);

    const resultado = await this.prisma.$transaction(async (tx) => {
      const cuenta = await tx.usuario.create({
        data: {
          tenantId,
          username,
          nombreCompleto: `Integración: ${dto.nombre}`.slice(0, 200),
          cargo: "Cuenta de servicio (API)",
          estado: ESTADO_CUENTA_SERVICIO,
        },
      });
      await tx.usuarioRol.create({ data: { usuarioId: cuenta.id, rolId: rol.id, unidadId } });
      const token = this.firmador.sign(
        { sub: cuenta.id, username, tenantId, type: TIPO_TOKEN_INTEGRACION, jti: tokenId },
        { algorithm: "HS256", expiresIn: Math.floor((expira.getTime() - ahora.getTime()) / 1000) },
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO token_integracion
           (id, tenant_id, nombre, descripcion, usuario_id, rol_id, unidad_id, token_hash, sufijo, expira_at, creado_por)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7::uuid, $8, $9, $10::timestamptz, $11::uuid)`,
        tokenId,
        tenantId,
        dto.nombre,
        dto.descripcion || null,
        cuenta.id,
        rol.id,
        unidadId,
        hashToken(token),
        sufijoToken(token),
        expira.toISOString(),
        creadoPor,
      );
      return { token, cuenta: cuenta.username };
    });

    return {
      id: tokenId,
      nombre: dto.nombre,
      cuenta: resultado.cuenta,
      rol: { id: rol.id, codigo: rol.codigo, nombre: rol.nombre },
      expiraAt: expira,
      // Única vez que el token sale del servidor.
      token: resultado.token,
    };
  }

  async revocar(id: string, body: unknown, req: any) {
    const dto = TokenIntegracionRevocar.parse(body ?? {});
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `UPDATE token_integracion
          SET revocado_at = now(), revocado_por = $3::uuid, motivo_revocacion = $4
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND revocado_at IS NULL
        RETURNING id, nombre`,
      id,
      tenantDe(req),
      uuidONull(req?.user?.sub),
      dto.motivo || null,
    );
    if (!filas.length) {
      const existe = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT 1 FROM token_integracion WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        id,
        tenantDe(req),
      );
      if (!existe.length) throw new NotFoundException("El token de integración no existe.");
      throw new BadRequestException("El token ya estaba revocado.");
    }
    return { id: filas[0].id, nombre: filas[0].nombre, revocado: true };
  }

  // ------------------------------------------------------- autenticación ---

  /**
   * Valida un token de integración presentado como Bearer (lo llama JwtStrategy
   * tras verificar la firma) y devuelve el usuario para req.user. Se memoiza en
   * el request: los AuthGuard("jwt") de los controladores repiten la validación.
   */
  async validar(req: any, payload: { sub?: string; jti?: string }): Promise<UsuarioIntegracion> {
    if (req?.__usuarioIntegracion) return req.__usuarioIntegracion;
    const crudo = bearerDe(req?.headers?.authorization);
    if (!crudo || !payload?.jti || !uuidONull(payload.jti)) {
      throw new UnauthorizedException("El token de integración no es válido.");
    }
    const [fila] = await this.prisma.$queryRawUnsafe<FilaToken[]>(
      `SELECT t.id, t.tenant_id, t.nombre, t.usuario_id, t.token_hash, t.expira_at, t.revocado_at,
              u.estado AS usuario_estado, (u.deleted_at IS NOT NULL) AS usuario_borrado, u.username
         FROM token_integracion t
         JOIN usuario u ON u.id = t.usuario_id
        WHERE t.id = $1::uuid`,
      payload.jti,
    );
    const motivo = motivoRechazo(
      fila
        ? {
            usuarioId: fila.usuario_id,
            tokenHash: fila.token_hash,
            revocadoAt: fila.revocado_at,
            expiraAt: fila.expira_at,
            usuarioEstado: fila.usuario_estado,
            usuarioBorrado: fila.usuario_borrado,
          }
        : null,
      { sub: payload.sub, hash: hashToken(crudo) },
    );
    if (motivo || !fila) throw new UnauthorizedException(motivo ?? "El token de integración no es válido.");

    const ctx = await this.alcance.contexto(fila.usuario_id, fila.tenant_id);
    const roles = [...new Set(ctx.asignacionesVigentes.map((a) => a.rolCodigo))];
    const permisos = permisosToken(ctx.asignacionesVigentes.flatMap((a) => a.permisos ?? []));
    const usuario: UsuarioIntegracion = {
      sub: fila.usuario_id,
      username: fila.username,
      tenantId: fila.tenant_id,
      roles,
      permisos,
      unidades: ctx.esGlobal ? [] : ctx.unidadIds,
      unidadGlobal: ctx.esGlobal,
      perfil: ctx.perfil,
      cambioClave: false,
      integracion: { tokenId: fila.id, nombre: fila.nombre, auditarLecturas: await this.auditarLecturas(fila.tenant_id) },
    };
    if (req) req.__usuarioIntegracion = usuario;

    // Último uso: una escritura por petición (la memoización evita la segunda).
    void this.prisma
      .$executeRawUnsafe(
        `UPDATE token_integracion SET ultimo_uso_at = now(), ultimo_uso_ip = $2::inet, usos = usos + 1 WHERE id = $1::uuid`,
        fila.id,
        ipValida(req),
      )
      .catch(() => undefined);
    return usuario;
  }

  /** Parámetro integracion.auditar_lecturas (por defecto Sí). */
  private async auditarLecturas(tenantId: string): Promise<boolean> {
    const c = this.cacheAuditar.get(tenantId);
    if (c && c.exp > Date.now()) return c.valor;
    let valor = true;
    try {
      const [f] = await this.prisma.$queryRawUnsafe<{ valor: string | null; activo: boolean }[]>(
        `SELECT valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'integracion' AND codigo = 'auditar_lecturas'`,
        tenantId,
      );
      if (f && f.activo !== false) valor = String(f.valor ?? "si").trim().toLowerCase() !== "no";
    } catch {
      /* sin la tabla o la fila rige el valor por defecto */
    }
    this.cacheAuditar.set(tenantId, { exp: Date.now() + TTL_PARAMETRO_MS, valor });
    return valor;
  }

  /** Nombre de usuario libre en el tenant: «api.erp», «api.erp-2», «api.erp-3»… */
  private async usernameLibre(base: string, tenantId: string): Promise<string> {
    for (let i = 1; i < 100; i++) {
      const candidato = i === 1 ? base : `${base}-${i}`;
      const existe = await this.prisma.usuario.findFirst({ where: { tenantId, username: candidato }, select: { id: true } });
      if (!existe) return candidato;
    }
    return `${base}-${randomUUID().slice(0, 8)}`;
  }
}

function uuidONull(v: unknown): string | null {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

/** IP admisible por la columna INET (misma normalización que AuditInterceptor). */
function ipValida(req: any): string | null {
  const cruda: string | undefined = req?.ip ?? req?.socket?.remoteAddress;
  if (!cruda) return null;
  const ip = cruda.startsWith("::ffff:") ? cruda.slice(7) : cruda;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split(".").every((o) => Number(o) <= 255)) return ip;
  if (ip.includes(":") && /^[0-9a-fA-F:]+$/.test(ip)) return ip;
  return null;
}
