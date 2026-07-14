import { Body, Controller, Get, Module, Post, UseGuards, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";

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
@ApiTags("firmas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt")) @Controller("firmas")
export class FirmaController extends BaseCrudController {
  protected updateSchema = FirmaCreate.partial();
  constructor(protected svc: FirmaService) { super(); }
  // POST /firmas hace upsert por usuario (registrar/actualizar)
  @Post()
  crear(@Body() body: unknown) {
    return (this.svc as FirmaService).registrar(FirmaCreate.parse(body));
  }
}

/* ===================== USUARIOS y ROLES (lectura) ===================== */
@ApiTags("usuarios") @ApiBearerAuth() @UseGuards(AuthGuard("jwt")) @Controller("usuarios")
export class UsuarioController {
  private prisma = new PrismaClient();
  @Get()
  async list() {
    const data = await this.prisma.usuario.findMany({
      where: { deletedAt: null },
      include: { usuarioRoles: { include: { rol: true } } },
      orderBy: { username: "asc" },
      take: 200,
    });
    return { data, meta: { page: 1, limit: 200, total: data.length, totalPages: 1 } };
  }
}

@ApiTags("roles") @ApiBearerAuth() @UseGuards(AuthGuard("jwt")) @Controller("roles")
export class RolController {
  private prisma = new PrismaClient();
  @Get()
  async list() {
    const data = await this.prisma.rol.findMany({ orderBy: { codigo: "asc" } });
    return { data, meta: { page: 1, limit: data.length, total: data.length, totalPages: 1 } };
  }
}

@Module({
  controllers: [PermisoController, FirmaController, UsuarioController, RolController],
  providers: [PermisoService, FirmaService],
})
export class RbacModule {}
