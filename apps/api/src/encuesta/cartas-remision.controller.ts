/**
 * Cartas de remisión de encuestas (DCO-PG01-P04-IT05 FORM06, FORM07 y FORM08)
 * a la Sección Planificación, Estudios y Control Comercial. Se emiten desde la
 * lista de encuestas (/encuestas) filtrando el período.
 *
 *   GET encuestas/cartas-remision?carta=FORM06&anio=&mes=|trimestre=&tipo=&fecha=      · en pantalla (JSON)
 *   GET encuestas/cartas-remision/pdf?…                                               · PDF de la carta
 *
 * Permiso encuesta.ver (el mismo del informe trimestral). Alcance igual que la
 * lista: quien tiene el Departamento Comercial en su alcance (o es global) ve
 * todas; una jefatura técnica, solo las de sus laboratorios o sucursales.
 * Quien remite = el usuario conectado (nombre y cargo de su ficha).
 * Reglas: cartas-remision.ts.
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
import { fechaChile, hoyChile } from "../common/fecha-chile";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import type { Sello } from "../plantilla-render/plantilla-defecto";
import { leerTiposEncuesta } from "./encuesta-informe.controller";
import { armarCarta, CARTAS, cuerpoCartaHtml, esCodigoCarta, periodoCarta, type CartaRemision, type FilaCarta } from "./cartas-remision";

@Injectable()
export class CartasRemisionService {
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

  async carta(req: any, q: Record<string, string | undefined>): Promise<CartaRemision> {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new ForbiddenException("Tenant no resuelto en el token");
    const codigo = (q.carta ?? "").trim().toUpperCase();
    if (!esCodigoCarta(codigo)) throw new BadRequestException("Elija la carta: FORM06 (remitidas), FORM07 (realizadas) o FORM08 (Ejército, trimestral).");
    const def = CARTAS[codigo];
    const periodo = periodoCarta(def, q);
    if ("error" in periodo) throw new BadRequestException(periodo.error);
    const fecha = q.fecha?.trim() || hoyChile();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new BadRequestException("Fecha de la carta no válida (AAAA-MM-DD).");
    const tipo = !def.soloEjercito && q.tipo?.trim() ? q.tipo.trim().toUpperCase() : null;
    if (tipo && !/^[A-Z0-9_]{1,20}$/.test(tipo)) throw new BadRequestException("Formulario de encuesta no válido.");

    const tipos = await leerTiposEncuesta(this.prisma, tenantId, false);
    const ejercito = tipos.filter((t) => String(t.reglaCliente ?? "").toUpperCase() === "EJERCITO").map((t) => t.codigo);
    const unidades = await this.unidades(req);
    const crudas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.id, e.tipo_codigo AS tipo, et.formulario, e.estado,
              to_char(COALESCE(e.fecha_envio, e.created_at::date), 'YYYY-MM-DD') AS "fechaEnvio",
              to_char(COALESCE(e.fecha_respuesta, (e.registrada_at AT TIME ZONE 'America/Santiago')::date), 'YYYY-MM-DD') AS "fechaRespuesta",
              COALESCE(o.codigo, c.codigo, e.referencia, e.codigo) AS referencia,
              COALESCE(cl.razon_social, e.cliente_texto) AS cliente,
              e.promedio::float8 AS promedio
         FROM encuesta_satisfaccion e
         LEFT JOIN orden_trabajo o ON o.id = e.ot_id
         LEFT JOIN cotizacion c ON c.id = e.cotizacion_id AND e.ot_id IS NULL
         LEFT JOIN cliente cl ON cl.id = COALESCE(e.cliente_id, o.cliente_id)
         LEFT JOIN encuesta_tipo et ON et.tenant_id = e.tenant_id AND et.codigo = e.tipo_codigo
        WHERE e.tenant_id = $1::uuid
          AND ($2::uuid[] IS NULL OR e.unidad_id = ANY($2::uuid[]))
          AND ($5::text IS NULL OR e.tipo_codigo = $5)
          AND (   (COALESCE(e.fecha_envio, e.created_at::date) >= $3::date AND COALESCE(e.fecha_envio, e.created_at::date) < $4::date)
               OR (COALESCE(e.fecha_respuesta, (e.registrada_at AT TIME ZONE 'America/Santiago')::date) >= $3::date
                   AND COALESCE(e.fecha_respuesta, (e.registrada_at AT TIME ZONE 'America/Santiago')::date) < $4::date))`,
      tenantId,
      unidades,
      periodo.desde,
      periodo.hasta,
      tipo,
    );
    const filas: FilaCarta[] = crudas.map((f) => ({
      id: f.id,
      tipo: f.tipo,
      formulario: f.formulario,
      estado: f.estado,
      fechaEnvio: f.fechaEnvio,
      fechaRespuesta: f.fechaRespuesta,
      referencia: f.referencia,
      cliente: f.cliente,
      promedio: f.promedio === null ? null : Number(f.promedio),
    }));
    const u = await this.prisma.$queryRawUnsafe<{ nombre: string; cargo: string | null }[]>(
      `SELECT nombre_completo AS nombre, cargo FROM usuario WHERE id = $1::uuid`,
      req?.user?.sub ?? "00000000-0000-0000-0000-000000000000",
    );
    const remitente = { nombre: u[0]?.nombre ?? "—", cargo: u[0]?.cargo?.trim() || null };
    return armarCarta(def, periodo, filas, fecha, remitente, ejercito.length ? ejercito : ["FORM03"]);
  }

  nombreArchivo(c: CartaRemision): string {
    const p = c.periodo.trimestre ? `${c.periodo.anio}_T${c.periodo.trimestre}` : `${c.periodo.anio}-${String(c.periodo.mes).padStart(2, "0")}`;
    return `carta_remision_encuestas_${c.carta.codigo}_${p}.pdf`;
  }

  async pdf(c: CartaRemision): Promise<Buffer> {
    const cuerpo = cuerpoCartaHtml(c);
    const sello: Sello = {
      numero: `${c.carta.formulario} · ${c.periodo.texto}`,
      codigoVerificacion: "—",
      hash: createHash("sha256").update(cuerpo, "utf8").digest("hex"),
      fecha: fechaChile(new Date()),
      urlVerificacion: "",
      borrador: false,
    };
    return generarPdf(cuerpo, sello, `${c.carta.nombre} · ${c.periodo.texto}`);
  }
}

@ApiTags("encuestas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("encuestas/cartas-remision")
export class CartasRemisionController {
  constructor(private readonly svc: CartasRemisionService) {}

  @Get()
  @RequierePermiso("encuesta.ver")
  @ApiOperation({ summary: "Carta de remisión de encuestas (FORM06 remitidas, FORM07 realizadas, FORM08 Ejército): ?carta=&anio=&mes=|trimestre=&tipo=&fecha=" })
  carta(@Query() q: Record<string, string>, @Req() req: any) {
    return this.svc.carta(req, q ?? {});
  }

  @Get("pdf")
  @RequierePermiso("encuesta.ver")
  async pdf(@Query() q: Record<string, string>, @Req() req: any, @Res() res: Response) {
    const c = await this.svc.carta(req, q ?? {});
    const b = await this.svc.pdf(c);
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${this.svc.nombreArchivo(c)}"` });
    res.send(b);
  }
}
