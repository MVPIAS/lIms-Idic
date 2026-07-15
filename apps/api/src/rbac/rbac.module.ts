import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ParseUUIDPipe,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import * as argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";

/* ===================== PERMISOS ===================== */
@Injectable()
export class PermisoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "permiso", search: ["codigo", "modulo", "accion"], tenant: false, softDelete: false, orderBy: { codigo: "asc" } });
  }
}
const PermisoCreate = z.object({
  codigo: z.string().min(1).max(80),
  modulo: z.string().min(1).max(40),
  accion: z.string().min(1).max(40),
  descripcion: z.string().optional(),
});
// Ejemplo de RBAC por ruta: gestionar permisos exige 'admin.usuarios'.
// (mismo patrón aplicable a cualquier controlador: @UseGuards(AuthGuard('jwt'), PermisoGuard) + @RequierePermiso)
@ApiTags("permisos") @ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@RequierePermiso("admin.usuarios")
@Controller("permisos")
export class PermisoController extends BaseCrudController {
  protected createSchema = PermisoCreate;
  protected updateSchema = PermisoCreate.partial();
  constructor(protected svc: PermisoService) { super(); }
}

/* ===================== FIRMAS (imagen + HASH por usuario) ===================== */
@Injectable()
export class FirmaService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "firma", search: [], tenant: false, softDelete: false, orderBy: { registradaAt: "desc" } });
  }
  /** Registra/actualiza la firma de un usuario (upsert por usuario_id). */
  async registrar(dto: any) {
    return this.prisma.firma.upsert({
      where: { usuarioId: dto.usuarioId },
      create: { usuarioId: dto.usuarioId, imagenRef: dto.imagenRef, hashSha256: dto.hashSha256 },
      update: { imagenRef: dto.imagenRef, hashSha256: dto.hashSha256, registradaAt: new Date() },
    });
  }
}
const FirmaCreate = z.object({
  usuarioId: z.string().uuid(),
  imagenRef: z.string().max(200),
  hashSha256: z.string().max(64).optional(),
});
/**
 * Todo el dominio de firmas se gobierna con el único permiso sembrado,
 * `firma.registrar` (no existen firma.ver/eliminar). La lectura también lo
 * exige: el listado expone las firmas-imagen y sus hashes de todos los usuarios,
 * así que no debe quedar al alcance de cualquier autenticado.
 */
