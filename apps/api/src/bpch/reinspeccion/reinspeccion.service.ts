import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../../common/prisma.service";
import { BpchComunService, tenantDe, usuarioDe } from "../comun/bpch-comun.service";
import { OtDesdeProcesoService } from "../ot-desde-proceso.service";
import { CodificacionService } from "../codificacion/codificacion.service";
import { condicionFinal, erroresLote, erroresLoteParaMuestra, erroresReinspeccion } from "../comun/reglas-bpch";

const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const texto = (max: number) => z.string().trim().max(max);
const opcional = (max: number) => texto(max).optional().nullable();
const uuidOpt = z.string().uuid().optional().nullable();

export const AntecedenteQuery = z.object({
  otId: uuidOpt,
  certificadoId: uuidOpt,
  codificacionId: uuidOpt,
  cnc: opcional(80),
});

export const SolicitudBody = z.object({
  motivo: texto(30),
  motivoDetalle: opcional(4000),
  solicitadoPor: texto(160),
  documentoSolicitud: opcional(120),
  fechaSolicitud: fechaDia,
  origenOtId: uuidOpt,
  certificadoOrigenId: uuidOpt,
  codificacionId: uuidOpt,
  cnc: opcional(80),
  clienteId: uuidOpt,
  empresaDestino: opcional(200),
  clienteDestinoId: uuidOpt,
  esquema: z.enum(["LOTES", "TIPO"]).optional(),
  procedimiento: opcional(40),
  unidadInspeccionId: z.string().uuid({ message: "Indique la sucursal o delegación que inspecciona" }),
  conCobro: z.boolean({ required_error: "Indique si la reinspección tiene cobro" }),
  elementoGenerico: opcional(240),
  elementoEspecifico: opcional(240),
  claseDivisionUn: opcional(20),
  numeroUn: opcional(10),
  catElementoId: uuidOpt,
  identificacionLote: opcional(80),
  tamanoLote: z.number().int().optional().nullable(),
  tamanoMuestra: z.number().int().optional().nullable(),
});

const InspeccionBody = z.object({
  lugarInspeccion: opcional(240),
  fechaInspeccion: fechaDia.optional().nullable(),
  inspectores: opcional(240),
  fechaVencimientoProducto: fechaDia.optional().nullable(),
  vigenciaInforme: fechaDia.optional().nullable(),
  observaciones: opcional(4000),
  procedimiento: opcional(40),
  identificacionLote: opcional(80),
  tamanoLote: z.number().int().optional().nullable(),
  tamanoMuestra: z.number().int().optional().nullable(),
});

const LoteBody = z.object({ metodoIds: z.array(z.string().uuid()).min(1, "Elija al menos un ensayo").max(200) });

const TrazabilidadBody = z.object({
  cambiarTitular: z.boolean().default(false),
  motivo: opcional(500),
});

export const FiltroReinspecciones = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * Reinspección BPCH: nueva inspección de un producto o lote ya inspeccionado
 * (rechazado, vencido, traspasado…), ligada a la OT, el certificado o el
 * código original, de los que hereda los antecedentes. Usa el flujo general
 * de la OT y cierra con el Informe de Inspección (SAC-PG05, no entregado).
 */
