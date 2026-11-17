/**
 * Comercial y cotización · cambios de las sesiones de preproducción (frente S1,
 * reuniones 1, 2 y 3 · 27 y 28-10-2026). Rutas nuevas, sin tocar las de los
 * módulos grandes:
 *
 *  · Ficha de ensayo (reunión 2): GET/PUT /cat/ensayos/:id/ficha y su PDF.
 *  · Avisos de Comercial (reunión 1): OT listas para facturar, OT con OPI
 *    pendiente (plazo de dos meses, reunión 2) y cotizaciones aceptadas sin OT.
 *  · Anular una OT cuando el cliente desiste (reunión 2): POST /ot/:id/anular.
 *  · Validez por tipo de cliente y laboratorio (reunión 2): /comercial/validez-reglas.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { DEV_TENANT } from "../common/base-crud.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { RecursoDeLaboratorio } from "../rbac/alcance-catalogo.guard";
import { AlcanceService } from "../rbac/alcance.service";
import { LaboratorioOtService } from "../ot/laboratorio-ot.service";
import { BLOQUES_FICHA, TITULO_BLOQUE, erroresFicha, importeItem, totalesFicha, type ItemFicha } from "./ficha-ensayo";
import { CAUSAS_ANULACION_OT, MESES_OPI_DEF, SQL_ACEPTADA_SIN_OT, SQL_OT_LISTA_PARA_FACTURAR, estadoPlazoOpi, motivoNoAnularOt } from "./avisos-comercial";
import { erroresRegla } from "../cotizacion/validez-config";
import { leerReglasValidez } from "../cotizacion/cotizacion-s1";
import { leerConfigCircuito } from "../cotizacion/circuito-config";
import { itemsListaVigente } from "../lista-precio/precio-lista";
import { entero, valoresCategoria } from "../common/parametros-r4d";
import { SQL_ZONA, hoyChile, fechaChile, fechaHoraChile } from "../common/fecha-chile";
import { clp, esc } from "../cotizacion/cotizacion-documento";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import type { Sello } from "../plantilla-render/plantilla-defecto";

const tenantDe = (req: any): string => req?.user?.tenantId ?? DEV_TENANT;

/* ================================================================ ficha de ensayo === */

const ItemSchema = z.object({
  bloque: z.enum(BLOQUES_FICHA),
  descripcion: z.string().trim().min(1, "Indique la descripción.").max(300),
  categoria: z.string().trim().max(120).nullable().optional(),
  cantidad: z.number().positive().max(1e9).nullable().optional(),
  unidad: z.string().trim().max(30).nullable().optional(),
  horas: z.number().min(0).max(1e6).nullable().optional(),
  valorUnitario: z.number().min(0).max(1e12).nullable().optional(),
});
const FichaSchema = z.object({
  observaciones: z.string().trim().max(5000).nullable().optional(),
  items: z.array(ItemSchema).max(200),
});

@Injectable()
export class FichaEnsayoService {
  constructor(private readonly prisma: PrismaService) {}

