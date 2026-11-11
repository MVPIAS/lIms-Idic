/**
 * Requerimiento BPCH · OT sin cotización (Reunión 11, 06-11-2026).
 *   borrador ──validar (otra jefatura)──▶ validado + OT derivada a la sucursal
 *       └──anular (motivo)──▶ anulado
 * La OT nace con OtDesdeProcesoService (correlativo, laboratorio responsable =
 * la sucursal de destino, plazo y historial); de ahí sigue el flujo general:
 * la sucursal registra lotes e inspección y cierra con el informe.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../../common/prisma.service";
import { hoyCl } from "../../ot/plazos";
import { BpchComunService, tenantDe, usuarioDe } from "../comun/bpch-comun.service";
import { OtDesdeProcesoService } from "../ot-desde-proceso.service";
import { ESCALONES, descripcionOt, erroresRequerimiento, motivoNoValidable, type Escalon } from "./reglas-requerimiento";

const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const opcional = (max: number) => z.string().trim().max(max).optional().nullable();

export const RequerimientoBody = z.object({
  escalon: z.enum(ESCALONES, { errorMap: () => ({ message: "Indique el escalón o unidad que elabora el requerimiento." }) }),
  clienteId: z.string().uuid({ message: "Elija la empresa." }),
  plantaIds: z.array(z.string().uuid()).max(50).default([]),
  docOrigenTipo: z.enum(["oficio", "rpi"], { errorMap: () => ({ message: "Indique si el documento de origen es un oficio o un RPI." }) }),
  docOrigenNumero: z.string().trim().max(80),
  docOrigenFecha: fechaDia,
  asistenciaTecnica: z.boolean().default(false),
  instrucciones: opcional(4000),
  conCobro: z.boolean({ required_error: "Indique si la OT tiene cobro." }),
  sinCobroComunicacion: opcional(2000),
  sinCobroNumero: opcional(80),
  tecnico: opcional(160),
  unidadDestinoId: z.string().uuid({ message: "Elija la sucursal o delegación a la que se deriva la OT." }),
  catElementoId: z.string().uuid().optional().nullable(),
  elementoGenerico: opcional(240),
});

export const FiltroRequerimientos = z.object({
  q: z.string().trim().max(120).optional(),
  estado: z.enum(["borrador", "validado", "anulado"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const SELECT = `
  SELECT r.id, r.numero, r.escalon, r.estado, r.cliente_id AS "clienteId", cl.razon_social AS empresa, cl.rut AS "empresaRut",
         r.planta_ids AS "plantaIds", r.doc_origen_tipo AS "docOrigenTipo", r.doc_origen_numero AS "docOrigenNumero",
         r.doc_origen_fecha::text AS "docOrigenFecha", r.asistencia_tecnica AS "asistenciaTecnica", r.instrucciones,
         r.con_cobro AS "conCobro", r.sin_cobro_comunicacion AS "sinCobroComunicacion", r.sin_cobro_numero AS "sinCobroNumero",
         r.tecnico, r.unidad_destino_id AS "unidadDestinoId", u.codigo AS "unidadCodigo", u.nombre AS "unidadNombre",
         r.cat_elemento_id AS "catElementoId", r.elemento_generico AS "elementoGenerico",
         r.validado_por AS "validadoPor", r.validado_at AS "validadoAt", r.anulado_motivo AS "anuladoMotivo",
         r.ot_id AS "otId", o.codigo AS "otCodigo", o.estado AS "otEstado",
         r.created_by AS "createdBy", r.created_at AS "createdAt",
         uc.nombre_completo AS "elaboradoPor", uv.nombre_completo AS "validadoPorNombre"
    FROM bpch_requerimiento r
    JOIN cliente cl ON cl.id = r.cliente_id
    LEFT JOIN unidad u ON u.id = r.unidad_destino_id
    LEFT JOIN orden_trabajo o ON o.id = r.ot_id
    LEFT JOIN usuario uc ON uc.id = r.created_by
    LEFT JOIN usuario uv ON uv.id = r.validado_por`;

@Injectable()
export class RequerimientoBpchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comun: BpchComunService,
    private readonly ots: OtDesdeProcesoService,
  ) {}

  async listar(req: any, f: z.infer<typeof FiltroRequerimientos>) {
    const tenantId = tenantDe(req);
    const filtro = await this.comun.filtroExpedientes(req);
    const params: unknown[] = [tenantId];
    let where = "WHERE r.tenant_id = $1::uuid";
    if (filtro) {
      params.push(filtro);
      where += ` AND r.unidad_destino_id = ANY($${params.length}::uuid[])`;
    }
    if (f.estado) {
      params.push(f.estado);
      where += ` AND r.estado = $${params.length}`;
    }
    if (f.q) {
      params.push(`%${f.q}%`);
      where += ` AND (r.numero ILIKE $${params.length} OR cl.razon_social ILIKE $${params.length} OR r.doc_origen_numero ILIKE $${params.length} OR o.codigo ILIKE $${params.length})`;
    }
    const data = await this.prisma.$queryRawUnsafe<any[]>(`${SELECT} ${where} ORDER BY r.created_at DESC LIMIT ${f.limit ?? 100}`, ...params);
    return { data };
  }

  async detalle(req: any, id: string) {
    const tenantId = tenantDe(req);
    const [r] = await this.prisma.$queryRawUnsafe<any[]>(`${SELECT} WHERE r.id = $1::uuid AND r.tenant_id = $2::uuid`, id, tenantId);
    if (!r) throw new NotFoundException("Requerimiento no encontrado.");
    await this.comun.exigirExpediente(req, r.unidadDestinoId, `el requerimiento ${r.numero}`);
    const plantas = r.plantaIds?.length
      ? await this.prisma.planta.findMany({ where: { id: { in: r.plantaIds } }, select: { id: true, codigo: true, nombre: true, direccion: true, ciudad: true } })
      : [];
    return { ...r, plantas, puedeValidar: motivoNoValidable(r, usuarioDe(req)) };
  }

  private async validarDatos(tenantId: string, d: z.infer<typeof RequerimientoBody>) {
    await this.comun.cliente(tenantId, d.clienteId);
    const plantas = await this.prisma.planta.findMany({ where: { clienteId: d.clienteId }, select: { id: true } });
    const errores = erroresRequerimiento(
      {
        docOrigenTipo: d.docOrigenTipo,
        docOrigenNumero: d.docOrigenNumero,
        docOrigenFecha: d.docOrigenFecha,
        conCobro: d.conCobro,
        sinCobroComunicacion: d.sinCobroComunicacion,
        sinCobroNumero: d.sinCobroNumero,
        plantaIds: d.plantaIds,
        plantasEmpresa: plantas.map((p) => p.id),
      },
      hoyCl(),
    );
    if (errores.length) throw new BadRequestException(errores.join(" "));
    if (d.catElementoId) await this.comun.catElemento(tenantId, d.catElementoId);
    return this.comun.validarUnidadInspeccion(tenantId, d.unidadDestinoId);
  }

  /** 1 · Elaborar (borrador). */
  async crear(req: any, body: unknown) {
    const tenantId = tenantDe(req);
    const d = RequerimientoBody.parse(body ?? {});
    const unidad = await this.validarDatos(tenantId, d);
    await this.comun.exigirExpediente(req, unidad.id, "el requerimiento");
    const usuario = usuarioDe(req);
    const id = await this.prisma.$transaction(async (tx) => {
      const numero = await this.ots.correlativo(tx, tenantId, "REQ");
      const [f] = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO bpch_requerimiento (tenant_id, numero, escalon, cliente_id, planta_ids, doc_origen_tipo, doc_origen_numero, doc_origen_fecha,
                asistencia_tecnica, instrucciones, con_cobro, sin_cobro_comunicacion, sin_cobro_numero, tecnico, unidad_destino_id,
                cat_elemento_id, elemento_generico, created_by, updated_by)
         VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid[], $6, $7, $8::date, $9, $10, $11, $12, $13, $14, $15::uuid, $16::uuid, $17, $18::uuid, $18::uuid)
         RETURNING id`,
        tenantId, numero, d.escalon, d.clienteId, d.plantaIds, d.docOrigenTipo, d.docOrigenNumero.trim(), d.docOrigenFecha,
        d.asistenciaTecnica, d.instrucciones?.trim() || null, d.conCobro,
        d.conCobro ? null : d.sinCobroComunicacion?.trim() || null, d.conCobro ? null : d.sinCobroNumero?.trim() || null,
        d.tecnico?.trim() || null, unidad.id, d.catElementoId ?? null, d.elementoGenerico?.trim() || null, usuario,
      );
      return f.id;
    });
    return this.detalle(req, id);
  }

  /** Corregir el borrador antes de validarlo. */
  async actualizar(req: any, id: string, body: unknown) {
    const tenantId = tenantDe(req);
    const actual = await this.detalle(req, id);
    if (actual.estado !== "borrador") throw new ConflictException(`El requerimiento ${actual.numero} ya no es un borrador (${actual.estado}).`);
    const d = RequerimientoBody.parse(body ?? {});
    const unidad = await this.validarDatos(tenantId, d);
    await this.comun.exigirExpediente(req, unidad.id, "el requerimiento");
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_requerimiento SET escalon = $2, cliente_id = $3::uuid, planta_ids = $4::uuid[], doc_origen_tipo = $5, doc_origen_numero = $6,
              doc_origen_fecha = $7::date, asistencia_tecnica = $8, instrucciones = $9, con_cobro = $10, sin_cobro_comunicacion = $11,
              sin_cobro_numero = $12, tecnico = $13, unidad_destino_id = $14::uuid, cat_elemento_id = $15::uuid, elemento_generico = $16,
              updated_by = $17::uuid, updated_at = now()
        WHERE id = $1::uuid`,
      id, d.escalon, d.clienteId, d.plantaIds, d.docOrigenTipo, d.docOrigenNumero.trim(), d.docOrigenFecha, d.asistenciaTecnica,
      d.instrucciones?.trim() || null, d.conCobro, d.conCobro ? null : d.sinCobroComunicacion?.trim() || null,
      d.conCobro ? null : d.sinCobroNumero?.trim() || null, d.tecnico?.trim() || null, unidad.id, d.catElementoId ?? null,
      d.elementoGenerico?.trim() || null, usuarioDe(req),
    );
    return this.detalle(req, id);
  }

  /** 2 · Validar: nace la OT, derivada a la sucursal de destino. */
  async validar(req: any, id: string) {
    const tenantId = tenantDe(req);
    const r = await this.detalle(req, id);
    const usuario = usuarioDe(req);
    const motivo = motivoNoValidable(r, usuario);
    if (motivo) throw new ConflictException(motivo);
    const unidad = await this.ots.unidadDeBpch(tenantId, r.unidadDestinoId);
    await this.ots.exigirOperarEnUnidad(req, unidad);
    const ot = await this.prisma.$transaction(async (tx) => {
      // Bloquea la fila: dos validaciones a la vez no generan dos OT.
      const [fila] = await tx.$queryRawUnsafe<{ estado: string }[]>(`SELECT estado FROM bpch_requerimiento WHERE id = $1::uuid FOR UPDATE`, id);
      if (fila?.estado !== "borrador") throw new ConflictException("El requerimiento ya fue validado o anulado.");
      const nueva = await this.ots.crearOt(tx, {
        tenantId,
        usuarioId: usuario,
        clienteId: r.clienteId,
        unidad,
        origen: "REQUERIMIENTO_BPCH",
        conCobro: r.conCobro,
        resolucion: `${r.docOrigenTipo === "rpi" ? "RPI" : "OF"} ${r.docOrigenNumero}`.slice(0, 40),
        fechaResolucion: r.docOrigenFecha ?? null,
        descripcion: descripcionOt({ ...r, escalon: r.escalon as Escalon }),
        elementoGenerico: r.elementoGenerico,
        catElementoId: r.catElementoId,
        tipoTrabajo: "INSPECCION",
        tipoHistorial: "bpch_requerimiento",
        detalleHistorial: {
          requerimiento: r.numero,
          escalon: r.escalon,
          documento: `${r.docOrigenTipo} ${r.docOrigenNumero}`,
          sinCobro: r.conCobro ? null : { numero: r.sinCobroNumero, comunicacion: r.sinCobroComunicacion },
          derivadaA: unidad.codigo,
        },
      });
      await tx.$executeRawUnsafe(
        `UPDATE bpch_requerimiento SET estado = 'validado', validado_por = $2::uuid, validado_at = now(), ot_id = $3::uuid,
                updated_by = $2::uuid, updated_at = now() WHERE id = $1::uuid`,
        id, usuario, nueva.id,
      );
      return nueva;
    });
    return { ok: true, ot, mensaje: `Requerimiento ${r.numero} validado: OT ${ot.codigo} derivada a ${unidad.codigo} · ${unidad.nombre}.` };
  }

  async anular(req: any, id: string, motivo: string) {
    const r = await this.detalle(req, id);
    if (r.estado !== "borrador") throw new ConflictException(`Solo se anula un borrador: el requerimiento ${r.numero} está ${r.estado}${r.otCodigo ? ` (OT ${r.otCodigo}: anule la OT)` : ""}.`);
    const m = String(motivo ?? "").trim();
    if (m.length < 5) throw new BadRequestException("Indique el motivo de la anulación (mínimo 5 caracteres).");
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_requerimiento SET estado = 'anulado', anulado_motivo = $2, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`,
      id, m.slice(0, 2000), usuarioDe(req),
    );
    return this.detalle(req, id);
  }
}