@ApiTags("firmas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("firmas")
@RequierePermisoCrud({
  ver: "firma.registrar",
  crear: "firma.registrar",
  editar: "firma.registrar",
  eliminar: "firma.registrar",
})
export class FirmaController extends BaseCrudController {
  protected updateSchema = FirmaCreate.partial();
  constructor(protected svc: FirmaService) { super(); }
  // POST /firmas hace upsert por usuario (registrar/actualizar)
  @Post()
  @RequierePermiso("firma.registrar")
  crear(@Body() body: unknown) {
    return (this.svc as FirmaService).registrar(FirmaCreate.parse(body));
  }
}

/* ===================== USUARIOS y ROLES (lectura) ===================== */
const UsuarioCreate = z.object({
  username: z.string().min(2).max(60),
  nombreCompleto: z.string().min(2).max(200),
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().min(4).max(200),
  grado: z.string().max(80).optional(),
  cargo: z.string().max(200).optional(),
  rolId: z.string().uuid().optional(),
});

const UsuarioUpdate = z.object({
  nombreCompleto: z.string().min(2).max(200).optional(),
  email: z.string().email().optional().or(z.literal("")),
  grado: z.string().max(80).optional(),
  cargo: z.string().max(200).optional(),
  estado: z.enum(["activo", "inactivo", "bloqueado"]).optional(),
  rolId: z.string().uuid().optional(),
});

// Gestión de usuarios: `admin.usuarios` en los cuatro verbos (era la brecha
// verificada: un LECTOR podía listar todos los usuarios).
@ApiTags("usuarios") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("usuarios")
@RequierePermiso("admin.usuarios")
export class UsuarioController {
  private prisma = new PrismaClient();
  @Get()
  async list(@Req() req: any) {
    const data = await this.prisma.usuario.findMany({
      // Usuario tiene tenant_id: solo se listan los usuarios del tenant del solicitante.
      where: { deletedAt: null, ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}) },
      include: { usuarioRoles: { include: { rol: true } } },
      orderBy: { username: "asc" },
      take: 200,
    });
    return { data, meta: { page: 1, limit: 200, total: data.length, totalPages: 1 } };
  }

  @Post()
  async crear(@Body() body: unknown, @Req() req: any) {
    const dto = UsuarioCreate.parse(body);
    const tenantId = req.user?.tenantId ?? (await this.prisma.tenant.findFirst())?.id;
    const passwordHash = await argon2.hash(dto.password);
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
      await this.prisma.usuarioRol.create({ data: { usuarioId: u.id, rolId: dto.rolId } });
    }
    const { passwordHash: _omit, ...safe } = u as any;
    return safe;
  }

  /** Editar datos del usuario (no toca passwordHash). Opcionalmente reasigna su rol. */
  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = UsuarioUpdate.parse(body);
    const tenantId = req.user?.tenantId;
    // Verifica existencia + pertenencia al tenant (no revela usuarios de otros tenants).
    const actual = await this.prisma.usuario.findFirst({
      where: { id, deletedAt: null, ...(tenantId ? { tenantId } : {}) },
    });
    if (!actual) throw new NotFoundException(`usuario ${id} no encontrado`);

    const { rolId, email, ...campos } = dto;
    const data: any = { ...campos };
    if (email !== undefined) data.email = email ? email : null;

    const u = await this.prisma.usuario.update({ where: { id }, data });

    // Reasignar rol: reemplaza los roles vigentes por el indicado.
    if (rolId) {
      await this.prisma.usuarioRol.deleteMany({ where: { usuarioId: id } });
      await this.prisma.usuarioRol.create({ data: { usuarioId: id, rolId } });
    }
    const { passwordHash: _omit, ...safe } = u as any;
    return safe;
  }

  /** Soft-delete: marca deletedAt y deja el usuario en estado 'inactivo'. */
  @Delete(":id")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId;
    const actual = await this.prisma.usuario.findFirst({
      where: { id, deletedAt: null, ...(tenantId ? { tenantId } : {}) },
    });
    if (!actual) throw new NotFoundException(`usuario ${id} no encontrado`);
    const u = await this.prisma.usuario.update({
      where: { id },
      data: { deletedAt: new Date(), estado: "inactivo" },
    });
    const { passwordHash: _omit, ...safe } = u as any;
    return safe;
  }
}

const RolCreate = z.object({
  codigo: z.string().min(1).max(40),
  nombre: z.string().min(1).max(120),
  descripcion: z.string().optional(),
});
const RolUpdate = RolCreate.partial();

// Los roles son la definición del RBAC: mismo permiso que usuarios/permisos.
@ApiTags("roles") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("roles")
@RequierePermiso("admin.usuarios")
export class RolController {
  private prisma = new PrismaClient();
  @Get()
  async list(@Req() req: any) {
    // Rol tiene tenant_id: solo los roles del tenant del solicitante.
    const data = await this.prisma.rol.findMany({
      where: { ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}) },
      orderBy: { codigo: "asc" },
    });
    return { data, meta: { page: 1, limit: data.length, total: data.length, totalPages: 1 } };
  }

  @Post()
  async crear(@Body() body: unknown, @Req() req: any) {
    const dto = RolCreate.parse(body);
    const tenantId = req.user?.tenantId ?? (await this.prisma.tenant.findFirst())?.id;
    return this.prisma.rol.create({
      data: {
        tenantId,
        codigo: dto.codigo,
        nombre: dto.nombre,
        descripcion: dto.descripcion ?? null,
      },
    });
  }

  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = RolUpdate.parse(body);
    const tenantId = req.user?.tenantId;
    const actual = await this.prisma.rol.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!actual) throw new NotFoundException(`rol ${id} no encontrado`);
    return this.prisma.rol.update({ where: { id }, data: dto });
  }

  @Delete(":id")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId;
    const actual = await this.prisma.rol.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!actual) throw new NotFoundException(`rol ${id} no encontrado`);
    // Los roles de sistema no se pueden borrar (protegen el RBAC base).
    if (actual.esSistema) throw new ForbiddenException("No se puede eliminar un rol de sistema");
    // El modelo Rol no tiene deleted_at → borrado físico. usuario_rol se limpia en cascada (onDelete: Cascade).
    await this.prisma.rol.delete({ where: { id } });
    return { ok: true, id };
  }
}

@Module({
  controllers: [PermisoController, FirmaController, UsuarioController, RolController],
  providers: [PermisoService, FirmaService],
})
export class RbacModule {}
