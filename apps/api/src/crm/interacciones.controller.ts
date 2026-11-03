/**
 * CRM · historial de interacciones por cliente (contrato §4.1.2).
 *
 * Registro de llamadas, reuniones, correos, visitas y notas con fecha,
 * contacto, responsable y próxima acción (`cliente_interaccion`,
 * align_comunicacion.sql), y la LÍNEA DE TIEMPO del cliente, que junta además
 * lo que el LIMS ya sabe de él: oportunidades, cotizaciones, OT, correos y
 * documentos vinculados (gestor documental e informes oficiales). Cada fuente
 * se muestra solo si el usuario tiene su permiso de lectura y, las OT y
 * documentos, solo las de su alcance.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
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
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { instanteDeHoraChile } from "../common/fecha-chile";
import { ETIQUETA_INTERACCION, TIPOS_INTERACCION, erroresInteraccion, lineaTiempo, oportunidadEnAlcance, type HitoCliente } from "./reglas-crm";

const vacio = (v: unknown) => (v === "" ? null : v);

const InteraccionBody = z.object({
  tipo: z.enum(TIPOS_INTERACCION),
  /** Instante ISO o «AAAA-MM-DDTHH:mm» de un <input type="datetime-local"> (hora de Chile). */
  fecha: z.string().min(10),
  asunto: z.string().trim().min(3, "Indique el asunto.").max(200),
  detalle: z.preprocess(vacio, z.string().max(10_000).nullable().optional()),
  contacto: z.preprocess(vacio, z.string().max(160).nullable().optional()),
  responsableId: z.preprocess(vacio, z.string().uuid().nullable().optional()),
  oportunidadId: z.preprocess(vacio, z.string().uuid().nullable().optional()),
  otId: z.preprocess(vacio, z.string().uuid().nullable().optional()),
  cotizacionId: z.preprocess(vacio, z.string().uuid().nullable().optional()),
  proximaAccion: z.preprocess(vacio, z.string().max(200).nullable().optional()),
  proximaFecha: z.preprocess(vacio, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Próxima fecha: AAAA-MM-DD.").nullable().optional()),
});

/** «2026-11-02T10:30» sin zona = hora de pared de Chile; con zona o «Z», tal cual. */
function instante(fecha: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(fecha.trim());
  if (m) {
    // Fecha de calendario de Chile: se guarda con la hora indicada o a las 12:00.
    return instanteDeHoraChile(+m[1], +m[2], +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0);
  }
  const d = new Date(fecha);
  return Number.isNaN(d.getTime()) ? null : d;
}

