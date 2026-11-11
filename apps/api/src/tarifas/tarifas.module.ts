/**
 * Tarifas del Sistema Comercial antiguo (frente f5 · Mapa de migración v2.1,
 * «Maestros y combos»): horas hombre (HH) por categoría, ajuste HH por perfil,
 * horas máquina (HM) por equipo y servicios primarios. Más los costos estándar
 * de DCO-PG01-P05-IT01: escala de viáticos por grado y costo por km de vehículo. Las tablas existían
 * (schema.sql) pero no tenían pantalla.
 *
 * Mismo patrón CRUD que las demás tablas maestras (BaseCrudController):
 *   GET /tarifas/<tabla>        listar y buscar (?search=)       · tarifa.ver
 *   GET /tarifas/<tabla>/:id    detalle                           · tarifa.ver
 *   POST / PATCH                crear y editar (activo = activar o desactivar)
 *                               · catalogo.gestionar con alcance GLOBAL
 *                                 (AlcanceCatalogoGuard: una jefatura de
 *                                 laboratorio recibe 403, son tablas comunes)
 *   DELETE                      409: no hay borrado físico; se desactiva.
 *
 * Valores con vigencia (desde ≤ hasta). El FORM05 propone los valores vigentes
 * de HH, HM y viáticos (cotizacion/referencias-costeo.ts); quedan editables.
 */
import { BadRequestException, ConflictException, Controller, Injectable, Module, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermisoCrud } from "../auth/permisos.decorator";
import { erroresViatico, erroresVigencia, esquemasTarifa, MSJ_SIN_BORRADO, mensajeDuplicado } from "./reglas-tarifas";

const PERMISOS_TARIFA = {
  ver: "tarifa.ver",
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
} as const;

/** BaseCrudService con el duplicado (P2002) traducido a 409 y sin borrado físico. */
abstract class TarifaService extends BaseCrudService {
  protected abstract readonly nombre: string;

  private async conDuplicado<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      if (e?.code === "P2002") throw new ConflictException(mensajeDuplicado(this.nombre));
      // Centro de costo inexistente (FK): error del usuario, no del servidor.
      if (e?.code === "P2003") throw new BadRequestException("El centro de costo elegido no existe.");
      throw e;
    }
  }

  crear(data: any, tenantId?: string) {
    return this.conDuplicado(() => super.crear(data, tenantId));
  }

  async actualizar(id: string, data: any, tenantId?: string) {
    // Edición parcial: la vigencia se valida con lo que queda guardado (desde ≤ hasta).
    if (data?.vigenteDesde !== undefined || data?.vigenteHasta !== undefined) {
      const actual: any = await this.detalle(id, tenantId);
      const errores = erroresVigencia(
        data.vigenteDesde !== undefined ? data.vigenteDesde : actual.vigenteDesde,
        data.vigenteHasta !== undefined ? data.vigenteHasta : actual.vigenteHasta,
      );
      if (errores.length) throw new BadRequestException(errores.join(" "));
    }
    return this.conDuplicado(() => super.actualizar(id, data, tenantId));
  }

  async eliminar(): Promise<never> {
    throw new ConflictException(MSJ_SIN_BORRADO);
  }
}

