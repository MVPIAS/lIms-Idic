import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { ALCANCES, NIVELES_ROL } from "./rbac.constants";

const RolCreate = z.object({
  codigo: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Z0-9_]+$/, "codigo en MAYÚSCULAS, dígitos y _"),
  nombre: z.string().min(1).max(120),
  descripcion: z.string().optional().nullable(),
  nivel: z.enum(NIVELES_ROL).optional(),
  alcance: z.enum(ALCANCES).optional(),
  orden: z.number().int().optional(),
});
const RolUpdate = RolCreate.partial();

const PermisosBody = z.object({ codigos: z.array(z.string().min(1).max(80)) });

function tenantDe(req: any): string | undefined {
  return req?.user?.tenantId;
}

function aDto(r: any) {
  const { _count, ...rest } = r;
  return {
    ...rest,
    nPermisos: _count?.rolPermisos ?? 0,
    nUsuarios: _count?.usuarioRoles ?? 0,
  };
}

/**
 * Catálogo de roles y su matriz de permisos. Todo exige admin.roles.
 * (GET /permisos/matriz vive en PermisoController para no chocar con /permisos/:id.)
 */
@ApiTags("roles")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("roles")
@RequierePermiso("admin.roles")
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() req: any) {
    const tenantId = tenantDe(req);
    const data = await this.prisma.rol.findMany({
      where: tenantId ? { tenantId } : {},
      include: { _count: { select: { rolPermisos: true, usuarioRoles: true } } },
      orderBy: [{ orden: "asc" }, { codigo: "asc" }],
    });
    return { data: data.map(aDto), meta: { page: 1, limit: data.length, total: data.length, totalPages: 1 } };
  }

  @Post()
  async crear(@Body() body: unknown, @Req() req: any) {
    const dto = RolCreate.parse(body);
    const tenantId = tenantDe(req) ?? (await this.prisma.tenant.findFirst())?.id;
    if (!tenantId) throw new BadRequestException("No hay tenant");
    const dup = await this.prisma.rol.findFirst({ where: { tenantId, codigo: dto.codigo } });
    if (dup) throw new ConflictException(`Ya existe el rol ${dto.codigo}`);
    const r = await this.prisma.rol.create({
      data: {
        tenantId,
        codigo: dto.codigo,
        nombre: dto.nombre,
        descripcion: dto.descripcion ?? null,
        nivel: dto.nivel ?? "OPERATIVO",
        alcance: dto.alcance ?? "UNIDAD",
        orden: dto.orden ?? 100,
      },
      include: { _count: { select: { rolPermisos: true, usuarioRoles: true } } },
    });
    return aDto(r);
  }

  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = RolUpdate.parse(body);
    const actual = await this.cargar(id, tenantDe(req));
    if (dto.codigo && dto.codigo !== actual.codigo) {
      if (actual.esSistema) throw new ForbiddenException("No se puede cambiar el código de un rol de sistema");
      const dup = await this.prisma.rol.findFirst({ where: { tenantId: actual.tenantId, codigo: dto.codigo } });
      if (dup) throw new ConflictException(`Ya existe el rol ${dto.codigo}`);
    }
    if (actual.codigo === "SUPERADMIN" && (dto.alcance || dto.nivel)) {
      throw new ForbiddenException("SUPERADMIN no es editable");
    }
    const r = await this.prisma.rol.update({
      where: { id },
      data: dto,
      include: { _count: { select: { rolPermisos: true, usuarioRoles: true } } },
    });
    return aDto(r);
  }

  @Delete(":id")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const actual = await this.cargar(id, tenantDe(req));
    if (actual.esSistema) throw new ForbiddenException("No se puede eliminar un rol de sistema");
    await this.prisma.rol.delete({ where: { id } });
    return { ok: true, id };
  }

  /** Códigos de permiso del rol. */
  @Get(":id/permisos")
  async permisos(@Param("id", ParseUUIDPipe) id: string, @Req() req: any): Promise<string[]> {
    await this.cargar(id, tenantDe(req));
    const rp = await this.prisma.rolPermiso.findMany({
      where: { rolId: id },
      select: { permiso: { select: { codigo: true } } },
    });
    return rp.map((x) => x.permiso.codigo).sort();
  }

  /** Reemplaza el conjunto de permisos del rol. SUPERADMIN no es editable. */
  @Put(":id/permisos")
  async fijarPermisos(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any): Promise<string[]> {
    const { codigos } = PermisosBody.parse(body);
    const rol = await this.cargar(id, tenantDe(req));
    if (rol.codigo === "SUPERADMIN") throw new ForbiddenException("Los permisos de SUPERADMIN no son editables");
    const unicos = [...new Set(codigos)];
    const permisos = await this.prisma.permiso.findMany({ where: { codigo: { in: unicos } }, select: { id: true, codigo: true } });
    if (permisos.length !== unicos.length) {
      const conocidos = new Set(permisos.map((p) => p.codigo));
      throw new BadRequestException(`Permisos inexistentes: ${unicos.filter((c) => !conocidos.has(c)).join(", ")}`);
    }
    await this.prisma.$transaction([
      this.prisma.rolPermiso.deleteMany({ where: { rolId: id } }),
      this.prisma.rolPermiso.createMany({ data: permisos.map((p) => ({ rolId: id, permisoId: p.id })) }),
    ]);
    return permisos.map((p) => p.codigo).sort();
  }

  private async cargar(id: string, tenantId?: string) {
    const r = await this.prisma.rol.findFirst({ where: { id, ...(tenantId ? { tenantId } : {}) } });
    if (!r) throw new NotFoundException(`rol ${id} no encontrado`);
    return r;
  }
}
