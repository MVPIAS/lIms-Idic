import {
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
  Injectable,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService, DEV_TENANT } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";

/**
 * =============================================================================
 * CATÁLOGO v2 · API sobre las tablas cat_* (cascada real StarLIMS).
 *
 * DDL fuente: packages/db/catalogo_v2.sql (10 tablas cat_*, ya creadas y
 * cargadas con datos maestros reales). Modelos Prisma añadidos al final de
 * packages/db/prisma/schema.prisma (CatGranGrupo … CatPanel).
 *
 * NO se toca la app viva (gran_grupo/grupo/metodo siguen usándose por
 * catalogo.module.ts y laboratorio.module.ts). Todo aquí vive bajo el prefijo
 * de ruta `cat/…` (CRUD por entidad) y `cascada/…` (lecturas encadenadas para
 * los selectores en cascada del front).
 *
 * Todas las entidades: tenant:true (columna tenant_id), softDelete:true
 * (columna deleted_at). Permisos: se LEE con `muestra.ver` (todos los roles
 * operativos) y se GESTIONA con `catalogo.gestionar`, igual que el resto del
 * catálogo (grupos, familias, tipos de muestra, analitos).
 * =============================================================================
 */

/** Permisos comunes de todo el catálogo v2. */
const PERMISOS_CATALOGO = {
  ver: "muestra.ver",
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
} as const;

/* ============================ EJE PRODUCTO (5 niveles) ============================ */

/* --------- Nivel 1 · Gran Grupo --------- */
@Injectable()
export class CatGranGrupoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "catGranGrupo",
      search: ["codigo", "nombre"],
      include: { grupos: true },
      orderBy: { codigo: "asc" },
      tenant: true,
      softDelete: true,
    });
  }
}
const CatGranGrupoCreate = z.object({
  codigo: z.string().min(1).max(20),
  nombre: z.string().min(1).max(160),
  activo: z.boolean().default(true),
});
@ApiTags("cat-gran-grupos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("cat/gran-grupos")
@RequierePermisoCrud(PERMISOS_CATALOGO)
export class CatGranGrupoController extends BaseCrudController {
  protected createSchema = CatGranGrupoCreate;
  protected updateSchema = CatGranGrupoCreate.partial();
  constructor(protected svc: CatGranGrupoService) { super(); }
}

/* --------- Nivel 2 · Grupo --------- */
@Injectable()
export class CatGrupoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "catGrupo",
      search: ["cgrupo", "nombre"],
      include: { granGrupo: true },
      orderBy: { nombre: "asc" },
      tenant: true,
      softDelete: true,
    });
  }
}
const CatGrupoCreate = z.object({
  granGrupoId: z.string().uuid(),
  cgrupo: z.string().min(1).max(20),
  nombre: z.string().min(1).max(200),
  activo: z.boolean().default(true),
});
@ApiTags("cat-grupos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("cat/grupos")
@RequierePermisoCrud(PERMISOS_CATALOGO)
export class CatGrupoController extends BaseCrudController {
  protected createSchema = CatGrupoCreate;
  protected updateSchema = CatGrupoCreate.partial();
  constructor(protected svc: CatGrupoService) { super(); }
}

/* --------- Nivel 3 · SubGrupo --------- */
@Injectable()
export class CatSubgrupoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "catSubgrupo",
      search: ["cntlroom", "nombre"],
      include: { grupo: true },
      orderBy: { nombre: "asc" },
      tenant: true,
      softDelete: true,
    });
  }
}
const CatSubgrupoCreate = z.object({
  grupoId: z.string().uuid(),
  cntlroom: z.string().min(1).max(30),
  nombre: z.string().min(1).max(240),
  activo: z.boolean().default(true),
});
@ApiTags("cat-subgrupos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("cat/subgrupos")
@RequierePermisoCrud(PERMISOS_CATALOGO)
export class CatSubgrupoController extends BaseCrudController {
  protected createSchema = CatSubgrupoCreate;
  protected updateSchema = CatSubgrupoCreate.partial();
  constructor(protected svc: CatSubgrupoService) { super(); }
}

/* --------- Nivel 4 · Familia (= laboratorio, dimensión lateral) --------- */
@Injectable()
export class CatFamiliaService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "catFamilia",
      search: ["codsucdel", "nombre", "laboratorio"],
      orderBy: { nombre: "asc" },
      tenant: true,
      softDelete: true,
    });
  }
}
const CatFamiliaCreate = z.object({
  codsucdel: z.string().min(1).max(30),
  nombre: z.string().min(1).max(200),
  laboratorio: z.string().max(200).optional(),
  departamento: z.string().max(200).optional(),
  subdireccion: z.string().max(200).optional(),
  activo: z.boolean().default(true),
});
@ApiTags("cat-familias") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("cat/familias")
@RequierePermisoCrud(PERMISOS_CATALOGO)
export class CatFamiliaController extends BaseCrudController {
  protected createSchema = CatFamiliaCreate;
  protected updateSchema = CatFamiliaCreate.partial();
  constructor(protected svc: CatFamiliaService) { super(); }
}

