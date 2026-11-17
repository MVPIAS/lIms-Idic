/**
 * Informe trimestral de encuestas de satisfacción (DCO-PG01-P04-IT05, Anexos 01
 * a 06). Se abre desde la Zona de informes (/zona-informes/encuestas-trimestral).
 *
 *   GET encuestas/informe-trimestral?anio=&trimestre=&tipo=     · en pantalla (JSON)
 *   GET encuestas/informe-trimestral/pdf?anio=&trimestre=&tipo= · PDF con el formato del anexo
 *   GET encuestas/informe-trimestral/excel?…                     · planilla de análisis (.xlsx)
 *
 * Permiso encuesta.ver. Alcance igual que la lista de encuestas: quien tiene el
 * Departamento Comercial en su alcance (o es global) ve todas; una jefatura
 * técnica, solo las de sus laboratorios o sucursales.
 */
import { BadRequestException, Controller, ForbiddenException, Get, Injectable, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createHash } from "node:crypto";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { libroXlsx } from "../common/xlsx-escritura";
import { fechaChile, hoyChile } from "../common/fecha-chile";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import type { Sello } from "../plantilla-render/plantilla-defecto";
import {
  calcularInforme,
  esTrimestre,
  rangoTrimestre,
  trimestreAnterior,
  trimestrePorDefecto,
  type FilaEncuesta,
  type InformeTrimestral,
  type TipoEncuesta,
} from "./informe-trimestral";
import { cuerpoInformeHtml, hojasInforme } from "./informe-trimestral.documento";