@Injectable()
export class ReinspeccionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comun: BpchComunService,
    private readonly ots: OtDesdeProcesoService,
    private readonly codificacion: CodificacionService,
  ) {}

  /* ------------------------------------------------------------ antecedente --- */

  /**
   * Lo que se hereda del antecedente original: titular, producto, código,
   * clase UN, elemento del catálogo, lote y condición de la inspección anterior.
   * Lo usa el formulario (vista previa) y el registro (valores por defecto).
   */
  async antecedente(req: any, q: z.infer<typeof AntecedenteQuery>) {
    const tenantId = tenantDe(req);
    const out: any = { ot: null, certificado: null, codificacion: null, internacion: null, propuesta: {} };
    let otId = q.otId ?? null;

    if (q.certificadoId) {
      const [c] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT c.id, c.numero, c.estado, c.tipo_documento AS "tipoDocumento", c.ot_id AS "otId", c.oficial_at AS "oficialAt"
           FROM certificado c WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid AND c.deleted_at IS NULL`,
        q.certificadoId,
        tenantId,
      );
      if (!c || !c.otId) throw new BadRequestException("El certificado original indicado no existe.");
      out.certificado = c;
      if (otId && otId !== c.otId) throw new BadRequestException("El certificado original no es de la OT original indicada.");
      otId = c.otId;
    }

    if (otId) {
      const [o] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT o.id, o.codigo, o.estado, o.cliente_id AS "clienteId", o.unidad_principal AS "unidadId", o.origen_trabajo AS "origenTrabajo",
                o.cat_elemento_id AS "catElementoId", o.elemento_generico AS "elementoGenerico",
                cl.razon_social AS "clienteNombre", cl.rut AS "clienteRut", u.codigo AS "unidadCodigo"
           FROM orden_trabajo o JOIN cliente cl ON cl.id = o.cliente_id LEFT JOIN unidad u ON u.id = o.unidad_principal
          WHERE o.id = $1::uuid AND o.tenant_id = $2::uuid`,
        otId,
        tenantId,
      );
      if (!o) throw new BadRequestException("La OT original indicada no existe.");
      const ramas = await this.comun.unidadesInspeccion(tenantId);
      if (!o.unidadId || !ramas.some((u) => u.id === o.unidadId))
        throw new BadRequestException(`La OT ${o.codigo} no es del Banco de Pruebas de Chile: no se puede reinspeccionar desde aquí.`);
      // Sus antecedentes solo los hereda quien tiene esa unidad en su alcance (o la SCC / globales).
      await this.comun.exigirExpediente(req, o.unidadId, `la OT ${o.codigo}`);
      const veredictos = await this.prisma.$queryRawUnsafe<{ veredicto: string | null; numero_lote: string | null }[]>(
        `SELECT veredicto, numero_lote FROM muestra WHERE ot_id = $1::uuid AND deleted_at IS NULL ORDER BY codigo`,
        o.id,
      );
      out.ot = { ...o, condicion: condicionFinal(veredictos.map((v) => v.veredicto)) };
      out.documentos = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT c.id, c.numero, c.tipo_documento AS "tipoDocumento", c.estado
           FROM certificado c WHERE c.ot_id = $1::uuid AND c.deleted_at IS NULL AND c.estado IN ('oficial', 'emitido')
          ORDER BY c.created_at`,
        o.id,
      );
      const [int] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT i.id, i.numero, i.procedimiento, i.esquema FROM bpch_internacion i WHERE i.ot_id = $1::uuid`,
        o.id,
      );
      if (int) {
        const items = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT codificacion_id AS "codificacionId", cat_elemento_id AS "catElementoId", elemento_generico AS "elementoGenerico",
                  elemento_especifico AS "elementoEspecifico", cnc_dgmn AS cnc, clase_division_un AS "claseDivisionUn", numero_un AS "numeroUn",
                  identificacion_lote AS "identificacionLote", tamano_lote AS "tamanoLote"
             FROM bpch_internacion_item WHERE internacion_id = $1::uuid ORDER BY orden`,
          int.id,
        );
        out.internacion = { ...int, items };
      }
      const [previa] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT r.codificacion_id AS "codificacionId", r.cat_elemento_id AS "catElementoId", r.elemento_generico AS "elementoGenerico",
                r.elemento_especifico AS "elementoEspecifico", r.cnc_dgmn AS cnc, r.clase_division_un AS "claseDivisionUn", r.numero_un AS "numeroUn",
                r.identificacion_lote AS "identificacionLote", r.tamano_lote AS "tamanoLote", r.procedimiento, r.esquema
           FROM bpch_reinspeccion r WHERE r.ot_id = $1::uuid`,
        o.id,
      );
      const item = out.internacion?.items?.[0] ?? previa ?? null;
      out.propuesta = {
        clienteId: o.clienteId,
        clienteNombre: o.clienteNombre,
        catElementoId: item?.catElementoId ?? o.catElementoId,
        elementoGenerico: item?.elementoGenerico ?? o.elementoGenerico,
        elementoEspecifico: item?.elementoEspecifico ?? null,
        cnc: item?.cnc ?? null,
        claseDivisionUn: item?.claseDivisionUn ?? null,
        numeroUn: item?.numeroUn ?? null,
        identificacionLote: item?.identificacionLote ?? null,
        tamanoLote: item?.tamanoLote ?? null,
        codificacionId: item?.codificacionId ?? null,
        unidadInspeccionId: o.unidadId,
        esquema: previa?.esquema ?? out.internacion?.esquema ?? null,
      };
      if (out.internacion?.items?.length > 1)
        out.aviso = `La internación ${out.internacion.numero} tiene ${out.internacion.items.length} elementos: se propone el primero; ajuste el producto y el lote a reinspeccionar.`;
    }

    const codId = q.codificacionId ?? out.propuesta.codificacionId ?? null;
    const cod = codId ? await this.codificacion.uno(tenantId, codId) : q.cnc?.trim() ? await this.codificacion.porCnc(tenantId, q.cnc) : null;
    if (q.cnc?.trim() && !cod) out.cncNoCodificado = true;
    if (cod) {
      out.codificacion = cod;
      out.propuesta = {
        ...out.propuesta,
        codificacionId: cod.id,
        cnc: out.propuesta.cnc ?? cod.cnc,
        elementoEspecifico: out.propuesta.elementoEspecifico ?? cod.producto,
        elementoGenerico: out.propuesta.elementoGenerico ?? cod.elementoGenerico,
        claseDivisionUn: out.propuesta.claseDivisionUn ?? cod.claseDivisionUn,
        numeroUn: out.propuesta.numeroUn ?? cod.numeroUn,
        catElementoId: out.propuesta.catElementoId ?? cod.catElementoId,
        clienteId: out.propuesta.clienteId ?? cod.clienteId,
        clienteNombre: out.propuesta.clienteNombre ?? cod.fabricanteNombre,
      };
    }
    return out;
  }

  /* ---------------------------------------------------------------- lectura --- */

  async listar(req: any, f: z.infer<typeof FiltroReinspecciones>) {
    const tenantId = tenantDe(req);
    const args: unknown[] = [tenantId];
    const p = (v: unknown) => (args.push(v), `$${args.length}`);
    const where = [`r.tenant_id = $1::uuid`];
    const filtro = await this.comun.filtroExpedientes(req);
    if (filtro !== null) where.push(`r.unidad_inspeccion_id = ANY(${p(filtro)}::uuid[])`);
    if (f.q) {
      const q = p(`%${f.q}%`);
      where.push(`(r.numero ILIKE ${q} OR r.elemento_especifico ILIKE ${q} OR r.cnc_dgmn ILIKE ${q} OR cl.razon_social ILIKE ${q} OR o.codigo ILIKE ${q} OR oo.codigo ILIKE ${q})`);
    }
    const limit = f.limit ?? 50;
    const page = f.page ?? 1;
    const desde = `FROM bpch_reinspeccion r JOIN cliente cl ON cl.id = r.cliente_id JOIN unidad u ON u.id = r.unidad_inspeccion_id
                   LEFT JOIN orden_trabajo o ON o.id = r.ot_id LEFT JOIN orden_trabajo oo ON oo.id = r.origen_ot_id
                   WHERE ${where.join(" AND ")}`;
    const [{ total }] = await this.prisma.$queryRawUnsafe<{ total: number }[]>(`SELECT count(*)::int AS total ${desde}`, ...args);
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id, r.numero, r.estado, r.motivo, r.fecha_solicitud AS "fechaSolicitud", r.elemento_especifico AS "elementoEspecifico",
              r.cnc_dgmn AS cnc, cl.razon_social AS empresa, u.codigo AS "unidadCodigo", o.id AS "otId", o.codigo AS "otCodigo", o.estado AS "otEstado",
              oo.codigo AS "origenOtCodigo", r.trazabilidad_at AS "trazabilidadAt", r.created_at AS "createdAt"
         ${desde} ORDER BY r.created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      ...args,
    );
    return { data, meta: { page, limit, total: Number(total), totalPages: Math.max(1, Math.ceil(Number(total) / limit)) } };
  }

  private async cargar(req: any, id: string) {
    const [r] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.*, cl.razon_social AS empresa, cl.rut AS empresa_rut, u.codigo AS unidad_codigo, u.nombre AS unidad_nombre,
              oo.codigo AS origen_ot_codigo, co.numero AS certificado_origen_numero, cd.razon_social AS destino_nombre
         FROM bpch_reinspeccion r
         JOIN cliente cl ON cl.id = r.cliente_id
         JOIN unidad u ON u.id = r.unidad_inspeccion_id
         LEFT JOIN orden_trabajo oo ON oo.id = r.origen_ot_id
         LEFT JOIN certificado co ON co.id = r.certificado_origen_id
         LEFT JOIN cliente cd ON cd.id = r.cliente_destino_id
        WHERE r.id = $1::uuid AND r.tenant_id = $2::uuid`,
      id,
      tenantDe(req),
    );
    if (!r) throw new NotFoundException("Reinspección no encontrada.");
    await this.comun.exigirExpediente(req, r.unidad_inspeccion_id, `la reinspección ${r.numero}`);
    return r;
  }

  async detalle(req: any, id: string) {
    const r = await this.cargar(req, id);
    const [estadoOt, cod, motivos] = await Promise.all([
      this.comun.estadoOt(r.ot_id),
      r.codificacion_id ? this.codificacion.uno(tenantDe(req), r.codificacion_id).catch(() => null) : null,
      this.comun.parametros(tenantDe(req)).then((p) => p.motivosReinspeccion),
    ]);
    const informe = estadoOt?.informeInspeccion;
    const oficial = informe && ["oficial", "emitido"].includes(informe.estado);
    const res = estadoOt?.resultados;
    type Estado = "hecho" | "en_curso" | "pendiente" | "no_aplica";
    const f = (clave: string, titulo: string, estado: Estado, detalle?: string | null) => ({ clave, titulo, estado, detalle: detalle ?? null });
    return {
      id: r.id,
      numero: r.numero,
      estado: r.estado,
      motivo: r.motivo,
      motivoEtiqueta: motivos.find((m) => m.codigo === r.motivo)?.etiqueta ?? r.motivo,
      motivoDetalle: r.motivo_detalle,
      solicitadoPor: r.solicitado_por,
      documentoSolicitud: r.documento_solicitud,
      fechaSolicitud: r.fecha_solicitud,
      origenOt: r.origen_ot_id ? { id: r.origen_ot_id, codigo: r.origen_ot_codigo } : null,
      certificadoOrigen: r.certificado_origen_id ? { id: r.certificado_origen_id, numero: r.certificado_origen_numero } : null,
      codificacion: cod,
      cliente: { id: r.cliente_id, razonSocial: r.empresa, rut: r.empresa_rut },
      empresaDestino: r.destino_nombre ?? r.empresa_destino,
      clienteDestinoId: r.cliente_destino_id,
      esquema: r.esquema,
      procedimiento: r.procedimiento,
      unidad: { id: r.unidad_inspeccion_id, codigo: r.unidad_codigo, nombre: r.unidad_nombre },
      conCobro: r.con_cobro,
      producto: {
        elementoGenerico: r.elemento_generico,
        elementoEspecifico: r.elemento_especifico,
        cnc: r.cnc_dgmn,
        claseDivisionUn: r.clase_division_un,
        numeroUn: r.numero_un,
        catElementoId: r.cat_elemento_id,
      },
      lote: { identificacion: r.identificacion_lote, tamanoLote: r.tamano_lote, tamanoMuestra: r.tamano_muestra, muestraId: r.muestra_id },
      inspeccion: {
        lugar: r.lugar_inspeccion,
        fecha: r.fecha_inspeccion,
        inspectores: r.inspectores,
        vencimientoProducto: r.fecha_vencimiento_producto,
        vigenciaInforme: r.vigencia_informe,
        observaciones: r.observaciones_inspeccion,
      },
      otId: r.ot_id,
      trazabilidadAt: r.trazabilidad_at,
      createdAt: r.created_at,
      estadoOt,
      fases: [
        f("solicitud", "Solicitud de reinspección", "hecho", r.numero),
        f("lote", "OT y lote a inspeccionar", r.muestra_id ? "hecho" : "en_curso", estadoOt?.ot?.codigo),
        f("resultados", "Resultados de la inspección", res && res.total > 0 && res.aprobados === res.total ? "hecho" : res && res.capturados > 0 ? "en_curso" : "pendiente", res ? `${res.aprobados}/${res.total} aprobados` : null),
        f("informe", "Informe de Inspección (reinspección)", oficial ? (informe!.entregadoAt ? "hecho" : "en_curso") : informe ? "en_curso" : "pendiente", informe?.numero ?? (estadoOt ? `Condición: ${estadoOt.condicionTexto}` : null)),
        f("trazabilidad", "Trazabilidad en Codificación Única", r.trazabilidad_at ? "hecho" : r.codificacion_id ? "pendiente" : "no_aplica"),
        f("cierre", "Cierre de la OT", estadoOt?.ot?.estado === "cerrada" ? "hecho" : "pendiente", estadoOt?.ot?.estado),
      ],
    };
  }

  /* --------------------------------------------------------------- registro --- */

  async registrar(req: any, body: unknown) {
    const tenantId = tenantDe(req);
    const dto = SolicitudBody.parse(body ?? {});
    const ant = await this.antecedente(req, {
      otId: dto.origenOtId,
      certificadoId: dto.certificadoOrigenId,
      codificacionId: dto.codificacionId,
      cnc: dto.codificacionId ? null : dto.cnc,
    });
    const prop = ant.propuesta ?? {};
    const prm = await this.comun.parametros(tenantId);
    const d = {
      clienteId: dto.clienteId ?? prop.clienteId ?? null,
      catElementoId: dto.catElementoId ?? prop.catElementoId ?? null,
      elementoGenerico: dto.elementoGenerico?.trim() || prop.elementoGenerico || null,
      elementoEspecifico: dto.elementoEspecifico?.trim() || prop.elementoEspecifico || null,
      cnc: dto.cnc?.trim() || prop.cnc || null,
      claseDivisionUn: dto.claseDivisionUn?.trim() || prop.claseDivisionUn || null,
      numeroUn: dto.numeroUn?.trim() || prop.numeroUn || null,
      identificacionLote: dto.identificacionLote?.trim() || prop.identificacionLote || null,
      tamanoLote: dto.tamanoLote ?? null,
      tamanoMuestra: dto.tamanoMuestra ?? null,
      codificacionId: ant.codificacion?.id ?? null,
    };
    const errores = erroresReinspeccion({
      motivo: dto.motivo,
      motivosValidos: prm.motivosReinspeccion.map((m) => m.codigo),
      motivoDetalle: dto.motivoDetalle,
      solicitadoPor: dto.solicitadoPor,
      fechaSolicitud: dto.fechaSolicitud,
      origenOtId: ant.ot?.id ?? null,
      certificadoOrigenId: ant.certificado?.id ?? null,
      codificacionId: d.codificacionId,
      cnc: dto.cnc,
      cncEnCodificacion: dto.cnc?.trim() ? Boolean(ant.codificacion) : undefined,
      elementoEspecifico: d.elementoEspecifico,
    });
    errores.push(...erroresLote(d));
    if (!d.clienteId) errores.push("Indique la empresa titular (no se pudo heredar del antecedente).");
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.comun.cliente(tenantId, d.clienteId!);
    if (dto.clienteDestinoId) await this.comun.cliente(tenantId, dto.clienteDestinoId);
    if (d.catElementoId) await this.comun.catElemento(tenantId, d.catElementoId);
    const unidad = await this.comun.validarUnidadInspeccion(tenantId, dto.unidadInspeccionId);
    await this.comun.exigirExpediente(req, unidad.id, "la reinspección");
    const usuario = usuarioDe(req);
    const id = await this.prisma.$transaction(async (tx) => {
      const numero = await this.ots.correlativo(tx, tenantId, "REI");
      const motivo = prm.motivosReinspeccion.find((m) => m.codigo === dto.motivo)?.etiqueta ?? dto.motivo;
      const ot = await this.ots.crearOt(tx, {
        tenantId,
        clienteId: d.clienteId!,
        unidad,
        origen: "REINSPECCION",
        resolucion: null,
        conCobro: dto.conCobro,
        descripcion: `Reinspección ${numero} · ${motivo} · ${d.elementoEspecifico}${ant.ot ? ` · OT original ${ant.ot.codigo}` : ""}${ant.certificado ? ` · certificado ${ant.certificado.numero}` : ""}`.slice(0, 4000),
        tipoTrabajo: "REINSPECCION",
        elementoGenerico: d.elementoGenerico,
        catElementoId: d.catElementoId,
        usuarioId: usuario,
        tipoHistorial: "bpch_reinspeccion",
        detalleHistorial: { reinspeccion: numero, motivo: dto.motivo, origenOt: ant.ot?.codigo ?? null, certificado: ant.certificado?.numero ?? null },
      });
      const [fila] = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO bpch_reinspeccion (tenant_id, numero, motivo, motivo_detalle, solicitado_por, documento_solicitud, fecha_solicitud,
                origen_ot_id, certificado_origen_id, codificacion_id, internacion_origen_id, cliente_id, empresa_destino, cliente_destino_id,
                esquema, procedimiento, unidad_inspeccion_id, con_cobro, elemento_generico, elemento_especifico, cnc_dgmn, clase_division_un,
                numero_un, cat_elemento_id, identificacion_lote, tamano_lote, tamano_muestra, ot_id, created_by, updated_by)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::date, $8::uuid, $9::uuid, $10::uuid, $11::uuid, $12::uuid, $13, $14::uuid, $15, $16,
                 $17::uuid, $18, $19, $20, $21, $22, $23, $24::uuid, $25, $26, $27, $28::uuid, $29::uuid, $29::uuid)
         RETURNING id`,
        tenantId,
        numero,
        dto.motivo,
        dto.motivoDetalle?.trim() || null,
        dto.solicitadoPor.trim(),
        dto.documentoSolicitud?.trim() || null,
        dto.fechaSolicitud,
        ant.ot?.id ?? null,
        ant.certificado?.id ?? null,
        d.codificacionId,
        ant.internacion?.id ?? null,
        d.clienteId,
        dto.empresaDestino?.trim() || null,
        dto.clienteDestinoId ?? null,
        dto.esquema ?? prop.esquema ?? "TIPO",
        dto.procedimiento?.trim() || null,
        unidad.id,
        dto.conCobro,
        d.elementoGenerico,
        d.elementoEspecifico,
        d.cnc,
        d.claseDivisionUn,
        d.numeroUn,
        d.catElementoId,
        d.identificacionLote,
        d.tamanoLote,
        d.tamanoMuestra,
        ot.id,
        usuario,
      );
      return fila.id;
    });
    return this.detalle(req, id);
  }

  private exigirOtAbierta(r: any, e: Awaited<ReturnType<BpchComunService["estadoOt"]>>) {
    if (r.estado === "anulada") throw new ConflictException(`La reinspección ${r.numero} está anulada.`);
    if (!e) throw new ConflictException(`La reinspección ${r.numero} no tiene OT.`);
    if (["cerrada", "anulada"].includes(e.ot.estado)) throw new ConflictException(`La OT ${e.ot.codigo} está ${e.ot.estado}.`);
  }

  async inspeccion(req: any, id: string, body: unknown) {
    const r = await this.cargar(req, id);
    const dto = InspeccionBody.parse(body ?? {});
    this.exigirOtAbierta(r, await this.comun.estadoOt(r.ot_id));
    const lote = {
      identificacionLote: dto.identificacionLote === undefined ? r.identificacion_lote : dto.identificacionLote,
      tamanoLote: dto.tamanoLote === undefined ? r.tamano_lote : dto.tamanoLote,
      tamanoMuestra: dto.tamanoMuestra === undefined ? r.tamano_muestra : dto.tamanoMuestra,
    };
    const errores = erroresLote(lote);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_reinspeccion SET lugar_inspeccion = $2, fecha_inspeccion = $3::date, inspectores = $4, fecha_vencimiento_producto = $5::date,
              vigencia_informe = $6::date, observaciones_inspeccion = $7, procedimiento = COALESCE($8, procedimiento),
              identificacion_lote = $9, tamano_lote = $10, tamano_muestra = $11, updated_by = $12::uuid, updated_at = now()
        WHERE id = $1::uuid`,
      id,
      dto.lugarInspeccion?.trim() || null,
      dto.fechaInspeccion ?? null,
      dto.inspectores?.trim() || null,
      dto.fechaVencimientoProducto ?? null,
      dto.vigenciaInforme ?? null,
      dto.observaciones?.trim() || null,
      dto.procedimiento?.trim() || null,
      lote.identificacionLote?.trim() || null,
      lote.tamanoLote ?? null,
      lote.tamanoMuestra ?? null,
      usuarioDe(req),
    );
    if (r.muestra_id && lote.identificacionLote?.trim())
      await this.prisma.$executeRawUnsafe(`UPDATE muestra SET numero_lote = $2 WHERE id = $1::uuid`, r.muestra_id, lote.identificacionLote.trim().slice(0, 80));
    return this.detalle(req, id);
  }

  async lote(req: any, id: string, body: unknown) {
    const r = await this.cargar(req, id);
    const dto = LoteBody.parse(body ?? {});
    this.exigirOtAbierta(r, await this.comun.estadoOt(r.ot_id));
    if (r.muestra_id) throw new ConflictException("El lote ya está registrado como muestra de la OT.");
    const errores = erroresLoteParaMuestra({ identificacionLote: r.identificacion_lote, tamanoLote: r.tamano_lote, tamanoMuestra: r.tamano_muestra });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    // Con la fila de la reinspección bloqueada: un doble envío no crea dos muestras (hallazgo 10).
    await this.prisma.$transaction(
      async (tx) => {
        const [fila] = await tx.$queryRawUnsafe<{ muestra_id: string | null }[]>(
          `SELECT muestra_id FROM bpch_reinspeccion WHERE id = $1::uuid FOR UPDATE`,
          id,
        );
        if (fila?.muestra_id) throw new ConflictException("El lote ya está registrado como muestra de la OT.");
        const m = await this.comun.registrarLote(
          req,
          r.ot_id,
          {
            nombre: `Lote ${r.identificacion_lote} · ${r.elemento_especifico} (reinspección)`,
            metodoIds: dto.metodoIds,
            catElementoId: r.cat_elemento_id,
            lote: r.identificacion_lote,
          },
          tx,
        );
        await tx.$executeRawUnsafe(`UPDATE bpch_reinspeccion SET muestra_id = $2::uuid, updated_at = now() WHERE id = $1::uuid`, id, m.id);
      },
      { maxWait: 15_000, timeout: 120_000 },
    );
    return this.detalle(req, id);
  }

  /**
   * Con el Informe de Inspección oficial, deja la reinspección en el historial
   * del producto en la Codificación Única y, si se pide (traspaso), cambia el
   * titular. El cambio de titular exige además `bpch.codificacion.gestionar`.
   */
  async trazabilidad(req: any, id: string, body: unknown) {
    const tenantId = tenantDe(req);
    const r = await this.cargar(req, id);
    const dto = TrazabilidadBody.parse(body ?? {});
    if (r.trazabilidad_at) throw new ConflictException("La trazabilidad de esta reinspección ya está registrada.");
    if (!r.codificacion_id) throw new ConflictException("La reinspección no está ligada a un producto de la Codificación Única.");
    const e = await this.comun.estadoOt(r.ot_id);
    const informe = e?.informeInspeccion;
    if (!informe || !["oficial", "emitido"].includes(informe.estado))
      throw new ConflictException("La trazabilidad se registra con el Informe de Inspección de la reinspección oficial (firmado).");
    if (dto.cambiarTitular) {
      const permisos: string[] = req?.user?.permisos ?? [];
      const roles: string[] = req?.user?.roles ?? [];
      if (!roles.includes("SUPERADMIN") && !permisos.includes("bpch.codificacion.gestionar"))
        throw new ForbiddenException("Cambiar el titular en la Codificación Única requiere el permiso bpch.codificacion.gestionar.");
      if (!r.cliente_destino_id && !r.empresa_destino) throw new BadRequestException("La reinspección no indica la empresa de destino del traspaso.");
      if (!dto.motivo || dto.motivo.length < 5) throw new BadRequestException("Indique el motivo del cambio de titular (mínimo 5 caracteres).");
    }
    await this.prisma.$transaction(async (tx) => {
      await this.codificacion.anotar(tx, {
        tenantId,
        codificacionId: r.codificacion_id,
        evento: "reinspeccion",
        detalle: { reinspeccion: r.numero, motivo: r.motivo, informe: informe.numero, condicion: e!.condicionTexto, destino: r.empresa_destino ?? null },
        otId: r.ot_id,
        certificadoId: informe.id,
        usuarioId: usuarioDe(req),
      });
      if (dto.cambiarTitular)
        await this.codificacion.cambiarTitular(
          req,
          r.codificacion_id,
          { clienteId: r.cliente_destino_id, fabricanteNombre: r.cliente_destino_id ? null : r.empresa_destino, motivo: dto.motivo, reinspeccionId: r.id },
          tx,
        );
      await tx.$executeRawUnsafe(`UPDATE bpch_reinspeccion SET trazabilidad_at = now(), updated_by = $2::uuid, updated_at = now() WHERE id = $1::uuid`, id, usuarioDe(req));
    });
    return this.detalle(req, id);
  }
}