  async ver(tenantId: string, id: string) {
    const e = await this.prisma.catEnsayo.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, codigo: true, nombre: true, precio: true, objetivo: true, familia: { select: { nombre: true, codsucdel: true } } },
    });
    if (!e) throw new NotFoundException("Ensayo no encontrado.");
    const cab = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT f.version, f.observaciones, f.actualizada_at AS "actualizadaAt", u.nombre_completo AS "actualizadaPor"
         FROM cat_ensayo_ficha f LEFT JOIN usuario u ON u.id = f.actualizada_por WHERE f.cat_ensayo_id = $1::uuid`,
      id,
    );
    const items = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id::text AS id, bloque, descripcion, categoria, cantidad::float8 AS cantidad, unidad, horas::float8 AS horas,
              valor_unitario::float8 AS "valorUnitario", orden
         FROM cat_ensayo_ficha_item WHERE cat_ensayo_id = $1::uuid ORDER BY array_position($2::text[], bloque), orden`,
      id,
      [...BLOQUES_FICHA],
    );
    const cfg = await leerConfigCircuito(this.prisma, tenantId);
    const pct = { ciPct: cfg.cfaPct, recargoPct: cfg.margenParticularPct, ivaPct: cfg.ivaPct };
    const lista = (await itemsListaVigente(this.prisma, tenantId, [id], hoyChile(), { soloMoneda: "CLP" })).get(id) ?? null;
    return {
      ensayo: { ...e, precio: Number(e.precio ?? 0) },
      ficha: cab[0] ?? { version: 0, observaciones: null, actualizadaAt: null, actualizadaPor: null },
      items: items.map((it) => ({ ...it, importe: importeItem(it) })),
      totales: totalesFicha(items, pct),
      pct,
      precioLista: lista ? { precio: lista.precio, costoDirecto: lista.costoDirecto ?? null, costoTotal: lista.costoTotal, lista: `${lista.listaCodigo} · ${lista.listaNombre}`, item: lista.itemCodigo } : null,
    };
  }

  async guardar(tenantId: string, id: string, body: unknown, usuarioId: string | null) {
    const d = FichaSchema.parse(body ?? {});
    const errores = erroresFicha(d.items as ItemFicha[]);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const e = await this.prisma.catEnsayo.findFirst({ where: { id, tenantId, deletedAt: null }, select: { id: true } });
    if (!e) throw new NotFoundException("Ensayo no encontrado.");
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO cat_ensayo_ficha (cat_ensayo_id, tenant_id, version, observaciones, actualizada_por, actualizada_at)
         VALUES ($1::uuid, $2::uuid, 1, $3, $4::uuid, now())
         ON CONFLICT (cat_ensayo_id) DO UPDATE SET version = cat_ensayo_ficha.version + 1, observaciones = EXCLUDED.observaciones,
                                                   actualizada_por = EXCLUDED.actualizada_por, actualizada_at = now()`,
        id,
        tenantId,
        d.observaciones ?? null,
        usuarioId,
      );
      await tx.$executeRawUnsafe(`DELETE FROM cat_ensayo_ficha_item WHERE cat_ensayo_id = $1::uuid`, id);
      if (d.items.length)
        await tx.$executeRawUnsafe(
          `INSERT INTO cat_ensayo_ficha_item (tenant_id, cat_ensayo_id, bloque, descripcion, categoria, cantidad, unidad, horas, valor_unitario, orden)
           SELECT $1::uuid, $2::uuid, x.bloque, x.descripcion, x.categoria, x.cantidad, x.unidad, x.horas, x.valor, x.orden
             FROM jsonb_to_recordset($3::jsonb) AS x(bloque text, descripcion text, categoria text, cantidad numeric, unidad text, horas numeric, valor numeric, orden int)`,
          tenantId,
          id,
          JSON.stringify(
            d.items.map((it, i) => ({
              bloque: it.bloque,
              descripcion: it.descripcion,
              categoria: it.categoria ?? null,
              cantidad: it.cantidad ?? null,
              unidad: it.unidad ?? null,
              horas: it.horas ?? null,
              valor: it.valorUnitario ?? null,
              orden: i + 1,
            })),
          ),
        );
    });
    return this.ver(tenantId, id);
  }

  /** PDF de formato estándar de la ficha (cinco bloques, totales y estructura del precio). */
  async pdf(tenantId: string, id: string): Promise<{ pdf: Buffer; codigo: string }> {
    const f = await this.ver(tenantId, id);
    const num = (v: unknown, dec = 2) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("es-CL", { maximumFractionDigits: dec }));
    const bloques = BLOQUES_FICHA.map((b) => {
      const its = f.items.filter((it: any) => it.bloque === b);
      const filas = its.length
        ? its
            .map(
              (it: any) => `<tr><td>${esc(it.descripcion)}</td><td>${esc(it.categoria ?? "")}</td><td class="num">${num(it.cantidad, 3)}${it.unidad ? ` ${esc(it.unidad)}` : ""}</td>
                <td class="num">${num(it.horas)}</td><td class="num">${it.valorUnitario == null ? "—" : clp(it.valorUnitario)}</td><td class="num">${it.importe == null ? "—" : clp(it.importe)}</td></tr>`,
            )
            .join("")
        : `<tr><td class="vacio" colspan="6">Sin recursos registrados.</td></tr>`;
      const t = f.totales.porBloque[b];
      return `<h2>${esc(TITULO_BLOQUE[b])}</h2>
<table class="rep"><thead><tr><th>Recurso</th><th>Categoría / código</th><th class="num">Cantidad</th><th class="num">Horas</th><th class="num">Valor unitario</th><th class="num">Importe</th></tr></thead>
<tbody>${filas}</tbody>
<tfoot><tr><td colspan="5" class="num">Subtotal${t.sinValor ? ` (${t.sinValor} sin valor)` : ""}</td><td class="num">${clp(t.importe)}</td></tr></tfoot></table>`;
    }).join("\n");
    const est = f.totales.estructura;
    const estructura = est
      ? `<table class="meta">
  <tr><th>Costo directo</th><td>${clp(est.costoDirecto)}</td><th>Costo indirecto (${f.pct.ciPct} %)</th><td>${clp(est.costoIndirecto)}</td></tr>
  <tr><th>Costo total (Ejército)</th><td>${clp(est.costoTotal)}</td><th>Recargo (${f.pct.recargoPct} %)</th><td>${clp(est.recargo)}</td></tr>
  <tr><th>Neto particular</th><td>${clp(est.neto)}</td><th>IVA (${f.pct.ivaPct} %)</th><td>${clp(est.iva)}</td></tr>
</table>`
      : `<p>${f.totales.vacia ? "La ficha aún no tiene el desglose de recursos." : `Costo directo incompleto (${clp(f.totales.costoDirecto)} con los valores registrados): faltan valores unitarios.`} El precio vigente sale de la lista de precios.</p>`;
    const cuerpo = `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org"><b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b><span>Ejército de Chile &middot; Ficha de ensayo</span></div>
  <div class="doc"><b>${esc(f.ensayo.codigo)}</b><span>Ficha de ensayo</span></div>
</div>
<h1>FICHA DE ENSAYO</h1>
<table class="meta">
  <tr><th>Ensayo</th><td colspan="3">${esc(f.ensayo.codigo)} · ${esc(f.ensayo.nombre)}</td></tr>
  <tr><th>Laboratorio</th><td>${esc(f.ensayo.familia?.nombre ?? "—")}</td><th>Versión de la ficha</th><td>${esc(f.ficha.version || "sin registrar")}</td></tr>
  <tr><th>Precio de la ficha</th><td>${clp(f.ensayo.precio)}</td><th>Lista de precios vigente</th><td>${f.precioLista ? `${clp(f.precioLista.precio)} (${esc(f.precioLista.lista)})` : "—"}</td></tr>
  ${f.ficha.actualizadaAt ? `<tr><th>Actualizada</th><td colspan="3">${esc(fechaHoraChile(f.ficha.actualizadaAt))}${f.ficha.actualizadaPor ? ` · ${esc(f.ficha.actualizadaPor)}` : ""}</td></tr>` : ""}
</table>
${bloques}
<h2>Costo directo y estructura del precio</h2>
${estructura}
${f.ficha.observaciones ? `<h2>Observaciones</h2>${String(f.ficha.observaciones).split(/\r?\n/).filter((x) => x.trim()).map((x) => `<p>${esc(x.trim())}</p>`).join("")}` : ""}
<p class="nota">Documento interno generado por el sistema LIMS IDIC. Importe = cantidad × horas × valor unitario; valores en pesos chilenos (CLP), netos.</p>`;
    const sello: Sello = {
      numero: `FICHA-${f.ensayo.codigo}`,
      codigoVerificacion: `FICHA-${f.ensayo.codigo}-v${f.ficha.version || 0}`,
      hash: createHash("sha256").update(cuerpo, "utf8").digest("hex"),
      fecha: fechaChile(new Date()),
      urlVerificacion: "el Departamento Comercial del IDIC",
      borrador: false,
    };
    return { pdf: await generarPdf(cuerpo, sello, `Ficha de ensayo ${f.ensayo.codigo}`), codigo: f.ensayo.codigo };
  }
}

@ApiTags("cat-ensayos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("cat/ensayos")
export class FichaEnsayoController {
  constructor(private readonly svc: FichaEnsayoService) {}

  @Get(":id/ficha")
  @RequierePermiso("lista_precio.ver")
  @ApiOperation({ summary: "Ficha de ensayo: recursos por bloque, costo directo y estructura del precio" })
  ver(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.ver(tenantDe(req), id);
  }

  /** Edita la ficha quien mantiene el catálogo, en el alcance de su laboratorio (AlcanceCatalogoGuard). */
  @Put(":id/ficha")
  @RequierePermiso("catalogo.gestionar")
  @RecursoDeLaboratorio("cat_ensayo")
  guardar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.guardar(tenantDe(req), id, body, req?.user?.sub ?? null);
  }

  @Get(":id/ficha/pdf")
  @RequierePermiso("lista_precio.ver")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: any) {
    const { pdf, codigo } = await this.svc.pdf(tenantDe(req), id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="Ficha-ensayo-${String(codigo).replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`);
    res.end(pdf);
  }
}

