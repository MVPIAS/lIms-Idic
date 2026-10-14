import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { randomInt } from "crypto";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { alcanceDe } from "./alcance";

/**
 * Alta de usuario. Lo usan las dos pantallas:
 *   · Administración › Usuarios: envía `nombre` (alias de nombreCompleto), sin
 *     contraseña → el servidor genera una TEMPORAL, la devuelve UNA vez
 *     (`passwordTemporal`) y marca el cambio obligatorio en el primer ingreso.
 *   · Vista clásica: envía `nombreCompleto` y `password` elegida por el
 *     administrador; también queda con cambio obligatorio.
 */
const UsuarioCreate = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "El usuario debe tener al menos 3 caracteres.")
      .max(60)
      .regex(/^[a-zA-Z0-9._-]+$/, "El usuario solo admite letras, números, punto, guion y guion bajo."),
    nombreCompleto: z.string().trim().min(2).max(200).optional(),
    /** Alias de nombreCompleto (pantalla de Administración). */
    nombre: z.string().trim().min(2).max(200).optional(),
    email: z.string().email("Correo no válido").optional().nullable().or(z.literal("")),
    password: z.string().min(4).max(200).optional().or(z.literal("")),
    grado: z.string().max(80).optional().nullable(),
    cargo: z.string().max(200).optional().nullable(),
    rolId: z.string().uuid().optional().or(z.literal("")),
    // Unidad a la que se acota el rol. Vacío = sin unidad (solo válido para roles GLOBAL).
    unidadId: z.string().uuid().optional().nullable().or(z.literal("")),
  })
  .refine((d) => d.nombreCompleto || d.nombre, { message: "Indique el nombre completo.", path: ["nombre"] });

const UsuarioUpdate = z.object({
  nombreCompleto: z.string().min(2).max(200).optional(),
  /** Alias de nombreCompleto. */
  nombre: z.string().min(2).max(200).optional(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  grado: z.string().max(80).optional().nullable(),
  cargo: z.string().max(200).optional().nullable(),
  estado: z.enum(["activo", "inactivo", "bloqueado"]).optional(),
  /** true → estado 'activo'; false → 'inactivo'. */
  activo: z.boolean().optional(),
  // LEGACY: si viene rolId se REEMPLAZAN todas las asignaciones por esta.
  rolId: z.string().uuid().optional(),
  unidadId: z.string().uuid().optional().or(z.literal("")),
});

const AsignacionCreate = z.object({
  rolId: z.string().uuid(),
  unidadId: z.string().uuid().nullable().optional(),
  vigenteDesde: z.coerce.date().optional(),
  vigenteHasta: z.coerce.date().nullable().optional(),
});

const SELECT_USUARIO = {
  id: true,
  username: true,
  email: true,
  nombreCompleto: true,
  grado: true,
  cargo: true,
  estado: true,
  totpActivo: true,
  debeCambiarPassword: true,
  ultimoLoginAt: true,
  createdAt: true,
  tenantId: true,
} as const;

const INCLUDE_ASIGNACIONES = {
  usuarioRoles: {
    include: {
      rol: { select: { id: true, codigo: true, nombre: true, nivel: true, alcance: true, aliasDe: true } },
      unidad: { select: { id: true, codigo: true, nombre: true, tipo: true } },
    },
    orderBy: { vigenteDesde: "asc" as const },
  },
} as const;

function aDto(u: any) {
  const { usuarioRoles = [], ...rest } = u;
  const asignaciones = usuarioRoles.map((ur: any) => ({
    id: ur.id,
    rol: { id: ur.rol.id, codigo: ur.rol.codigo, nombre: ur.rol.nombre, nivel: ur.rol.nivel ?? null },
    unidad: ur.unidad ?? null,
    vigenteDesde: ur.vigenteDesde,
    vigenteHasta: ur.vigenteHasta ?? null,
  }));
  return {
    ...rest,
    nombre: rest.nombreCompleto,
    activo: rest.estado === "activo",
    asignaciones,
    // Compatibilidad con la pantalla actual de usuarios (lee usuarioRoles[].rol).
    usuarioRoles: usuarioRoles.map((ur: any) => ({
      id: ur.id,
      rolId: ur.rolId,
      unidadId: ur.unidadId,
      vigenteDesde: ur.vigenteDesde,
      vigenteHasta: ur.vigenteHasta,
      rol: { id: ur.rol.id, codigo: ur.rol.codigo, nombre: ur.rol.nombre },
    })),
  };
}

function tenantDe(req: any): string | undefined {
  return req?.user?.tenantId;
}

/** Contraseña temporal legible (sin 0/O/1/l/I), 12 caracteres. */
function passwordTemporal(): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 12; i++) s += alfabeto[randomInt(alfabeto.length)];
  return s;
}