@ApiTags("clientes")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("clientes")
export class InteraccionesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  private async cliente(id: string, tenantId: string) {
    const c = await this.prisma.cliente.findFirst({ where: { id, tenantId }, select: { id: true, razonSocial: true } });
    if (!c) throw new NotFoundException("Cliente no encontrado.");
    return c;
  }

  /** Línea de tiempo del cliente (§4.1.2). `clases` = lista separada por comas para filtrar. */
  @Get(":id/historial")
  @RequierePermiso("cliente.ver")
  async historial(@Param("id", ParseUUIDPipe) id: string, @Query("clases") clases: string | undefined, @Req() req: any) {
    const tenantId = req.user.tenantId;
    const c = await this.cliente(id, tenantId);
    const permisos: string[] = req.user.permisos ?? [];
    const super_ = (req.user.roles ?? []).includes("SUPERADMIN");
    const puede = (p: string) => super_ || permisos.includes(p);
    const pedidas = new Set((clases ?? "").split(",").map((x) => x.trim()).filter(Boolean));
    const quiere = (k: string) => !pedidas.size || pedidas.has(k);
    const fuentes: HitoCliente[][] = [];
    const iso = (d: any) => (d instanceof Date ? d.toISOString() : String(d));

    if (quiere("interaccion")) {
      const f = await this.interaccionesDe(id, tenantId);
      fuentes.push(
        f.map((i) => ({
          clase: "interaccion",
          id: i.id,
          fecha: iso(i.fecha),
          titulo: `${ETIQUETA_INTERACCION[i.tipo as keyof typeof ETIQUETA_INTERACCION] ?? i.tipo}: ${i.asunto}`,
          detalle: [i.detalle, i.contacto ? `Contacto: ${i.contacto}` : null, i.proximaAccion ? `Próxima acción: ${i.proximaAccion}${i.proximaFecha ? ` (${String(i.proximaFecha).split("-").reverse().join("-")})` : ""}` : null]
            .filter(Boolean)
            .join(" · ") || null,
          subtipo: i.tipo,
          responsable: i.responsable,
          ruta: null,
        })),
      );
    }

    if (quiere("oportunidad") && puede("cotizacion.ver")) {
      const visibles = await this.alcance.filtroUnidades(req, "cotizacion.ver");
      const dco = visibles === null ? null : (await this.alcance.arbol(tenantId)).porCodigo.get("DCO")?.id ?? null;
      const f = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, codigo, titulo, etapa, estado, unidad_id, created_at FROM oportunidad
          WHERE tenant_id = $1::uuid AND cliente_id = $2::uuid AND deleted_at IS NULL`,
        tenantId,
        id,
      );
      fuentes.push(
        f
          .filter((o) => oportunidadEnAlcance(visibles, o.unidad_id, dco))
          .map((o) => ({ clase: "oportunidad", id: o.id, fecha: iso(o.created_at), titulo: `Oportunidad ${o.codigo}: ${o.titulo}`, detalle: `Etapa ${o.etapa}`, subtipo: o.estado, responsable: null, ruta: "/crm" })),
      );
    }

    if (quiere("cotizacion") && puede("cotizacion.ver")) {
      const f = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT c.id, c.codigo, c.estado, c.total, c.moneda, c.created_at, u.nombre_completo AS ejecutivo
           FROM cotizacion c LEFT JOIN usuario u ON u.id = c.ejecutivo_id
          WHERE c.tenant_id = $1::uuid AND c.cliente_id = $2::uuid`,
        tenantId,
        id,
      );
      fuentes.push(
        f.map((x) => ({
          clase: "cotizacion",
          id: x.id,
          fecha: iso(x.created_at),
          titulo: `Cotización ${x.codigo}`,
          detalle: `Estado ${x.estado} · total ${Math.round(Number(x.total ?? 0)).toLocaleString("es-CL")} ${x.moneda ?? "CLP"}`,
          subtipo: x.estado,
          responsable: x.ejecutivo,
          ruta: `/cotizaciones/${x.id}`,
        })),
      );
    }

    let otsVisibles: string[] = [];
    if (puede("ot.ver")) {
      const visibles = await this.alcance.filtroUnidades(req, "ot.ver");
      const f = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT o.id, o.codigo, o.estado, o.created_at, o.fecha_compromiso::text AS fecha_compromiso, un.codigo AS unidad
           FROM orden_trabajo o LEFT JOIN unidad un ON un.id = o.unidad_principal
          WHERE o.tenant_id = $1::uuid AND o.cliente_id = $2::uuid
            AND ($3::uuid[] IS NULL OR o.unidad_principal = ANY($3::uuid[]))`,
        tenantId,
        id,
        visibles,
      );
      otsVisibles = f.map((o) => o.id);
      if (quiere("ot"))
        fuentes.push(
          f.map((o) => ({
            clase: "ot",
            id: o.id,
            fecha: iso(o.created_at),
            titulo: `OT ${o.codigo}${o.unidad ? ` · ${o.unidad}` : ""}`,
            detalle: `Estado ${o.estado}${o.fecha_compromiso ? ` · compromiso ${o.fecha_compromiso.split("-").reverse().join("-")}` : ""}`,
            subtipo: o.estado,
            responsable: null,
            ruta: `/ot/${o.id}`,
          })),
        );
    }

    if (quiere("correo") && puede("cotizacion.ver")) {
      const f = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT ce.id, ce.asunto, ce.destinatarios, ce.estado, ce.tipo, ce.n_adjuntos, ce.created_at,
                COALESCE(u.nombre_completo, 'Sistema LIMS') AS remitente
           FROM correo_enviado ce LEFT JOIN usuario u ON u.id = ce.enviado_por
          WHERE ce.tenant_id = $1::uuid AND ce.cliente_id = $2::uuid
          ORDER BY ce.created_at DESC LIMIT 200`,
        tenantId,
        id,
      );
      fuentes.push(
        f.map((x) => ({
          clase: "correo",
          id: x.id,
          fecha: iso(x.created_at),
          titulo: `Correo: ${x.asunto ?? "(sin asunto)"}`,
          detalle: `A ${x.destinatarios}${x.n_adjuntos ? ` · ${x.n_adjuntos} adjunto(s)` : ""} · ${x.estado === "enviado" ? "enviado" : x.estado === "sin_configurar" ? "sin servidor de correo" : "no enviado"}`,
          subtipo: x.estado,
          responsable: x.remitente,
          ruta: "/mensajeria",
        })),
      );
    }

    if (quiere("documento")) {
      const docs: HitoCliente[] = [];
      if (puede("documento.ver")) {
        const visibles = await this.alcance.filtroUnidades(req, "documento.ver");
        const f = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT d.id, d.codigo, d.titulo, d.version_publicada, d.creado_en, u.nombre_completo AS autor
             FROM doc_documento d JOIN doc_carpeta k ON k.id = d.carpeta_id
             LEFT JOIN usuario u ON u.id = d.creado_por
            WHERE d.tenant_id = $1::uuid AND d.deleted_at IS NULL AND NOT d.restringido
              AND (d.cliente_id = $2::uuid OR d.ot_id = ANY($3::uuid[]))
              AND ($4::uuid[] IS NULL OR k.unidad_id IS NULL OR k.unidad_id = ANY($4::uuid[]))`,
          tenantId,
          id,
          otsVisibles,
          visibles,
        );
        docs.push(
          ...f.map((d) => ({
            clase: "documento" as const,
            id: d.id,
            fecha: iso(d.creado_en),
            titulo: `Documento ${d.codigo}: ${d.titulo}`,
            detalle: d.version_publicada ? `Versión publicada ${d.version_publicada}` : "Sin versión publicada",
            subtipo: "gestor",
            responsable: d.autor,
            ruta: "/documentos",
          })),
        );
      }
      // Informes y certificados oficiales de sus OT visibles.
      if (otsVisibles.length) {
        const f = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT c.id, COALESCE(c.numero, c.codigo) AS numero, c.tipo_documento, c.estado, c.ot_id,
                  COALESCE(c.oficial_at, c.emitido_at, c.created_at) AS fecha
             FROM certificado c
            WHERE c.ot_id = ANY($1::uuid[]) AND c.estado IN ('oficial', 'emitido', 'entregado')`,
          otsVisibles,
        );
        docs.push(
          ...f.map((d) => ({
            clase: "documento" as const,
            id: d.id,
            fecha: iso(d.fecha),
            titulo: `${d.tipo_documento ?? "Informe"} ${d.numero ?? ""}`.trim(),
            detalle: `Estado ${d.estado}`,
            subtipo: "informe",
            responsable: null,
            ruta: `/ot/${d.ot_id}?tab=informe`,
          })),
        );
      }
      fuentes.push(docs);
    }

    const data = lineaTiempo(fuentes);
    const conteo: Record<string, number> = {};
    for (const h of data) conteo[h.clase] = (conteo[h.clase] ?? 0) + 1;
    return { cliente: c, data, conteo };
  }

  private interaccionesDe(clienteId: string, tenantId: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT i.id, i.tipo, i.fecha, i.asunto, i.detalle, i.contacto, i.responsable_id AS "responsableId",
              u.nombre_completo AS responsable, i.oportunidad_id AS "oportunidadId", i.ot_id AS "otId", o.codigo AS "otCodigo",
              i.cotizacion_id AS "cotizacionId", c.codigo AS "cotizacionCodigo",
              i.proxima_accion AS "proximaAccion", i.proxima_fecha::text AS "proximaFecha", i.creado_por AS "creadoPor", i.created_at AS "createdAt"
         FROM cliente_interaccion i
         LEFT JOIN usuario u ON u.id = i.responsable_id
         LEFT JOIN orden_trabajo o ON o.id = i.ot_id
         LEFT JOIN cotizacion c ON c.id = i.cotizacion_id
        WHERE i.tenant_id = $1::uuid AND i.cliente_id = $2::uuid AND i.deleted_at IS NULL
        ORDER BY i.fecha DESC`,
      tenantId,
      clienteId,
    );
  }

  @Get(":id/interacciones")
  @RequierePermiso("cliente.ver")
  async listar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.cliente(id, req.user.tenantId);
    return this.interaccionesDe(id, req.user.tenantId);
  }

  /** Comprueba que la OT, la cotización y la oportunidad citadas sean de este cliente. */
  private async validarVinculos(tenantId: string, clienteId: string, d: z.infer<typeof InteraccionBody>) {
    const ajeno = async (tabla: string, vid: string | null | undefined, que: string) => {
      if (!vid) return;
      const [f] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT cliente_id FROM ${tabla} WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        vid,
        tenantId,
      );
      if (!f) throw new NotFoundException(`${que} no encontrada.`);
      if (f.cliente_id !== clienteId) throw new BadRequestException(`${que} no es de este cliente.`);
    };
    await ajeno("orden_trabajo", d.otId, "La OT");
    await ajeno("cotizacion", d.cotizacionId, "La cotización");
    await ajeno("oportunidad", d.oportunidadId, "La oportunidad");
    if (d.responsableId) {
      const u = await this.prisma.usuario.findFirst({ where: { id: d.responsableId, tenantId }, select: { id: true } });
      if (!u) throw new BadRequestException("El responsable no es un usuario del instituto.");
    }
  }

  @Post(":id/interacciones")
  @RequierePermiso("cliente.interaccion")
  async crear(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const tenantId = req.user.tenantId;
    await this.cliente(id, tenantId);
    const d = InteraccionBody.parse(body ?? {});
    const fecha = instante(d.fecha);
    const errores = erroresInteraccion({ fecha, proximaAccion: d.proximaAccion, proximaFecha: d.proximaFecha }, new Date());
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.validarVinculos(tenantId, id, d);
    const [f] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO cliente_interaccion (tenant_id, cliente_id, tipo, fecha, asunto, detalle, contacto, responsable_id,
                                        oportunidad_id, ot_id, cotizacion_id, proxima_accion, proxima_fecha, creado_por)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, COALESCE($8::uuid, $14::uuid), $9::uuid, $10::uuid, $11::uuid, $12, $13::date, $14::uuid)
       RETURNING id`,
      tenantId,
      id,
      d.tipo,
      fecha,
      d.asunto,
      d.detalle ?? null,
      d.contacto ?? null,
      d.responsableId ?? null,
      d.oportunidadId ?? null,
      d.otId ?? null,
      d.cotizacionId ?? null,
      d.proximaAccion ?? null,
      d.proximaFecha ?? null,
      req.user.sub ?? null,
    );
    return (await this.interaccionesDe(id, tenantId)).find((i) => i.id === f.id);
  }

  /** Corregir o anular: quien la registró o una jefatura con cliente.editar. */
  private async propia(req: any, clienteId: string, iid: string) {
    const [i] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, creado_por FROM cliente_interaccion WHERE id = $1::uuid AND cliente_id = $2::uuid AND tenant_id = $3::uuid AND deleted_at IS NULL`,
      iid,
      clienteId,
      req.user.tenantId,
    );
    if (!i) throw new NotFoundException("Interacción no encontrada.");
    const permisos: string[] = req.user.permisos ?? [];
    if (i.creado_por !== req.user.sub && !permisos.includes("cliente.editar") && !(req.user.roles ?? []).includes("SUPERADMIN"))
      throw new ForbiddenException("Solo quien registró la interacción (o quien edita clientes) puede cambiarla.");
    return i;
  }

  @Patch(":id/interacciones/:iid")
  @RequierePermiso("cliente.interaccion")
  async editar(@Param("id", ParseUUIDPipe) id: string, @Param("iid", ParseUUIDPipe) iid: string, @Body() body: unknown, @Req() req: any) {
    const tenantId = req.user.tenantId;
    await this.propia(req, id, iid);
    const d = InteraccionBody.parse(body ?? {});
    const fecha = instante(d.fecha);
    const errores = erroresInteraccion({ fecha, proximaAccion: d.proximaAccion, proximaFecha: d.proximaFecha }, new Date());
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.validarVinculos(tenantId, id, d);
    await this.prisma.$executeRawUnsafe(
      `UPDATE cliente_interaccion SET tipo = $3, fecha = $4, asunto = $5, detalle = $6, contacto = $7, responsable_id = COALESCE($8::uuid, responsable_id),
              oportunidad_id = $9::uuid, ot_id = $10::uuid, cotizacion_id = $11::uuid, proxima_accion = $12, proxima_fecha = $13::date, actualizado_en = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      iid,
      tenantId,
      d.tipo,
      fecha,
      d.asunto,
      d.detalle ?? null,
      d.contacto ?? null,
      d.responsableId ?? null,
      d.oportunidadId ?? null,
      d.otId ?? null,
      d.cotizacionId ?? null,
      d.proximaAccion ?? null,
      d.proximaFecha ?? null,
    );
    return (await this.interaccionesDe(id, tenantId)).find((i) => i.id === iid);
  }

  @Delete(":id/interacciones/:iid")
  @RequierePermiso("cliente.interaccion")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Param("iid", ParseUUIDPipe) iid: string, @Req() req: any) {
    await this.propia(req, id, iid);
    await this.prisma.$executeRawUnsafe(`UPDATE cliente_interaccion SET deleted_at = now() WHERE id = $1::uuid`, iid);
    return { ok: true };
  }
}
