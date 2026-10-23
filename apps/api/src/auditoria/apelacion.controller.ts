import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { anioChile } from "../common/fecha-chile";
import { entero, valoresCategoria } from "../common/parametros-r4d";
import { MAX_BYTES_ADJUNTO, cabecerasAdjunto, guardarAdjunto, leerAdjunto, listarAdjuntos, type ArchivoAdjunto } from "../common/adjuntos";

/**
 * Apelación de un Informe de Rechazo (LRB · EP-05 8.2, BL-166).
 *
 *   GET  /apelaciones[?otId=]            · apelacion.ver       · lista del alcance
 *   POST /apelaciones                    · apelacion.registrar · «Registrar apelación → Director» (Jefe DSA o de Laboratorio)
 *   POST /apelaciones/:id/adjuntos       · apelacion.registrar · antecedentes (PDF o imagen)
 *   POST /apelaciones/:id/resolver       · apelacion.resolver  · «Resolver → cerrar» (Director: acoge o rechaza, inapelable)
 *
 * Plazo: N días hábiles (lunes a viernes) desde la recepción del informe; N es
 * el parámetro lrb.plazo_apelacion (5 por defecto). Fuera de plazo se registra
 * igual, con el aviso y la marca «fuera de plazo» (lo decide el Director).
 * Feriados: POR CONFIRMAR (no se descuentan).
 */

/** Suma días hábiles (lunes a viernes) a una fecha AAAA-MM-DD. */
export function sumarDiasHabiles(desde: string, dias: number): string {
  const d = new Date(`${desde}T12:00:00Z`);
  let n = 0;
  while (n < dias) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return d.toISOString().slice(0, 10);
}

/** Plazo de la apelación y si el ingreso quedó fuera (regla pura). */
export function plazoApelacion(fechaRecepcion: string, fechaIngreso: string, dias: number): { venceEl: string; fueraDePlazo: boolean } {
  const venceEl = sumarDiasHabiles(fechaRecepcion, dias);
  return { venceEl, fueraDePlazo: fechaIngreso > venceEl };
}

