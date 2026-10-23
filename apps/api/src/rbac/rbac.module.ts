import { Body, Controller, Get, Module, Post, Req, UseGuards, Injectable } from "@nestjs/common";
import { BandejaMetrologiaDocumentos } from "./bandeja-metrologia-documentos";
import { ClientesBuscadorController } from "./clientes-buscador.controller";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";
import { UnidadesController } from "./unidades.controller";
import { UsuariosController } from "./usuarios.controller";
import { PersonasController } from "./usuarios-personas.controller";
import { RolesController } from "./roles.controller";
import { FirmasMatrizController, FirmasMatrizService } from "./firmas-matriz.controller";
import { MeController } from "./me.controller";
import { BandejaService } from "./bandeja.service";

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
  constructor(protected svc: PermisoService, private readonly prisma: PrismaService) { super(); }

  /**
   * Matriz rol × permiso para la pantalla de roles. Declarada en ESTA clase para
   * que se registre antes que la ruta heredada GET /permisos/:id (ParseUUIDPipe).
   */
  @Get("matriz")
  @RequierePermiso("admin.roles")
  async matriz(@Req() req: any) {
    const tenantId: string | undefined = req?.user?.tenantId;
    const [permisos, roles, rp] = await Promise.all([
      this.prisma.permiso.findMany({ orderBy: [{ modulo: "asc" }, { codigo: "asc" }] }),
      this.prisma.rol.findMany({
        where: tenantId ? { tenantId } : {},
        select: { id: true, codigo: true, nombre: true, nivel: true },
        orderBy: [{ orden: "asc" }, { codigo: "asc" }],
      }),
      this.prisma.rolPermiso.findMany({
        where: tenantId ? { rol: { tenantId } } : {},
        select: { rolId: true, permiso: { select: { codigo: true } } },
      }),
    ]);
    const porModulo = new Map<string, { id: string; codigo: string; accion: string; descripcion: string | null }[]>();
    for (const p of permisos) {
      const l = porModulo.get(p.modulo) ?? [];
      l.push({ id: p.id, codigo: p.codigo, accion: p.accion, descripcion: p.descripcion ?? null });
      porModulo.set(p.modulo, l);
    }
    const asignaciones: Record<string, string[]> = {};
    for (const r of roles) asignaciones[r.id] = [];
    for (const x of rp) (asignaciones[x.rolId] ??= []).push(x.permiso.codigo);
    for (const k of Object.keys(asignaciones)) asignaciones[k].sort();
    return {
      modulos: [...porModulo.entries()].map(([modulo, permisos]) => ({ modulo, permisos })),
      roles: roles.map((r) => ({ id: r.id, codigo: r.codigo, nombre: r.nombre, nivel: r.nivel ?? null })),
      asignaciones,
    };
  }
}

/* ===================== FIRMAS (imagen + HASH por usuario) ===================== */
@Injectable()
export class FirmaService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "firma", search: [], tenant: false, softDelete: false, orderBy: { registradaAt: "desc" } });
  }
  /**
   * La imagen de firma (firma.imagen_data, align_firma_cierre.sql) NO sale en el
   * listado ni en el detalle: `firma.registrar` lo tiene casi todo el personal
   * y no debe poder descargarse la firma de otro. Se informa solo si existe.
   * Cada usuario ve la suya en GET /mi-firma (firmas-imagen.controller.ts).
   */
  private sinImagen(f: any) {
    if (!f) return f;
    const { imagenData, ...resto } = f;
    return { ...resto, tieneImagen: !!imagenData };
  }
  async listar(q: any = {}, tenantId?: string) {
    const r = await super.listar(q, tenantId);
    return { ...r, data: r.data.map((f: any) => this.sinImagen(f)) };
  }
  async detalle(id: string, tenantId?: string) {
    return this.sinImagen(await super.detalle(id, tenantId));
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

/*
 * USUARIOS · ROLES · UNIDADES · MATRIZ DE FIRMAS · /me
 * Controladores en archivos propios (usuarios/roles/unidades/firmas-matriz/me
 * .controller.ts). Todos usan el PrismaService compartido (antes cada uno
 * instanciaba su propio PrismaClient = un pool de conexiones por controlador).
 * AlcanceService llega por AlcanceModule (@Global, importado en AppModule).
 * Contrato: docs/ADMIN_ROLES.md.
 */
@Module({
  controllers: [
    PermisoController,
    FirmaController,
    UsuariosController,
    PersonasController,
    RolesController,
    UnidadesController,
    FirmasMatrizController,
    MeController,
    // B-014: buscador acotado de clientes (D11, Jefe de Sucursal).
    ClientesBuscadorController,
  ],
  // BandejaMetrologiaDocumentos: tarjetas de informes técnicos y servicios externos (B-017).
  providers: [PermisoService, FirmaService, FirmasMatrizService, BandejaService, BandejaMetrologiaDocumentos],
  exports: [FirmasMatrizService],
})
export class RbacModule {}
