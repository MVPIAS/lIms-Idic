import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards, BadRequestException, ConflictException } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { AmbitoUnidad } from "../../rbac/ambito-unidad.guard";
import { PrismaService } from "../../common/prisma.service";
import { AlcanceService } from "../../rbac/alcance.service";
import { hoyChile } from "../../common/fecha-chile";
import {
  DESTINATARIOS_DGMN,
  MEDIOS_NOTIFICACION,
  NOMBRE_MEDIO,
  TIPOS_INCUMPLIMIENTO,
  erroresNotificacion,
  faltantesNotificacion,
} from "./reglas-notificacion";

type Sql = { $queryRawUnsafe<T = unknown>(q: string, ...v: any[]): Promise<T> };

const NotificarBody = z.object({
  certificadoId: z.string().uuid(),
  medio: z.string().max(20),
  oficioNumero: z.string().trim().max(60).optional().nullable(),
  fechaEnvio: z.string().max(10),
  copiaInternador: z.boolean().optional().nullable(),
  observaciones: z.string().trim().max(2000).optional().nullable(),
});

/** Incumplimientos de la OT con su notificación (si la hay). */
async function incumplimientos(db: Sql, otId: string) {
  return db.$queryRawUnsafe<any[]>(
    `SELECT c.id, COALESCE(c.numero, c.codigo) AS numero, c.estado, c.tipo_documento AS tipo, c.oficial_at AS "oficialAt",
            n.id AS "notificacionId", n.medio, n.oficio_numero AS "oficioNumero", n.fecha_envio AS "fechaEnvio",
            n.copia_internador AS "copiaInternador", n.destinatarios, n.observaciones, n.created_at AS "registradaAt",
            u.nombre_completo AS "registradaPor"
       FROM certificado c
       LEFT JOIN bpch_notificacion_dgmn n ON n.certificado_id = c.id
       LEFT JOIN usuario u ON u.id = n.created_by
      WHERE c.ot_id = $1::uuid AND c.deleted_at IS NULL AND c.tipo_documento = ANY($2::text[])
      ORDER BY c.created_at`,
    otId,
    [...TIPOS_INCUMPLIMIENTO],
  );
}

/**
 * Faltante del cierre de la OT (EP-10 10.17): incumplimiento oficial sin
 * notificación a DGMN. Sin inyección: lo usa ot-cierre con la base o su
 * transacción. Una base sin align_r4b_d11.sql no tiene faltantes.
 */
export async function faltantesNotificacionDgmn(db: Sql, otId: string): Promise<string[]> {
  try {
    const docs = await incumplimientos(db, otId);
    return faltantesNotificacion(docs.map((d) => ({ numero: d.numero, estado: d.estado, notificado: Boolean(d.notificacionId) })));
  } catch {
    return [];
  }
}

@Injectable()
export class NotificacionDgmnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  private async ot(req: any, otId: string) {
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, tenantId: req?.user?.tenantId },
      select: { id: true, codigo: true, estado: true, unidadPrincipal: true },
    });
    if (!ot) throw new NotFoundException("OT no encontrada.");
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    return ot;
  }

  async estado(req: any, otId: string) {
    await this.ot(req, otId);
    const docs = await incumplimientos(this.prisma, otId);
    const puede = (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes("bpch.dgmn.notificar");
    return {
      aplica: docs.length > 0,
      destinatarios: DESTINATARIOS_DGMN,
      medios: MEDIOS_NOTIFICACION.map((m) => ({ valor: m, texto: NOMBRE_MEDIO[m] })),
      incumplimientos: docs.map((d) => ({
        certificadoId: d.id,
        numero: d.numero,
        estado: d.estado,
        oficial: ["oficial", "emitido"].includes(d.estado),
        notificacion: d.notificacionId
          ? {
              medio: d.medio,
              medioTexto: NOMBRE_MEDIO[d.medio as keyof typeof NOMBRE_MEDIO] ?? d.medio,
              oficioNumero: d.oficioNumero,
              fechaEnvio: d.fechaEnvio,
              copiaInternador: d.copiaInternador,
              destinatarios: d.destinatarios,
              observaciones: d.observaciones,
              registradaAt: d.registradaAt,
              registradaPor: d.registradaPor,
            }
          : null,
      })),
      puedeNotificar: puede,
    };
  }

  async notificar(req: any, otId: string, body: unknown) {
    const ot = await this.ot(req, otId);
    const d = NotificarBody.parse(body ?? {});
    const docs = await incumplimientos(this.prisma, otId);
    const doc = docs.find((x) => x.id === d.certificadoId) ?? null;
    const errores = erroresNotificacion({
      documento: doc ? { estado: doc.estado, tipo: doc.tipo } : null,
      yaNotificado: Boolean(doc?.notificacionId),
      medio: d.medio,
      fechaEnvio: d.fechaEnvio,
      hoy: hoyChile(),
      copiaInternador: d.copiaInternador,
      oficioNumero: d.oficioNumero,
    });
    if (errores.length) {
      if (doc?.notificacionId) throw new ConflictException(errores.join(" "));
      throw new BadRequestException(errores.join(" "));
    }
    try {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO bpch_notificacion_dgmn (tenant_id, ot_id, certificado_id, destinatarios, medio, oficio_numero, fecha_envio,
                                             copia_internador, observaciones, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text[], $5, $6, $7::date, $8, $9, $10::uuid)`,
        req.user.tenantId,
        otId,
        d.certificadoId,
        [...DESTINATARIOS_DGMN],
        d.medio,
        d.oficioNumero?.trim() || null,
        d.fechaEnvio,
        d.copiaInternador,
        d.observaciones?.trim() || null,
        req?.user?.sub ?? null,
      );
    } catch (e: any) {
      if (String(e?.message ?? "").includes("duplicate key")) throw new ConflictException("La notificación a DGMN de este informe ya está registrada.");
      throw e;
    }
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'notificacion_dgmn', $3::jsonb, $4::uuid)`,
      req.user.tenantId,
      otId,
      JSON.stringify({ informe: doc!.numero, medio: d.medio, oficio: d.oficioNumero ?? null, copiaInternador: d.copiaInternador }),
      req?.user?.sub ?? null,
    );
    return { ...(await this.estado(req, otId)), otCodigo: ot.codigo };
  }
}

/** EP-10 10.15 · /bpch/notificacion-dgmn · lo registra la Subdirección BPCH (bpch.dgmn.notificar). */
@ApiTags("bpch-notificacion-dgmn")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH", "DCO")
@Controller("bpch/notificacion-dgmn")
export class NotificacionDgmnController {
  constructor(private readonly svc: NotificacionDgmnService) {}

  @Get("ot/:otId")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Incumplimientos de la OT y su notificación a DGMN" })
  estado(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.estado(req, otId);
  }

  @Post("ot/:otId")
  @RequierePermiso("bpch.dgmn.notificar")
  @AmbitoUnidad("BPCH")
  @ApiOperation({ summary: "Registrar la notificación a DGMN y al internador { certificadoId, medio, oficioNumero, fechaEnvio, copiaInternador }" })
  notificar(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.notificar(req, otId, body);
  }
}

@Module({
  controllers: [NotificacionDgmnController],
  providers: [NotificacionDgmnService],
})
export class NotificacionDgmnModule {}