/** Código APE-AAAA-NNNN. */
export function siguienteCodigoApelacion(ultimo: string | null | undefined, anio: number): string {
  const m = ultimo ? /^APE-(\d{4})-(\d+)$/.exec(ultimo) : null;
  const n = m && Number(m[1]) === anio ? Number(m[2]) + 1 : 1;
  return `APE-${anio}-${String(n).padStart(4, "0")}`;
}

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const RegistrarSchema = z
  .object({
    otId: z.string().uuid(),
    certificadoId: z.string().uuid().nullable().optional(),
    documentoNumero: z.string().trim().max(80).nullable().optional(),
    fechaRecepcionDoc: fecha,
    fechaIngreso: fecha,
    fundamento: z.string().trim().min(10, "Escriba el fundamento de la apelación (mínimo 10 caracteres).").max(10000),
    antecedentes: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((d) => d.fechaIngreso >= d.fechaRecepcionDoc, { message: "La apelación no puede ingresar antes de recibir el informe.", path: ["fechaIngreso"] });
const ResolverSchema = z.object({
  decision: z.enum(["acoge", "rechaza"]),
  resolucionFecha: fecha,
  resolucionTexto: z.string().trim().min(5, "Escriba la resolución.").max(10000),
});

const SELECT = `
  SELECT a.id, a.codigo, a.ot_id AS "otId", o.codigo AS "otCodigo", o.unidad_principal AS "unidadId", un.codigo AS "unidadCodigo",
         cl.razon_social AS cliente, a.certificado_id AS "certificadoId", COALESCE(ce.numero, a.documento_numero) AS documento,
         to_char(a.fecha_recepcion_doc, 'YYYY-MM-DD') AS "fechaRecepcionDoc", to_char(a.fecha_ingreso, 'YYYY-MM-DD') AS "fechaIngreso",
         a.plazo_dias_habiles AS "plazoDias", to_char(a.vence_el, 'YYYY-MM-DD') AS "venceEl", a.fuera_de_plazo AS "fueraDePlazo",
         a.fundamento, a.antecedentes, a.estado, a.decision, to_char(a.resolucion_fecha, 'YYYY-MM-DD') AS "resolucionFecha",
         a.resolucion_texto AS "resolucionTexto", ur.nombre_completo AS "resueltaPor", a.resuelta_at AS "resueltaAt",
         ug.nombre_completo AS "registradaPor", a.created_at AS "registradaAt"
    FROM apelacion a
    JOIN orden_trabajo o ON o.id = a.ot_id
    LEFT JOIN unidad un ON un.id = o.unidad_principal
    LEFT JOIN cliente cl ON cl.id = o.cliente_id
    LEFT JOIN certificado ce ON ce.id = a.certificado_id
    LEFT JOIN usuario ur ON ur.id = a.resuelta_por
    LEFT JOIN usuario ug ON ug.id = a.registrada_por`;

@ApiTags("apelaciones")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("apelaciones")
export class ApelacionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  private async cargar(id: string, req: any) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(`${SELECT} WHERE a.id = $1::uuid AND a.tenant_id = $2::uuid`, id, req?.user?.tenantId);
    if (!f[0]) throw new NotFoundException("Apelación no encontrada.");
    await this.alcance.exigirUnidad(req, f[0].unidadId, `la OT ${f[0].otCodigo}`);
    const adjuntos = await listarAdjuntos(this.prisma, req?.user?.tenantId, "apelacion", [id]);
    return { ...f[0], adjuntos };
  }

  @Get()
  @RequierePermiso("apelacion.ver")
  async listar(@Query("otId") otId: string | undefined, @Req() req: any) {
    if (otId && !z.string().uuid().safeParse(otId).success) throw new BadRequestException("otId inválido.");
    const u = await this.alcance.filtroUnidades(req);
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT} WHERE a.tenant_id = $1::uuid AND ($2::uuid[] IS NULL OR o.unidad_principal = ANY($2::uuid[])) AND ($3::uuid IS NULL OR a.ot_id = $3::uuid)
        ORDER BY (a.estado = 'resuelta'), a.fecha_ingreso DESC LIMIT 300`,
      req?.user?.tenantId,
      u,
      otId ?? null,
    );
    const dias = entero((await valoresCategoria(this.prisma, req?.user?.tenantId, "lrb")).plazo_apelacion, 5, 1, 60);
    return { data, plazoDias: dias };
  }

  @Post()
  @RequierePermiso("apelacion.registrar")
  async registrar(@Body() body: unknown, @Req() req: any) {
    const d = RegistrarSchema.parse(body ?? {});
    const tenantId = req?.user?.tenantId;
    const o = await this.prisma.$queryRawUnsafe<{ codigo: string; unidad_principal: string | null }[]>(
      `SELECT codigo, unidad_principal FROM orden_trabajo WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      d.otId,
      tenantId,
    );
    if (!o[0]) throw new BadRequestException("La OT no existe.");
    await this.alcance.exigirUnidad(req, o[0].unidad_principal, `la OT ${o[0].codigo}`, "apelacion.registrar");
    if (d.certificadoId) {
      const c = await this.prisma.$queryRawUnsafe<{ estado: string }[]>(`SELECT estado FROM certificado WHERE id = $1::uuid AND ot_id = $2::uuid`, d.certificadoId, d.otId);
      if (!c[0]) throw new BadRequestException("El informe indicado no es de la OT.");
    } else if (!d.documentoNumero) throw new BadRequestException("Indique el informe de rechazo que se apela (documento de la OT o su número).");
    const viva = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT codigo FROM apelacion WHERE ot_id = $1::uuid AND estado = 'registrada' AND COALESCE(certificado_id::text, documento_numero) = COALESCE($2::text, $3)`,
      d.otId,
      d.certificadoId ?? null,
      d.documentoNumero ?? null,
    );
    if (viva.length) throw new ConflictException(`Ya hay una apelación en trámite de ese informe (${viva[0].codigo}).`);
    const dias = entero((await valoresCategoria(this.prisma, tenantId, "lrb")).plazo_apelacion, 5, 1, 60);
    const p = plazoApelacion(d.fechaRecepcionDoc, d.fechaIngreso, dias);
    for (let intento = 0; intento < 3; intento++) {
      const ult = await this.prisma.$queryRawUnsafe<{ codigo: string }[]>(
        `SELECT codigo FROM apelacion WHERE tenant_id = $1::uuid AND codigo LIKE $2 ORDER BY codigo DESC LIMIT 1`,
        tenantId,
        `APE-${anioChile()}-%`,
      );
      try {
        const f = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO apelacion (tenant_id, codigo, ot_id, certificado_id, documento_numero, fecha_recepcion_doc, fecha_ingreso, plazo_dias_habiles,
                                  vence_el, fuera_de_plazo, fundamento, antecedentes, registrada_por)
           VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6::date, $7::date, $8, $9::date, $10, $11, $12, $13::uuid) RETURNING id`,
          tenantId,
          siguienteCodigoApelacion(ult[0]?.codigo, anioChile()),
          d.otId,
          d.certificadoId ?? null,
          d.documentoNumero ?? null,
          d.fechaRecepcionDoc,
          d.fechaIngreso,
          dias,
          p.venceEl,
          p.fueraDePlazo,
          d.fundamento,
          d.antecedentes ?? null,
          req?.user?.sub ?? null,
        );
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'apelacion', $3::jsonb, $4::uuid)`,
          tenantId,
          d.otId,
          JSON.stringify({ apelacionId: f[0].id, fueraDePlazo: p.fueraDePlazo, venceEl: p.venceEl }),
          req?.user?.sub ?? null,
        );
        const a = await this.cargar(f[0].id, req);
        return {
          ...a,
          aviso: p.fueraDePlazo ? `Fuera de plazo: vencía el ${p.venceEl} (${dias} días hábiles desde la recepción del informe). La resuelve igual el Director.` : null,
        };
      } catch (e: any) {
        if (String(e?.message ?? "").includes("ux_apelacion_codigo") && intento < 2) continue;
        throw e;
      }
    }
    throw new ConflictException("No se pudo asignar un código a la apelación; reintente.");
  }

  @Post(":id/adjuntos")
  @RequierePermiso("apelacion.registrar")
  @UseInterceptors(FileInterceptor("archivo", { limits: { fileSize: MAX_BYTES_ADJUNTO, files: 1, fields: 1 } }))
  async adjuntar(@Param("id", ParseUUIDPipe) id: string, @UploadedFile() archivo: ArchivoAdjunto | undefined, @Req() req: any) {
    const a = await this.cargar(id, req);
    if (a.estado === "resuelta") throw new ConflictException("La apelación ya está resuelta.");
    await guardarAdjunto(this.prisma, { tenantId: req?.user?.tenantId, entidad: "apelacion", entidadId: id, clase: "antecedente", archivo, usuarioId: req?.user?.sub ?? null });
    return this.cargar(id, req);
  }

  @Get(":id/adjuntos/:adjuntoId")
  @RequierePermiso("apelacion.ver")
  async adjunto(@Param("id", ParseUUIDPipe) id: string, @Param("adjuntoId", ParseUUIDPipe) adjuntoId: string, @Req() req: any, @Res() res: Response) {
    await this.cargar(id, req);
    const a = await leerAdjunto(this.prisma, req?.user?.tenantId, ["apelacion"], adjuntoId);
    if (a.entidadId !== id) throw new NotFoundException("Adjunto no encontrado.");
    res.set(cabecerasAdjunto(a));
    res.end(a.datos);
  }

  @Post(":id/resolver")
  @RequierePermiso("apelacion.resolver")
  async resolver(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const d = ResolverSchema.parse(body ?? {});
    const a = await this.cargar(id, req);
    if (a.estado === "resuelta") throw new ConflictException("La apelación ya está resuelta: la decisión del Director es inapelable.");
    if (d.resolucionFecha < a.fechaIngreso) throw new BadRequestException("La resolución no puede ser anterior al ingreso de la apelación.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE apelacion SET estado = 'resuelta', decision = $2, resolucion_fecha = $3::date, resolucion_texto = $4, resuelta_por = $5::uuid, resuelta_at = now()
        WHERE id = $1::uuid AND estado = 'registrada'`,
      id,
      d.decision,
      d.resolucionFecha,
      d.resolucionTexto,
      req?.user?.sub ?? null,
    );
    return this.cargar(id, req);
  }
}
