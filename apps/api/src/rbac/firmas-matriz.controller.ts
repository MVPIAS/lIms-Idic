import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
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
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "./alcance.service";
import { ResolucionFirmas, resolverFirmas } from "./firmas-resolver";
import { ACCIONES_FIRMA, NIVELES_UNIDAD_FIRMA, TIPOS_DOCUMENTO } from "./rbac.constants";

const ReglaBase = z.object({
  tipoDocumento: z.enum(TIPOS_DOCUMENTO),
  unidadId: z.string().uuid().nullable().optional(),
  orden: z.number().int().min(1).max(99),
  accion: z.enum(ACCIONES_FIRMA),
  rolId: z.string().uuid(),
  nivelUnidad: z.enum(NIVELES_UNIDAD_FIRMA).default("MISMA"),
  unidadDestinoId: z.string().uuid().nullable().optional(),
  obligatorio: z.boolean().default(true),
  activo: z.boolean().default(true),
  descripcion: z.string().max(500).nullable().optional(),
});
const ReglaCreate = ReglaBase.refine((d) => d.nivelUnidad !== "FIJA" || !!d.unidadDestinoId, {
  message: "nivelUnidad FIJA requiere unidadDestinoId",
});
const ReglaUpdate = ReglaBase.partial().extend({
  nivelUnidad: z.enum(NIVELES_UNIDAD_FIRMA).optional(),
  obligatorio: z.boolean().optional(),
  activo: z.boolean().optional(),
});

const INCLUDE_REGLA = {
  rol: { select: { id: true, codigo: true, nombre: true, nivel: true, alcance: true } },
  unidad: { select: { id: true, codigo: true, nombre: true, tipo: true } },
  unidadDestino: { select: { id: true, codigo: true, nombre: true, tipo: true } },
} as const;

function tenantDe(req: any): string | undefined {
  return req?.user?.tenantId;
}

/** Carga los datos y aplica el resolver puro (firmas-resolver.ts). */
@Injectable()
export class FirmasMatrizService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  async resolver(tipoDocumento: string, unidadId: string | null, tenantId?: string): Promise<ResolucionFirmas> {
    const arbol = await this.alcance.arbol(tenantId);
    if (unidadId && !arbol.porId.has(unidadId)) throw new NotFoundException(`unidad ${unidadId} no encontrada`);
    const [reglas, jefes, tenencias] = await Promise.all([
      this.prisma.flujoFirma.findMany({
        where: { tipoDocumento, activo: true, ...(tenantId ? { tenantId } : {}) },
        include: { rol: { select: { id: true, codigo: true, nombre: true, nivel: true, alcance: true, aliasDe: true } } },
      }),
      this.prisma.unidadJefe.findMany({
        where: tenantId ? { tenantId } : {},
        select: { unidadId: true, usuarioId: true, rol: true, usuario: { select: { nombreCompleto: true, estado: true, deletedAt: true } } },
      }),
      this.prisma.usuarioRol.findMany({
        where: { usuario: { deletedAt: null, estado: "activo", ...(tenantId ? { tenantId } : {}) } },
        select: {
          usuarioId: true,
          unidadId: true,
          vigenteDesde: true,
          vigenteHasta: true,
          usuario: { select: { nombreCompleto: true } },
          rol: { select: { codigo: true, aliasDe: true } },
        },
      }),
    ]);
    return resolverFirmas({
      tipoDocumento,
      unidadId,
      arbol,
      reglas: reglas.map((r) => ({ ...r, rol: r.rol })),
      jefes: jefes
        .filter((j) => !j.usuario.deletedAt && j.usuario.estado === "activo")
        .map((j) => ({ unidadId: j.unidadId, usuarioId: j.usuarioId, nombre: j.usuario.nombreCompleto, rol: j.rol })),
      tenencias: tenencias.map((t) => ({
        usuarioId: t.usuarioId,
        nombre: t.usuario.nombreCompleto,
        rolCodigo: t.rol.codigo,
        aliasDe: t.rol.aliasDe,
        unidadId: t.unidadId,
        vigenteDesde: t.vigenteDesde,
        vigenteHasta: t.vigenteHasta,
      })),
    });
  }
}

/**
 * Matriz de firmas: quién revisa/aprueba/firma/oficializa cada tipo de
 * documento, con reglas por defecto y overrides por unidad.
 * CRUD: admin.firmas · resolver: cualquier autenticado.
 */
