import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../../common/prisma.service";
import { BpchComunService, tenantDe, usuarioDe } from "../comun/bpch-comun.service";
import { OtDesdeProcesoService } from "../ot-desde-proceso.service";
import { CodificacionService } from "../codificacion/codificacion.service";
import {
  ACCIONES_DOC_ADM,
  LISTADOS_CODIFICACION,
  PERMISO_CONFIGURACION,
  porcentajesTasaCambiados,
  TEXTO_AVANCE,
  avanceInternacion,
  calcularTasa,
  erroresAnalisis,
  erroresItems,
  erroresLote,
  erroresLoteParaMuestra,
  erroresTasa,
  faltantesRemision,
  normalizarCnc,
  transicionDocAdm,
} from "../comun/reglas-bpch";
import { numeroBorrador, totales } from "../../facturacion/reglas-factura";

const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const texto = (max: number) => z.string().trim().max(max);
const opcional = (max: number) => texto(max).optional().nullable();

const ItemBody = z.object({
  codificacionId: z.string().uuid().optional().nullable(),
  catElementoId: z.string().uuid().optional().nullable(),
  elementoGenerico: opcional(240),
  elementoEspecifico: texto(240).optional().nullable(),
  cnc: opcional(80),
  claseDivisionUn: opcional(20),
  numeroUn: opcional(10),
  cantidad: z.number().positive().optional().nullable(),
  unidadMedida: opcional(20),
  identificacionLote: opcional(80),
  tamanoLote: z.number().int().optional().nullable(),
  tamanoMuestra: z.number().int().optional().nullable(),
});

export const RegistroBody = z.object({
  resolucionNumero: texto(60).min(1, "Indique el Nº de la resolución DGMN"),
  resolucionFecha: fechaDia,
  oficio: opcional(60),
  clienteId: z.string().uuid({ message: "Indique la empresa importadora" }),
  documentoAduanero: opcional(60),
  paisOrigen: opcional(80),
  esquema: z.enum(["LOTES", "TIPO"]).default("LOTES"),
  procedimiento: opcional(40),
  unidadInspeccionId: z.string().uuid({ message: "Indique la sucursal o delegación que inspecciona" }),
  sujetaTasa: z.boolean({ required_error: "Indique si la internación está sujeta a la tasa" }),
  items: z.array(ItemBody).max(50),
});

const AnalisisBody = z.object({
  infoCompleta: z.boolean(),
  fechaAnalisis: fechaDia,
  observaciones: opcional(4000),
  solicitud: z.object({ destinatario: opcional(200), detalle: opcional(4000), fechaEnvio: fechaDia.optional() }).optional().nullable(),
});

const RespuestaBody = z.object({ fechaRespuesta: fechaDia, respuesta: texto(4000).min(3, "Describa la respuesta de DGMN") });

const DocumentacionBody = z.object({
  accion: z.enum(ACCIONES_DOC_ADM),
  fecha: fechaDia,
  detalle: opcional(4000),
  facturaComercial: opcional(60),
  documentoAduanero: opcional(60),
});

const InspeccionBody = z.object({
  lugarInspeccion: opcional(240),
  fechaInspeccion: fechaDia.optional().nullable(),
  inspectores: opcional(240),
  fechaVencimientoProducto: fechaDia.optional().nullable(),
  vigenciaInforme: fechaDia.optional().nullable(),
  observaciones: opcional(4000),
  procedimiento: opcional(40),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        identificacionLote: opcional(80),
        tamanoLote: z.number().int().optional().nullable(),
        tamanoMuestra: z.number().int().optional().nullable(),
      }),
    )
    .max(50)
    .optional(),
});

const LotesBody = z.object({
  items: z.array(z.object({ id: z.string().uuid(), metodoIds: z.array(z.string().uuid()).min(1, "Elija al menos un ensayo del lote").max(200) })).min(1).max(50),
});

const TasaBody = z.object({
  cifUsd: z.number(),
  paridad: z.number(),
  pctAfecto: z.number().default(100),
  tasaPct: z.number().optional(),
  ivaPct: z.number().optional(),
});

const CodificacionBody = z.object({
  items: z.array(z.object({ id: z.string().uuid(), listado: z.enum(LISTADOS_CODIFICACION).optional() })).min(1).max(50),
});

const AnularBody = z.object({ motivo: texto(500).min(5, "Indique el motivo (mínimo 5 caracteres)") });

