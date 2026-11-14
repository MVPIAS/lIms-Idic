/**
 * Exportación de facturas para el sistema de facturación electrónica del IDIC y
 * documento de cobro en PDF (docs/EXPORTACION_FACTURACION.md).
 *
 *   GET /facturas/:id/documento-cobro   PDF «Documento de cobro · no es un DTE»   factura.ver
 *   GET /facturas/:id/exportacion       JSON lims-idic.factura.v1 (una factura)    factura.ver
 *   GET /facturas/exportacion?desde=&hasta=&estado=
 *                                       JSON lims-idic.factura-lote.v1 (rango)     factura.ver
 *   PUT /facturas/:id/exencion          marca la factura pendiente exenta de IVA   factura.emitir
 *
 * Mismos permisos que Facturas (factura.ver / factura.emitir); sin alcance por
 * laboratorio, igual que el resto del módulo (Finanzas es global).
 * El controlador se registra ANTES que FacturaController: así la ruta fija
 * «/facturas/exportacion» no cae en «/facturas/:id».
 */
import {
  BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Put, Query, Req, Res, UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { DEV_TENANT } from "../common/base-crud.service";
import { ZONA_CHILE, hoyChile } from "../common/fecha-chile";
import {
  ESQUEMA_LOTE,
  MAX_LOTE,
  TASA_IVA,
  construirExportacion,
  nombreArchivoExportacion,
  type DatosExportacion,
  type EmisorEntrada,
  type ReferenciaEntrada,
} from "./exportacion-factura";
import { pdfDocumentoCobro } from "./documento-cobro";
import { ESTADOS_FACTURA, totales } from "./reglas-factura";

/** Códigos de `parametro_sistema` · categoría `emisor_facturacion` → campo del emisor. */
export const CODIGOS_EMISOR: Record<string, keyof EmisorEntrada> = {
  rut: "rut",
  razon_social: "razonSocial",
  giro: "giro",
  acteco: "acteco",
  direccion: "direccion",
  comuna: "comuna",
  ciudad: "ciudad",
  codigo_sucursal_sii: "codigoSucursalSii",
  correo: "correo",
  telefono: "telefono",
};

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ExencionBody = z.object({ exenta: z.boolean({ required_error: "Indique si la factura es exenta de IVA (exenta: true o false)." }) });

const tenantDe = (req: any): string => req?.user?.tenantId ?? DEV_TENANT;
/** Instante con el desfase de Chile («2026-11-14T12:00:00-03:00»). */
function ahoraChile(): string {
  const d = new Date();
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_CHILE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const off = String(p.timeZoneName ?? "GMT").replace("GMT", "") || "+00:00";
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off}`;
}

@Injectable()
export class ExportacionFacturaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Datos del IDIC como emisor (Parámetros del sistema › «Emisor de la factura»). */
  async emisor(tenantId: string): Promise<EmisorEntrada> {
    const filas = await this.prisma.$queryRawUnsafe<{ codigo: string; valor: string | null }[]>(
      `SELECT codigo, valor FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'emisor_facturacion'`,
      tenantId,
    );
    const e: EmisorEntrada = {};
    for (const f of filas) {
      const campo = CODIGOS_EMISOR[f.codigo];
      if (campo) (e as any)[campo] = f.valor?.trim() || null;
    }
    return e;
  }

  /** Lee la factura y todo lo que la exportación y el PDF necesitan (404 si es de otro tenant). */
  async datos(id: string, tenantId: string, emisor?: EmisorEntrada) {
    const [f] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT f.id::text, f.numero, f.estado, f.origen, f.moneda, to_char(f.fecha_emision, 'YYYY-MM-DD') AS "fechaEmision",
              f.neto::float8 AS neto, f.iva_pct::float8 AS "ivaPct", f.iva_monto::float8 AS "ivaMonto", f.total::float8 AS total,
              f.exenta_iva AS "exentaIva", f.observaciones,
              f.cliente_id::text AS "clienteId", f.ot_id::text AS "otId", f.cotizacion_id::text AS "cotizacionId", f.centro_costo_id::text AS "centroCostoId",
              COALESCE((SELECT SUM(p.monto) FROM pago p WHERE p.factura_id = f.id), 0)::float8 AS pagado,
              COALESCE((SELECT SUM(n.monto) FROM nota_credito n WHERE n.factura_id = f.id), 0)::float8 AS "notasCredito"
         FROM factura f
        WHERE f.id = $1::uuid AND f.tenant_id = $2::uuid AND f.deleted_at IS NULL`,
      id,
      tenantId,
    );
    if (!f) throw new NotFoundException("Factura no encontrada.");
    const [lineas, [cli], [ot], [cot], internaciones, [cc]] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT descripcion, cantidad::float8 AS cantidad, precio_unitario::float8 AS "precioUnitario", subtotal::float8 AS subtotal
           FROM linea_factura WHERE factura_id = $1::uuid ORDER BY ctid`,
        id,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT c.rut, c.razon_social AS "razonSocial", c.giro, c.direccion, c.comuna, c.ciudad, c.email::text AS correo, c.telefono,
                c.contacto_nombre AS "contactoNombre", c.contacto_email AS "contactoCorreo", c.contacto_telefono AS "contactoTelefono",
                c.dias_credito AS "diasCredito", c.forma_pago_habitual AS "formaPago"
           FROM cliente c WHERE c.id = $1::uuid`,
        f.clienteId,
      ),
      f.otId
        ? this.prisma.$queryRawUnsafe<any[]>(
            `SELECT o.codigo, to_char(COALESCE(o.fecha_recepcion, o.created_at), 'YYYY-MM-DD') AS fecha, o.oc_numero AS "ocNumero",
                    o.opi_numero AS "opiNumero", to_char(o.opi_fecha, 'YYYY-MM-DD') AS "opiFecha",
                    o.disposicion_ref AS "disposicionRef", to_char(o.disposicion_fecha, 'YYYY-MM-DD') AS "disposicionFecha",
                    o.centro_costo_id::text AS "centroCostoId"
               FROM orden_trabajo o WHERE o.id = $1::uuid`,
            f.otId,
          )
        : Promise.resolve([] as any[]),
      f.cotizacionId
        ? this.prisma.$queryRawUnsafe<any[]>(
            `SELECT q.codigo, to_char(q.fecha_emision, 'YYYY-MM-DD') AS fecha, q.forma_pago AS "formaPago",
                    q.aceptacion_tipo AS "aceptacionTipo", q.aceptacion_numero AS "aceptacionNumero", to_char(q.aceptacion_fecha, 'YYYY-MM-DD') AS "aceptacionFecha"
               FROM cotizacion q WHERE q.id = $1::uuid`,
            f.cotizacionId,
          )
        : Promise.resolve([] as any[]),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT i.numero, i.resolucion_numero AS "resolucionNumero", to_char(i.resolucion_fecha, 'YYYY-MM-DD') AS "resolucionFecha"
           FROM bpch_internacion i
          WHERE i.factura_id = $1::uuid OR ($2::uuid IS NOT NULL AND i.ot_id = $2::uuid)
          ORDER BY i.numero`,
        id,
        f.otId ?? null,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT codigo, COALESCE(nombre, descripcion) AS nombre FROM centro_costo
          WHERE id = COALESCE($1::uuid, (SELECT o.centro_costo_id FROM orden_trabajo o WHERE o.id = $2::uuid))`,
        f.centroCostoId ?? null,
        f.otId ?? null,
      ),
    ]);
    const codigoFp = cot?.formaPago ?? cli?.formaPago ?? null;
    const [fp] = codigoFp
      ? await this.prisma.$queryRawUnsafe<{ etiqueta: string }[]>(
          `SELECT etiqueta FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'forma_pago' AND codigo = $2`,
          tenantId,
          codigoFp,
        )
      : [];

    const referencias: ReferenciaEntrada[] = [];
    if (ot) referencias.push({ tipo: "OT", folio: ot.codigo, fecha: ot.fecha, razon: "Orden de trabajo del LIMS" });
    if (cot) referencias.push({ tipo: "COTIZACION", folio: cot.codigo, fecha: cot.fecha, razon: "Cotización aceptada" });
    if (cot?.aceptacionTipo === "OC" && cot.aceptacionNumero)
      referencias.push({ tipo: "OC", folio: cot.aceptacionNumero, fecha: cot.aceptacionFecha, razon: "Orden de compra del cliente" });
    else if (ot?.ocNumero) referencias.push({ tipo: "OC", folio: ot.ocNumero, fecha: null, razon: "Orden de compra del cliente" });
    if (cot?.aceptacionTipo === "OPI_RESOLUCION" && cot.aceptacionNumero)
      referencias.push({ tipo: "OPI", folio: cot.aceptacionNumero, fecha: cot.aceptacionFecha, razon: "OPI / resolución de aceptación" });
    else if (ot?.opiNumero) referencias.push({ tipo: "OPI", folio: ot.opiNumero, fecha: ot.opiFecha, razon: "OPI" });
    if (ot?.disposicionRef) referencias.push({ tipo: "DISPOSICION", folio: ot.disposicionRef, fecha: ot.disposicionFecha, razon: "Disposición del Director" });
    for (const i of internaciones)
      if (i.resolucionNumero) referencias.push({ tipo: "RESOLUCION", folio: i.resolucionNumero, fecha: i.resolucionFecha, razon: `Resolución DGMN de la internación ${i.numero}` });

    const datos: DatosExportacion & { pagado: number; notasCredito: number } = {
      factura: {
        id: f.id,
        numero: f.numero,
        estado: f.estado,
        origen: f.origen,
        moneda: f.moneda,
        fechaEmision: f.fechaEmision,
        neto: f.neto,
        ivaPct: f.ivaPct,
        ivaMonto: f.ivaMonto,
        total: f.total,
        exentaIva: f.exentaIva,
        observaciones: f.observaciones,
      },
      lineas,
      emisor: emisor ?? (await this.emisor(tenantId)),
      receptor: cli ?? null,
      formaPago: codigoFp ? { codigo: codigoFp, etiqueta: fp?.etiqueta ?? codigoFp } : null,
      referencias,
      centroCosto: cc ? { codigo: cc.codigo, nombre: cc.nombre } : null,
      hoy: hoyChile(),
      pagado: f.pagado,
      notasCredito: f.notasCredito,
    };
    return datos;
  }

  async exportarUna(id: string, tenantId: string) {
    const d = await this.datos(id, tenantId);
    const r = construirExportacion(d, ahoraChile());
    if (!r.documento) throw new ConflictException(`No se puede exportar la factura ${d.factura.numero}. ${r.errores.join(" ")}`);
    return r.documento;
  }

  async exportarLote(q: { desde?: string; hasta?: string; estado?: string }, tenantId: string) {
    const desde = String(q.desde ?? "").trim();
    const hasta = String(q.hasta ?? "").trim();
    if (!FECHA.test(desde) || !FECHA.test(hasta)) throw new BadRequestException("Indique el rango de fechas de emisión: desde y hasta (AAAA-MM-DD).");
    if (hasta < desde) throw new BadRequestException("La fecha «hasta» es anterior a «desde»: corrija el rango.");
    const estados = [...ESTADOS_FACTURA, "por_cobrar"] as string[];
    const estado = q.estado ? String(q.estado) : "";
    if (estado && !estados.includes(estado)) throw new BadRequestException(`Estado no válido: use ${estados.join(", ")} o déjelo vacío (todas menos las anuladas).`);
    const filtroEstado = !estado
      ? `AND f.estado <> 'anulada'`
      : estado === "por_cobrar"
        ? `AND f.estado IN ('emitida', 'parcial')`
        : `AND f.estado = $4`;
    const params: unknown[] = [tenantId, desde, hasta];
    if (estado && estado !== "por_cobrar") params.push(estado);
    const ids = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT f.id::text FROM factura f
        WHERE f.tenant_id = $1::uuid AND f.deleted_at IS NULL AND f.fecha_emision BETWEEN $2::date AND $3::date ${filtroEstado}
        ORDER BY f.fecha_emision, f.numero
        LIMIT ${MAX_LOTE + 1}`,
      ...params,
    );
    if (ids.length > MAX_LOTE)
      throw new BadRequestException(`El rango tiene más de ${MAX_LOTE} facturas: acótelo (por ejemplo, un mes) y exporte por partes.`);
    const emisor = await this.emisor(tenantId);
    const generadoEn = ahoraChile();
    const documentos: unknown[] = [];
    const omitidas: { idFactura: string; folioInterno: string; estadoLims: string; motivos: string[] }[] = [];
    for (const { id } of ids) {
      const d = await this.datos(id, tenantId, emisor);
      const r = construirExportacion(d, generadoEn);
      if (r.documento) documentos.push(r.documento);
      else omitidas.push({ idFactura: d.factura.id, folioInterno: d.factura.numero, estadoLims: d.factura.estado, motivos: r.errores });
    }
    return {
      esquema: ESQUEMA_LOTE,
      generadoEn,
      filtro: { desde, hasta, estado: estado || null },
      cantidad: documentos.length,
      documentos,
      omitidas,
    };
  }

  /** Marca (o desmarca) exenta de IVA una factura PENDIENTE y recalcula sus importes. */
  async exencion(id: string, exenta: boolean, tenantId: string) {
    const [f] = await this.prisma.$queryRawUnsafe<{ numero: string; estado: string; moneda: string; ivaPct: number }[]>(
      `SELECT numero, estado, moneda, iva_pct::float8 AS "ivaPct" FROM factura WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id,
      tenantId,
    );
    if (!f) throw new NotFoundException("Factura no encontrada.");
    if (f.estado !== "pendiente")
      throw new ConflictException(`La factura ${f.numero} ya no está pendiente de emitir (estado: ${f.estado}): su exención no se cambia. Corríjala con una nota de crédito.`);
    const lineas = await this.prisma.$queryRawUnsafe<{ subtotal: number }[]>(`SELECT subtotal::float8 AS subtotal FROM linea_factura WHERE factura_id = $1::uuid`, id);
    const ivaPct = exenta ? 0 : f.ivaPct > 0 ? f.ivaPct : TASA_IVA;
    const t = totales(lineas, ivaPct, f.moneda);
    await this.prisma.$executeRawUnsafe(
      `UPDATE factura SET exenta_iva = $2, iva_pct = $3, neto = $4, iva_monto = $5, total = $6, updated_at = now() WHERE id = $1::uuid`,
      id,
      exenta,
      ivaPct,
      t.neto,
      t.ivaMonto,
      t.total,
    );
    return { id, numero: f.numero, exentaIva: exenta, ivaPct, neto: t.neto, ivaMonto: t.ivaMonto, total: t.total };
  }
}

