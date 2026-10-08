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

const UsuarioCreate = z.object({
  username: z.string().min(2).max(60),
  nombreCompleto: z.string().min(2).max(200),
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().min(4).max(200),
  grado: z.string().max(80).optional(),
  cargo: z.string().max(200).optional(),
  rolId: z.string().uuid().optional(),
  // Unidad a la que se acota el rol. Vacío = sin unidad (solo válido para roles GLOBAL).
  unidadId: z.string().uuid().optional().or(z.literal("")),
});

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
    if (dto.rolId) await this.validarAsignacion(dto.rolId, dto.unidadId || null, tenantId, false);
    const passwordHash = await hashArgon2(dto.password);
    const u = await this.prisma.usuario.create({
      data: {
        tenantId,
        username: dto.username,
        email: dto.email ? dto.email : null,
        nombreCompleto: dto.nombreCompleto,
        grado: dto.grado ?? null,
        cargo: dto.cargo ?? null,
        passwordHash,
        estado: "activo",
      },
    });
    if (dto.rolId) {
      await this.prisma.usuarioRol.create({
        data: { usuarioId: u.id, rolId: dto.rolId, unidadId: dto.unidadId ? dto.unidadId : null },
      });
    }
    return aDto(await this.cargar(u.id, tenantId));
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
    if (data.estado === "activo") data.intentosFallidos = 0;
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

  /** Soft-delete: marca deletedAt y deja el usuario en estado 'inactivo'. */
  @Delete(":id")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.cargar(id, tenantDe(req));
    const u = await this.prisma.usuario.update({
      where: { id },
      data: { deletedAt: new Date(), estado: "inactivo" },
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
