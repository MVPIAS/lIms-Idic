import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
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
import { AlcanceService } from "./alcance.service";
import { construirArbol, esDescendiente } from "./alcance";
import { TIPOS_UNIDAD } from "./rbac.constants";

const optStr = (max: number) => z.string().max(max).optional().nullable();

const UnidadCreate = z.object({
  codigo: z.string().min(1).max(20),
  nombre: z.string().min(1).max(200),
  tipo: z.enum(TIPOS_UNIDAD),
  padreId: z.string().uuid().optional().nullable(),
  sigla: optStr(20),
  icono: optStr(8),
  color: optStr(20),
  codsucdel: optStr(40),
  centroCosto: optStr(40),
  orden: z.number().int().optional().nullable(),
  descripcion: z.string().optional().nullable(),
  sedeId: z.string().uuid().optional(),
  activo: z.boolean().optional(),
});
const UnidadUpdate = UnidadCreate.partial();

const JefesBody = z.object({
  titularId: z.string().uuid().nullable().optional(),
  subroganteId: z.string().uuid().nullable().optional(),
});

/** Campos que se devuelven de una unidad (activa → activo). */
const SELECT_UNIDAD = {
  id: true,
  codigo: true,
  nombre: true,
  descripcion: true,
  tipo: true,
  padreId: true,
  sigla: true,
  icono: true,
  color: true,
  codsucdel: true,
  centroCosto: true,
  orden: true,
  activa: true,
  sedeId: true,
} as const;

function aDto(u: any) {
  const { activa, ...rest } = u;
  return { ...rest, activo: activa };
}

function tenantDe(req: any): string | undefined {
  return req?.user?.tenantId;
}

/**
 * Estructura organizacional: unidades (dirección, departamentos, secciones,
 * laboratorios, sucursales, delegaciones, apoyo) y sus jefaturas.
 * Lectura: cualquier usuario autenticado. Escritura: admin.estructura.
 */