/* --------- Nivel 5 · Elemento (hoja) --------- */
@Injectable()
export class CatElementoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "catElemento",
      search: ["codigo", "nombre", "servgrp"],
      include: { subgrupo: true, familia: true },
      orderBy: { codigo: "asc" },
      tenant: true,
      softDelete: true,
    });
  }
}
const CatElementoCreate = z.object({
  subgrupoId: z.string().uuid(),
  familiaId: z.string().uuid().optional(),
  codigo: z.string().min(1).max(30),
  nombre: z.string().min(1).max(240),
  servgrp: z.string().max(240).optional(),
  activo: z.boolean().default(true),
});
@ApiTags("cat-elementos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("cat/elementos")
@RequierePermisoCrud(PERMISOS_CATALOGO)
export class CatElementoController extends BaseCrudController {
  protected createSchema = CatElementoCreate;
  protected updateSchema = CatElementoCreate.partial();
  constructor(protected svc: CatElementoService) { super(); }
}

/* ============================ EJE ANÁLISIS (4 niveles) ============================ */

/* --------- Nivel 1 · Ensayo (lleva el PRECIO) --------- */
@Injectable()
export class CatEnsayoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "catEnsayo",
      search: ["codigo", "nombre", "agrupado"],
      include: { familia: true },
      orderBy: { codigo: "asc" },
      tenant: true,
      softDelete: true,
    });
  }
}
const CatEnsayoCreate = z.object({
  codigo: z.string().min(1).max(30),
  nombre: z.string().min(1).max(240),
  precio: z.number().nonnegative().default(0),
  familiaId: z.string().uuid().optional(),
  agrupado: z.string().max(30).optional(),
  objetivo: z.string().optional(),
  instruccionTrabajo: z.string().optional(),
  activo: z.boolean().default(true),
});
@ApiTags("cat-ensayos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("cat/ensayos")
@RequierePermisoCrud(PERMISOS_CATALOGO)
export class CatEnsayoController extends BaseCrudController {
  protected createSchema = CatEnsayoCreate;
  protected updateSchema = CatEnsayoCreate.partial();
  constructor(protected svc: CatEnsayoService) { super(); }
}

/* --------- Nivel 2 · Método --------- */
@Injectable()
export class CatMetodoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "catMetodo",
      search: ["codigo", "nombre", "norma"],
      include: { ensayo: true },
      orderBy: { codigo: "asc" },
      tenant: true,
      softDelete: true,
    });
  }
}
const CatMetodoCreate = z.object({
  ensayoId: z.string().uuid().optional(),
  codigo: z.string().min(1).max(30),
  nombre: z.string().min(1).max(240),
  norma: z.string().max(240).optional(),
  instrumento: z.string().max(160).optional(),
  version: z.string().max(30).optional(),
  servgrp: z.string().max(240).optional(),
  activo: z.boolean().default(true),
});
@ApiTags("cat-metodos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("cat/metodos")
@RequierePermisoCrud(PERMISOS_CATALOGO)
export class CatMetodoController extends BaseCrudController {
  protected createSchema = CatMetodoCreate;
  protected updateSchema = CatMetodoCreate.partial();
  constructor(protected svc: CatMetodoService) { super(); }
}

/* --------- Nivel 3 · Analito --------- */
@Injectable()
export class CatAnalitoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "catAnalito",
      search: ["codigo", "nombre", "unidad"],
      include: { metodo: true },
      orderBy: { codigo: "asc" },
      tenant: true,
      softDelete: true,
    });
  }
}
const CatAnalitoCreate = z.object({
  metodoId: z.string().uuid(),
  codigo: z.string().min(1).max(120),
  nombre: z.string().min(1).max(240),
  unidad: z.string().max(60).optional(),
  formula: z.string().optional(),
  rangoMin: z.string().max(120).optional(),
  rangoNominal: z.string().max(120).optional(),
  rangoMax: z.string().max(120).optional(),
  activo: z.boolean().default(true),
});
@ApiTags("cat-analitos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("cat/analitos")
@RequierePermisoCrud(PERMISOS_CATALOGO)
export class CatAnalitoController extends BaseCrudController {
  protected createSchema = CatAnalitoCreate;
  protected updateSchema = CatAnalitoCreate.partial();
  constructor(protected svc: CatAnalitoService) { super(); }
}

/* --------- Nivel 4 · Especificación --------- */
@Injectable()
export class CatEspecificacionService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "catEspecificacion",
      search: ["ambito", "requisitos", "texto"],
      include: { analito: true },
      orderBy: { ambito: "asc" },
      tenant: true,
      softDelete: true,
    });
  }
}
const CatEspecificacionCreate = z.object({
  analitoId: z.string().uuid(),
  ambito: z.string().min(1).max(16).default("estandar"),
  limiteInf: z.string().max(120).optional(),
  nominal: z.string().max(120).optional(),
  limiteSup: z.string().max(120).optional(),
  requisitos: z.string().optional(),
  texto: z.string().optional(),
  unidad: z.string().max(60).optional(),
  dedupeKey: z.string().min(1).max(40),
});
@ApiTags("cat-especificaciones") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("cat/especificaciones")
@RequierePermisoCrud(PERMISOS_CATALOGO)
export class CatEspecificacionController extends BaseCrudController {
  protected createSchema = CatEspecificacionCreate;
  protected updateSchema = CatEspecificacionCreate.partial();
  constructor(protected svc: CatEspecificacionService) { super(); }
}

