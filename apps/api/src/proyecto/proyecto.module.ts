/**
 * Proyectos de cliente (quinto envío IDIC, lote 3) · mantenedor en Comercial.
 *
 * Un proyecto tiene código PROY/correlativo/año (numeracion-proyecto.ts), nombre
 * y UN cliente. Se elige (opcional) en la cotización, la OT lo hereda y la Zona
 * de informes filtra y consolida por él.
 *
 * Rutas:
 *   GET   /proyectos       · lista (search, clienteId, activo=1|0, page, limit) · cotizacion.ver o proyecto.gestionar
 *   GET   /proyectos/:id   · ficha con cuántas cotizaciones y OT lo llevan
 *   POST  /proyectos       · crear {clienteId, nombre, descripcion?}            · proyecto.gestionar
 *   PATCH /proyectos/:id   · nombre, descripción, activo                         · proyecto.gestionar
 * No se borran: se desactivan (un proyecto inactivo no se ofrece en las cotizaciones nuevas).
 * La tabla `proyecto` no está enlazada en Prisma con relaciones: SQL parametrizado.
 */
import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { DEV_TENANT } from "../common/base-crud.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequiereAlgunPermiso, RequierePermiso } from "../auth/permisos.decorator";
import { generarCodigoProyecto, textoProyecto } from "./numeracion-proyecto";

export const PERMISO_PROYECTO = "proyecto.gestionar";

const vacioANull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const aBool = (v: unknown) => (v === "si" || v === "true" ? true : v === "no" || v === "false" ? false : v);

const CrearProyectoSchema = z.object({
  clienteId: z.string({ required_error: "Elija el cliente del proyecto." }).uuid("Elija el cliente del proyecto."),
  nombre: z.string().trim().min(1, "Escriba el nombre del proyecto.").max(300, "Nombre del proyecto: máximo 300 caracteres."),
  descripcion: z.preprocess(vacioANull, z.string().trim().max(2000, "Descripción: máximo 2.000 caracteres.").nullable().optional()),
  activo: z.preprocess(aBool, z.boolean().optional()),
});

const EditarProyectoSchema = z.object({
  // El cliente no cambia (un proyecto pertenece a un solo cliente); se admite para comprobarlo.
  clienteId: z.preprocess(vacioANull, z.string().uuid().nullable().optional()),
  nombre: z.string().trim().min(1, "Escriba el nombre del proyecto.").max(300, "Nombre del proyecto: máximo 300 caracteres.").optional(),
  descripcion: z.preprocess(vacioANull, z.string().trim().max(2000, "Descripción: máximo 2.000 caracteres.").nullable().optional()),
  activo: z.preprocess(aBool, z.boolean().optional()),
});

const SELECT_PROYECTO = `
  SELECT p.id::text AS id, p.codigo, p.nombre, p.descripcion, p.cliente_id::text AS "clienteId", COALESCE(p.activo, TRUE) AS activo,
         p.anio, p.created_at AS "createdAt", p.updated_at AS "updatedAt",
         c.razon_social AS "clienteRazonSocial", c.rut AS "clienteRut",
         (SELECT count(*)::int FROM cotizacion x WHERE x.proyecto_id = p.id) AS cotizaciones,
         (SELECT count(*)::int FROM orden_trabajo x WHERE x.proyecto_id = p.id) AS ots
    FROM proyecto p LEFT JOIN cliente c ON c.id = p.cliente_id`;

function forma(f: any) {
  const { clienteRazonSocial, clienteRut, ...r } = f;
  return { ...r, texto: textoProyecto(f.codigo, f.nombre), cliente: f.clienteId ? { id: f.clienteId, razonSocial: clienteRazonSocial, rut: clienteRut } : null };
}