@ApiTags("firmas-matriz")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("firmas-matriz")
export class FirmasMatrizController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: FirmasMatrizService,
  ) {}

  /** Pasos efectivos para un documento emitido por una unidad. */
  @Get("resolver")
  async resolver(@Query("tipoDocumento") tipoDocumento: string, @Query("unidadId") unidadId: string, @Req() req: any) {
    const tipo = z.enum(TIPOS_DOCUMENTO).safeParse(tipoDocumento);
    if (!tipo.success) throw new BadRequestException(`tipoDocumento inválido. Valores: ${TIPOS_DOCUMENTO.join(", ")}`);
    if (unidadId && !z.string().uuid().safeParse(unidadId).success) throw new BadRequestException("unidadId debe ser uuid");
    return this.svc.resolver(tipo.data, unidadId || null, tenantDe(req));
  }

  @Get()
  @RequierePermiso("admin.firmas")
  async list(
    @Req() req: any,
    @Query("tipoDocumento") tipoDocumento?: string,
    @Query("unidadId") unidadId?: string,
  ) {
    const tenantId = tenantDe(req);
    const where: any = { ...(tenantId ? { tenantId } : {}) };
    if (tipoDocumento) where.tipoDocumento = tipoDocumento;
    // unidadId=null|defecto → solo reglas por defecto
    if (unidadId === "null" || unidadId === "defecto") where.unidadId = null;
    else if (unidadId) where.unidadId = unidadId;
    const data = await this.prisma.flujoFirma.findMany({
      where,
      include: INCLUDE_REGLA,
      orderBy: [{ tipoDocumento: "asc" }, { unidadId: { sort: "asc", nulls: "first" } }, { orden: "asc" }],
    });
    return { data, meta: { total: data.length } };
  }

  @Post()
  @RequierePermiso("admin.firmas")
  async crear(@Body() body: unknown, @Req() req: any) {
    const dto = ReglaCreate.parse(body);
    const tenantId = tenantDe(req) ?? (await this.prisma.tenant.findFirst())?.id;
    if (!tenantId) throw new BadRequestException("No hay tenant");
    await this.validarRefs(dto, tenantId);
    return this.prisma.flujoFirma.create({
      data: {
        tenantId,
        tipoDocumento: dto.tipoDocumento,
        unidadId: dto.unidadId ?? null,
        orden: dto.orden,
        accion: dto.accion,
        rolId: dto.rolId,
        nivelUnidad: dto.nivelUnidad,
        unidadDestinoId: dto.unidadDestinoId ?? null,
        obligatorio: dto.obligatorio,
        activo: dto.activo,
        descripcion: dto.descripcion ?? null,
      },
      include: INCLUDE_REGLA,
    });
  }

  @Patch(":id")
  @RequierePermiso("admin.firmas")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = ReglaUpdate.parse(body);
    const actual = await this.cargar(id, tenantDe(req));
    const nivel = dto.nivelUnidad ?? actual.nivelUnidad;
    const destino = dto.unidadDestinoId !== undefined ? dto.unidadDestinoId : actual.unidadDestinoId;
    if (nivel === "FIJA" && !destino) throw new BadRequestException("nivelUnidad FIJA requiere unidadDestinoId");
    await this.validarRefs(dto, actual.tenantId);
    return this.prisma.flujoFirma.update({
      where: { id },
      data: { ...dto, updatedAt: new Date() },
      include: INCLUDE_REGLA,
    });
  }

  @Delete(":id")
  @RequierePermiso("admin.firmas")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.cargar(id, tenantDe(req));
    await this.prisma.flujoFirma.delete({ where: { id } });
    return { ok: true, id };
  }

  private async cargar(id: string, tenantId?: string) {
    const r = await this.prisma.flujoFirma.findFirst({ where: { id, ...(tenantId ? { tenantId } : {}) } });
    if (!r) throw new NotFoundException(`regla ${id} no encontrada`);
    return r;
  }

  private async validarRefs(dto: { rolId?: string; unidadId?: string | null; unidadDestinoId?: string | null }, tenantId: string) {
    if (dto.rolId && !(await this.prisma.rol.findFirst({ where: { id: dto.rolId, tenantId } }))) {
      throw new BadRequestException("rolId no existe");
    }
    for (const u of [dto.unidadId, dto.unidadDestinoId]) {
      if (u && !(await this.prisma.unidad.findFirst({ where: { id: u, tenantId } }))) {
        throw new BadRequestException(`unidad ${u} no existe`);
      }
    }
  }
}
