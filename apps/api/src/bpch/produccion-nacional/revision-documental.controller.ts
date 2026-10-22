import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Put, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { PrismaService } from "../../common/prisma.service";
import { AlcanceService } from "../../rbac/alcance.service";
import { PuenteAnalisisService } from "../../flujo-real/flujo-real.module";
import { DOCUMENTOS_IT08, RevisionBody, evaluarRevision, tipoDefectoAnalito } from "./revision-documental";

const tenantDe = (req: any): string => {
  const t = req?.user?.tenantId;
  if (!t) throw new ForbiddenException("Sesión sin institución.");
  return t;
};

/**
 * EP-07 7.3 · revisión documental IT08 de la OT de una inspección de
 * Producción Nacional. La registran los inspectores de la unidad de la OT
 * (alcance por unidad) y sus defectos se trasladan al ensayo «Rev. Doc. Legal».
 */
@Injectable()
export class RevisionDocumentalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly puente: PuenteAnalisisService,
  ) {}

  private async ot(req: any, otId: string, permiso: string) {
    const [ot] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, estado, origen_trabajo, unidad_principal FROM orden_trabajo WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      otId,
      tenantDe(req),
    );
    if (!ot) throw new NotFoundException("OT no encontrada.");
    await this.alcance.exigirUnidad(req, ot.unidad_principal, "la OT", permiso);
    return ot;
  }

  /** Resultados del ensayo «Rev. Doc. Legal» de la OT (defectos crítico y menor). */
  private async ensayo(otId: string) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id, r.estado, COALESCE(an.nombre, an.codigo) AS analito
         FROM resultado r
         JOIN cat_metodo m ON m.id = r.cat_metodo_id
         LEFT JOIN cat_analito an ON an.id = r.cat_analito_id
        WHERE r.ot_id = $1::uuid AND r.deleted_at IS NULL
          AND translate(lower(m.nombre), 'áéíóú', 'aeiou') LIKE '%documentacion legal%'`,
      otId,
    );
    return filas.map((f) => ({ ...f, tipo: tipoDefectoAnalito(f.analito) })).filter((f) => f.tipo);
  }

  async ver(req: any, otId: string) {
    const ot = await this.ot(req, otId, "ot.ver");
    const [r] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT rd.items, rd.criticos, rd.menores, rd.resultado, rd.registrado_at AS "registradoAt", rd.trasladado_at AS "trasladadoAt",
              u.nombre_completo AS "registradoPor"
         FROM bpch_revision_documental rd LEFT JOIN usuario u ON u.id = rd.registrado_por
        WHERE rd.ot_id = $1::uuid`,
      otId,
    );
    const ensayo = await this.ensayo(otId);
    return {
      aplica: ot.origen_trabajo === "PRODUCCION_NACIONAL",
      documentos: DOCUMENTOS_IT08,
      revision: r ?? null,
      ensayo: ensayo.map((e) => ({ id: e.id, analito: e.analito, tipo: e.tipo, estado: e.estado })),
      otAbierta: !["cerrada", "anulada"].includes(ot.estado),
    };
  }

  /** Guarda el checklist y, si no queda pendiente, traslada los defectos a la OT. */
  async registrar(req: any, otId: string, body: unknown) {
    const ot = await this.ot(req, otId, "resultado.crear");
    if (ot.origen_trabajo !== "PRODUCCION_NACIONAL") throw new BadRequestException("La revisión documental IT08 es de las OT de Producción Nacional.");
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException("La OT está cerrada.");
    const d = RevisionBody.parse(body ?? {});
    const ev = evaluarRevision(d.items);
    if (ev.faltantes.length) throw new BadRequestException(ev.faltantes.join(" "));
    const tenantId = tenantDe(req);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO bpch_revision_documental (tenant_id, ot_id, items, criticos, menores, resultado, registrado_por, registrado_at)
       VALUES ($1::uuid, $2::uuid, $3::jsonb, $4, $5, $6, $7::uuid, now())
       ON CONFLICT (ot_id) DO UPDATE SET items = EXCLUDED.items, criticos = EXCLUDED.criticos, menores = EXCLUDED.menores,
              resultado = EXCLUDED.resultado, registrado_por = EXCLUDED.registrado_por, registrado_at = now()`,
      tenantId,
      otId,
      JSON.stringify(d.items),
      ev.criticos,
      ev.menores,
      ev.resultado,
      req?.user?.sub ?? null,
    );
    let trasladados = 0;
    if (ev.resultado !== "pendiente") {
      const ensayo = await this.ensayo(otId);
      if (!ensayo.length) throw new ConflictException("Revisión guardada, pero la OT no tiene el ensayo «Rev. Doc. Legal»: agréguelo al panel para trasladar los defectos.");
      for (const e of ensayo) {
        if (["revisado_n1", "aprobado"].includes(e.estado)) continue;
        const valor = e.tipo === "critico" ? ev.criticos : ev.menores;
        await this.puente.capturarValor(
          e.id,
          { valor, observacion: "Trasladado desde la revisión documental IT08", ...(e.estado !== "pendiente" ? { motivo: "Revisión documental IT08 actualizada" } : {}) } as any,
          tenantId,
          req,
        );
        trasladados++;
      }
      await this.prisma.$executeRawUnsafe(`UPDATE bpch_revision_documental SET trasladado_at = now() WHERE ot_id = $1::uuid`, otId);
    }
    return { ...ev, trasladados, ...(await this.ver(req, otId)) };
  }
}

@ApiTags("bpch · producción nacional")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("bpch/pn/ot")
export class RevisionDocumentalController {
  constructor(private readonly svc: RevisionDocumentalService) {}

  @Get(":otId/revision-documental")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "7.3 · Revisión documental IT08 de la OT (checklist y ensayo «Rev. Doc. Legal»)" })
  ver(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.ver(req, otId);
  }

  @Put(":otId/revision-documental")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "7.3 · Registrar el checklist IT08 y trasladar los defectos crítico/menor al ensayo «Rev. Doc. Legal»" })
  registrar(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.registrar(req, otId, body);
  }
}
