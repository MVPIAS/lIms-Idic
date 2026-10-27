import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { anioChile, hoyChile } from "../common/fecha-chile";
import { siguienteCodigoNc } from "./no-conformidad.reglas";

/**
 * Reclamos de clientes (EP-00 9.2, BL-219) · vista comercial sobre las no
 * conformidades de tipo «reclamo_cliente».
 *
 *   GET  /reclamos                 · reclamo.ver · lista (abiertos, respondidos, cerrados)
 *   POST /reclamos                 · registrar: fecha, cliente y OT, motivo, rol responsable → «Registrar reclamo → responsable»
 *   POST /reclamos/:id/responder   · respuesta al cliente
 *   POST /reclamos/:id/cerrar      · cierre (exige la respuesta)
 * Alcance: Comercial (DCO) los ve todos; el resto, los de las OT de sus
 * laboratorios. Si el reclamo exige una acción correctiva técnica, Calidad abre
 * su no conformidad (la vista «No conformidades» los muestra a ambos).
 */

export const ROLES_RESPONSABLES = ["JEFE_LAB", "JEFE_DEPTO", "COMERCIAL", "PLANIFICACION", "CALIDAD", "DIRECTOR"] as const;
export const ETIQUETA_ROL_RESPONSABLE: Record<(typeof ROLES_RESPONSABLES)[number], string> = {
  JEFE_LAB: "Jefe de Laboratorio",
  JEFE_DEPTO: "Jefe de Departamento (Jefe DCO o técnico)",
  COMERCIAL: "Ejecutivo de Ventas (SVT)",
  PLANIFICACION: "Planificación y Control (SPC)",
  CALIDAD: "Calidad",
  DIRECTOR: "Dirección",
};

/** Estado del reclamo para Comercial (regla pura). */
export function estadoReclamo(r: { estado: string; respuesta?: string | null }): "abierto" | "respondido" | "cerrado" {
  if (r.estado === "cerrada") return "cerrado";
  return r.respuesta && r.respuesta.trim() ? "respondido" : "abierto";
}

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const CrearSchema = z.object({
  fecha,
  clienteId: z.string().uuid(),
  otId: z.string().uuid().nullable().optional(),
  motivo: z.string().trim().min(5, "Describa el motivo del reclamo (mínimo 5 caracteres).").max(5000),
  responsableRol: z.enum(ROLES_RESPONSABLES),
  responsableId: z.string().uuid().nullable().optional(),
  criticidad: z.enum(["baja", "media", "alta", "critica"]).default("media"),
});
const ResponderSchema = z.object({ respuesta: z.string().trim().min(5, "Escriba la respuesta al cliente.").max(5000) });
const CerrarSchema = z.object({ comentario: z.string().trim().max(2000).optional() });

const SELECT = `
  SELECT nc.id, nc.codigo, nc.titulo, nc.descripcion AS motivo, nc.estado, nc.criticidad,
         to_char(nc.reclamo_fecha, 'YYYY-MM-DD') AS fecha, nc.cliente_id AS "clienteId", cl.razon_social AS cliente,
         nc.ot_id AS "otId", o.codigo AS "otCodigo", nc.unidad_id AS "unidadId", un.codigo AS "unidadCodigo",
         nc.responsable_rol AS "responsableRol", nc.responsable_id AS "responsableId", ur.nombre_completo AS responsable,
         nc.respuesta, nc.respondido_at AS "respondidoAt", up.nombre_completo AS "respondidoPor",
         nc.cerrado_at AS "cerradoAt", uc.nombre_completo AS "cerradoPor", nc.cierre_comentario AS "cierreComentario",
         nc.detectado_at AS "registradoAt", ud.nombre_completo AS "registradoPor"
    FROM no_conformidad nc
    LEFT JOIN cliente cl ON cl.id = nc.cliente_id
    LEFT JOIN orden_trabajo o ON o.id = nc.ot_id
    LEFT JOIN unidad un ON un.id = nc.unidad_id
    LEFT JOIN usuario ur ON ur.id = nc.responsable_id
    LEFT JOIN usuario up ON up.id = nc.respondido_por
    LEFT JOIN usuario uc ON uc.id = nc.cerrado_por
    LEFT JOIN usuario ud ON ud.id = nc.detectado_por
   WHERE nc.tipo = 'reclamo_cliente'`;

