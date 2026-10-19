import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";
import { CATEGORIAS_CON_HISTORIAL, defPorcentaje, erroresPorcentaje, leerPorcentaje, valorGuardado } from "./parametro-porcentaje";

/**
 * PARÁMETROS DE NEGOCIO (§5). Maestra genérica y editable de los combos que
 * antes estaban hardcodeados en el frontend (tipo_cliente, forma_pago,
 * prioridad, tipo_linea_costeo, tipo_inspeccion). Tabla `parametro_sistema`.
 */
@Injectable()
export class ParametroSistemaService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "parametroSistema",
      search: ["categoria", "codigo", "etiqueta"],
      softDelete: false,
      // Orden natural del combo: por categoría y, dentro de ella, por `orden`.
      orderBy: [{ categoria: "asc" }, { orden: "asc" }],
    });
  }

  /** Porcentajes de la tasa de internación (bpch_tasa) con su historial de cambios. */
  async porcentajes(tenantId: string) {
    const categorias = CATEGORIAS_CON_HISTORIAL;
    const valores = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, categoria, codigo, etiqueta, valor, activo, updated_at AS "updatedAt"
         FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = ANY($2::text[]) ORDER BY categoria, orden`,
      tenantId,
      categorias,
    );
    const historial = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT h.id, h.categoria, h.codigo, h.valor_anterior AS "valorAnterior", h.valor_nuevo AS "valorNuevo",
              h.motivo, h.created_at AS "createdAt", u.nombre_completo AS "usuarioNombre"
         FROM parametro_sistema_historial h LEFT JOIN usuario u ON u.id = h.usuario_id
        WHERE h.tenant_id = $1::uuid AND h.categoria = ANY($2::text[])
        ORDER BY h.created_at DESC LIMIT 100`,
      tenantId,
      categorias,
    );
    return {
      valores: valores
        .filter((v) => defPorcentaje(v.categoria, v.codigo))
        .map((v) => ({ ...v, numero: v.valor == null ? null : Number(String(v.valor).replace(",", ".")) })),
      historial,
    };
  }

  /** Cambia un porcentaje con motivo; deja el valor anterior y el nuevo en el historial (una transacción). */
  async cambiarPorcentaje(tenantId: string, categoria: string, codigo: string, cuerpo: unknown, usuarioId: string | null) {
    const def = defPorcentaje(categoria, codigo);
    if (!def) throw new NotFoundException(`El parámetro ${categoria}.${codigo} no es un porcentaje configurable.`);
    const b = (cuerpo ?? {}) as { valor?: unknown; motivo?: unknown };
    const valor = leerPorcentaje(b.valor);
    const motivo = typeof b.motivo === "string" ? b.motivo.trim() : "";
    const errores = erroresPorcentaje(def, valor, motivo);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const nuevo = valorGuardado(valor);
    return this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRawUnsafe<{ id: string; valor: string | null }[]>(
        `SELECT id, valor FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = $2 AND codigo = $3 FOR UPDATE`,
        tenantId,
        categoria,
        codigo,
      );
      if (!filas[0]) throw new NotFoundException(`El parámetro ${categoria}.${codigo} no existe en esta instalación.`);
      const anterior = filas[0].valor;
      if (anterior != null && Number(String(anterior).replace(",", ".")) === valor)
        throw new ConflictException("El valor nuevo es igual al vigente: no hay nada que cambiar.");
      await tx.$executeRawUnsafe(`UPDATE parametro_sistema SET valor = $2, updated_at = now() WHERE id = $1::uuid`, filas[0].id, nuevo);
      await tx.$executeRawUnsafe(
        `INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid)`,
        tenantId,
        filas[0].id,
        categoria,
        codigo,
        anterior,
        nuevo,
        motivo,
        usuarioId,
      );
      return { id: filas[0].id, categoria, codigo, valorAnterior: anterior, valor: nuevo };
    });
  }
}

const ParametroCreate = z.object({
  categoria: z.string().min(1).max(60),
  codigo: z.string().min(1).max(60),
  etiqueta: z.string().min(1).max(160),
  // El form envía `orden` como número (input number) o lo omite.
  orden: z.coerce.number().int().default(0),
  activo: z.boolean().default(true),
  // Dato técnico del código (regla de validez del tipo de cliente, número de días…).
  valor: z.string().max(4000).nullable().optional(),
});

/** Tenant del usuario autenticado (lo inyecta JwtStrategy en req.user). */
function tenantDe(req: any): string | undefined {
  return req?.user?.tenantId;
}