@ApiTags("unidades")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("unidades")
export class UnidadesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  @Get()
  async list(@Req() req: any) {
    const tenantId = tenantDe(req);
    const data = await this.prisma.unidad.findMany({
      where: tenantId ? { tenantId } : {},
      select: SELECT_UNIDAD,
      orderBy: [{ orden: "asc" }, { codigo: "asc" }],
    });
    return { data: data.map(aDto), meta: { total: data.length } };
  }

  /** Árbol anidado con jefes (titular/subrogante) e hijos. */
  @Get("arbol")
  async arbol(@Req() req: any) {
    const tenantId = tenantDe(req);
    const [unidades, jefes] = await Promise.all([
      this.prisma.unidad.findMany({
        where: tenantId ? { tenantId } : {},
        select: SELECT_UNIDAD,
        orderBy: [{ orden: "asc" }, { codigo: "asc" }],
      }),
      this.prisma.unidadJefe.findMany({
        where: tenantId ? { tenantId } : {},
        select: { unidadId: true, usuarioId: true, rol: true, usuario: { select: { nombreCompleto: true } } },
      }),
    ]);
    const nodos = new Map<string, any>();
    for (const u of unidades) {
      nodos.set(u.id, {
        ...aDto(u),
        jefes: jefes
          .filter((j) => j.unidadId === u.id)
          .sort((a, b) => (a.rol === "titular" ? -1 : b.rol === "titular" ? 1 : 0))
          .map((j) => ({ usuarioId: j.usuarioId, nombre: j.usuario.nombreCompleto, rol: j.rol })),
        hijos: [],
      });
    }
    const raices: any[] = [];
    for (const u of unidades) {
      const n = nodos.get(u.id);
      if (u.padreId && nodos.has(u.padreId) && u.padreId !== u.id) nodos.get(u.padreId).hijos.push(n);
      else raices.push(n);
    }
    return raices;
  }

  @Post()
  @RequierePermiso("admin.estructura")
  async crear(@Body() body: unknown, @Req() req: any) {
    const dto = UnidadCreate.parse(body);
    const tenantId = tenantDe(req) ?? (await this.prisma.tenant.findFirst())?.id;
    if (!tenantId) throw new BadRequestException("No hay tenant");
    const existe = await this.prisma.unidad.findFirst({ where: { tenantId, codigo: dto.codigo } });
    if (existe) throw new ConflictException(`Ya existe una unidad con código ${dto.codigo}`);
    let padre: { id: string; sedeId: string } | null = null;
    if (dto.padreId) {
      padre = await this.prisma.unidad.findFirst({ where: { id: dto.padreId, tenantId }, select: { id: true, sedeId: true } });
      if (!padre) throw new BadRequestException("padreId no existe");
    }
    const sedeId =
      dto.sedeId ??
      padre?.sedeId ??
      (await this.prisma.sede.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" } }))?.id;
    if (!sedeId) throw new BadRequestException("No hay sede para la unidad (indique sedeId)");
    const u = await this.prisma.unidad.create({
      data: {
        tenantId,
        sedeId,
        codigo: dto.codigo,
        nombre: dto.nombre,
        tipo: dto.tipo,
        padreId: dto.padreId ?? null,
        sigla: dto.sigla ?? null,
        icono: dto.icono ?? null,
        color: dto.color ?? null,
        codsucdel: dto.codsucdel ?? null,
        centroCosto: dto.centroCosto ?? null,
        orden: dto.orden ?? 0,
        descripcion: dto.descripcion ?? null,
        activa: dto.activo ?? true,
      },
      select: SELECT_UNIDAD,
    });
    this.alcance.invalidarArbol();
    return aDto(u);
  }

  @Patch(":id")
  @RequierePermiso("admin.estructura")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = UnidadUpdate.parse(body);
    const tenantId = tenantDe(req);
    const actual = await this.prisma.unidad.findFirst({ where: { id, ...(tenantId ? { tenantId } : {}) } });
    if (!actual) throw new NotFoundException(`unidad ${id} no encontrada`);
    if (dto.codigo && dto.codigo !== actual.codigo) {
      const dup = await this.prisma.unidad.findFirst({ where: { tenantId: actual.tenantId, codigo: dto.codigo } });
      if (dup) throw new ConflictException(`Ya existe una unidad con código ${dto.codigo}`);
    }
    if (dto.padreId) {
      if (dto.padreId === id) throw new BadRequestException("Una unidad no puede ser su propio padre");
      const todas = await this.prisma.unidad.findMany({
        where: { tenantId: actual.tenantId },
        select: { id: true, padreId: true, codigo: true, nombre: true, tipo: true },
      });
      const arbol = construirArbol(todas);
      if (!arbol.porId.has(dto.padreId)) throw new BadRequestException("padreId no existe");
      // El nuevo padre no puede estar en la descendencia de la unidad (ciclo).
      if (esDescendiente(arbol, id, dto.padreId)) {
        throw new BadRequestException("El padre indicado es descendiente de la unidad (se formaría un ciclo)");
      }
    }
    if (dto.activo === false) await this.exigirSinHijosActivos(id);
    const { activo, ...resto } = dto;
    const data: any = { ...resto };
    if (activo !== undefined) data.activa = activo;
    const u = await this.prisma.unidad.update({ where: { id }, data, select: SELECT_UNIDAD });
    this.alcance.invalidarArbol();
    return aDto(u);
  }

  /** Baja lógica (activo=false). Rechaza si tiene unidades hijas activas. */
  @Delete(":id")
  @RequierePermiso("admin.estructura")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = tenantDe(req);
    const actual = await this.prisma.unidad.findFirst({ where: { id, ...(tenantId ? { tenantId } : {}) } });
    if (!actual) throw new NotFoundException(`unidad ${id} no encontrada`);
    await this.exigirSinHijosActivos(id);
    const u = await this.prisma.unidad.update({ where: { id }, data: { activa: false }, select: SELECT_UNIDAD });
    this.alcance.invalidarArbol();
    return aDto(u);
  }

  /**
   * Fija jefes de la unidad. undefined = no tocar; null = quitar; uuid = asignar.
   * Mantiene unidad.jefe_usuario_id (legacy) = titular.
   */
  @Put(":id/jefes")
  @RequierePermiso("admin.estructura")
  async jefes(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = JefesBody.parse(body);
    const tenantId = tenantDe(req);
    const unidad = await this.prisma.unidad.findFirst({ where: { id, ...(tenantId ? { tenantId } : {}) } });
    if (!unidad) throw new NotFoundException(`unidad ${id} no encontrada`);
    if (dto.titularId && dto.subroganteId && dto.titularId === dto.subroganteId) {
      throw new BadRequestException("El titular y el subrogante deben ser personas distintas");
    }
    const ids = [dto.titularId, dto.subroganteId].filter((x): x is string => !!x);
    if (ids.length) {
      const n = await this.prisma.usuario.count({
        where: { id: { in: ids }, deletedAt: null, tenantId: unidad.tenantId },
      });
      if (n !== new Set(ids).size) throw new BadRequestException("Usuario titular/subrogante no existe");
    }

    await this.prisma.$transaction(async (tx) => {
      const fijar = async (rol: "titular" | "subrogante", usuarioId: string | null | undefined) => {
        if (usuarioId === undefined) return;
        await tx.unidadJefe.deleteMany({ where: { unidadId: id, rol } });
        if (usuarioId) {
          // PK (unidad_id, usuario_id): si la persona tenía el otro rol aquí, se reemplaza.
          await tx.unidadJefe.deleteMany({ where: { unidadId: id, usuarioId } });
          await tx.unidadJefe.create({ data: { tenantId: unidad.tenantId, unidadId: id, usuarioId, rol } });
        }
        if (rol === "titular") {
          await tx.unidad.update({ where: { id }, data: { jefeUsuarioId: usuarioId ?? null } });
        }
      };
      await fijar("titular", dto.titularId);
      await fijar("subrogante", dto.subroganteId);
    });

    const jefes = await this.prisma.unidadJefe.findMany({
      where: { unidadId: id },
      select: { usuarioId: true, rol: true, usuario: { select: { nombreCompleto: true } } },
    });
    return {
      unidadId: id,
      jefes: jefes
        .sort((a, b) => (a.rol === "titular" ? -1 : b.rol === "titular" ? 1 : 0))
        .map((j) => ({ usuarioId: j.usuarioId, nombre: j.usuario.nombreCompleto, rol: j.rol })),
    };
  }

  private async exigirSinHijosActivos(id: string) {
    const hijos = await this.prisma.unidad.findMany({
      where: { padreId: id, activa: true },
      select: { codigo: true },
    });
    if (hijos.length) {
      throw new ConflictException(
        `La unidad tiene ${hijos.length} unidad(es) hija(s) activa(s): ${hijos.map((h) => h.codigo).join(", ")}. Desactívelas o muévalas primero.`,
      );
    }
  }
}