/* ============================ BISAGRA · Panel ============================ */
@Injectable()
export class CatPanelService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "catPanel",
      search: ["inspecTipo"],
      include: { elemento: true, metodo: true, ensayo: true },
      orderBy: { orden: "asc" },
      tenant: true,
      softDelete: true,
    });
  }
}
const CatPanelCreate = z.object({
  elementoId: z.string().uuid(),
  metodoId: z.string().uuid(),
  ensayoId: z.string().uuid().optional(),
  inspecTipo: z.string().max(30).optional(),
  orden: z.number().int().optional(),
  activo: z.boolean().default(true),
});
@ApiTags("cat-paneles") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("cat/paneles")
@RequierePermisoCrud(PERMISOS_CATALOGO)
export class CatPanelController extends BaseCrudController {
  protected createSchema = CatPanelCreate;
  protected updateSchema = CatPanelCreate.partial();
  constructor(protected svc: CatPanelService) { super(); }
}

/* =============================================================================
 * CASCADA · lecturas encadenadas para los selectores en cascada del front.
 *
 * Devuelve ARRAYS PLANOS (sin paginar), con un cap sensato (take) en los
 * endpoints potencialmente grandes (elementos, ensayos). Todo filtra por el
 * tenant del JWT (req.user.tenantId, con fallback DEV_TENANT en dev) y por
 * deletedAt: null. Se lee con `muestra.ver` a nivel de clase.
 * ============================================================================= */