@ApiTags("facturas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("facturas")
export class ExportacionFacturaController {
  constructor(private readonly svc: ExportacionFacturaService) {}

  @Get("exportacion")
  @RequierePermiso("factura.ver")
  @ApiOperation({ summary: "Exporta para facturación (lims-idic.factura-lote.v1) las facturas emitidas en un rango de fechas" })
  async lote(@Query("desde") desde: string, @Query("hasta") hasta: string, @Query("estado") estado: string | undefined, @Req() req: any, @Res() res: any) {
    const r = await this.svc.exportarLote({ desde, hasta, estado }, tenantDe(req));
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="Facturas-${desde}-a-${hasta}.json"`);
    res.end(JSON.stringify(r, null, 2));
  }

  @Get(":id/exportacion")
  @RequierePermiso("factura.ver")
  @ApiOperation({ summary: "Exporta una factura para el sistema de facturación (lims-idic.factura.v1)" })
  async una(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: any) {
    const doc = await this.svc.exportarUna(id, tenantDe(req));
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivoExportacion(doc.encabezado.folioInterno, "json")}"`);
    res.end(JSON.stringify(doc, null, 2));
  }

  @Get(":id/documento-cobro")
  @RequierePermiso("factura.ver")
  @ApiOperation({ summary: "PDF «Documento de cobro · no es un documento tributario electrónico»" })
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: any) {
    const d = await this.svc.datos(id, tenantDe(req));
    const pdf = await pdfDocumentoCobro(d, d.hoy);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${nombreArchivoExportacion(d.factura.numero, "pdf", "Documento-cobro")}"`);
    res.end(pdf);
  }

  @Put(":id/exencion")
  @RequierePermiso("factura.emitir")
  @ApiOperation({ summary: "Marca una factura pendiente como exenta (o afecta) de IVA y recalcula sus importes" })
  exencion(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.exencion(id, ExencionBody.parse(body ?? {}).exenta, tenantDe(req));
  }
}