@Injectable()
export class ProyectoService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(tenantId: string, q: { search?: string; clienteId?: string; activo?: string; page?: string; limit?: string }) {
    const page = Math.max(1, parseInt(q.page ?? "1") || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? "20") || 20));
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (q.clienteId && !uuid.test(q.clienteId)) throw new BadRequestException("clienteId no es válido.");
    const activo = q.activo === "1" || q.activo === "true" ? true : q.activo === "0" || q.activo === "false" ? false : null;
    const texto = (q.search ?? "").trim().slice(0, 80);
    const like = texto ? `%${texto.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const donde = `p.tenant_id = $1::uuid AND ($2::uuid IS NULL OR p.cliente_id = $2::uuid)
      AND ($3::boolean IS NULL OR COALESCE(p.activo, TRUE) = $3::boolean)
      AND ($4::text IS NULL OR p.codigo ILIKE $4 OR p.nombre ILIKE $4 OR c.razon_social ILIKE $4 OR c.rut ILIKE $4)`;
    const args = [tenantId, q.clienteId || null, activo, like];
    const [filas, total] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `${SELECT_PROYECTO} WHERE ${donde} ORDER BY p.created_at DESC, p.codigo DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        ...args,
      ),
      this.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM proyecto p LEFT JOIN cliente c ON c.id = p.cliente_id WHERE ${donde}`, ...args),
    ]);
    const n = total[0]?.n ?? 0;
    return { data: filas.map(forma), meta: { page, limit, total: n, totalPages: Math.max(1, Math.ceil(n / limit)) } };
  }

  async detalle(tenantId: string, id: string) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(`${SELECT_PROYECTO} WHERE p.id = $1::uuid AND p.tenant_id = $2::uuid`, id, tenantId);
    if (!f[0]) throw new NotFoundException("Proyecto no encontrado.");
    return forma(f[0]);
  }

  /** Mismo nombre (sin distinguir mayúsculas) para el mismo cliente: no se duplica. */
  private async exigirNombreLibre(tenantId: string, clienteId: string, nombre: string, salvoId?: string) {
    const d = await this.prisma.$queryRawUnsafe<{ codigo: string }[]>(
      `SELECT codigo FROM proyecto WHERE tenant_id = $1::uuid AND cliente_id = $2::uuid AND lower(btrim(nombre)) = lower(btrim($3))
          AND ($4::uuid IS NULL OR id <> $4::uuid) LIMIT 1`,
      tenantId,
      clienteId,
      nombre,
      salvoId ?? null,
    );
    if (d[0]) throw new ConflictException(`El cliente ya tiene el proyecto ${d[0].codigo} con ese nombre.`);
  }

  async crear(tenantId: string, usuarioId: string | null, body: unknown) {
    const d = CrearProyectoSchema.parse(body);
    const cli = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id::text AS id FROM cliente WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      d.clienteId,
      tenantId,
    );
    if (!cli[0]) throw new BadRequestException("El cliente elegido no existe.");
    await this.exigirNombreLibre(tenantId, d.clienteId, d.nombre);
    const usuario = usuarioId ? await this.prisma.usuario.findFirst({ where: { id: usuarioId }, select: { id: true } }) : null;
    const id = await this.prisma.$transaction(async (tx) => {
      const c = await generarCodigoProyecto(tx, tenantId);
      const f = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO proyecto (tenant_id, codigo, nombre, descripcion, cliente_id, activo, anio, correlativo, created_by, updated_by)
         VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9::uuid, $9::uuid) RETURNING id::text AS id`,
        tenantId,
        c.codigo,
        d.nombre,
        d.descripcion ?? null,
        d.clienteId,
        d.activo ?? true,
        c.anio,
        c.correlativo,
        usuario?.id ?? null,
      );
      return f[0].id;
    });
    return this.detalle(tenantId, id);
  }

  async actualizar(tenantId: string, usuarioId: string | null, id: string, body: unknown) {
    const d = EditarProyectoSchema.parse(body);
    const actual = await this.detalle(tenantId, id);
    if (d.clienteId && d.clienteId !== actual.clienteId)
      throw new ConflictException(`El proyecto ${actual.codigo} pertenece a ${actual.cliente?.razonSocial ?? "otro cliente"}: el cliente de un proyecto no cambia.`);
    const nombre = d.nombre !== undefined ? d.nombre : actual.nombre;
    if (nombre !== actual.nombre && actual.clienteId) await this.exigirNombreLibre(tenantId, actual.clienteId, nombre, id);
    const usuario = usuarioId ? await this.prisma.usuario.findFirst({ where: { id: usuarioId }, select: { id: true } }) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE proyecto SET nombre = $2, descripcion = $3, activo = $4, updated_at = now(), updated_by = $5::uuid WHERE id = $1::uuid`,
        id,
        nombre,
        d.descripcion !== undefined ? d.descripcion : actual.descripcion,
        d.activo !== undefined ? d.activo : actual.activo,
        usuario?.id ?? null,
      );
      // El texto del encargo de sus OT («Nombre del proyecto» del IVC) sigue al nombre, salvo el escrito a mano.
      if (nombre !== actual.nombre)
        await tx.$executeRawUnsafe(
          `UPDATE ot_encargo e SET proyecto = $2, actualizado_at = now()
             FROM orden_trabajo o WHERE o.id = e.ot_id AND o.proyecto_id = $1::uuid AND e.proyecto = $3`,
          id,
          textoProyecto(actual.codigo, nombre),
          textoProyecto(actual.codigo, actual.nombre),
        );
    });
    return this.detalle(tenantId, id);
  }
}

const tenantDe = (req: any): string => req?.user?.tenantId ?? DEV_TENANT;

@ApiTags("proyectos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("proyectos")
export class ProyectoController {
  constructor(private readonly svc: ProyectoService) {}

  @Get()
  @RequiereAlgunPermiso("cotizacion.ver", PERMISO_PROYECTO)
  @ApiOperation({ summary: "Proyectos de cliente (search, clienteId, activo=1|0, page, limit)" })
  listar(@Query() q: Record<string, string>, @Req() req: any) {
    return this.svc.listar(tenantDe(req), q ?? {});
  }

  @Get(":id")
  @RequiereAlgunPermiso("cotizacion.ver", PERMISO_PROYECTO)
  detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(tenantDe(req), id);
  }

  @Post()
  @RequierePermiso(PERMISO_PROYECTO)
  @ApiOperation({ summary: "Crear proyecto (código PROY/correlativo/año automático)" })
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crear(tenantDe(req), req?.user?.sub ?? null, body);
  }

  @Patch(":id")
  @RequierePermiso(PERMISO_PROYECTO)
  @ApiOperation({ summary: "Cambiar nombre, descripción o activar / desactivar el proyecto" })
  actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.actualizar(tenantDe(req), req?.user?.sub ?? null, id, body);
  }
}

@Module({ controllers: [ProyectoController], providers: [ProyectoService] })
export class ProyectoModule {}