@ApiTags("reclamos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("reclamos")
export class ReclamoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  /** null = todos (alcance global o DCO); si no, las unidades visibles. */
  private async unidades(req: any): Promise<string[] | null> {
    const v = await this.alcance.filtroUnidades(req);
    if (v === null) return null;
    const dco = (await this.alcance.arbol(req?.user?.tenantId)).porCodigo.get("DCO")?.id;
    return dco && v.includes(dco) ? null : v;
  }

  private async cargar(id: string, req: any) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(`${SELECT} AND nc.id = $1::uuid AND nc.tenant_id = $2::uuid`, id, req?.user?.tenantId);
    if (!f[0]) throw new NotFoundException("Reclamo no encontrado.");
    const u = await this.unidades(req);
    if (u !== null && !(f[0].unidadId && u.includes(f[0].unidadId)))
      throw new ForbiddenException("Fuera de su alcance: el reclamo es de una OT de un laboratorio que usted no tiene asignado.");
    return { ...f[0], estadoReclamo: estadoReclamo(f[0]) };
  }

  @Get()
  @RequierePermiso("reclamo.ver")
  async listar(@Query("estado") estado: string | undefined, @Req() req: any) {
    const u = await this.unidades(req);
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT} AND nc.tenant_id = $1::uuid AND ($2::uuid[] IS NULL OR nc.unidad_id = ANY($2::uuid[]))
        ORDER BY (nc.estado = 'cerrada'), nc.reclamo_fecha DESC NULLS LAST, nc.detectado_at DESC LIMIT 500`,
      req?.user?.tenantId,
      u,
    );
    const data = f.map((x) => ({ ...x, estadoReclamo: estadoReclamo(x) })).filter((x) => !estado || x.estadoReclamo === estado);
    const permisos: string[] = req?.user?.permisos ?? [];
    return {
      data,
      puedeGestionar: (req?.user?.roles ?? []).includes("SUPERADMIN") || permisos.includes("reclamo.gestionar"),
      roles: ROLES_RESPONSABLES.map((r) => ({ codigo: r, etiqueta: ETIQUETA_ROL_RESPONSABLE[r] })),
      resumen: {
        abiertos: f.filter((x) => estadoReclamo(x) === "abierto").length,
        respondidos: f.filter((x) => estadoReclamo(x) === "respondido").length,
        cerrados: f.filter((x) => estadoReclamo(x) === "cerrado").length,
      },
    };
  }

  @Post()
  @RequierePermiso("reclamo.gestionar")
  async crear(@Body() body: unknown, @Req() req: any) {
    const d = CrearSchema.parse(body ?? {});
    const tenantId = req?.user?.tenantId;
    const cl = await this.prisma.$queryRawUnsafe<{ razon_social: string }[]>(`SELECT razon_social FROM cliente WHERE id = $1::uuid AND tenant_id = $2::uuid`, d.clienteId, tenantId);
    if (!cl[0]) throw new BadRequestException("El cliente no existe.");
    let unidadId: string | null = null;
    if (d.otId) {
      const o = await this.prisma.$queryRawUnsafe<{ cliente_id: string; unidad_principal: string | null; codigo: string }[]>(
        `SELECT cliente_id, unidad_principal, codigo FROM orden_trabajo WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        d.otId,
        tenantId,
      );
      if (!o[0]) throw new BadRequestException("La OT no existe.");
      if (o[0].cliente_id !== d.clienteId) throw new BadRequestException(`La OT ${o[0].codigo} es de otro cliente.`);
      unidadId = o[0].unidad_principal;
    }
    const u = await this.unidades(req);
    if (u !== null && !(unidadId && u.includes(unidadId))) throw new ForbiddenException("Solo registra reclamos de OT de sus laboratorios.");
    if (d.fecha > hoyChile()) throw new BadRequestException("La fecha del reclamo no puede ser futura.");
    for (let intento = 0; intento < 3; intento++) {
      const ultimo = await this.prisma.$queryRawUnsafe<{ codigo: string }[]>(
        `SELECT codigo FROM no_conformidad WHERE tenant_id = $1::uuid AND codigo LIKE $2 ORDER BY codigo DESC LIMIT 1`,
        tenantId,
        `NC-${anioChile()}-%`,
      );
      const codigo = siguienteCodigoNc(ultimo[0]?.codigo, anioChile());
      try {
        const f = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO no_conformidad (tenant_id, codigo, titulo, tipo, criticidad, descripcion, unidad_id, ot_id, origen_entidad_tipo, origen_entidad_id,
                                       detectado_por, responsable_id, estado, clase, cliente_id, reclamo_fecha, responsable_rol)
           VALUES ($1::uuid, $2, $3, 'reclamo_cliente', $4, $5, $6::uuid, $7::uuid, $8, $9::uuid, $10::uuid, $11::uuid, 'abierta', 'NC', $12::uuid, $13::date, $14)
           RETURNING id`,
          tenantId,
          codigo,
          `Reclamo de ${cl[0].razon_social}`.slice(0, 200),
          d.criticidad,
          d.motivo,
          unidadId,
          d.otId ?? null,
          d.otId ? "orden_trabajo" : "cliente",
          d.otId ?? d.clienteId,
          req?.user?.sub ?? null,
          d.responsableId ?? null,
          d.clienteId,
          d.fecha,
          d.responsableRol,
        );
        return this.cargar(f[0].id, req);
      } catch (e: any) {
        if (String(e?.message ?? "").includes("no_conformidad_tenant_id_codigo_key") && intento < 2) continue;
        throw e;
      }
    }
    throw new ConflictException("No se pudo asignar un código al reclamo; reintente.");
  }

  @Post(":id/responder")
  @RequierePermiso("reclamo.gestionar")
  async responder(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const { respuesta } = ResponderSchema.parse(body ?? {});
    const r = await this.cargar(id, req);
    if (r.estadoReclamo === "cerrado") throw new ConflictException("El reclamo está cerrado.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE no_conformidad SET respuesta = $2, respondido_at = now(), respondido_por = $3::uuid, updated_at = now() WHERE id = $1::uuid`,
      id,
      respuesta,
      req?.user?.sub ?? null,
    );
    return this.cargar(id, req);
  }

  @Post(":id/cerrar")
  @RequierePermiso("reclamo.gestionar")
  async cerrar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const { comentario } = CerrarSchema.parse(body ?? {});
    const r = await this.cargar(id, req);
    if (r.estadoReclamo === "cerrado") throw new ConflictException("El reclamo ya está cerrado.");
    if (r.estadoReclamo !== "respondido") throw new ConflictException("Registre la respuesta al cliente antes de cerrar el reclamo.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE no_conformidad SET estado = 'cerrada', cerrado_at = now(), cerrado_por = $2::uuid, cierre_comentario = $3, updated_at = now() WHERE id = $1::uuid`,
      id,
      req?.user?.sub ?? null,
      comentario || "Reclamo respondido y cerrado por Comercial.",
    );
    return this.cargar(id, req);
  }
}
