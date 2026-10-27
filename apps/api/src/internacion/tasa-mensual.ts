import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { PrismaService } from "../common/prisma.service";
import { AmbitoUnidad } from "../rbac/ambito-unidad.guard";
import { AlcanceService } from "../rbac/alcance.service";
import { DIFUSION_TASA, lista, valoresCategoria } from "../common/parametros-r4d";
import { ZONA_CHILE, SQL_ZONA, mesChile } from "../common/fecha-chile";

/**
 * Informe mensual de la tasa de internación 1,5 % (EP-06 6.23, BL-164).
 *
 *   GET  /internaciones/tasa-mensual?mes=AAAA-MM[&formato=csv]
 *        · bpch.tasa.gestionar · OT, resolución, monto de la tasa, estado de pago
 *          y centro de costo de las tasas calculadas en el mes (hora de Chile).
 *   POST /internaciones/tasa-mensual/emitir { mes, observaciones? }
 *        · tasa.emitir (Jefe DCO) · guarda la foto del mes y a quién se difunde
 *          (parámetro tasa_informe.difusion). Un mes se emite una vez.
 * Alcance: Comercial (DCO) y la Sección Certificación de la Conformidad (SCC)
 * ven todas; una sucursal, las de sus OT.
 */

export interface FilaTasa {
  internacion: string | null;
  ot: string | null;
  otId: string | null;
  resolucion: string | null;
  cliente: string | null;
  centroCosto: string | null;
  calculadaAt: string;
  tasa: number;
  iva: number;
  total: number;
  factura: string | null;
  estadoFactura: string | null;
  pagado: number;
  estadoPago: "sin_facturar" | "por_cobrar" | "abonada" | "pagada";
}

/** Estado de pago de la tasa a partir de su factura y lo pagado (regla pura). */
export function estadoPagoTasa(f: { facturaEstado: string | null; total: number; pagado: number }): FilaTasa["estadoPago"] {
  if (!f.facturaEstado || ["pendiente", "anulada"].includes(f.facturaEstado)) return "sin_facturar";
  if (f.facturaEstado === "pagada" || (f.total > 0 && f.pagado >= f.total - 0.5)) return "pagada";
  if (f.pagado > 0) return "abonada";
  return "por_cobrar";
}

/** Totales del informe: nº de OT, tasa, total a cancelar, pagado y por centro de costo. */
export function resumenTasa(filas: FilaTasa[]) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const porCentro = new Map<string, number>();
  for (const f of filas) porCentro.set(f.centroCosto ?? "Sin centro de costo", r2((porCentro.get(f.centroCosto ?? "Sin centro de costo") ?? 0) + f.total));
  return {
    nOt: new Set(filas.map((f) => f.otId ?? f.internacion)).size,
    tasa: r2(filas.reduce((s, f) => s + f.tasa, 0)),
    total: r2(filas.reduce((s, f) => s + f.total, 0)),
    pagado: r2(filas.reduce((s, f) => s + f.pagado, 0)),
    porCentro: [...porCentro.entries()].map(([centro, total]) => ({ centro, total })),
  };
}

/** Mes AAAA-MM → [primer día, primer día del mes siguiente). */
export function rangoMes(mes: string): { desde: string; hasta: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new BadRequestException("Mes AAAA-MM.");
  const a = Number(m[1]);
  const n = Number(m[2]);
  const sig = n === 12 ? `${a + 1}-01` : `${a}-${String(n + 1).padStart(2, "0")}`;
  return { desde: `${mes}-01`, hasta: `${sig}-01` };
}

const ETIQUETA_PAGO: Record<FilaTasa["estadoPago"], string> = {
  sin_facturar: "Sin facturar",
  por_cobrar: "Facturada, por cobrar",
  abonada: "Abonada",
  pagada: "Pagada",
};