/* ================================================================ avisos comerciales === */

@Injectable()
export class AvisosComercialService {
  constructor(private readonly prisma: PrismaService) {}

  async mesesOpi(tenantId: string) {
    return entero((await valoresCategoria(this.prisma, tenantId, "ot_disposicion")).meses_opi, MESES_OPI_DEF, 1, 24);
  }

  /** OT con cobro listas para facturar (cerradas o listas para cerrar, sin factura emitida). */
  otPorFacturar(tenantId: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id::text AS id, o.codigo, o.estado, cl.razon_social AS cliente, o.cotizacion_numero AS cotizacion,
              u.codigo AS laboratorio, o.updated_at AS "actualizadaAt",
              (SELECT f.codigo FROM factura f WHERE f.ot_id = o.id AND f.deleted_at IS NULL AND f.estado = 'pendiente' LIMIT 1) AS "borradorFactura"
         FROM orden_trabajo o
         LEFT JOIN cliente cl ON cl.id = o.cliente_id
         LEFT JOIN unidad u ON u.id = o.unidad_principal
        WHERE o.tenant_id = $1::uuid AND ${SQL_OT_LISTA_PARA_FACTURAR}
        ORDER BY o.updated_at DESC LIMIT 300`,
      tenantId,
    );
  }

  /** OT con OPI pendiente y su plazo de regularización (dos meses por defecto). */
  async otOpiPendiente(tenantId: string) {
    const meses = await this.mesesOpi(tenantId);
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id::text AS id, o.codigo, o.estado, cl.razon_social AS cliente, o.disposicion_ref AS "disposicionRef",
              to_char(COALESCE(o.disposicion_fecha, (o.created_at AT TIME ZONE ${SQL_ZONA})::date), 'YYYY-MM-DD') AS desde,
              u.codigo AS laboratorio
         FROM orden_trabajo o
         LEFT JOIN cliente cl ON cl.id = o.cliente_id
         LEFT JOIN unidad u ON u.id = o.unidad_principal
        WHERE o.tenant_id = $1::uuid AND o.opi_pendiente AND o.estado <> 'anulada'
        ORDER BY 6 LIMIT 300`,
      tenantId,
    );
    const hoy = hoyChile();
    return { meses, data: filas.map((f) => ({ ...f, plazo: estadoPlazoOpi({ opiPendiente: true, desde: f.desde, hoy, meses }) })) };
  }

  aceptadasSinOt(tenantId: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id::text AS id, c.codigo, cl.razon_social AS cliente, c.aceptada_at AS "aceptadaAt", c.aceptacion_tipo AS "aceptacionTipo"
         FROM cotizacion c LEFT JOIN cliente cl ON cl.id = c.cliente_id
        WHERE c.tenant_id = $1::uuid AND ${SQL_ACEPTADA_SIN_OT}
        ORDER BY c.aceptada_at DESC NULLS LAST LIMIT 300`,
      tenantId,
    );
  }

  async resumen(tenantId: string) {
    const [facturar, opi, sinOt] = await Promise.all([this.otPorFacturar(tenantId), this.otOpiPendiente(tenantId), this.aceptadasSinOt(tenantId).catch(() => [])]);
    return {
      otPorFacturar: facturar,
      otOpiPendiente: opi.data,
      mesesOpi: opi.meses,
      aceptadasSinOt: sinOt,
      conteos: {
        otPorFacturar: facturar.length,
        opiVencida: opi.data.filter((x: any) => x.plazo?.estado === "vencida").length,
        opiPorVencer: opi.data.filter((x: any) => x.plazo?.estado === "por_vencer").length,
        aceptadasSinOt: sinOt.length,
      },
    };
  }
}

@ApiTags("comercial")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("comercial")
export class AvisosComercialController {
  constructor(
    private readonly svc: AvisosComercialService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("avisos")
  @RequierePermiso("cotizacion.ver")
  @ApiOperation({ summary: "OT listas para facturar, OT con OPI pendiente (plazo) y cotizaciones aceptadas sin OT" })
  avisos(@Req() req: any) {
    return this.svc.resumen(tenantDe(req));
  }

  /* ---- validez por tipo de cliente y laboratorio (reunión 2) ---- */

  @Get("validez-reglas")
  @RequierePermiso("cotizacion.ver")
  reglas(@Req() req: any) {
    return leerReglasValidez(this.prisma, tenantDe(req), false);
  }

  @Post("validez-reglas")
  @RequierePermiso("comercial.configurar")
  async crearRegla(@Body() body: unknown, @Req() req: any) {
    const d = ReglaSchema.parse(body ?? {});
    const e = erroresRegla(d);
    if (e.length) throw new BadRequestException(e.join(" "));
    await this.exigirReferencias(tenantDe(req), d);
    try {
      const f = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO cotizacion_validez_regla (tenant_id, tipo_cliente, centro_costo_id, regla, dias, meses_oct_dic, nota, activo)
         VALUES ($1::uuid, $2, $3::uuid, $4, $5::int, $6::int, $7, $8) RETURNING id::text AS id`,
        tenantDe(req),
        d.tipoCliente || null,
        d.centroCostoId || null,
        d.regla,
        d.regla === "DIAS" ? d.dias : null,
        d.regla === "FIN_ANIO" ? d.mesesOctDic ?? null : null,
        d.nota ?? null,
        d.activo ?? true,
      );
      return { ok: true, id: f[0].id };
    } catch (err: any) {
      if (/uq_cotizacion_validez_regla|23505|duplicate key|unique constraint/i.test(`${err?.message ?? ""} ${err?.meta?.code ?? ""} ${err?.code ?? ""}`)) throw new ConflictException("Ya hay una regla para ese tipo de cliente y laboratorio: edítela.");
      throw err;
    }
  }

  @Patch("validez-reglas/:id")
  @RequierePermiso("comercial.configurar")
  async editarRegla(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const actual = (await leerReglasValidez(this.prisma, tenantDe(req), false)).find((r) => r.id === id);
    if (!actual) throw new NotFoundException("Regla no encontrada.");
    const d = { ...actual, ...ReglaSchema.partial().parse(body ?? {}) };
    const e = erroresRegla(d);
    if (e.length) throw new BadRequestException(e.join(" "));
    await this.exigirReferencias(tenantDe(req), d);
    await this.prisma.$executeRawUnsafe(
      `UPDATE cotizacion_validez_regla SET tipo_cliente = $2, centro_costo_id = $3::uuid, regla = $4, dias = $5::int, meses_oct_dic = $6::int,
              nota = $7, activo = $8, updated_at = now() WHERE id = $1::uuid AND tenant_id = $9::uuid`,
      id,
      d.tipoCliente || null,
      d.centroCostoId || null,
      d.regla,
      d.regla === "DIAS" ? d.dias : null,
      d.regla === "FIN_ANIO" ? d.mesesOctDic ?? null : null,
      (d as any).nota ?? null,
      d.activo ?? true,
      tenantDe(req),
    );
    return { ok: true };
  }

  @Delete("validez-reglas/:id")
  @RequierePermiso("comercial.configurar")
  async borrarRegla(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const n = await this.prisma.$executeRawUnsafe(`DELETE FROM cotizacion_validez_regla WHERE id = $1::uuid AND tenant_id = $2::uuid`, id, tenantDe(req));
    if (!n) throw new NotFoundException("Regla no encontrada.");
    return { ok: true };
  }

  private async exigirReferencias(tenantId: string, d: { tipoCliente?: string | null; centroCostoId?: string | null }) {
    if (d.tipoCliente) {
      const p = await this.prisma.parametroSistema.findFirst({ where: { tenantId, categoria: "tipo_cliente", codigo: d.tipoCliente }, select: { id: true } });
      if (!p) throw new BadRequestException(`Tipo de cliente «${d.tipoCliente}» desconocido.`);
    }
    if (d.centroCostoId) {
      const cc = await this.prisma.centroCosto.findFirst({ where: { id: d.centroCostoId, tenantId, deletedAt: null }, select: { id: true } });
      if (!cc) throw new BadRequestException("El laboratorio (centro de costo) no existe.");
    }
  }
}