async function hashArgon2(password: string): Promise<string> {
  try {
    // import diferido: si el binario nativo de argon2 no carga en este entorno,
    // falla SOLO esta operación (500 explícito) y no el arranque de la API.
    const argon2 = await import("argon2");
    return await argon2.hash(password);
  } catch (e: any) {
    throw new InternalServerErrorException(
      `No se pudo generar el hash argon2 de la contraseña en este servidor (${e?.message ?? e}). ` +
        "Revise que el módulo nativo argon2 esté compilado para esta plataforma.",
    );
  }
}

/**
 * Usuarios y sus ASIGNACIONES de rol (rol + unidad + vigencia). Un usuario
 * puede tener varias asignaciones (p. ej. ANALISTA en LQC y REVISOR en LQA).
 * Todo exige admin.usuarios.
 */
@ApiTags("usuarios")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("usuarios")
@RequierePermiso("admin.usuarios")
export class UsuariosController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Req() req: any,
    @Query("q") q?: string,
    @Query("unidadId") unidadId?: string,
    @Query("rolId") rolId?: string,
    @Query("activo") activo?: string,
  ) {
    const tenantId = tenantDe(req);
    const where: any = { deletedAt: null, ...(tenantId ? { tenantId } : {}) };
    if (q?.trim()) {
      const t = q.trim();
      where.OR = [
        { username: { contains: t, mode: "insensitive" } },
        { nombreCompleto: { contains: t, mode: "insensitive" } },
        { email: { contains: t, mode: "insensitive" } },
        { cargo: { contains: t, mode: "insensitive" } },
      ];
    }
    if (unidadId || rolId) {
      where.usuarioRoles = { some: { ...(unidadId ? { unidadId } : {}), ...(rolId ? { rolId } : {}) } };
    }
    if (activo === "true") where.estado = "activo";
    else if (activo === "false") where.estado = { not: "activo" };

    const data = await this.prisma.usuario.findMany({
      where,
      select: { ...SELECT_USUARIO, ...INCLUDE_ASIGNACIONES },
      orderBy: { username: "asc" },
      take: 500,
    });
    return { data: data.map(aDto), meta: { page: 1, limit: 500, total: data.length, totalPages: 1 } };
  }

  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const u = await this.cargar(id, tenantDe(req));
    const jefaturas = await this.prisma.unidadJefe.findMany({
      where: { usuarioId: id },
      select: { rol: true, unidad: { select: { id: true, codigo: true, nombre: true, tipo: true } } },
    });
    return { ...aDto(u), jefaturas: jefaturas.map((j) => ({ rol: j.rol, unidad: j.unidad })) };
  }

  @Post()
  async crear(@Body() body: unknown, @Req() req: any) {
    const dto = UsuarioCreate.parse(body);
    const tenantId = tenantDe(req) ?? (await this.prisma.tenant.findFirst())?.id;
    if (!tenantId) throw new BadRequestException("No hay tenant");
    const dup = await this.prisma.usuario.findFirst({ where: { tenantId, username: dto.username } });
    if (dup) throw new ConflictException(`Ya existe el usuario ${dto.username}`);
    if (dto.email) {
      const dupMail = await this.prisma.usuario.findFirst({ where: { tenantId, email: dto.email } });
      if (dupMail) throw new ConflictException(`El correo ${dto.email} ya está registrado para ${dupMail.username}`);
    }
    if (dto.rolId) await this.validarAsignacion(dto.rolId, dto.unidadId || null, tenantId, false);
    // Sin contraseña elegida → temporal generada, que se devuelve UNA sola vez.
    const temporal = dto.password ? null : passwordTemporal();
    const passwordHash = await hashArgon2(dto.password || (temporal as string));
    const u = await this.prisma.usuario.create({
      data: {
        tenantId,
        username: dto.username,
        email: dto.email ? dto.email : null,
        nombreCompleto: (dto.nombreCompleto ?? dto.nombre) as string,
        grado: dto.grado ?? null,
        cargo: dto.cargo ?? null,
        passwordHash,
        estado: "activo",
        // «Deberá cambiarla en su primer ingreso»: lo impone PermisoGuard.
        debeCambiarPassword: true,
      },
    });
    if (dto.rolId) {
      await this.prisma.usuarioRol.create({
        data: { usuarioId: u.id, rolId: dto.rolId, unidadId: dto.unidadId ? dto.unidadId : null },
      });
    }
    return { ...aDto(await this.cargar(u.id, tenantId)), ...(temporal ? { passwordTemporal: temporal } : {}) };
  }

  /**
   * Datos básicos. NO toca las asignaciones de rol, salvo que venga el campo
   * legacy `rolId` (entonces reemplaza todas por esa única asignación).
   */
  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = UsuarioUpdate.parse(body);
    const tenantId = tenantDe(req);
    const actual = await this.cargar(id, tenantId);

    const data: any = {};
    if (dto.nombreCompleto !== undefined) data.nombreCompleto = dto.nombreCompleto;
    if (dto.nombre !== undefined) data.nombreCompleto = dto.nombre;
    if (dto.email !== undefined) data.email = dto.email ? dto.email : null;
    if (dto.grado !== undefined) data.grado = dto.grado;
    if (dto.cargo !== undefined) data.cargo = dto.cargo;
    if (dto.estado !== undefined) data.estado = dto.estado;
    if (dto.activo !== undefined) data.estado = dto.activo ? "activo" : "inactivo";
    if (data.estado && data.estado !== "activo" && req?.user?.sub === id) {
      throw new BadRequestException("No puede desactivar su propia cuenta.");
    }
    if (data.estado === "activo") data.intentosFallidos = 0;
    // Desactivar/bloquear corta las sesiones abiertas (los refresh dejan de renovar).
    if (data.estado && data.estado !== "activo" && actual.estado === "activo") data.tokenVersion = { increment: 1 };
    if (Object.keys(data).length) {
      data.updatedAt = new Date();
      await this.prisma.usuario.update({ where: { id }, data });
    }

    if (dto.rolId) {
      await this.validarAsignacion(dto.rolId, dto.unidadId || null, actual.tenantId, false);
      await this.prisma.$transaction([
        this.prisma.usuarioRol.deleteMany({ where: { usuarioId: id } }),
        this.prisma.usuarioRol.create({
          data: { usuarioId: id, rolId: dto.rolId, unidadId: dto.unidadId ? dto.unidadId : null },
        }),
      ]);
    }
    return aDto(await this.cargar(id, tenantId));
  }

  /**
   * «Desactivar» (REVERSIBLE): estado 'inactivo' e invalida sus sesiones. NO
   * marca deletedAt: el usuario sigue en la lista (filtro «Inactivos») y se
   * reactiva con PATCH { activo: true }. Antes se borraba lógicamente y la
   * persona desaparecía sin poder reactivarse. Su historial se conserva.
   */
  @Delete(":id")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    if (req?.user?.sub === id) throw new BadRequestException("No puede desactivar su propia cuenta.");
    await this.cargar(id, tenantDe(req));
    const u = await this.prisma.usuario.update({
      where: { id },
      data: { estado: "inactivo", tokenVersion: { increment: 1 }, updatedAt: new Date() },
      select: SELECT_USUARIO,
    });
    return u;
  }

  @Post(":id/asignaciones")
  async asignar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = AsignacionCreate.parse(body);
    const usuario = await this.cargar(id, tenantDe(req));
    const unidadId = dto.unidadId ?? null;
    await this.validarAsignacion(dto.rolId, unidadId, usuario.tenantId);
    if (dto.vigenteDesde && dto.vigenteHasta && dto.vigenteHasta <= dto.vigenteDesde) {
      throw new BadRequestException("vigenteHasta debe ser posterior a vigenteDesde");
    }
    const dup = await this.prisma.usuarioRol.findFirst({ where: { usuarioId: id, rolId: dto.rolId, unidadId } });
    if (dup) throw new ConflictException("El usuario ya tiene ese rol en esa unidad");
    const a = await this.prisma.usuarioRol.create({
      data: {
        usuarioId: id,
        rolId: dto.rolId,
        unidadId,
        ...(dto.vigenteDesde ? { vigenteDesde: dto.vigenteDesde } : {}),
        vigenteHasta: dto.vigenteHasta ?? null,
      },
      include: INCLUDE_ASIGNACIONES.usuarioRoles.include,
    });
    return {
      id: a.id,
      rol: { id: a.rol.id, codigo: a.rol.codigo, nombre: a.rol.nombre, nivel: a.rol.nivel ?? null },
      unidad: a.unidad ?? null,
      vigenteDesde: a.vigenteDesde,
      vigenteHasta: a.vigenteHasta ?? null,
    };
  }

  @Delete(":id/asignaciones/:asignacionId")
  async desasignar(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("asignacionId", ParseUUIDPipe) asignacionId: string,
    @Req() req: any,
  ) {
    await this.cargar(id, tenantDe(req));
    const a = await this.prisma.usuarioRol.findFirst({ where: { id: asignacionId, usuarioId: id } });
    if (!a) throw new NotFoundException(`asignación ${asignacionId} no encontrada`);
    await this.prisma.usuarioRol.delete({ where: { id: asignacionId } });
    return { ok: true, id: asignacionId };
  }

  /** Genera una contraseña temporal (se devuelve UNA vez) e invalida sesiones. */
  @Post(":id/reset-password")
  async resetPassword(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.cargar(id, tenantDe(req));
    const passwordTemporal_ = passwordTemporal();
    const passwordHash = await hashArgon2(passwordTemporal_);
    await this.prisma.usuario.update({
      where: { id },
      data: {
        passwordHash,
        intentosFallidos: 0,
        tokenVersion: { increment: 1 },
        // La temporal solo sirve para entrar y elegir una propia.
        debeCambiarPassword: true,
        updatedAt: new Date(),
      },
    });
    return { passwordTemporal: passwordTemporal_ };
  }

  private async cargar(id: string, tenantId?: string) {
    const u = await this.prisma.usuario.findFirst({
      where: { id, deletedAt: null, ...(tenantId ? { tenantId } : {}) },
      select: { ...SELECT_USUARIO, ...INCLUDE_ASIGNACIONES },
    });
    if (!u) throw new NotFoundException(`usuario ${id} no encontrado`);
    return u;
  }

  /**
   * Roles UNIDAD/DESCENDENCIA exigen unidad; roles GLOBAL no la admiten.
   * `estricto=false` (rutas legacy POST /usuarios y PATCH con rolId): solo valida
   * que rol y unidad existan, para no romper la pantalla actual (una asignación
   * sin unidad de un rol acotado se interpreta como global, igual que antes).
   */
  private async validarAsignacion(rolId: string, unidadId: string | null, tenantId: string, estricto = true) {
    const rol = await this.prisma.rol.findFirst({ where: { id: rolId, tenantId } });
    if (!rol) throw new BadRequestException("rolId no existe");
    const alcance = alcanceDe({ rolCodigo: rol.codigo, aliasDe: rol.aliasDe, alcance: rol.alcance, unidadId });
    if (!estricto) {
      if (unidadId && !(await this.prisma.unidad.findFirst({ where: { id: unidadId, tenantId } }))) {
        throw new BadRequestException("unidadId no existe");
      }
      return;
    }
    if (alcance === "GLOBAL" && unidadId) {
      throw new BadRequestException(`El rol ${rol.codigo} es GLOBAL: no se acota a una unidad (unidadId debe ser null)`);
    }
    if (alcance !== "GLOBAL" && !unidadId) {
      throw new BadRequestException(`El rol ${rol.codigo} tiene alcance ${alcance}: indique unidadId`);
    }
    if (unidadId) {
      const u = await this.prisma.unidad.findFirst({ where: { id: unidadId, tenantId } });
      if (!u) throw new BadRequestException("unidadId no existe");
      if (!u.activa) throw new BadRequestException(`La unidad ${u.codigo} está inactiva`);
    }
  }
}