/**
 * CRUD de parámetros de negocio.
 *
 * GET (listar/detalle) NO declara permiso `ver`: es de lectura interna para
 * cualquier usuario autenticado, porque los formularios de negocio (p. ej. el
 * alta de clientes, que gestionan roles comerciales sin `catalogo.gestionar`)
 * necesitan leer sus combos. La ESCRITURA sí exige `catalogo.gestionar`.
 *
 * `?categoria=` filtra un combo concreto (lo usan los formularios); `?activo=true`
 * devuelve solo los valores ofrecibles. Sin filtros, lista todo (pantalla de
 * gestión /catalogo/parametros).
 */
@ApiTags("parametros")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("parametros")
@RequierePermisoCrud({
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
})
export class ParametroSistemaController extends BaseCrudController {
  protected createSchema = ParametroCreate;
  protected updateSchema = ParametroCreate.partial();
  constructor(protected svc: ParametroSistemaService) {
    super();
  }

  /**
   * Sobrescribe el listar heredado para admitir los filtros `categoria` y
   * `activo`, que BaseCrudController no contempla.
   */
  @Get()
  @ApiOperation({ summary: "Lista parámetros; filtra por ?categoria= y ?activo=true" })
  override listar(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("search") search?: string,
    @Query("categoria") categoria?: string,
    @Query("activo") activo?: string,
    @Req() req?: any,
  ) {
    const where: Record<string, unknown> = {};
    if (categoria) where.categoria = categoria;
    if (activo === "true") where.activo = true;
    return this.svc.listar(
      { page: parseInt(page), limit: parseInt(limit), search, where },
      tenantDe(req),
    );
  }

  /** El valor de un porcentaje con historial solo cambia por PUT porcentajes/… (con motivo). */
  @Patch(":id")
  override async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = ParametroCreate.partial().parse(body);
    const actual: any = await this.svc.detalle(id, tenantDe(req));
    if (CATEGORIAS_CON_HISTORIAL.includes(actual.categoria)) {
      const cambiaClave =
        (dto.categoria !== undefined && dto.categoria !== actual.categoria) || (dto.codigo !== undefined && dto.codigo !== actual.codigo);
      if (cambiaClave || (dto.valor !== undefined && dto.valor !== actual.valor) || dto.activo === false)
        throw new ConflictException("Este porcentaje se cambia en «Porcentajes de la tasa de internación», con motivo: queda en el historial.");
    }
    return this.svc.actualizar(id, dto, tenantDe(req));
  }

  @Delete(":id")
  override async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const actual: any = await this.svc.detalle(id, tenantDe(req));
    if (CATEGORIAS_CON_HISTORIAL.includes(actual.categoria))
      throw new ConflictException("Los porcentajes de la tasa de internación no se borran: el cálculo de la tasa los necesita.");
    return this.svc.eliminar(id, tenantDe(req));
  }
}

/**
 * Porcentajes de la tasa de internación y del IVA (bpch_tasa). Controlador
 * PROPIO declarado antes del CRUD para que `porcentajes` gane a `@Get(":id")`.
 * Leen quien configura (catalogo.gestionar) y quien trabaja con internaciones
 * (bpch.internacion.ver); cambia solo catalogo.gestionar, con motivo.
 */
@ApiTags("parametros")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("parametros")
export class ParametroPorcentajeController {
  constructor(private readonly svc: ParametroSistemaService) {}

  @Get("porcentajes")
  @ApiOperation({ summary: "Porcentajes de la tasa de internación (bpch_tasa) y su historial" })
  porcentajes(@Req() req: any) {
    exigirAlguno(req, ["catalogo.gestionar", "bpch.internacion.ver"]);
    return this.svc.porcentajes(tenantDe(req) ?? "");
  }

  /** { valor: "1,5", motivo } · 0–100, coma o punto decimal, hasta 4 decimales. */
  @Put("porcentajes/:categoria/:codigo")
  @RequierePermiso("catalogo.gestionar")
  @ApiOperation({ summary: "Cambia un porcentaje con motivo; queda en el historial" })
  cambiar(@Param("categoria") categoria: string, @Param("codigo") codigo: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.cambiarPorcentaje(tenantDe(req) ?? "", categoria, codigo, body, req?.user?.sub ?? null);
  }
}

/** Exige al menos uno de los permisos (SUPERADMIN pasa siempre). */
function exigirAlguno(req: any, permisos: string[]) {
  if ((req?.user?.roles ?? []).includes("SUPERADMIN")) return;
  const tiene: string[] = req?.user?.permisos ?? [];
  if (!permisos.some((p) => tiene.includes(p)))
    throw new ForbiddenException(`Permiso insuficiente. Requiere uno de: ${permisos.join(", ")}`);
}

@Module({
  // El de porcentajes va ANTES que el CRUD para que «porcentajes» gane a `@Get(":id")`.
  controllers: [ParametroPorcentajeController, ParametroSistemaController],
  providers: [ParametroSistemaService],
})
export class ParametroModule {}