const ReglaSchema = z.object({
  tipoCliente: z.string().trim().max(60).nullable().optional(),
  centroCostoId: z.string().uuid().nullable().optional(),
  regla: z.enum(["DIAS", "FIN_ANIO"]),
  dias: z.number().int().min(1).max(730).nullable().optional(),
  mesesOctDic: z.number().int().min(1).max(24).nullable().optional(),
  nota: z.string().trim().max(300).nullable().optional(),
  activo: z.boolean().optional(),
});

/* ================================================================ anular OT (cliente desiste) === */

const AnularOtSchema = z.object({
  causa: z.enum(Object.keys(CAUSAS_ANULACION_OT) as [keyof typeof CAUSAS_ANULACION_OT, ...(keyof typeof CAUSAS_ANULACION_OT)[]]),
  motivo: z.string().trim().min(5, "Indique el motivo (mínimo 5 caracteres).").max(2000),
});

@ApiTags("ot")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ot")
export class OtAnulacionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly labs: LaboratorioOtService,
  ) {}

  /**
   * Reunión 2 · anular la OT cuando el cliente desiste (u otra causa), con
   * motivo. No se anula una OT cerrada, facturada o con documentos oficiales.
   * Queda en el Historial de la OT.
   */
  @Post(":id/anular")
  @RequierePermiso("ot.anular")
  async anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const d = AnularOtSchema.parse(body ?? {});
    const tenantId = tenantDe(req);
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id, tenantId }, select: { id: true, codigo: true, estado: true, unidadPrincipal: true } });
    if (!ot) throw new NotFoundException("OT no encontrada.");
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`, "ot.anular");
    const h = await this.prisma.$queryRawUnsafe<{ fact: number; docs: number }[]>(
      `SELECT (SELECT count(*)::int FROM factura f WHERE f.ot_id = $1::uuid AND f.deleted_at IS NULL AND f.estado NOT IN ('pendiente','anulada')) AS fact,
              (SELECT count(*)::int FROM certificado c WHERE c.ot_id = $1::uuid AND c.deleted_at IS NULL AND c.estado IN ('oficial','emitido')) AS docs`,
      id,
    );
    const motivo = motivoNoAnularOt({ estado: ot.estado, codigo: ot.codigo, facturaEmitida: (h[0]?.fact ?? 0) > 0, documentosOficiales: h[0]?.docs ?? 0 });
    if (motivo) throw new ConflictException(motivo);
    const yo = req?.user?.sub ?? null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE orden_trabajo SET estado = 'anulada', anulacion_causa = $2, anulacion_motivo = $3, anulada_at = now(), anulada_por = $4::uuid, updated_at = now()
          WHERE id = $1::uuid`,
        id,
        d.causa,
        d.motivo,
        yo,
      );
      // El borrador de factura que hubiera dejado el cierre no se emite.
      await tx.$executeRawUnsafe(`UPDATE factura SET estado = 'anulada', updated_at = now() WHERE ot_id = $1::uuid AND estado = 'pendiente' AND deleted_at IS NULL`, id);
      await this.labs.anotar(tx as any, {
        tenantId,
        otId: id,
        tipo: "ot_anulada",
        usuarioId: yo,
        detalle: { causa: d.causa, causaTexto: CAUSAS_ANULACION_OT[d.causa], motivo: d.motivo, estadoAnterior: ot.estado },
      });
    });
    return { ok: true, mensaje: `OT ${ot.codigo} anulada: ${CAUSAS_ANULACION_OT[d.causa].toLowerCase()}.` };
  }
}

@Module({
  controllers: [FichaEnsayoController, AvisosComercialController, OtAnulacionController],
  providers: [FichaEnsayoService, AvisosComercialService],
})
export class SesionesS1Module {}