/** Formularios de encuesta del inquilino (activos). */
export async function leerTiposEncuesta(prisma: PrismaService, tenantId: string, soloActivos = true): Promise<(TipoEncuesta & { activo: boolean })[]> {
  const filas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT codigo, nombre, formulario, formulario_revision, instruccion, anexo_numero, anexo_revision, anexo_emision,
            titulo_informe, objeto_informe, agrupar_por, nota_maxima, umbral_pct::float8 AS umbral_pct, distribucion, orden, activo
       FROM encuesta_tipo WHERE tenant_id = $1::uuid AND ($2::boolean = FALSE OR activo) ORDER BY orden, codigo`,
    tenantId,
    soloActivos,
  );
  return filas.map((f) => ({
    codigo: f.codigo,
    nombre: f.nombre,
    formulario: f.formulario,
    formularioRevision: f.formulario_revision,
    instruccion: f.instruccion,
    anexoNumero: f.anexo_numero,
    anexoRevision: f.anexo_revision,
    anexoEmision: f.anexo_emision,
    tituloInforme: f.titulo_informe,
    objetoInforme: f.objeto_informe,
    agruparPor: f.agrupar_por === "sucursal" ? "sucursal" : "laboratorio",
    notaMaxima: Number(f.nota_maxima) || 7,
    umbralPct: Number(f.umbral_pct ?? 85),
    distribucion: String(f.distribucion ?? "")
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean),
    orden: Number(f.orden) || 0,
    activo: !!f.activo,
  }));
}

@Injectable()
export class EncuestaInformeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  private async unidades(req: any): Promise<string[] | null> {
    const v = await this.alcance.filtroUnidades(req, "encuesta.ver");
    if (v === null) return null;
    const dco = (await this.alcance.arbol(req.user.tenantId)).porCodigo.get("DCO")?.id;
    return dco && v.includes(dco) ? null : v;
  }

  /** Valida año/trimestre/tipo; sin año ni trimestre, el trimestre que acaba de cerrar. */
  parametros(q: Record<string, string | undefined>): { anio: number; trimestre: 1 | 2 | 3 | 4; tipo: string | null } {
    const def = trimestrePorDefecto(hoyChile());
    const anio = q.anio ? Number(q.anio) : def.anio;
    const trimestre = q.trimestre ? Number(q.trimestre) : def.trimestre;
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) throw new BadRequestException("Indique un año válido (por ejemplo 2026).");
    if (!esTrimestre(trimestre)) throw new BadRequestException("Indique el trimestre: 1, 2, 3 o 4.");
    const tipo = q.tipo?.trim() ? q.tipo.trim().toUpperCase() : null;
    if (tipo && !/^[A-Z0-9_]{1,20}$/.test(tipo)) throw new BadRequestException("Formulario de encuesta no válido.");
    return { anio, trimestre, tipo };
  }

  async informe(req: any, q: Record<string, string | undefined>): Promise<InformeTrimestral> {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new ForbiddenException("Tenant no resuelto en el token");
    const { anio, trimestre, tipo } = this.parametros(q);
    const tipos = await leerTiposEncuesta(this.prisma, tenantId);
    if (tipo && !tipos.some((t) => t.codigo === tipo)) throw new BadRequestException(`El formulario ${tipo} no existe o está desactivado.`);
    const ant = trimestreAnterior(anio, trimestre);
    const desde = rangoTrimestre(ant.anio, ant.trimestre).desde;
    const hasta = rangoTrimestre(anio, trimestre).hasta;
    const unidades = await this.unidades(req);
    const crudas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.id, e.tipo_codigo AS tipo, e.estado, to_char(COALESCE(e.fecha_envio, e.created_at::date), 'YYYY-MM-DD') AS fecha,
              COALESCE(u.nombre, u.codigo) AS grupo,
              COALESCE(o.codigo, c.codigo, e.referencia, e.codigo) AS referencia,
              e.promedio::float8 AS promedio, e.respuestas, e.comentario_libre AS comentario
         FROM encuesta_satisfaccion e
         LEFT JOIN orden_trabajo o ON o.id = e.ot_id
         LEFT JOIN cotizacion c ON c.id = e.cotizacion_id AND e.ot_id IS NULL
         LEFT JOIN unidad u ON u.id = e.unidad_id
        WHERE e.tenant_id = $1::uuid
          AND ($2::uuid[] IS NULL OR e.unidad_id = ANY($2::uuid[]))
          AND COALESCE(e.fecha_envio, e.created_at::date) >= $3::date
          AND COALESCE(e.fecha_envio, e.created_at::date) < $4::date
          AND e.estado IN ('pendiente', 'registrada', 'sin_respuesta')
          AND ($5::text IS NULL OR e.tipo_codigo = $5)
        ORDER BY COALESCE(e.fecha_respuesta, e.fecha_envio), e.codigo`,
      tenantId,
      unidades,
      desde,
      hasta,
      tipo,
    );
    const filas: FilaEncuesta[] = crudas.map((f) => ({
      id: f.id,
      tipo: f.tipo,
      estado: f.estado,
      fecha: f.fecha,
      grupo: f.grupo,
      referencia: f.referencia,
      promedio: f.promedio === null ? null : Number(f.promedio),
      respuestas: Array.isArray(f.respuestas) ? f.respuestas : null,
      comentario: f.comentario,
    }));
    return calcularInforme(tipos, filas, anio, trimestre, tipo);
  }

  nombreArchivo(inf: InformeTrimestral, ext: string): string {
    const tipo = inf.secciones.length === 1 ? `_${inf.secciones[0].tipo.codigo}` : "";
    return `informe_encuestas_${inf.anio}_T${inf.trimestre}${tipo}.${ext}`;
  }

  async pdf(inf: InformeTrimestral): Promise<Buffer> {
    const cuerpo = cuerpoInformeHtml(inf);
    const numero = inf.secciones.length === 1 ? `${inf.secciones[0].tipo.instruccion}-Anexo${inf.secciones[0].tipo.anexoNumero ?? ""}` : "DCO-PG01-P04-IT05";
    const sello: Sello = {
      numero: `${numero} · ${inf.etiqueta}`,
      codigoVerificacion: "—",
      hash: createHash("sha256").update(cuerpo, "utf8").digest("hex"),
      fecha: fechaChile(new Date()),
      urlVerificacion: "",
      borrador: false,
    };
    return generarPdf(cuerpo, sello, `Informe de encuestas de satisfacción ${inf.etiqueta}`);
  }

  excel(inf: InformeTrimestral): Buffer {
    return libroXlsx(hojasInforme(inf));
  }
}

@ApiTags("encuestas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("encuestas/informe-trimestral")
export class EncuestaInformeController {
  constructor(private readonly svc: EncuestaInformeService) {}

  @Get()
  @RequierePermiso("encuesta.ver")
  @ApiOperation({ summary: "Informe trimestral de encuestas (Anexos 01–06 de DCO-PG01-P04-IT05): ?anio=&trimestre=1..4&tipo=FORM01" })
  informe(@Query() q: Record<string, string>, @Req() req: any) {
    return this.svc.informe(req, q ?? {});
  }

  @Get("pdf")
  @RequierePermiso("encuesta.ver")
  async pdf(@Query() q: Record<string, string>, @Req() req: any, @Res() res: Response) {
    const inf = await this.svc.informe(req, q ?? {});
    const b = await this.svc.pdf(inf);
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${this.svc.nombreArchivo(inf, "pdf")}"` });
    res.send(b);
  }

  @Get("excel")
  @RequierePermiso("encuesta.ver")
  async excel(@Query() q: Record<string, string>, @Req() req: any, @Res() res: Response) {
    const inf = await this.svc.informe(req, q ?? {});
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${this.svc.nombreArchivo(inf, "xlsx")}"`);
    res.send(this.svc.excel(inf));
  }
}