/* ------------------------------------------------------------ HH por categoría --- */
@Injectable()
export class TarifaHhService extends TarifaService {
  protected readonly nombre = "una tarifa HH con esa categoría y esa fecha de inicio";
  constructor(prisma: PrismaService) {
    super(prisma, { model: "horaHombreCatalogo", search: ["categoria", "descripcion"], orderBy: [{ categoria: "asc" }, { vigenteDesde: "desc" }] });
  }
}
@ApiTags("tarifas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("tarifas/hh")
@RequierePermisoCrud(PERMISOS_TARIFA)
export class TarifaHhController extends BaseCrudController {
  protected createSchema = esquemasTarifa.hh.crear;
  protected updateSchema = esquemasTarifa.hh.editar;
  constructor(protected svc: TarifaHhService) { super(); }
}

/* ------------------------------------------------------------- perfiles HH --- */
@Injectable()
export class TarifaHhPerfilService extends TarifaService {
  protected readonly nombre = "un perfil HH con ese nombre";
  constructor(prisma: PrismaService) {
    super(prisma, { model: "horaHombrePerfil", search: ["perfil", "descripcion"], orderBy: { perfil: "asc" } });
  }

  /** El índice único es por lower(perfil): Prisma no lo conoce, se comprueba aquí antes de escribir. */
  private async exigirPerfilUnico(perfil: unknown, tenantId: string | undefined, id?: string) {
    if (typeof perfil !== "string" || !tenantId) return;
    const otro = await this.prisma.horaHombrePerfil.findFirst({
      where: { tenantId, perfil: { equals: perfil, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) },
      select: { id: true },
    });
    if (otro) throw new ConflictException(mensajeDuplicado(this.nombre, false));
  }

  async crear(data: any, tenantId?: string) {
    await this.exigirPerfilUnico(data?.perfil, tenantId);
    return super.crear(data, tenantId);
  }

  async actualizar(id: string, data: any, tenantId?: string) {
    await this.exigirPerfilUnico(data?.perfil, tenantId, id);
    return super.actualizar(id, data, tenantId);
  }
}
@ApiTags("tarifas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("tarifas/hh-perfiles")
@RequierePermisoCrud(PERMISOS_TARIFA)
export class TarifaHhPerfilController extends BaseCrudController {
  protected createSchema = esquemasTarifa.perfil.crear;
  protected updateSchema = esquemasTarifa.perfil.editar;
  constructor(protected svc: TarifaHhPerfilService) { super(); }
}

/* ------------------------------------------------------------- HM por equipo --- */
@Injectable()
export class TarifaHmService extends TarifaService {
  protected readonly nombre = "una tarifa HM para ese equipo y esa fecha de inicio";
  constructor(prisma: PrismaService) {
    super(prisma, { model: "horaMaquinaCatalogo", search: ["codigo", "descripcion"], orderBy: [{ codigo: "asc" }, { vigenteDesde: "desc" }] });
  }

  /** `equipo` (código y nombre) de «Equipos y calibración»; la tabla equipo no está en Prisma. */
  private async conEquipo<T extends { equipoId?: string | null }>(filas: T[]): Promise<(T & { equipo: { id: string; codigo: string | null; nombre: string | null } | null })[]> {
    const ids = [...new Set(filas.map((f) => f.equipoId).filter((x): x is string => !!x))];
    const eq = ids.length
      ? await this.prisma.$queryRawUnsafe<{ id: string; codigo: string | null; nombre: string | null }[]>(
          `SELECT id::text, codigo, COALESCE(nombre, descripcion) AS nombre FROM equipo WHERE id = ANY($1::uuid[])`,
          ids,
        )
      : [];
    const porId = new Map(eq.map((e) => [e.id, e]));
    return filas.map((f) => ({ ...f, equipo: f.equipoId ? porId.get(f.equipoId) ?? null : null }));
  }

  private async exigirEquipo(equipoId: unknown, tenantId?: string) {
    if (typeof equipoId !== "string") return;
    const r = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM equipo WHERE id = $1::uuid AND ($2::uuid IS NULL OR tenant_id = $2::uuid)`,
      equipoId,
      tenantId ?? null,
    );
    if (!r[0]?.n) throw new ConflictException("El equipo elegido no existe en «Equipos y calibración».");
  }

  async listar(q: any, tenantId?: string) {
    const r = await super.listar(q, tenantId);
    return { ...r, data: await this.conEquipo(r.data) };
  }

  async detalle(id: string, tenantId?: string) {
    return (await this.conEquipo([await super.detalle(id, tenantId)]))[0];
  }

  async crear(data: any, tenantId?: string) {
    await this.exigirEquipo(data?.equipoId, tenantId);
    return super.crear(data, tenantId);
  }

  async actualizar(id: string, data: any, tenantId?: string) {
    await this.exigirEquipo(data?.equipoId, tenantId);
    return super.actualizar(id, data, tenantId);
  }
}
@ApiTags("tarifas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("tarifas/hm")
@RequierePermisoCrud(PERMISOS_TARIFA)
export class TarifaHmController extends BaseCrudController {
  protected createSchema = esquemasTarifa.hm.crear;
  protected updateSchema = esquemasTarifa.hm.editar;
  constructor(protected svc: TarifaHmService) { super(); }
}

/* ------------------------------------------------------- servicios primarios --- */
@Injectable()
export class ServicioPrimarioService extends TarifaService {
  protected readonly nombre = "un servicio primario con ese código y esa fecha de inicio";
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "listaPrecioServicioPrimario",
      search: ["codigo", "descripcion"],
      include: { centroCosto: { select: { id: true, codigo: true, nombre: true } } },
      orderBy: [{ codigo: "asc" }, { vigenteDesde: "desc" }],
    });
  }
}
@ApiTags("tarifas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("tarifas/servicios-primarios")
@RequierePermisoCrud(PERMISOS_TARIFA)
export class ServicioPrimarioController extends BaseCrudController {
  protected createSchema = esquemasTarifa.servicioPrimario.crear;
  protected updateSchema = esquemasTarifa.servicioPrimario.editar;
  constructor(protected svc: ServicioPrimarioService) { super(); }
}

/* ------------------------------------------------- viáticos por grado (IT01) --- */
@Injectable()
export class TarifaViaticoService extends TarifaService {
  protected readonly nombre = "un tramo de viático con ese ámbito, país, grado inicial y fecha de inicio";
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "tarifaViatico",
      search: ["denominacion", "pais"],
      orderBy: [{ ambito: "asc" }, { pais: "asc" }, { gradoDesde: "asc" }, { vigenteDesde: "desc" }],
    });
  }

  async actualizar(id: string, data: any, tenantId?: string) {
    // Edición parcial: el tramo se valida con lo que queda guardado.
    const actual: any = await this.detalle(id, tenantId);
    const errores = erroresViatico({ ...actual, ...Object.fromEntries(Object.entries(data ?? {}).filter(([, v]) => v !== undefined)) });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    return super.actualizar(id, data, tenantId);
  }
}
@ApiTags("tarifas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("tarifas/viaticos")
@RequierePermisoCrud(PERMISOS_TARIFA)
export class TarifaViaticoController extends BaseCrudController {
  protected createSchema = esquemasTarifa.viatico.crear;
  protected updateSchema = esquemasTarifa.viatico.editar;
  constructor(protected svc: TarifaViaticoService) { super(); }
}

/* ------------------------------------------- vehículos: costo por km (IT01) --- */
@Injectable()
export class TarifaVehiculoService extends TarifaService {
  protected readonly nombre = "un costo por km con esa categoría y esa fecha de inicio";
  constructor(prisma: PrismaService) {
    super(prisma, { model: "tarifaVehiculo", search: ["categoria", "descripcion"], orderBy: [{ categoria: "asc" }, { vigenteDesde: "desc" }] });
  }
}
@ApiTags("tarifas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("tarifas/vehiculos")
@RequierePermisoCrud(PERMISOS_TARIFA)
export class TarifaVehiculoController extends BaseCrudController {
  protected createSchema = esquemasTarifa.vehiculo.crear;
  protected updateSchema = esquemasTarifa.vehiculo.editar;
  constructor(protected svc: TarifaVehiculoService) { super(); }
}

@Module({
  controllers: [TarifaHhController, TarifaHhPerfilController, TarifaHmController, ServicioPrimarioController, TarifaViaticoController, TarifaVehiculoController],
  providers: [TarifaHhService, TarifaHhPerfilService, TarifaHmService, ServicioPrimarioService, TarifaViaticoService, TarifaVehiculoService],
})
export class TarifasModule {}