export const FiltroInternaciones = z.object({
  estado: z.string().max(30).optional(),
  /** Tarjetas de Mi bandeja (EP-06 6.1 y 6.6): «analisis» = por analizar (SCC); «inspeccion» = lotes por inspeccionar. */
  pendiente: z.enum(["analisis", "inspeccion"]).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** Estados en los que la OT ya no admite cambios del expediente. */
const ESTADOS_CERRADOS_OT = ["cerrada", "anulada"];

/**
 * Internación BPCH (IDIC-PG 24 Anexo 03): el expediente que nace con la
 * resolución DGMN y se apoya en el flujo general de la OT. Reglas puras en
 * comun/reglas-bpch.ts; contrato en docs/FLUJO_BPCH_INTERNACION_REINSPECCION_CODIFICACION.md.
 */
@Injectable()
export class InternacionBpchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comun: BpchComunService,
    private readonly ots: OtDesdeProcesoService,
    private readonly codificacion: CodificacionService,
  ) {}

  /* ------------------------------------------------------------- lectura --- */

  async listar(req: any, f: z.infer<typeof FiltroInternaciones>) {
    const tenantId = tenantDe(req);
    const args: unknown[] = [tenantId];
    const p = (v: unknown) => (args.push(v), `$${args.length}`);
    const where = [`i.tenant_id = $1::uuid`];
    const filtro = await this.comun.filtroExpedientes(req);
    if (filtro !== null) where.push(`i.unidad_inspeccion_id = ANY(${p(filtro)}::uuid[])`);
    if (f.estado) where.push(`i.estado = ${p(f.estado)}`);
    if (f.pendiente === "analisis") where.push(`i.estado IN ('registrada', 'antecedentes_pendientes')`);
    if (f.pendiente === "inspeccion")
      where.push(`i.estado = 'ot_generada' AND o.estado NOT IN ('cerrada', 'anulada')
                  AND NOT EXISTS (SELECT 1 FROM muestra m WHERE m.ot_id = o.id AND m.deleted_at IS NULL)`);
    if (f.q) {
      const q = p(`%${f.q}%`);
      where.push(`(i.numero ILIKE ${q} OR i.resolucion_numero ILIKE ${q} OR cl.razon_social ILIKE ${q} OR cl.rut ILIKE ${q} OR o.codigo ILIKE ${q}
                   OR EXISTS (SELECT 1 FROM bpch_internacion_item it WHERE it.internacion_id = i.id AND (it.elemento_especifico ILIKE ${q} OR it.cnc_dgmn ILIKE ${q})))`);
    }
    const limit = f.limit ?? 50;
    const page = f.page ?? 1;
    const desde = `FROM bpch_internacion i JOIN cliente cl ON cl.id = i.cliente_id JOIN unidad u ON u.id = i.unidad_inspeccion_id
                   LEFT JOIN orden_trabajo o ON o.id = i.ot_id WHERE ${where.join(" AND ")}`;
    const [{ total }] = await this.prisma.$queryRawUnsafe<{ total: number }[]>(`SELECT count(*)::int AS total ${desde}`, ...args);
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT i.id, i.numero, i.estado, i.resolucion_numero AS "resolucionNumero", i.resolucion_fecha AS "resolucionFecha",
              i.sujeta_tasa AS "sujetaTasa", i.doc_adm_estado AS "docAdmEstado", i.created_at AS "createdAt",
              cl.razon_social AS empresa, cl.rut, u.codigo AS "unidadCodigo", u.nombre AS "unidadNombre",
              o.id AS "otId", o.codigo AS "otCodigo", o.estado AS "otEstado", i.remitida_dco_at AS "remitidaAt",
              (SELECT string_agg(it.elemento_especifico, ' / ' ORDER BY it.orden) FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS elementos,
              (SELECT count(*)::int FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS "nLotes",
              (SELECT count(*)::int FROM bpch_internacion_item it WHERE it.internacion_id = i.id AND it.muestra_id IS NOT NULL) AS "nLotesRegistrados",
              COALESCE(ARRAY(SELECT DISTINCT c.tipo_documento FROM certificado c
                              WHERE c.ot_id = o.id AND c.deleted_at IS NULL AND c.estado IN ('oficial', 'emitido') AND c.tipo_documento IS NOT NULL), '{}') AS "documentosOficiales"
         ${desde}
        ORDER BY i.created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      ...args,
    );
    // Estado que se muestra: el avance real (OT, lotes, documentos, tasa), no solo
    // el del expediente, que deja de cambiar al generar la OT (hallazgo 21).
    for (const r of data) {
      const docs: string[] = r.documentosOficiales ?? [];
      r.avance = avanceInternacion({
        estado: r.estado,
        otEstado: r.otEstado,
        lotes: r.nLotes,
        lotesRegistrados: r.nLotesRegistrados,
        informeOficial: docs.includes("INFORME_INSPECCION"),
        certificadoOficial: docs.includes("CERTIFICADO_CONFORMIDAD"),
        incumplimientoOficial: docs.includes("INFORME_INCUMPLIMIENTO"),
        sujetaTasa: r.sujetaTasa,
        tasaRemitida: Boolean(r.remitidaAt),
      });
      r.avanceTexto = TEXTO_AVANCE[r.avance as keyof typeof TEXTO_AVANCE];
      delete r.documentosOficiales;
    }
    return { data, meta: { page, limit, total: Number(total), totalPages: Math.max(1, Math.ceil(Number(total) / limit)) } };
  }

  private async fila(tenantId: string, id: string) {
    const [i] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT i.*, cl.razon_social AS empresa, cl.rut AS empresa_rut, u.codigo AS unidad_codigo, u.nombre AS unidad_nombre, u.tipo AS unidad_tipo,
              an.nombre_completo AS analista_nombre
         FROM bpch_internacion i
         JOIN cliente cl ON cl.id = i.cliente_id
         JOIN unidad u ON u.id = i.unidad_inspeccion_id
         LEFT JOIN usuario an ON an.id = i.analista_id
        WHERE i.id = $1::uuid AND i.tenant_id = $2::uuid`,
      id,
      tenantId,
    );
    if (!i) throw new NotFoundException("Internación no encontrada.");
    return i;
  }

  /** Expediente del tenant y del alcance del usuario (404 / 403). */
  private async cargar(req: any, id: string) {
    const i = await this.fila(tenantDe(req), id);
    await this.comun.exigirExpediente(req, i.unidad_inspeccion_id, `la internación ${i.numero}`);
    return i;
  }

  private async items(id: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT it.id, it.orden, it.codificacion_id AS "codificacionId", it.cat_elemento_id AS "catElementoId", ce.nombre AS "catElementoNombre",
              it.elemento_generico AS "elementoGenerico", it.elemento_especifico AS "elementoEspecifico", it.cnc_dgmn AS cnc,
              it.clase_division_un AS "claseDivisionUn", it.numero_un AS "numeroUn", it.cantidad::float8 AS cantidad, it.unidad_medida AS "unidadMedida",
              it.identificacion_lote AS "identificacionLote", it.tamano_lote AS "tamanoLote", it.tamano_muestra AS "tamanoMuestra",
              it.muestra_id AS "muestraId", m.codigo AS "muestraCodigo", m.veredicto AS "muestraVeredicto",
              c.estado AS "codificacionEstado", c.listado AS "codificacionListado", c.certificado_id AS "codificacionCertificadoId"
         FROM bpch_internacion_item it
         LEFT JOIN cat_elemento ce ON ce.id = it.cat_elemento_id
         LEFT JOIN muestra m ON m.id = it.muestra_id
         LEFT JOIN bpch_codificacion c ON c.id = it.codificacion_id AND c.deleted_at IS NULL
        WHERE it.internacion_id = $1::uuid ORDER BY it.orden`,
      id,
    );
  }

  private async tasa(id: string) {
    const [t] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT t.id, t.monto_cif_usd::float8 AS "cifUsd", t.paridad_usd::float8 AS paridad, t.monto_cif_clp::float8 AS "cifClp",
              t.pct_afecto::float8 AS "pctAfecto", t.tasa_pct::float8 AS "tasaPct", t.iva_pct::float8 AS "ivaPct",
              t.monto_operacion::float8 AS tasa, t.iva_internacion::float8 AS iva, t.total_a_cancelar::float8 AS total,
              t.calculado_at AS "calculadoAt", u.nombre_completo AS "calculadoPorNombre", t.factura_id AS "facturaId"
         FROM calculo_tasa_internacion t LEFT JOIN usuario u ON u.id = t.calculado_por
        WHERE t.internacion_id = $1::uuid ORDER BY t.calculado_at DESC LIMIT 1`,
      id,
    );
    return t ?? null;
  }

  async detalle(req: any, id: string) {
    const i = await this.cargar(req, id);
    const [items, solicitudes, tasa, estadoOt] = await Promise.all([
      this.items(id),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT s.id, s.destinatario, s.detalle, s.fecha_envio AS "fechaEnvio", s.fecha_respuesta AS "fechaRespuesta", s.respuesta,
                s.created_at AS "createdAt", u.nombre_completo AS "creadaPorNombre"
           FROM bpch_solicitud_antecedentes s LEFT JOIN usuario u ON u.id = s.created_by
          WHERE s.internacion_id = $1::uuid ORDER BY s.created_at`,
        id,
      ),
      this.tasa(id),
      this.comun.estadoOt(i.ot_id),
    ]);
    const exp = {
      id: i.id,
      numero: i.numero,
      estado: i.estado,
      resolucionNumero: i.resolucion_numero,
      resolucionFecha: i.resolucion_fecha,
      oficio: i.oficio,
      cliente: { id: i.cliente_id, razonSocial: i.empresa, rut: i.empresa_rut },
      documentoAduanero: i.documento_aduanero,
      paisOrigen: i.pais_origen,
      esquema: i.esquema,
      procedimiento: i.procedimiento,
      unidad: { id: i.unidad_inspeccion_id, codigo: i.unidad_codigo, nombre: i.unidad_nombre, tipo: i.unidad_tipo },
      sujetaTasa: i.sujeta_tasa,
      analisis: { infoCompleta: i.info_completa, analistaNombre: i.analista_nombre, fecha: i.fecha_analisis, observaciones: i.observaciones_analisis },
      otId: i.ot_id,
      otGeneradaAt: i.ot_generada_at,
      documentacion: {
        estado: i.doc_adm_estado,
        solicitadaAt: i.doc_adm_solicitada_at,
        recibidaAt: i.doc_adm_recibida_at,
        detalle: i.doc_adm_detalle,
        facturaComercial: i.factura_comercial,
      },
      inspeccion: {
        lugar: i.lugar_inspeccion,
        fecha: i.fecha_inspeccion,
        inspectores: i.inspectores,
        vencimientoProducto: i.fecha_vencimiento_producto,
        vigenciaInforme: i.vigencia_informe,
        observaciones: i.observaciones_inspeccion,
      },
      remitidaAt: i.remitida_dco_at,
      facturaId: i.factura_id,
      anuladaMotivo: i.anulada_motivo,
      createdAt: i.created_at,
    };
    const oficial = (d: { estado: string } | null | undefined) => Boolean(d && ["oficial", "emitido"].includes(d.estado));
    const avance = avanceInternacion({
      estado: i.estado,
      otEstado: estadoOt?.ot?.estado ?? null,
      lotes: items.length,
      lotesRegistrados: items.filter((x) => x.muestraId).length,
      informeOficial: oficial(estadoOt?.informeInspeccion),
      certificadoOficial: oficial(estadoOt?.certificado),
      incumplimientoOficial: oficial(estadoOt?.incumplimiento),
      sujetaTasa: i.sujeta_tasa,
      tasaRemitida: Boolean(i.remitida_dco_at),
    });
    return {
      ...exp,
      avance,
      avanceTexto: TEXTO_AVANCE[avance],
      items,
      solicitudes,
      tasa,
      estadoOt,
      fases: this.fases(exp, items, tasa, estadoOt),
    };
  }

  /** Avance del expediente (lo que la pantalla pinta como pasos). */
  private fases(i: any, items: any[], tasa: any, e: Awaited<ReturnType<BpchComunService["estadoOt"]>>) {
    type Estado = "hecho" | "en_curso" | "pendiente" | "no_aplica";
    const f = (clave: string, titulo: string, estado: Estado, detalle?: string) => ({ clave, titulo, estado, detalle: detalle ?? null });
    const oficial = (d: any) => d && ["oficial", "emitido"].includes(d.estado);
    const otGen = Boolean(i.otId);
    const lotes = items.length > 0 && items.every((x) => x.muestraId);
    const res = e?.resultados;
    const resultadosOk = Boolean(res && res.total > 0 && res.aprobados === res.total);
    const final = e?.condicion === "no_cumple" ? e?.incumplimiento : e?.certificado;
    const codificado = e?.condicion === "cumple" && e?.certificado && items.every((x) => x.codificacionId && x.codificacionCertificadoId === e.certificado!.id);
    return [
      f("registro", "Registro de la resolución DGMN", "hecho", i.numero),
      f(
        "analisis",
        "Análisis técnico (SCC)",
        otGen ? "hecho" : i.estado === "antecedentes_pendientes" ? "en_curso" : "pendiente",
        i.estado === "antecedentes_pendientes" ? "Antecedentes solicitados a DGMN" : undefined,
      ),
      f("ot", "OT y lotes a inspeccionar", lotes ? "hecho" : otGen ? "en_curso" : "pendiente", e?.ot?.codigo),
      f("resultados", "Resultados de la inspección", resultadosOk ? "hecho" : res && res.capturados > 0 ? "en_curso" : "pendiente", res ? `${res.aprobados}/${res.total} aprobados` : undefined),
      f("informe", "Informe de Inspección", oficial(e?.informeInspeccion) ? "hecho" : e?.informeInspeccion ? "en_curso" : "pendiente", e?.informeInspeccion?.numero ?? undefined),
      f(
        "documento_final",
        e?.condicion === "no_cumple" ? "Informe de Incumplimiento → DGMN" : "Certificado de Conformidad",
        oficial(final) && (e?.condicion !== "no_cumple" || final?.entregadoAt) ? "hecho" : final ? "en_curso" : "pendiente",
        final?.numero ?? (e ? `Condición: ${e.condicionTexto}` : undefined),
      ),
      f("codificacion", "Codificación Única", e?.condicion === "no_cumple" ? "no_aplica" : codificado ? "hecho" : "pendiente"),
      f(
        "tasa",
        "Tasa de internación → facturación",
        !i.sujetaTasa ? "no_aplica" : i.remitidaAt ? "hecho" : tasa || i.documentacion.estado !== "pendiente" ? "en_curso" : "pendiente",
        i.sujetaTasa ? `Documentación: ${i.documentacion.estado}` : "No sujeta a tasa",
      ),
      f("cierre", "Cierre de la OT", e?.ot?.estado === "cerrada" ? "hecho" : "pendiente", e?.ot?.estado),
    ];
  }

  /* ------------------------------------------------------------ registro --- */

  /** Completa los datos de un elemento desde la Codificación Única (si se elige un producto codificado). */
  private async completarItem(tenantId: string, it: z.infer<typeof ItemBody>) {
    let cod: any = null;
    if (it.codificacionId) {
      cod = await this.codificacion.uno(tenantId, it.codificacionId);
    } else if (it.cnc?.trim()) {
      cod = await this.codificacion.porCnc(tenantId, it.cnc);
    }
    if (it.catElementoId) await this.comun.catElemento(tenantId, it.catElementoId);
    return {
      codificacionId: cod?.id ?? null,
      catElementoId: it.catElementoId ?? cod?.catElementoId ?? null,
      elementoGenerico: it.elementoGenerico?.trim() || cod?.elementoGenerico || null,
      elementoEspecifico: it.elementoEspecifico?.trim() || cod?.producto || "",
      cnc: it.cnc?.trim() || cod?.cnc || null,
      claseDivisionUn: it.claseDivisionUn?.trim() || cod?.claseDivisionUn || null,
      numeroUn: it.numeroUn?.trim() || cod?.numeroUn || null,
      cantidad: it.cantidad ?? null,
      unidadMedida: it.unidadMedida?.trim() || null,
      identificacionLote: it.identificacionLote?.trim() || null,
      tamanoLote: it.tamanoLote ?? null,
      tamanoMuestra: it.tamanoMuestra ?? null,
    };
  }

  private async guardarItems(tx: any, tenantId: string, internacionId: string, items: Awaited<ReturnType<InternacionBpchService["completarItem"]>>[]) {
    await tx.$executeRawUnsafe(`DELETE FROM bpch_internacion_item WHERE internacion_id = $1::uuid`, internacionId);
    let orden = 1;
    for (const it of items) {
      await tx.$executeRawUnsafe(
        `INSERT INTO bpch_internacion_item (tenant_id, internacion_id, orden, codificacion_id, cat_elemento_id, elemento_generico, elemento_especifico,
                cnc_dgmn, clase_division_un, numero_un, cantidad, unidad_medida, identificacion_lote, tamano_lote, tamano_muestra)
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        tenantId,
        internacionId,
        orden++,
        it.codificacionId,
        it.catElementoId,
        it.elementoGenerico,
        it.elementoEspecifico,
        it.cnc,
        it.claseDivisionUn,
        it.numeroUn,
        it.cantidad,
        it.unidadMedida,
        it.identificacionLote,
        it.tamanoLote,
        it.tamanoMuestra,
      );
    }
  }

  async registrar(req: any, body: unknown) {
    const tenantId = tenantDe(req);
    const dto = RegistroBody.parse(body ?? {});
    await this.comun.cliente(tenantId, dto.clienteId);
    await this.comun.validarUnidadInspeccion(tenantId, dto.unidadInspeccionId);
    await this.comun.exigirExpediente(req, dto.unidadInspeccionId, "la internación");
    const items = await Promise.all(dto.items.map((it) => this.completarItem(tenantId, it)));
    const errores = erroresItems(items);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const usuario = usuarioDe(req);
    const id = await this.prisma.$transaction(async (tx) => {
      const numero = await this.ots.correlativo(tx, tenantId, "INT");
      const [fila] = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO bpch_internacion (tenant_id, numero, resolucion_numero, resolucion_fecha, oficio, cliente_id, documento_aduanero, pais_origen,
                esquema, procedimiento, unidad_inspeccion_id, sujeta_tasa, doc_adm_estado, created_by, updated_by)
         VALUES ($1::uuid, $2, $3, $4::date, $5, $6::uuid, $7, $8, $9, $10, $11::uuid, $12, $13, $14::uuid, $14::uuid) RETURNING id`,
        tenantId,
        numero,
        dto.resolucionNumero,
        dto.resolucionFecha,
        dto.oficio?.trim() || null,
        dto.clienteId,
        dto.documentoAduanero?.trim() || null,
        dto.paisOrigen?.trim() || null,
        dto.esquema,
        dto.procedimiento?.trim() || null,
        dto.unidadInspeccionId,
        dto.sujetaTasa,
        dto.sujetaTasa ? "pendiente" : "no_aplica",
        usuario,
      );
      await this.guardarItems(tx, tenantId, fila.id, items);
      return fila.id;
    });
    return this.detalle(req, id);
  }

  /** Corrige el registro (solo antes de generar la OT). */
  async corregir(req: any, id: string, body: unknown) {
    const tenantId = tenantDe(req);
    const i = await this.cargar(req, id);
    if (!["registrada", "antecedentes_pendientes"].includes(i.estado))
      throw new ConflictException(
        i.estado === "ot_generada"
          ? `La OT ya está generada: el registro de ${i.numero} ya no se corrige aquí (los lotes y la inspección se completan en su paso).`
          : `La internación ${i.numero} está ${i.estado}.`,
      );
    const dto = RegistroBody.parse(body ?? {});
    await this.comun.cliente(tenantId, dto.clienteId);
    await this.comun.validarUnidadInspeccion(tenantId, dto.unidadInspeccionId);
    await this.comun.exigirExpediente(req, dto.unidadInspeccionId, "la internación");
    const items = await Promise.all(dto.items.map((it) => this.completarItem(tenantId, it)));
    const errores = erroresItems(items);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.prisma.$transaction(async (tx) => {
      // Con la fila bloqueada se vuelve a mirar el estado: si el análisis técnico generó
      // la OT mientras tanto, la corrección ya no procede (la OT nació con los datos de antes).
      const [actual] = await tx.$queryRawUnsafe<{ estado: string; ot_id: string | null }[]>(
        `SELECT estado, ot_id FROM bpch_internacion WHERE id = $1::uuid FOR UPDATE`,
        id,
      );
      if (actual?.ot_id || !["registrada", "antecedentes_pendientes"].includes(actual?.estado ?? ""))
        throw new ConflictException(`La internación ${i.numero} cambió mientras la corregía (${actual?.estado ?? "?"}): vuelva a cargarla.`);
      await tx.$executeRawUnsafe(
        `UPDATE bpch_internacion SET resolucion_numero = $2, resolucion_fecha = $3::date, oficio = $4, cliente_id = $5::uuid, documento_aduanero = $6,
                pais_origen = $7, esquema = $8, procedimiento = $9, unidad_inspeccion_id = $10::uuid, sujeta_tasa = $11,
                doc_adm_estado = CASE WHEN $11 THEN (CASE WHEN doc_adm_estado = 'no_aplica' THEN 'pendiente' ELSE doc_adm_estado END) ELSE 'no_aplica' END,
                updated_by = $12::uuid, updated_at = now()
          WHERE id = $1::uuid`,
        id,
        dto.resolucionNumero,
        dto.resolucionFecha,
        dto.oficio?.trim() || null,
        dto.clienteId,
        dto.documentoAduanero?.trim() || null,
        dto.paisOrigen?.trim() || null,
        dto.esquema,
        dto.procedimiento?.trim() || null,
        dto.unidadInspeccionId,
        dto.sujetaTasa,
        usuarioDe(req),
      );
      await this.guardarItems(tx, tenantId, id, items);
    });
    return this.detalle(req, id);
  }

  async anular(req: any, id: string, body: unknown) {
    const i = await this.cargar(req, id);
    const dto = AnularBody.parse(body ?? {});
    if (i.ot_id) throw new ConflictException(`La internación ${i.numero} ya tiene OT: anule o cierre la OT desde su expediente.`);
    if (i.estado === "anulada") throw new ConflictException(`La internación ${i.numero} ya está anulada.`);
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_internacion SET estado = 'anulada', anulada_motivo = $2, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`,
      id,
      dto.motivo,
      usuarioDe(req),
    );
    return this.detalle(req, id);
  }

  /* ----------------------------------------------------- análisis técnico --- */

  /**
   * Análisis técnico (carril SCC). Incompleta → solicitud a DGMN y el expediente
   * espera. Completa → se genera la OT automáticamente (sin cotización ni
   * aprobación), con laboratorio = la unidad que inspecciona.
   */
  async analizar(req: any, id: string, body: unknown) {
    const tenantId = tenantDe(req);
    const i = await this.cargar(req, id);
    const dto = AnalisisBody.parse(body ?? {});
    const [{ n }] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM bpch_solicitud_antecedentes WHERE internacion_id = $1::uuid AND fecha_respuesta IS NULL`,
      id,
    );
    const errores = erroresAnalisis({ estado: i.estado, infoCompleta: dto.infoCompleta, solicitudesPendientes: Number(n), solicitud: dto.solicitud });
    if (errores.length) throw new ConflictException(errores.join(" "));
    const usuario = usuarioDe(req);
    if (!dto.infoCompleta) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO bpch_solicitud_antecedentes (tenant_id, internacion_id, destinatario, detalle, fecha_envio, created_by)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::date, $6::uuid)`,
          tenantId,
          id,
          dto.solicitud!.destinatario!.trim(),
          dto.solicitud!.detalle!.trim(),
          dto.solicitud!.fechaEnvio ?? dto.fechaAnalisis,
          usuario,
        );
        await tx.$executeRawUnsafe(
          `UPDATE bpch_internacion SET estado = 'antecedentes_pendientes', info_completa = FALSE, analista_id = $2::uuid, fecha_analisis = $3::date,
                  observaciones_analisis = $4, updated_by = $2::uuid, updated_at = now() WHERE id = $1::uuid`,
          id,
          usuario,
          dto.fechaAnalisis,
          dto.observaciones?.trim() || null,
        );
      });
      return this.detalle(req, id);
    }

    const items = await this.items(id);
    const errItems = erroresItems(items);
    if (errItems.length) throw new BadRequestException(errItems.join(" "));
    const unidad = await this.comun.validarUnidadInspeccion(tenantId, i.unidad_inspeccion_id);
    await this.prisma.$transaction(async (tx) => {
      // Bloqueo: dos análisis simultáneos no generan dos OT.
      const [actual] = await tx.$queryRawUnsafe<{ estado: string; ot_id: string | null }[]>(
        `SELECT estado, ot_id FROM bpch_internacion WHERE id = $1::uuid FOR UPDATE`,
        id,
      );
      if (actual.ot_id) throw new ConflictException(`La internación ${i.numero} ya tiene OT.`);
      const elementos = items.map((x) => x.elementoEspecifico).join(" / ");
      const unico = items.length === 1 ? items[0] : null;
      const ot = await this.ots.crearOt(tx, {
        tenantId,
        clienteId: i.cliente_id,
        unidad,
        origen: "INTERNACION",
        conCobro: i.sujeta_tasa,
        resolucion: i.resolucion_numero,
        descripcion: `Internación ${i.numero} · Resolución DGMN ${i.resolucion_numero} · ${elementos}`.slice(0, 4000),
        tipoTrabajo: "CERTIFICACION",
        elementoGenerico: unico?.elementoGenerico ?? null,
        catElementoId: unico?.catElementoId ?? null,
        usuarioId: usuario,
        tipoHistorial: "bpch_internacion",
        detalleHistorial: { internacion: i.numero, resolucion: i.resolucion_numero, sujetaTasa: i.sujeta_tasa },
      });
      await tx.$executeRawUnsafe(
        `UPDATE bpch_internacion SET estado = 'ot_generada', info_completa = TRUE, analista_id = $2::uuid, fecha_analisis = $3::date,
                observaciones_analisis = $4, ot_id = $5::uuid, ot_generada_at = now(), updated_by = $2::uuid, updated_at = now()
          WHERE id = $1::uuid`,
        id,
        usuario,
        dto.fechaAnalisis,
        dto.observaciones?.trim() || null,
        ot.id,
      );
    });
    return this.detalle(req, id);
  }

  async responderSolicitud(req: any, id: string, solicitudId: string, body: unknown) {
    const i = await this.cargar(req, id);
    const dto = RespuestaBody.parse(body ?? {});
    const [s] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, fecha_envio, fecha_respuesta FROM bpch_solicitud_antecedentes WHERE id = $1::uuid AND internacion_id = $2::uuid`,
      solicitudId,
      id,
    );
    if (!s) throw new NotFoundException("Solicitud no encontrada en esta internación.");
    if (s.fecha_respuesta) throw new ConflictException("La respuesta de esta solicitud ya está registrada.");
    if (dto.fechaRespuesta < new Date(s.fecha_envio).toISOString().slice(0, 10))
      throw new BadRequestException("La fecha de respuesta no puede ser anterior al envío de la solicitud.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_solicitud_antecedentes SET fecha_respuesta = $2::date, respuesta = $3 WHERE id = $1::uuid`,
      solicitudId,
      dto.fechaRespuesta,
      dto.respuesta,
    );
    await this.prisma.$executeRawUnsafe(`UPDATE bpch_internacion SET updated_by = $2::uuid, updated_at = now() WHERE id = $1::uuid`, i.id, usuarioDe(req));
    return this.detalle(req, id);
  }

  /* -------------------------------------------- documentación administrativa --- */

  async documentacion(req: any, id: string, body: unknown) {
    const i = await this.cargar(req, id);
    const dto = DocumentacionBody.parse(body ?? {});
    if (i.estado === "anulada") throw new ConflictException(`La internación ${i.numero} está anulada.`);
    const t = transicionDocAdm(i.doc_adm_estado, dto.accion);
    if (t.error) throw new ConflictException(t.error);
    if ((dto.accion === "no_conforme" || dto.accion === "solicitar") && !dto.detalle?.trim())
      throw new BadRequestException(dto.accion === "no_conforme" ? "Indique por qué la documentación no es conforme." : "Indique qué documentos se solicitan.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_internacion SET doc_adm_estado = $2,
              doc_adm_solicitada_at = CASE WHEN $3 = 'solicitar' THEN $4::date ELSE doc_adm_solicitada_at END,
              doc_adm_recibida_at = CASE WHEN $3 = 'recibir' THEN $4::date ELSE doc_adm_recibida_at END,
              doc_adm_detalle = CASE WHEN $5::text IS NULL THEN doc_adm_detalle ELSE concat_ws(E'\n', doc_adm_detalle, $5::text) END,
              factura_comercial = COALESCE($6, factura_comercial),
              documento_aduanero = COALESCE($7, documento_aduanero),
              updated_by = $8::uuid, updated_at = now()
        WHERE id = $1::uuid`,
      id,
      t.estado,
      dto.accion,
      dto.fecha,
      dto.detalle?.trim() ? `${dto.fecha} · ${dto.accion}: ${dto.detalle.trim()}` : null,
      dto.facturaComercial?.trim() || null,
      dto.documentoAduanero?.trim() || null,
      usuarioDe(req),
    );
    return this.detalle(req, id);
  }

  /* ---------------------------------------------------- inspección y lotes --- */

  private exigirOtAbierta(i: any, e: Awaited<ReturnType<BpchComunService["estadoOt"]>>) {
    if (!i.ot_id || !e) throw new ConflictException(`La internación ${i.numero} aún no tiene OT: complete el análisis técnico.`);
    if (ESTADOS_CERRADOS_OT.includes(e.ot.estado)) throw new ConflictException(`La OT ${e.ot.codigo} está ${e.ot.estado}.`);
  }

  async inspeccion(req: any, id: string, body: unknown) {
    const i = await this.cargar(req, id);
    const dto = InspeccionBody.parse(body ?? {});
    const e = await this.comun.estadoOt(i.ot_id);
    this.exigirOtAbierta(i, e);
    const items = await this.items(id);
    const porId = new Map(items.map((x) => [x.id, x]));
    const errores: string[] = [];
    for (const it of dto.items ?? []) {
      const actual = porId.get(it.id);
      if (!actual) errores.push(`El lote ${it.id} no es de esta internación.`);
      else errores.push(...erroresLote(it, `Lote ${actual.orden}`));
    }
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE bpch_internacion SET lugar_inspeccion = $2, fecha_inspeccion = $3::date, inspectores = $4, fecha_vencimiento_producto = $5::date,
                vigencia_informe = $6::date, observaciones_inspeccion = $7, procedimiento = COALESCE($8, procedimiento),
                updated_by = $9::uuid, updated_at = now()
          WHERE id = $1::uuid`,
        id,
        dto.lugarInspeccion?.trim() || null,
        dto.fechaInspeccion ?? null,
        dto.inspectores?.trim() || null,
        dto.fechaVencimientoProducto ?? null,
        dto.vigenciaInforme ?? null,
        dto.observaciones?.trim() || null,
        dto.procedimiento?.trim() || null,
        usuarioDe(req),
      );
      for (const it of dto.items ?? []) {
        await tx.$executeRawUnsafe(
          `UPDATE bpch_internacion_item SET identificacion_lote = $2, tamano_lote = $3, tamano_muestra = $4 WHERE id = $1::uuid`,
          it.id,
          it.identificacionLote?.trim() || null,
          it.tamanoLote ?? null,
          it.tamanoMuestra ?? null,
        );
        const m = porId.get(it.id)?.muestraId;
        if (m && it.identificacionLote?.trim())
          await tx.$executeRawUnsafe(`UPDATE muestra SET numero_lote = $2 WHERE id = $1::uuid`, m, it.identificacionLote.trim().slice(0, 80));
      }
    });
    return this.detalle(req, id);
  }

  /** Registra cada lote como muestra de la OT con los ensayos elegidos (panel del catálogo). */
  async lotes(req: any, id: string, body: unknown) {
    const i = await this.cargar(req, id);
    const dto = LotesBody.parse(body ?? {});
    const e = await this.comun.estadoOt(i.ot_id);
    this.exigirOtAbierta(i, e);
    const items = await this.items(id);
    const porId = new Map(items.map((x) => [x.id, x]));
    const errores: string[] = [];
    for (const it of dto.items) {
      const actual = porId.get(it.id);
      if (!actual) errores.push(`El lote ${it.id} no es de esta internación.`);
      else if (actual.muestraId) errores.push(`El lote ${actual.orden} ya está registrado como muestra ${actual.muestraCodigo}.`);
      else errores.push(...erroresLoteParaMuestra(actual, `Lote ${actual.orden}`));
    }
    if (errores.length) throw new BadRequestException(errores.join(" "));
    // Todos los lotes o ninguno, con la fila del expediente bloqueada: un doble
    // envío espera al primero y ve sus lotes ya registrados; si un lote falla,
    // no queda ninguna muestra creada (revisión r3, hallazgo 10).
    const creadas = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(`SELECT id FROM bpch_internacion WHERE id = $1::uuid FOR UPDATE`, id);
        const ya = await tx.$queryRawUnsafe<{ orden: number; codigo: string | null }[]>(
          `SELECT it.orden, m.codigo FROM bpch_internacion_item it LEFT JOIN muestra m ON m.id = it.muestra_id
            WHERE it.internacion_id = $1::uuid AND it.id = ANY($2::uuid[]) AND it.muestra_id IS NOT NULL ORDER BY it.orden`,
          id,
          dto.items.map((x) => x.id),
        );
        if (ya.length)
          throw new BadRequestException(ya.map((x) => `El lote ${x.orden} ya está registrado como muestra ${x.codigo ?? ""}.`).join(" "));
        const hechas: { lote: number; muestra: string; ensayos: number }[] = [];
        for (const it of dto.items) {
          const actual = porId.get(it.id)!;
          const m = await this.comun.registrarLote(
            req,
            i.ot_id,
            {
              nombre: `Lote ${actual.identificacionLote} · ${actual.elementoEspecifico}`,
              metodoIds: it.metodoIds,
              catElementoId: actual.catElementoId,
              lote: actual.identificacionLote,
            },
            tx,
          );
          await tx.$executeRawUnsafe(`UPDATE bpch_internacion_item SET muestra_id = $2::uuid WHERE id = $1::uuid`, it.id, m.id);
          hechas.push({ lote: actual.orden, muestra: m.codigo, ensayos: m.ensayos });
        }
        return hechas;
      },
      { maxWait: 15_000, timeout: 120_000 },
    );
    return { ...(await this.detalle(req, id)), lotesRegistrados: creadas };
  }

  /* ------------------------------------------------------------------ tasa --- */

  async calcularTasa(req: any, id: string, body: unknown) {
    const tenantId = tenantDe(req);
    const i = await this.cargar(req, id);
    if (!i.sujeta_tasa) throw new ConflictException(`La internación ${i.numero} no está sujeta a la tasa.`);
    if (i.remitida_dco_at) throw new ConflictException("La tasa ya fue remitida a facturación: no se recalcula.");
    if (i.doc_adm_estado !== "conforme")
      throw new ConflictException(`La tasa se calcula con la documentación administrativa conforme (ahora: ${i.doc_adm_estado}).`);
    const dto = TasaBody.parse(body ?? {});
    const prm = await this.comun.parametros(tenantId);
    // Los porcentajes son los del parámetro; otros solo con el permiso de configuración.
    const cambiados = porcentajesTasaCambiados(dto, prm);
    const permisos: string[] = req?.user?.permisos ?? [];
    if (cambiados.length && !(req?.user?.roles ?? []).includes("SUPERADMIN") && !permisos.includes(PERMISO_CONFIGURACION))
      throw new ForbiddenException(
        `Los porcentajes de la tasa los fija Administración › Parámetros (bpch_tasa). Para calcular con ${cambiados.join(" y ")} hace falta el permiso ${PERMISO_CONFIGURACION}; deje los porcentajes vacíos para usar los vigentes.`,
      );
    const entrada = {
      cifUsd: dto.cifUsd,
      paridad: dto.paridad,
      pctAfecto: dto.pctAfecto,
      tasaPct: dto.tasaPct ?? prm.tasaPct ?? NaN,
      ivaPct: dto.ivaPct ?? prm.ivaPct ?? NaN,
    };
    const errores = erroresTasa(entrada);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const r = calcularTasa(entrada);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO calculo_tasa_internacion (tenant_id, ot_id, cliente_id, internacion_id, monto_cif_usd, paridad_usd, monto_cif_clp, pct_afecto,
              tasa_pct, iva_pct, monto_operacion, iva_internacion, total_a_cancelar, calculado_por)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid)`,
      tenantId,
      i.ot_id,
      i.cliente_id,
      id,
      r.cifUsd,
      r.paridad,
      r.cifClp,
      r.pctAfecto,
      r.tasaPct,
      r.ivaPct,
      r.tasa,
      r.iva,
      r.total,
      usuarioDe(req),
    );
    return this.detalle(req, id);
  }

  /**
   * Remite la tasa a facturación: crea la factura pendiente de la OT con la
   * línea de la tasa (o completa la que dejó el cierre de la OT sin líneas).
   * Finanzas la emite con folio en Facturas.
   */
  async remitirFacturacion(req: any, id: string) {
    const tenantId = tenantDe(req);
    const i = await this.cargar(req, id);
    const [tasa, e] = await Promise.all([this.tasa(id), this.comun.estadoOt(i.ot_id)]);
    const final = e?.condicion === "no_cumple" ? e?.incumplimiento : e?.certificado;
    const faltan = faltantesRemision({
      sujetaTasa: i.sujeta_tasa,
      docAdmEstado: i.doc_adm_estado,
      tasaCalculada: Boolean(tasa),
      documentoFinalOficial: Boolean(final && ["oficial", "emitido"].includes(final.estado)),
      yaRemitida: Boolean(i.remitida_dco_at),
    });
    if (faltan.length) throw new ConflictException(`No se puede remitir la tasa de ${i.numero}. ${faltan.join(" ")}`);
    const usuario = usuarioDe(req);
    const prm = await this.comun.parametros(tenantId);
    const ivaPct = Number(tasa.ivaPct ?? prm.ivaPct ?? 19);
    const lineas = [
      {
        descripcion: `Tasa de internación ${Number(tasa.tasaPct).toLocaleString("es-CL")} % · ${i.numero} · Res. DGMN ${i.resolucion_numero} · CIF US$ ${Number(tasa.cifUsd).toLocaleString("es-CL")} × ${Number(tasa.paridad).toLocaleString("es-CL")}${Number(tasa.pctAfecto) !== 100 ? ` × ${tasa.pctAfecto} % afecto` : ""}`.slice(0, 500),
        cantidad: 1,
        precioUnitario: tasa.tasa,
        subtotal: tasa.tasa,
      },
    ];
    const t = totales(lineas, ivaPct, "CLP");
    const obs = `Tasa de internación remitida por BPCH (${i.numero}). Documento final: ${final!.numero ?? ""}.`;
    const ot = await this.comun.ot(tenantId, i.ot_id);
    const facturaId = await this.prisma.$transaction(async (tx) => {
      const [bloq] = await tx.$queryRawUnsafe<{ remitida_dco_at: Date | null }[]>(`SELECT remitida_dco_at FROM bpch_internacion WHERE id = $1::uuid FOR UPDATE`, id);
      if (bloq?.remitida_dco_at) throw new ConflictException("La tasa ya fue remitida a facturación.");
      // Si el cierre de la OT ya dejó una factura pendiente sin líneas, se completa esa.
      const vacia = await tx.factura.findFirst({
        where: { otId: i.ot_id, deletedAt: null, estado: "pendiente", lineas: { none: {} } },
        select: { id: true },
      });
      let fid: string;
      if (vacia) {
        await tx.factura.update({
          where: { id: vacia.id },
          data: { ivaPct, neto: t.neto, ivaMonto: t.ivaMonto, total: t.total, observaciones: obs, lineas: { create: lineas } },
        });
        fid = vacia.id;
      } else {
        const viva = await tx.factura.findFirst({ where: { otId: i.ot_id, deletedAt: null, NOT: { estado: "anulada" } }, select: { numero: true, estado: true } });
        if (viva) throw new ConflictException(`La OT ${ot.codigo} ya tiene la factura ${viva.numero} (${viva.estado}) con importes: revísela en Facturas.`);
        const f = await tx.factura.create({
          data: {
            tenantId,
            numero: numeroBorrador(ot.codigo),
            clienteId: i.cliente_id,
            otId: i.ot_id,
            moneda: "CLP",
            ivaPct,
            neto: t.neto,
            ivaMonto: t.ivaMonto,
            total: t.total,
            estado: "pendiente",
            origen: "tasa_internacion",
            observaciones: obs,
            creadaPor: usuario,
            lineas: { create: lineas },
          },
          select: { id: true },
        });
        fid = f.id;
      }
      await tx.$executeRawUnsafe(
        `UPDATE bpch_internacion SET remitida_dco_at = now(), remitida_dco_por = $2::uuid, factura_id = $3::uuid, updated_by = $2::uuid, updated_at = now() WHERE id = $1::uuid`,
        id,
        usuario,
        fid,
      );
      await tx.$executeRawUnsafe(`UPDATE calculo_tasa_internacion SET factura_id = $2::uuid WHERE id = $1::uuid`, tasa.id, fid);
      return fid;
    });
    const detalle = await this.detalle(req, id);
    return { ...detalle, facturaId };
  }

  /* --------------------------------------------------- Codificación Única --- */

  /**
   * Tras el Certificado de Conformidad oficial, inscribe o actualiza cada
   * producto internado en la Codificación Única (con el certificado asociado).
   */
  async actualizarCodificacion(req: any, id: string, body: unknown) {
    const tenantId = tenantDe(req);
    const i = await this.cargar(req, id);
    const dto = CodificacionBody.parse(body ?? {});
    const e = await this.comun.estadoOt(i.ot_id);
    const cert = e?.certificado;
    if (!cert || !["oficial", "emitido"].includes(cert.estado))
      throw new ConflictException("La Codificación Única se actualiza con el Certificado de Conformidad oficial (firmado).");
    const items = await this.items(id);
    const porId = new Map(items.map((x) => [x.id, x]));
    const avisos: string[] = [];
    const usuario = usuarioDe(req);
    await this.prisma.$transaction(async (tx) => {
      for (const sel of dto.items) {
        const it = porId.get(sel.id);
        if (!it) throw new BadRequestException(`El elemento ${sel.id} no es de esta internación.`);
        let codId: string | null = it.codificacionId;
        // Dentro de la transacción: un CNC inscrito para un lote anterior de esta
        // misma petición (mismo producto nuevo) se ve y se actualiza, no se vuelve
        // a inscribir (revisión r3, hallazgo 3).
        if (!codId && it.cnc) {
          const ya = await this.codificacion.porCnc(tenantId, it.cnc, tx);
          codId = ya?.id ?? null;
        }
        if (codId) {
          const actual = await this.codificacion.uno(tenantId, codId, tx);
          await tx.$executeRawUnsafe(
            `UPDATE bpch_codificacion SET certificado_id = $2::uuid, certificado_numero = NULL, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`,
            codId,
            cert.id,
            usuario,
          );
          await this.codificacion.anotar(tx, {
            tenantId,
            codificacionId: codId,
            evento: "certificacion",
            detalle: { internacion: i.numero, certificado: cert.numero, lote: it.identificacionLote },
            otId: i.ot_id,
            certificadoId: cert.id,
            usuarioId: usuario,
          });
          if (actual.estado === "EN_RECESO")
            avisos.push(`${actual.producto} (${actual.cnc}) está en receso: se asoció el certificado, pero su estado no cambia. Reactívelo en Codificación Única si corresponde.`);
        } else {
          if (!it.cnc) throw new BadRequestException(`Elemento ${it.orden}: indique su código CNC-DGMN para inscribirlo en la Codificación Única.`);
          if (!sel.listado) throw new BadRequestException(`Elemento ${it.orden}: indique el listado (Explosivos o Sustancias químicas) para inscribirlo.`);
          codId = await this.codificacion.inscribir(
            req,
            {
              listado: sel.listado,
              cnc: it.cnc,
              clienteId: i.cliente_id,
              elementoGenerico: it.elementoGenerico,
              producto: it.elementoEspecifico,
              claseDivisionUn: it.claseDivisionUn,
              numeroUn: it.numeroUn,
              catElementoId: it.catElementoId,
            },
            tx,
            { evento: "alta_certificacion", otId: i.ot_id, certificadoId: cert.id },
          );
        }
        await tx.$executeRawUnsafe(`UPDATE bpch_internacion_item SET codificacion_id = $2::uuid, cnc_dgmn = COALESCE(cnc_dgmn, $3) WHERE id = $1::uuid`, it.id, codId, it.cnc);
      }
    });
    return { ...(await this.detalle(req, id)), avisos };
  }

  /** Comprueba si un CNC ya está codificado (ayuda del formulario). */
  async buscarCnc(req: any, cnc: string) {
    return { normalizado: normalizarCnc(cnc), producto: await this.codificacion.porCnc(tenantDe(req), cnc) };
  }
}