/** CSV para Excel (separador «;» y coma decimal, como lo abre Excel en Chile). */
export function csvTasa(mes: string, filas: FilaTasa[]): string {
  const num = (n: number) => String(Math.round(n)).replace(".", ",");
  const esc = (v: unknown) => {
    // Un texto que empieza con = + - @ se abre en Excel como fórmula: se antepone «'».
    const t0 = String(v ?? "");
    const t = /^[=+\-@]/.test(t0) ? `'${t0}` : t0;
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const cab = ["Mes", "Internación", "OT", "Resolución DGMN", "Cliente", "Centro de costo", "Tasa (CLP)", "IVA (CLP)", "Total a cancelar (CLP)", "Factura", "Estado de pago", "Pagado (CLP)"];
  const lineas = filas.map((f) =>
    [mes, f.internacion, f.ot, f.resolucion, f.cliente, f.centroCosto, num(f.tasa), num(f.iva), num(f.total), f.factura, ETIQUETA_PAGO[f.estadoPago], num(f.pagado)].map(esc).join(";"),
  );
  return "﻿" + [cab.join(";"), ...lineas].join("\r\n") + "\r\n";
}

const EmitirSchema = z.object({
  mes: z.string().regex(/^\d{4}-\d{2}$/, "Mes AAAA-MM"),
  observaciones: z.string().trim().max(2000).optional(),
});

@Injectable()
export class TasaMensualService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  /** null = todas; si no, solo las OT cuyo laboratorio responsable está en el alcance. */
  private async unidades(req: any): Promise<string[] | null> {
    const filtro = await this.alcance.filtroUnidades(req);
    if (filtro === null) return null;
    const arbol = await this.alcance.arbol(req?.user?.tenantId);
    const globales = ["SCC", "DCO"].map((c) => arbol.porCodigo.get(c)?.id).filter(Boolean) as string[];
    return globales.some((g) => filtro.includes(g)) ? null : filtro;
  }

  async filas(req: any, mes: string): Promise<FilaTasa[]> {
    const { desde, hasta } = rangoMes(mes);
    const unidades = await this.unidades(req);
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT DISTINCT ON (COALESCE(t.internacion_id, t.ot_id))
              i.numero AS internacion, o.codigo AS ot, o.id AS "otId",
              COALESCE(i.resolucion_numero, o.numero_ley) AS resolucion, cl.razon_social AS cliente,
              COALESCE(cc.nombre, un.codigo) AS "centroCosto",
              t.calculado_at AS "calculadaAt", t.monto_operacion::float8 AS tasa, t.iva_internacion::float8 AS iva,
              t.total_a_cancelar::float8 AS total, fa.numero AS factura, fa.estado AS "facturaEstado", fa.total::float8 AS "facturaTotal",
              COALESCE((SELECT sum(p.monto) FROM pago p WHERE p.factura_id = fa.id), 0)::float8 AS pagado
         FROM calculo_tasa_internacion t
         LEFT JOIN bpch_internacion i ON i.id = t.internacion_id
         LEFT JOIN orden_trabajo o ON o.id = COALESCE(t.ot_id, i.ot_id)
         LEFT JOIN cliente cl ON cl.id = COALESCE(t.cliente_id, o.cliente_id)
         LEFT JOIN unidad un ON un.id = o.unidad_principal
         LEFT JOIN factura fa ON fa.id = t.factura_id
         LEFT JOIN centro_costo cc ON cc.id = fa.centro_costo_id
        WHERE t.tenant_id = $1::uuid
          AND (t.calculado_at AT TIME ZONE ${SQL_ZONA}) >= $2::date
          AND (t.calculado_at AT TIME ZONE ${SQL_ZONA}) < $3::date
          AND ($4::uuid[] IS NULL OR o.unidad_principal = ANY($4::uuid[]))
        ORDER BY COALESCE(t.internacion_id, t.ot_id), t.calculado_at DESC`,
      req?.user?.tenantId,
      desde,
      hasta,
      unidades,
    );
    return f
      .map((x) => ({
        internacion: x.internacion,
        ot: x.ot,
        otId: x.otId,
        resolucion: x.resolucion,
        cliente: x.cliente,
        centroCosto: x.centroCosto,
        calculadaAt: x.calculadaAt,
        tasa: Number(x.tasa) || 0,
        iva: Number(x.iva) || 0,
        total: Number(x.total) || 0,
        factura: x.factura,
        estadoFactura: x.facturaEstado,
        pagado: Number(x.pagado) || 0,
        estadoPago: estadoPagoTasa({ facturaEstado: x.facturaEstado, total: Number(x.facturaTotal ?? x.total) || 0, pagado: Number(x.pagado) || 0 }),
      }))
      .sort((a, b) => String(a.calculadaAt).localeCompare(String(b.calculadaAt)));
  }

  async informe(req: any, mes: string) {
    const filas = await this.filas(req, mes);
    const emitido = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT t.emitido_at AS "emitidoAt", u.nombre_completo AS "emitidoPor", t.difusion, t.observaciones, t.n_ot AS "nOt", t.total_tasa::float8 AS "totalTasa"
         FROM tasa_informe_mensual t LEFT JOIN usuario u ON u.id = t.emitido_por
        WHERE t.tenant_id = $1::uuid AND t.mes = $2::date`,
      req?.user?.tenantId,
      `${mes}-01`,
    );
    const permisos: string[] = req?.user?.permisos ?? [];
    const difusion = lista((await valoresCategoria(this.prisma, req?.user?.tenantId, "tasa_informe")).difusion, ["DIRECCION", "SUBDIRECCION", "BPCH", "CONTRALORIA", "DFZ"]);
    return {
      mes,
      filas,
      resumen: resumenTasa(filas),
      emitido: emitido[0] ?? null,
      difusion: difusion.map((c) => DIFUSION_TASA.find((d) => d.valor === c)?.etiqueta ?? c),
      puedeEmitir: (req?.user?.roles ?? []).includes("SUPERADMIN") || permisos.includes("tasa.emitir"),
    };
  }

  async emitir(req: any, body: unknown) {
    const { mes, observaciones } = EmitirSchema.parse(body ?? {});
    const inf = await this.informe(req, mes);
    if (inf.emitido) throw new ConflictException(`El informe de ${mes} ya se emitió el ${new Date(inf.emitido.emitidoAt).toLocaleDateString("es-CL", { timeZone: ZONA_CHILE })}.`);
    if (!inf.filas.length) throw new BadRequestException(`No hay tasas calculadas en ${mes}: no hay informe que emitir.`);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO tasa_informe_mensual (tenant_id, mes, n_ot, total_tasa, total_pagado, detalle, difusion, observaciones, emitido_por)
       VALUES ($1::uuid, $2::date, $3, $4, $5, $6::jsonb, $7, $8, $9::uuid)`,
      req?.user?.tenantId,
      `${mes}-01`,
      inf.resumen.nOt,
      inf.resumen.total,
      inf.resumen.pagado,
      JSON.stringify(inf.filas),
      inf.difusion.join(", "),
      observaciones ?? null,
      req?.user?.sub ?? null,
    );
    const r = await this.informe(req, mes);
    return { ...r, mensaje: `Informe mensual de la tasa de ${mes} emitido y difundido a: ${r.difusion.join(", ")}.` };
  }
}

@ApiTags("internaciones")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH", "DCO")
@Controller("internaciones/tasa-mensual")
export class TasaMensualController {
  constructor(private readonly svc: TasaMensualService) {}

  @Get()
  @RequierePermiso("bpch.tasa.gestionar")
  @ApiOperation({ summary: "Informe mensual de la tasa 1,5 % (?mes=AAAA-MM&formato=csv)" })
  async ver(@Query("mes") mes: string | undefined, @Query("formato") formato: string | undefined, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const m = mes ?? mesChile();
    if (formato === "csv") {
      const filas = await this.svc.filas(req, m);
      res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tasa-1-5-${m}.csv"` });
      return csvTasa(m, filas);
    }
    return this.svc.informe(req, m);
  }

  @Post("emitir")
  @RequierePermiso("tasa.emitir")
  @ApiOperation({ summary: "Emitir el informe mensual de la tasa → difusión" })
  emitir(@Body() body: unknown, @Req() req: any) {
    return this.svc.emitir(req, body);
  }
}