/** Extrae el tenant del usuario autenticado; en dev cae al tenant por defecto. */
function tenantDe(req: any): string {
  return req?.user?.tenantId ?? DEV_TENANT;
}

@Injectable()
export class CascadaService {
  constructor(private readonly prisma: PrismaService) {}

  granGrupos(tenantId: string) {
    return this.prisma.catGranGrupo.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, codigo: true, nombre: true },
      orderBy: { codigo: "asc" },
    });
  }

  grupos(tenantId: string, granGrupoId?: string) {
    return this.prisma.catGrupo.findMany({
      where: { tenantId, deletedAt: null, ...(granGrupoId ? { granGrupoId } : {}) },
      select: { id: true, cgrupo: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
  }

  subgrupos(tenantId: string, grupoId?: string) {
    return this.prisma.catSubgrupo.findMany({
      where: { tenantId, deletedAt: null, ...(grupoId ? { grupoId } : {}) },
      select: { id: true, cntlroom: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
  }

  familias(tenantId: string) {
    return this.prisma.catFamilia.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, codsucdel: true, nombre: true, laboratorio: true },
      orderBy: { nombre: "asc" },
    });
  }

  async elementos(tenantId: string, subgrupoId?: string, familiaId?: string, q?: string) {
    const rows = await this.prisma.catElemento.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(subgrupoId ? { subgrupoId } : {}),
        ...(familiaId ? { familiaId } : {}),
        ...(q
          ? {
              OR: [
                { codigo: { contains: q, mode: "insensitive" } },
                { nombre: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        codigo: true,
        nombre: true,
        familiaId: true,
        familia: { select: { nombre: true } },
      },
      orderBy: { codigo: "asc" },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      codigo: r.codigo,
      nombre: r.nombre,
      familiaId: r.familiaId,
      familiaNombre: r.familia?.nombre ?? null,
    }));
  }

  /** Panel de un elemento: qué métodos (+ su ensayo y precio) aplican. */
  async panelDeElemento(tenantId: string, elementoId: string) {
    const rows = await this.prisma.catPanel.findMany({
      where: { tenantId, deletedAt: null, elementoId },
      select: {
        metodo: { select: { id: true, codigo: true, nombre: true } },
        ensayo: { select: { id: true, codigo: true, nombre: true, precio: true } },
      },
      orderBy: { orden: "asc" },
    });
    return rows.map((r) => ({
      metodoId: r.metodo?.id ?? null,
      metodoCodigo: r.metodo?.codigo ?? null,
      metodoNombre: r.metodo?.nombre ?? null,
      ensayoId: r.ensayo?.id ?? null,
      ensayoCodigo: r.ensayo?.codigo ?? null,
      ensayoNombre: r.ensayo?.nombre ?? null,
      precio: r.ensayo?.precio ?? null,
    }));
  }

  ensayos(tenantId: string, q?: string) {
    return this.prisma.catEnsayo.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { codigo: { contains: q, mode: "insensitive" } },
                { nombre: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: { id: true, codigo: true, nombre: true, precio: true },
      orderBy: { codigo: "asc" },
      take: 200,
    });
  }

  metodosDeEnsayo(tenantId: string, ensayoId: string) {
    return this.prisma.catMetodo.findMany({
      where: { tenantId, deletedAt: null, ensayoId },
      select: { id: true, codigo: true, nombre: true, norma: true },
      orderBy: { codigo: "asc" },
    });
  }

  analitosDeMetodo(tenantId: string, metodoId: string) {
    return this.prisma.catAnalito.findMany({
      where: { tenantId, deletedAt: null, metodoId },
      select: { id: true, codigo: true, nombre: true, unidad: true, formula: true },
      orderBy: { codigo: "asc" },
    });
  }

  async especificacionesDeAnalito(tenantId: string, analitoId: string) {
    const rows = await this.prisma.catEspecificacion.findMany({
      where: { tenantId, deletedAt: null, analitoId },
      select: {
        id: true,
        ambito: true,
        limiteInf: true,
        nominal: true,
        limiteSup: true,
        unidad: true,
        requisitos: true,
      },
      orderBy: { ambito: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      ambito: r.ambito,
      limiteInf: r.limiteInf,
      nominal: r.nominal,
      limiteSup: r.limiteSup,
      unidad: r.unidad,
      requisitos: r.requisitos,
    }));
  }
}

@ApiTags("cascada") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("cascada")
@RequierePermiso("muestra.ver")
export class CascadaController {
  constructor(private readonly svc: CascadaService) {}

  @Get("gran-grupos")
  @ApiOperation({ summary: "Gran grupos (raíz del eje producto)" })
  granGrupos(@Req() req: any) {
    return this.svc.granGrupos(tenantDe(req));
  }

  @Get("grupos")
  @ApiOperation({ summary: "Grupos de un gran grupo" })
  grupos(@Query("granGrupoId") granGrupoId: string | undefined, @Req() req: any) {
    return this.svc.grupos(tenantDe(req), granGrupoId);
  }

  @Get("subgrupos")
  @ApiOperation({ summary: "Subgrupos de un grupo" })
  subgrupos(@Query("grupoId") grupoId: string | undefined, @Req() req: any) {
    return this.svc.subgrupos(tenantDe(req), grupoId);
  }

  @Get("familias")
  @ApiOperation({ summary: "Familias (= laboratorios), dimensión lateral" })
  familias(@Req() req: any) {
    return this.svc.familias(tenantDe(req));
  }

  @Get("elementos")
  @ApiOperation({ summary: "Elementos (hoja) filtrados por subgrupo/familia/texto (take 200)" })
  elementos(
    @Query("subgrupoId") subgrupoId: string | undefined,
    @Query("familiaId") familiaId: string | undefined,
    @Query("q") q: string | undefined,
    @Req() req: any,
  ) {
    return this.svc.elementos(tenantDe(req), subgrupoId, familiaId, q);
  }

  @Get("elementos/:id/panel")
  @ApiOperation({ summary: "Panel del elemento: métodos + ensayo + precio que aplican" })
  panel(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.panelDeElemento(tenantDe(req), id);
  }

  @Get("ensayos")
  @ApiOperation({ summary: "Ensayos filtrados por texto (take 200)" })
  ensayos(@Query("q") q: string | undefined, @Req() req: any) {
    return this.svc.ensayos(tenantDe(req), q);
  }

  @Get("ensayos/:id/metodos")
  @ApiOperation({ summary: "Métodos de un ensayo" })
  metodos(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.metodosDeEnsayo(tenantDe(req), id);
  }

  @Get("metodos/:id/analitos")
  @ApiOperation({ summary: "Analitos de un método" })
  analitos(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.analitosDeMetodo(tenantDe(req), id);
  }

  @Get("analitos/:id/especificaciones")
  @ApiOperation({ summary: "Especificaciones (límites) de un analito" })
  especificaciones(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.especificacionesDeAnalito(tenantDe(req), id);
  }
}

@Module({
  controllers: [
    CatGranGrupoController,
    CatGrupoController,
    CatSubgrupoController,
    CatFamiliaController,
    CatElementoController,
    CatEnsayoController,
    CatMetodoController,
    CatAnalitoController,
    CatEspecificacionController,
    CatPanelController,
    CascadaController,
  ],
  providers: [
    CatGranGrupoService,
    CatGrupoService,
    CatSubgrupoService,
    CatFamiliaService,
    CatElementoService,
    CatEnsayoService,
    CatMetodoService,
    CatAnalitoService,
    CatEspecificacionService,
    CatPanelService,
    CascadaService,
  ],
})
export class CatalogoV2Module {}
