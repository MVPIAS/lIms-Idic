import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AvisosService } from "../../avisos/avisos.service";
import { createHash } from "crypto";
import { z } from "zod";
import { PrismaService } from "../../common/prisma.service";
import { FORMATO_BPCH, nuevoCodigoVerificacion } from "../../common/codigo-verificacion";
import { validaRut } from "../../common/rut.validator";
import { ClienteService } from "../../cliente/cliente.service";
import { diaDe, hoyCl } from "../../ot/plazos";
import { fmtFecha, fmtNum } from "../../plantilla-render/html.util";
import { documentoCompleto, type Sello } from "../../plantilla-render/plantilla-defecto";
import { generarPdf } from "../../plantilla-render/pdf.renderer";
import { OtDesdeProcesoService } from "../ot-desde-proceso.service";
import { ClasificacionService } from "../clasificacion/clasificacion.service";
import { cuerpoInformeTecnico } from "./documento-informe-tecnico";
import {
  ETIQUETA_ESTADO_LINEA,
  comprobarGeneracionOt,
  consumoOc,
  correlacionar,
  estadoLinea,
  faltantesInforme,
  fechaReferenciaLinea,
  puedeGenerarOt,
  resumenPrograma,
  sugerenciaConforme,
  validarLinea,
  type LineaPrograma,
  type ProductoOc,
} from "./reglas-pn";

/* ---------------------------------------------------------------- DTOs --- */

const texto = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v), z.string().max(max).nullable().optional());
const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const fechaOpcional = z.preprocess((v) => (v === "" ? null : v), fechaDia.nullable().optional());
const cantidad = z.coerce.number().finite().positive("La cantidad debe ser mayor que cero.").max(1e10);

export const CrearFabricante = z
  .object({
    rut: z.string().refine((r) => validaRut(r), { message: "RUT chileno inválido (no pasa módulo 11)." }),
    razonSocial: z.string().trim().min(1, "Indique la razón social.").max(200),
    tipo: z.string().trim().min(1, "Indique el tipo de cliente.").max(30),
    giro: texto(200),
    direccion: texto(500),
    ciudad: texto(80),
    region: texto(80),
    telefono: texto(40),
    email: z.preprocess((v) => (v === "" ? undefined : v), z.string().email("Correo no válido").optional()),
  })
  .strict();

const CamposRaf = {
  clienteId: z.string().uuid(),
  numero: z.string().trim().min(1, "Indique el Nº de la RAF DGMN.").max(60),
  fecha: fechaOpcional,
  tipoLinea: z.enum(["FIJA", "MOVIL"], { errorMap: () => ({ message: "Indique si la línea de fabricación es fija o móvil." }) }),
  planta: texto(200),
  vigenciaHasta: fechaOpcional,
  listadoProductos: texto(4000),
  resInspeccionLinea: texto(120),
  resAlmacenamiento: texto(120),
  observaciones: texto(4000),
};
export const CrearRaf = z.object(CamposRaf).strict();
export const EditarRaf = z.object(CamposRaf).omit({ clienteId: true }).partial().strict();

const ProductoDto = z
  .object({
    producto: z.string().trim().min(1, "Indique el producto.").max(240),
    unidadMedida: z.string().trim().min(1, "Indique la unidad (t, kg, u, m…).").max(20),
    cantidadAutorizada: cantidad,
    catElementoId: z.string().uuid().nullable().optional(),
    clasificacionId: z.string().uuid().nullable().optional(),
  })
  .strict();
export const CrearOc = z
  .object({
    rafId: z.string().uuid(),
    numero: z.string().trim().min(1, "Indique el Nº de la O/C operativa.").max(60),
    anio: z.coerce.number().int().min(2000).max(2100),
    vigenciaDesde: fechaDia,
    vigenciaHasta: fechaDia,
    conCobro: z.boolean({ required_error: "Indique si las inspecciones son con cobro o sin cobro.", invalid_type_error: "Indique si las inspecciones son con cobro o sin cobro." }),
    observaciones: texto(4000),
    productos: z.array(ProductoDto).min(1, "La O/C lleva al menos un producto con su cantidad.").max(200),
  })
  .strict()
  .refine((d) => d.vigenciaHasta >= d.vigenciaDesde, { message: "La vigencia termina antes de empezar.", path: ["vigenciaHasta"] });
export const EditarOc = z
  .object({
    vigenciaDesde: fechaDia.optional(),
    vigenciaHasta: fechaDia.optional(),
    conCobro: z.boolean().optional(),
    observaciones: texto(4000),
  })
  .strict();
export const EditarProducto = ProductoDto.partial().strict();
/** Asociar, cambiar o quitar la clasificación de un producto de la O/C después de crearla (con motivo). */
export const CambiarClasificacion = z
  .object({
    clasificacionId: z.string().uuid().nullable(),
    motivo: z.string().trim().min(5, "Indique el motivo del cambio de clasificación (al menos 5 caracteres).").max(2000),
  })
  .strict();

const LineaDto = z
  .object({
    ocProductoId: z.string().uuid(),
    unidadId: z.string().uuid(),
    mes: z.coerce.number().int().min(1, "Mes entre 1 y 12.").max(12, "Mes entre 1 y 12."),
    fechaProgramada: fechaOpcional,
    lugar: texto(200),
    lote: texto(120),
    cantidad: cantidad.nullable().optional(),
    observaciones: texto(2000),
  })
  .strict();
export const CrearLineas = z.object({ lineas: z.array(LineaDto).min(1).max(200) }).strict();
export const EditarLinea = LineaDto.partial().strict();
export const Motivo = z.object({ motivo: z.string().trim().min(5, "Indique el motivo (al menos 5 caracteres).").max(2000) });

const VentaDto = z.object({ ocProductoId: z.string().uuid(), cantidad: z.coerce.number().finite().min(0).max(1e10) }).strict();
export const CrearCorrelacion = z
  .object({
    periodoDesde: fechaDia,
    periodoHasta: fechaDia,
    relacionVentasRef: texto(200),
    relacionVentasAt: fechaOpcional,
    ventas: z.array(VentaDto).max(200).optional(),
  })
  .strict()
  .refine((d) => d.periodoHasta >= d.periodoDesde, { message: "El período termina antes de empezar.", path: ["periodoHasta"] });
export const EditarCorrelacion = z
  .object({
    relacionVentasRef: texto(200),
    relacionVentasAt: fechaOpcional,
    ventas: z.array(VentaDto).max(200).optional(),
    conforme: z.boolean().nullable().optional(),
    observaciones: texto(4000),
    requerimientoSucursal: texto(4000),
    requerimientoSucursalAt: fechaOpcional,
    respuestaSucursal: texto(4000),
    respuestaSucursalAt: fechaOpcional,
    respondeRequerimiento: z.boolean().nullable().optional(),
    solicitudDgmn: texto(4000),
    solicitudDgmnAt: fechaOpcional,
    respuestaDgmn: texto(4000),
    respuestaDgmnAt: fechaOpcional,
    propuestaTecnica: texto(8000),
  })
  .strict();

/* -------------------------------------------------------------- utilidades --- */

const iso = (d: unknown): string | null => diaDe(d as any);
const hoyAnioMes = () => {
  const h = hoyCl();
  return { anio: Number(h.slice(0, 4)), mes: Number(h.slice(5, 7)) };
};

function setDinamico(cols: Record<string, unknown>, desde: number, tipos: Record<string, string> = {}) {
  const nombres = Object.keys(cols);
  return {
    sql: nombres.map((n, i) => `${n} = $${i + desde}${tipos[n] ?? ""}`).join(", "),
    valores: Object.values(cols),
  };
}

/**
 * Producción Nacional (BPCH): fabricante → RAF DGMN → O/C operativa anual →
 * programa de inspecciones → OT por inspección (flujo general) → seguimiento
 * del programa y del consumo de la O/C → correlación con la relación de ventas
 * → informe técnico a DCO. Reglas en reglas-pn.ts.
 */
@Injectable()
export class ProduccionNacionalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comun: OtDesdeProcesoService,
    private readonly clientes: ClienteService,
    private readonly clasificaciones: ClasificacionService,
    private readonly avisos?: AvisosService,
  ) {}

  private get baseVerificacion(): string {
    return (process.env.URL_VERIFICACION ?? "https://verificar.idic.cl/c").replace(/\/+$/, "");
  }

  async config(tenantId: string) {
    const [unidades, tipos] = await Promise.all([
      this.comun.unidadesBpch(tenantId),
      this.prisma.$queryRawUnsafe<{ codigo: string; etiqueta: string }[]>(
        `SELECT codigo, etiqueta FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'tipo_cliente' AND activo ORDER BY orden, codigo`,
        tenantId,
      ),
    ]);
    return { unidades, tiposCliente: tipos, hoy: hoyCl() };
  }

  /* ----------------------------------------------------------- fabricantes --- */

  /** Fabricantes (clientes con RAF) o búsqueda de clientes por RUT / razón social. */
  async fabricantes(tenantId: string, q?: string) {
    const args: unknown[] = [tenantId];
    let filtro = "EXISTS (SELECT 1 FROM bpch_raf r WHERE r.cliente_id = cl.id)";
    if (q?.trim()) {
      args.push(`%${q.trim()}%`);
      filtro = `(cl.razon_social ILIKE $2 OR cl.rut ILIKE $2 OR cl.nombre_fantasia ILIKE $2)`;
    }
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT cl.id, cl.rut, cl.razon_social, cl.tipo,
              (SELECT count(*)::int FROM bpch_raf r WHERE r.cliente_id = cl.id AND r.estado = 'vigente') AS rafs,
              (SELECT count(*)::int FROM bpch_oc_operativa o WHERE o.cliente_id = cl.id AND o.estado = 'vigente') AS ocs
         FROM cliente cl
        WHERE cl.tenant_id = $1::uuid AND cl.deleted_at IS NULL AND ${filtro}
        ORDER BY cl.razon_social LIMIT 50`,
      ...args,
    );
    return { data: filas.map((r) => ({ id: r.id, rut: r.rut, razonSocial: r.razon_social, tipo: r.tipo, rafsVigentes: r.rafs, ocsVigentes: r.ocs })) };
  }

  /** Alta del fabricante como cliente (mismas reglas que Comercial: RUT y tipo vigente). */
  async crearFabricante(tenantId: string, body: unknown) {
    const d = CrearFabricante.parse(body ?? {});
    const limpio = d.rut.replace(/\./g, "").toUpperCase();
    const existe = await this.prisma.$queryRawUnsafe<{ id: string; razon_social: string }[]>(
      `SELECT id, razon_social FROM cliente WHERE tenant_id = $1::uuid AND upper(replace(rut, '.', '')) = $2 LIMIT 1`,
      tenantId,
      limpio,
    );
    if (existe[0])
      throw new ConflictException(`El RUT ${d.rut} ya está registrado como «${existe[0].razon_social}»: búsquelo y selecciónelo.`);
    const c = await this.clientes.crear(
      {
        rut: d.rut,
        razonSocial: d.razonSocial,
        tipo: d.tipo,
        giro: d.giro ?? undefined,
        direccion: d.direccion ?? undefined,
        ciudad: d.ciudad ?? undefined,
        region: d.region ?? undefined,
        telefono: d.telefono ?? undefined,
        email: d.email,
      },
      tenantId,
    );
    return { id: c.id, rut: c.rut, razonSocial: c.razonSocial, tipo: c.tipo };
  }

  /* ------------------------------------------------------------------ RAF --- */

  private mapearRaf(r: any) {
    const hoy = hoyCl();
    const vencida = r.vigencia_hasta ? iso(r.vigencia_hasta)! < hoy : false;
    return {
      id: r.id,
      cliente: { id: r.cliente_id, razonSocial: r.cliente_nombre, rut: r.cliente_rut },
      numero: r.numero,
      fecha: iso(r.fecha),
      tipoLinea: r.tipo_linea,
      planta: r.planta,
      vigenciaHasta: iso(r.vigencia_hasta),
      vencida,
      listadoProductos: r.listado_productos,
      resInspeccionLinea: r.res_inspeccion_linea,
      resAlmacenamiento: r.res_almacenamiento,
      observaciones: r.observaciones,
      estado: r.estado,
      anulada: r.anulada_at ? { motivo: r.anulada_motivo, at: r.anulada_at } : null,
      ocs: r.ocs ?? 0,
      createdAt: r.created_at,
    };
  }

  async rafs(tenantId: string, f: { clienteId?: string; q?: string }) {
    const args: unknown[] = [tenantId];
    const where = ["r.tenant_id = $1::uuid"];
    if (f.clienteId) {
      args.push(f.clienteId);
      where.push(`r.cliente_id = $${args.length}::uuid`);
    }
    if (f.q?.trim()) {
      args.push(`%${f.q.trim()}%`);
      where.push(`(r.numero ILIKE $${args.length} OR cl.razon_social ILIKE $${args.length} OR cl.rut ILIKE $${args.length})`);
    }
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.*, cl.razon_social AS cliente_nombre, cl.rut AS cliente_rut,
              (SELECT count(*)::int FROM bpch_oc_operativa o WHERE o.raf_id = r.id) AS ocs
         FROM bpch_raf r JOIN cliente cl ON cl.id = r.cliente_id
        WHERE ${where.join(" AND ")}
        ORDER BY r.created_at DESC LIMIT 300`,
      ...args,
    );
    return { data: filas.map((r) => this.mapearRaf(r)) };
  }

  private async raf(tenantId: string, id: string) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.*, cl.razon_social AS cliente_nombre, cl.rut AS cliente_rut,
              (SELECT count(*)::int FROM bpch_oc_operativa o WHERE o.raf_id = r.id) AS ocs
         FROM bpch_raf r JOIN cliente cl ON cl.id = r.cliente_id WHERE r.id = $1::uuid AND r.tenant_id = $2::uuid`,
      id,
      tenantId,
    );
    if (!filas[0]) throw new NotFoundException("RAF no encontrada.");
    return filas[0];
  }

  async crearRaf(tenantId: string, usuarioId: string | null, body: unknown) {
    const d = CrearRaf.parse(body ?? {});
    const cl = await this.prisma.cliente.findFirst({ where: { id: d.clienteId, tenantId, deletedAt: null }, select: { id: true } });
    if (!cl) throw new BadRequestException("El fabricante indicado no existe.");
    const dup = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM bpch_raf WHERE tenant_id = $1::uuid AND numero = $2`,
      tenantId,
      d.numero,
    );
    if (dup[0]) throw new ConflictException(`La RAF ${d.numero} ya está registrada.`);
    const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO bpch_raf (tenant_id, cliente_id, numero, fecha, tipo_linea, planta, vigencia_hasta, listado_productos,
                             res_inspeccion_linea, res_almacenamiento, observaciones, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4::date, $5, $6, $7::date, $8, $9, $10, $11, $12::uuid) RETURNING id`,
      tenantId,
      d.clienteId,
      d.numero,
      d.fecha ?? null,
      d.tipoLinea,
      d.planta ?? null,
      d.vigenciaHasta ?? null,
      d.listadoProductos ?? null,
      d.resInspeccionLinea ?? null,
      d.resAlmacenamiento ?? null,
      d.observaciones ?? null,
      usuarioId,
    );
    return this.mapearRaf(await this.raf(tenantId, filas[0].id));
  }

  async editarRaf(tenantId: string, id: string, body: unknown) {
    const d = EditarRaf.parse(body ?? {});
    const r = await this.raf(tenantId, id);
    if (r.estado !== "vigente") throw new ConflictException("La RAF está anulada.");
    const mapa: Record<string, [string, string?]> = {
      numero: ["numero"],
      fecha: ["fecha", "::date"],
      tipoLinea: ["tipo_linea"],
      planta: ["planta"],
      vigenciaHasta: ["vigencia_hasta", "::date"],
      listadoProductos: ["listado_productos"],
      resInspeccionLinea: ["res_inspeccion_linea"],
      resAlmacenamiento: ["res_almacenamiento"],
      observaciones: ["observaciones"],
    };
    const cols: Record<string, unknown> = {};
    const tipos: Record<string, string> = {};
    for (const [k, v] of Object.entries(d)) {
      if (v === undefined || !mapa[k]) continue;
      cols[mapa[k][0]] = v;
      if (mapa[k][1]) tipos[mapa[k][0]] = mapa[k][1]!;
    }
    if (cols.numero && cols.numero !== r.numero) {
      const dup = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM bpch_raf WHERE tenant_id = $1::uuid AND numero = $2 AND id <> $3::uuid`,
        tenantId,
        cols.numero,
        id,
      );
      if (dup[0]) throw new ConflictException(`La RAF ${cols.numero} ya está registrada.`);
    }
    if (Object.keys(cols).length) {
      const s = setDinamico(cols, 2, tipos);
      await this.prisma.$executeRawUnsafe(`UPDATE bpch_raf SET ${s.sql}, updated_at = now() WHERE id = $1::uuid`, id, ...s.valores);
    }
    return this.mapearRaf(await this.raf(tenantId, id));
  }

  async anularRaf(tenantId: string, id: string, usuarioId: string | null, body: unknown) {
    const { motivo } = Motivo.parse(body ?? {});
    const r = await this.raf(tenantId, id);
    if (r.estado === "anulada") throw new ConflictException("La RAF ya está anulada.");
    const vivas = await this.prisma.$queryRawUnsafe<{ numero: string }[]>(
      `SELECT numero FROM bpch_oc_operativa WHERE raf_id = $1::uuid AND estado = 'vigente'`,
      id,
    );
    if (vivas.length)
      throw new ConflictException(`La RAF tiene O/C vigentes (${vivas.map((v) => v.numero).join(", ")}): ciérrelas o anúlelas antes.`);
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_raf SET estado = 'anulada', anulada_motivo = $2, anulada_por = $3::uuid, anulada_at = now(), updated_at = now() WHERE id = $1::uuid`,
      id,
      motivo,
      usuarioId,
    );
    return this.mapearRaf(await this.raf(tenantId, id));
  }

  /* -------------------------------------------------------- O/C operativa --- */

  private async ocFila(tenantId: string, id: string) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.*, cl.razon_social AS cliente_nombre, cl.rut AS cliente_rut,
              r.numero AS raf_numero, r.tipo_linea AS raf_tipo_linea, r.estado AS raf_estado, r.vigencia_hasta AS raf_vigencia_hasta, r.planta AS raf_planta
         FROM bpch_oc_operativa o
         JOIN cliente cl ON cl.id = o.cliente_id
         JOIN bpch_raf r ON r.id = o.raf_id
        WHERE o.id = $1::uuid AND o.tenant_id = $2::uuid`,
      id,
      tenantId,
    );
    if (!filas[0]) throw new NotFoundException("O/C operativa no encontrada.");
    return filas[0];
  }

  private async productosDe(ocId: string): Promise<any[]> {
    return this.prisma.$queryRawUnsafe(
      `SELECT p.*, e.nombre AS elemento_nombre, c.codigo AS clas_codigo, c.version AS clas_version, c.estado AS clas_estado,
              c.explosiva AS clas_explosiva, c.clase_division AS clas_clase, c.grupo_compatibilidad AS clas_grupo, c.numero_onu AS clas_onu
         FROM bpch_oc_producto p
         LEFT JOIN cat_elemento e ON e.id = p.cat_elemento_id
         LEFT JOIN bpch_clasificacion c ON c.id = p.clasificacion_id
        WHERE p.oc_id = $1::uuid ORDER BY p.orden, p.created_at`,
      ocId,
    );
  }

  private async lineasDe(ocId: string): Promise<any[]> {
    return this.prisma.$queryRawUnsafe(
      `SELECT l.*, u.codigo AS unidad_codigo, u.nombre AS unidad_nombre, p.producto, p.unidad_medida,
              ot.codigo AS ot_codigo, ot.estado AS ot_estado, ot.fecha_cierre AS ot_fecha_cierre
         FROM bpch_pn_inspeccion l
         JOIN unidad u ON u.id = l.unidad_id
         JOIN bpch_oc_producto p ON p.id = l.oc_producto_id
         LEFT JOIN orden_trabajo ot ON ot.id = l.ot_id
        WHERE l.oc_id = $1::uuid
        ORDER BY l.mes, l.fecha_programada NULLS LAST, l.created_at`,
      ocId,
    );
  }

  private aLinea(l: any): LineaPrograma {
    return {
      id: l.id,
      anulada: l.anulada,
      otId: l.ot_id,
      otEstado: l.ot_estado,
      mes: Number(l.mes),
      ocProductoId: l.oc_producto_id,
      cantidad: l.cantidad === null ? null : Number(l.cantidad),
      fechaProgramada: iso(l.fecha_programada),
    };
  }

  private aProducto(p: any): ProductoOc {
    return { id: p.id, producto: p.producto, unidadMedida: p.unidad_medida, cantidadAutorizada: Number(p.cantidad_autorizada) };
  }

  private ocResumen(o: any) {
    return {
      id: o.id,
      numero: o.numero,
      anio: o.anio,
      vigenciaDesde: iso(o.vigencia_desde),
      vigenciaHasta: iso(o.vigencia_hasta),
      conCobro: o.con_cobro,
      estado: o.estado,
      observaciones: o.observaciones,
      cliente: { id: o.cliente_id, razonSocial: o.cliente_nombre, rut: o.cliente_rut },
      raf: {
        id: o.raf_id,
        numero: o.raf_numero,
        tipoLinea: o.raf_tipo_linea,
        estado: o.raf_estado,
        vigenciaHasta: iso(o.raf_vigencia_hasta),
        planta: o.raf_planta,
      },
      anulada: o.anulada_at ? { motivo: o.anulada_motivo, at: o.anulada_at } : null,
      cerradaAt: o.cerrada_at,
    };
  }

  async ocs(tenantId: string, f: { anio?: number; clienteId?: string; estado?: string; q?: string }) {
    const args: unknown[] = [tenantId];
    const p = (v: unknown) => {
      args.push(v);
      return `$${args.length}`;
    };
    const where = ["o.tenant_id = $1::uuid"];
    if (f.anio) where.push(`o.anio = ${p(f.anio)}`);
    if (f.clienteId) where.push(`o.cliente_id = ${p(f.clienteId)}::uuid`);
    if (f.estado) where.push(`o.estado = ${p(f.estado)}`);
    if (f.q?.trim()) {
      const q = p(`%${f.q.trim()}%`);
      where.push(`(o.numero ILIKE ${q} OR cl.razon_social ILIKE ${q} OR cl.rut ILIKE ${q} OR r.numero ILIKE ${q})`);
    }
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.*, cl.razon_social AS cliente_nombre, cl.rut AS cliente_rut,
              r.numero AS raf_numero, r.tipo_linea AS raf_tipo_linea, r.estado AS raf_estado, r.vigencia_hasta AS raf_vigencia_hasta, r.planta AS raf_planta
         FROM bpch_oc_operativa o JOIN cliente cl ON cl.id = o.cliente_id JOIN bpch_raf r ON r.id = o.raf_id
        WHERE ${where.join(" AND ")}
        ORDER BY o.anio DESC, o.created_at DESC LIMIT 300`,
      ...args,
    );
    const ids = filas.map((o) => o.id);
    const lineas = ids.length
      ? await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT l.oc_id, l.anulada, l.ot_id, l.mes, l.oc_producto_id, l.cantidad, l.fecha_programada, ot.estado AS ot_estado
             FROM bpch_pn_inspeccion l LEFT JOIN orden_trabajo ot ON ot.id = l.ot_id
            WHERE l.oc_id = ANY($1::uuid[])`,
          ids,
        )
      : [];
    const hoy = hoyAnioMes();
    return {
      data: filas.map((o) => ({
        ...this.ocResumen(o),
        programa: resumenPrograma(lineas.filter((l) => l.oc_id === o.id).map((l) => this.aLinea(l)), o.anio, hoy),
      })),
    };
  }

  async ocDetalle(tenantId: string, id: string) {
    const o = await this.ocFila(tenantId, id);
    const [productos, lineas, correlaciones, historialClas] = await Promise.all([
      this.productosDe(id),
      this.lineasDe(id),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, periodo_desde, periodo_hasta, estado, conforme, informe_numero, informe_at, remitido_dco_at
           FROM bpch_pn_correlacion WHERE oc_id = $1::uuid ORDER BY periodo_desde DESC, created_at DESC`,
        id,
      ),
      this.historialClasificaciones(id),
    ]);
    const lp = lineas.map((l) => this.aLinea(l));
    return {
      ...this.ocResumen(o),
      productos: productos.map((p) => ({
        id: p.id,
        producto: p.producto,
        unidadMedida: p.unidad_medida,
        cantidadAutorizada: Number(p.cantidad_autorizada),
        catElemento: p.cat_elemento_id ? { id: p.cat_elemento_id, nombre: p.elemento_nombre } : null,
        clasificacion: p.clasificacion_id
          ? {
              id: p.clasificacion_id,
              codigo: p.clas_version > 1 ? `${p.clas_codigo}-V${p.clas_version}` : p.clas_codigo,
              estado: p.clas_estado,
              explosiva: p.clas_explosiva,
              claseDivision: p.clas_clase,
              grupoCompatibilidad: p.clas_grupo,
              numeroOnu: p.clas_onu,
            }
          : null,
        historialClasificacion: historialClas.filter((h) => h.ocProductoId === p.id),
      })),
      programa: lineas.map((l) => {
        const e = estadoLinea(this.aLinea(l));
        return {
          id: l.id,
          ocProductoId: l.oc_producto_id,
          producto: l.producto,
          unidadMedida: l.unidad_medida,
          unidad: { id: l.unidad_id, codigo: l.unidad_codigo, nombre: l.unidad_nombre },
          mes: Number(l.mes),
          fechaProgramada: iso(l.fecha_programada),
          lugar: l.lugar,
          lote: l.lote,
          cantidad: l.cantidad === null ? null : Number(l.cantidad),
          observaciones: l.observaciones,
          ot: l.ot_id ? { id: l.ot_id, codigo: l.ot_codigo, estado: l.ot_estado, fechaCierre: l.ot_fecha_cierre } : null,
          estado: e,
          estadoTexto: ETIQUETA_ESTADO_LINEA[e],
          puedeGenerarOt: puedeGenerarOt(e),
          anulada: l.anulada ? { motivo: l.anulada_motivo, at: l.anulada_at } : null,
        };
      }),
      resumen: resumenPrograma(lp, o.anio, hoyAnioMes()),
      consumo: consumoOc(productos.map((p) => this.aProducto(p)), lp),
      correlaciones: correlaciones.map((c) => ({
        id: c.id,
        periodoDesde: iso(c.periodo_desde),
        periodoHasta: iso(c.periodo_hasta),
        estado: c.estado,
        conforme: c.conforme,
        informeNumero: c.informe_numero,
        informeAt: c.informe_at,
        remitidoDcoAt: c.remitido_dco_at,
      })),
    };
  }

  private async validarProducto(tenantId: string, p: { catElementoId?: string | null; clasificacionId?: string | null }) {
    if (p.catElementoId) {
      const e = await this.prisma.catElemento.findFirst({ where: { id: p.catElementoId, tenantId }, select: { id: true } });
      if (!e) throw new BadRequestException("El elemento del catálogo indicado no existe.");
    }
    if (p.clasificacionId) await this.clasificaciones.exigirAprobada(tenantId, p.clasificacionId);
  }

  async crearOc(tenantId: string, usuarioId: string | null, body: unknown) {
    const d = CrearOc.parse(body ?? {});
    const raf = await this.raf(tenantId, d.rafId);
    if (raf.estado !== "vigente") throw new BadRequestException(`La RAF ${raf.numero} está anulada.`);
    if (Number(d.vigenciaDesde.slice(0, 4)) > d.anio || Number(d.vigenciaHasta.slice(0, 4)) < d.anio)
      throw new BadRequestException(`La vigencia de la O/C debe incluir el año ${d.anio}.`);
    for (const p of d.productos) await this.validarProducto(tenantId, p);
    const dup = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM bpch_oc_operativa WHERE tenant_id = $1::uuid AND numero = $2`,
      tenantId,
      d.numero,
    );
    if (dup[0]) throw new ConflictException(`La O/C ${d.numero} ya está registrada.`);
    const id = await this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO bpch_oc_operativa (tenant_id, raf_id, cliente_id, numero, anio, vigencia_desde, vigencia_hasta, con_cobro, observaciones, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::date, $7::date, $8, $9, $10::uuid) RETURNING id`,
        tenantId,
        d.rafId,
        raf.cliente_id,
        d.numero,
        d.anio,
        d.vigenciaDesde,
        d.vigenciaHasta,
        d.conCobro,
        d.observaciones ?? null,
        usuarioId,
      );
      let orden = 0;
      for (const p of d.productos) await this.insertarProducto(tx, tenantId, filas[0].id, p, orden++);
      return filas[0].id;
    });
    return this.ocDetalle(tenantId, id);
  }

  private async insertarProducto(tx: Pick<PrismaService, "$executeRawUnsafe">, tenantId: string, ocId: string, p: z.infer<typeof ProductoDto>, orden: number) {
    await tx.$executeRawUnsafe(
      `INSERT INTO bpch_oc_producto (tenant_id, oc_id, producto, unidad_medida, cantidad_autorizada, cat_elemento_id, clasificacion_id, orden)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7::uuid, $8)`,
      tenantId,
      ocId,
      p.producto,
      p.unidadMedida,
      p.cantidadAutorizada,
      p.catElementoId ?? null,
      p.clasificacionId ?? null,
      orden,
    );
  }

  private exigirOcVigente(o: any) {
    if (o.estado !== "vigente") throw new ConflictException(`La O/C ${o.numero} está ${o.estado}.`);
  }

  async editarOc(tenantId: string, id: string, body: unknown) {
    const d = EditarOc.parse(body ?? {});
    const o = await this.ocFila(tenantId, id);
    this.exigirOcVigente(o);
    const desde = d.vigenciaDesde ?? iso(o.vigencia_desde)!;
    const hasta = d.vigenciaHasta ?? iso(o.vigencia_hasta)!;
    if (hasta < desde) throw new BadRequestException("La vigencia termina antes de empezar.");
    if (Number(desde.slice(0, 4)) > o.anio || Number(hasta.slice(0, 4)) < o.anio)
      throw new BadRequestException(`La vigencia de la O/C debe incluir el año ${o.anio}.`);
    const cols: Record<string, unknown> = {};
    const tipos: Record<string, string> = { vigencia_desde: "::date", vigencia_hasta: "::date" };
    if (d.vigenciaDesde) cols.vigencia_desde = d.vigenciaDesde;
    if (d.vigenciaHasta) cols.vigencia_hasta = d.vigenciaHasta;
    if (d.conCobro !== undefined) cols.con_cobro = d.conCobro;
    if (d.observaciones !== undefined) cols.observaciones = d.observaciones;
    if (Object.keys(cols).length) {
      const s = setDinamico(cols, 2, tipos);
      await this.prisma.$executeRawUnsafe(`UPDATE bpch_oc_operativa SET ${s.sql}, updated_at = now() WHERE id = $1::uuid`, id, ...s.valores);
    }
    return this.ocDetalle(tenantId, id);
  }

  async agregarProducto(tenantId: string, ocId: string, body: unknown) {
    const p = ProductoDto.parse(body ?? {});
    const o = await this.ocFila(tenantId, ocId);
    this.exigirOcVigente(o);
    await this.validarProducto(tenantId, p);
    const n = await this.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM bpch_oc_producto WHERE oc_id = $1::uuid`, ocId);
    await this.insertarProducto(this.prisma, tenantId, ocId, p, n[0].n);
    return this.ocDetalle(tenantId, ocId);
  }

  /** Historial de la clasificación de los productos de la O/C (quién, cuándo, de cuál a cuál, motivo). */
  private async historialClasificaciones(ocId: string) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT h.id, h.oc_producto_id, h.motivo, h.created_at, u.nombre_completo AS usuario,
              ca.codigo AS anterior_codigo, ca.version AS anterior_version, cn.codigo AS nueva_codigo, cn.version AS nueva_version
         FROM bpch_oc_producto_clasificacion_hist h
         LEFT JOIN usuario u ON u.id = h.usuario_id
         LEFT JOIN bpch_clasificacion ca ON ca.id = h.clasificacion_anterior
         LEFT JOIN bpch_clasificacion cn ON cn.id = h.clasificacion_nueva
        WHERE h.oc_id = $1::uuid ORDER BY h.created_at`,
      ocId,
    );
    const cod = (c: string | null, v: number | null) => (c ? (Number(v) > 1 ? `${c}-V${v}` : c) : null);
    return filas.map((h) => ({
      id: h.id,
      ocProductoId: h.oc_producto_id,
      anterior: cod(h.anterior_codigo, h.anterior_version),
      nueva: cod(h.nueva_codigo, h.nueva_version),
      motivo: h.motivo,
      usuario: h.usuario,
      at: h.created_at,
    }));
  }

  /**
   * Asocia, cambia o quita la clasificación de un producto de la O/C después de
   * crearla (pauta BPCH, caso P1, paso 4). Solo una clasificación APROBADA (400 si
   * está en borrador u otro estado), con motivo, y queda en el historial. Mismos
   * permisos que crear la O/C (los impone el controlador).
   */
  async cambiarClasificacion(tenantId: string, ocId: string, productoId: string, usuarioId: string | null, body: unknown) {
    const d = CambiarClasificacion.parse(body ?? {});
    const o = await this.ocFila(tenantId, ocId);
    this.exigirOcVigente(o);
    const actual = await this.prisma.$queryRawUnsafe<{ clasificacion_id: string | null }[]>(
      `SELECT clasificacion_id FROM bpch_oc_producto WHERE id = $1::uuid AND oc_id = $2::uuid AND tenant_id = $3::uuid`,
      productoId,
      ocId,
      tenantId,
    );
    if (!actual[0]) throw new NotFoundException("Producto no encontrado en esta O/C.");
    if ((actual[0].clasificacion_id ?? null) === d.clasificacionId)
      throw new ConflictException(d.clasificacionId ? "El producto ya tiene esa clasificación." : "El producto no tiene clasificación que quitar.");
    if (d.clasificacionId) await this.clasificaciones.exigirAprobada(tenantId, d.clasificacionId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE bpch_oc_producto SET clasificacion_id = $3::uuid WHERE id = $1::uuid AND oc_id = $2::uuid`,
        productoId,
        ocId,
        d.clasificacionId,
      );
      await this.anotarClasificacion(tx, tenantId, ocId, productoId, actual[0].clasificacion_id, d.clasificacionId, d.motivo, usuarioId);
    });
    return this.ocDetalle(tenantId, ocId);
  }

  private async anotarClasificacion(
    tx: Pick<PrismaService, "$executeRawUnsafe">,
    tenantId: string,
    ocId: string,
    productoId: string,
    anterior: string | null,
    nueva: string | null,
    motivo: string | null,
    usuarioId: string | null,
  ) {
    await tx.$executeRawUnsafe(
      `INSERT INTO bpch_oc_producto_clasificacion_hist (tenant_id, oc_id, oc_producto_id, clasificacion_anterior, clasificacion_nueva, motivo, usuario_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7::uuid)`,
      tenantId,
      ocId,
      productoId,
      anterior,
      nueva,
      motivo,
      usuarioId,
    );
  }

  async editarProducto(tenantId: string, ocId: string, productoId: string, body: unknown, usuarioId: string | null = null) {
    const p = EditarProducto.parse(body ?? {});
    const o = await this.ocFila(tenantId, ocId);
    this.exigirOcVigente(o);
    await this.validarProducto(tenantId, p);
    // Un cambio de clasificación por esta vía (sin motivo) también queda en el historial.
    const previa =
      p.clasificacionId !== undefined
        ? await this.prisma.$queryRawUnsafe<{ clasificacion_id: string | null }[]>(
            `SELECT clasificacion_id FROM bpch_oc_producto WHERE id = $1::uuid AND oc_id = $2::uuid`,
            productoId,
            ocId,
          )
        : [];
    const cols: Record<string, unknown> = {};
    const tipos: Record<string, string> = { cat_elemento_id: "::uuid", clasificacion_id: "::uuid" };
    if (p.producto !== undefined) cols.producto = p.producto;
    if (p.unidadMedida !== undefined) cols.unidad_medida = p.unidadMedida;
    if (p.cantidadAutorizada !== undefined) cols.cantidad_autorizada = p.cantidadAutorizada;
    if (p.catElementoId !== undefined) cols.cat_elemento_id = p.catElementoId;
    if (p.clasificacionId !== undefined) cols.clasificacion_id = p.clasificacionId;
    if (Object.keys(cols).length) {
      const s = setDinamico(cols, 3, tipos);
      const n = await this.prisma.$executeRawUnsafe(
        `UPDATE bpch_oc_producto SET ${s.sql} WHERE id = $1::uuid AND oc_id = $2::uuid`,
        productoId,
        ocId,
        ...s.valores,
      );
      if (n !== 1) throw new NotFoundException("Producto no encontrado en esta O/C.");
      if (previa[0] && (previa[0].clasificacion_id ?? null) !== (p.clasificacionId ?? null))
        await this.anotarClasificacion(this.prisma, tenantId, ocId, productoId, previa[0].clasificacion_id, p.clasificacionId ?? null, null, usuarioId);
    }
    return this.ocDetalle(tenantId, ocId);
  }

  async cerrarOc(tenantId: string, id: string, usuarioId: string | null) {
    const o = await this.ocFila(tenantId, id);
    this.exigirOcVigente(o);
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_oc_operativa SET estado = 'cerrada', cerrada_por = $2::uuid, cerrada_at = now(), updated_at = now() WHERE id = $1::uuid`,
      id,
      usuarioId,
    );
    return this.ocDetalle(tenantId, id);
  }

  async anularOc(tenantId: string, id: string, usuarioId: string | null, body: unknown) {
    const { motivo } = Motivo.parse(body ?? {});
    const o = await this.ocFila(tenantId, id);
    if (o.estado === "anulada") throw new ConflictException("La O/C ya está anulada.");
    const conOt = await this.prisma.$queryRawUnsafe<{ codigo: string }[]>(
      `SELECT ot.codigo FROM bpch_pn_inspeccion l JOIN orden_trabajo ot ON ot.id = l.ot_id
        WHERE l.oc_id = $1::uuid AND ot.estado <> 'anulada'`,
      id,
    );
    if (conOt.length)
      throw new ConflictException(
        `La O/C ya generó OT (${conOt.map((x) => x.codigo).join(", ")}): no se anula; ciérrela cuando termine el programa.`,
      );
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_oc_operativa SET estado = 'anulada', anulada_motivo = $2, anulada_por = $3::uuid, anulada_at = now(), updated_at = now() WHERE id = $1::uuid`,
      id,
      motivo,
      usuarioId,
    );
    return this.ocDetalle(tenantId, id);
  }

  /* --------------------------------------------------------------- programa --- */

  private ocVigencia(o: any) {
    return { estado: o.estado, anio: Number(o.anio), vigenciaDesde: iso(o.vigencia_desde)!, vigenciaHasta: iso(o.vigencia_hasta)! };
  }

  async agregarLineas(req: any, tenantId: string, usuarioId: string | null, ocId: string, body: unknown) {
    const { lineas } = CrearLineas.parse(body ?? {});
    const o = await this.ocFila(tenantId, ocId);
    const productos = new Set((await this.productosDe(ocId)).map((p) => p.id));
    const unidades = new Map<string, any>();
    const errores: string[] = [];
    for (const [i, l] of lineas.entries()) {
      const pre = lineas.length > 1 ? `Línea ${i + 1}: ` : "";
      if (!productos.has(l.ocProductoId)) errores.push(`${pre}el producto no es de esta O/C.`);
      for (const e of validarLinea(this.ocVigencia(o), { mes: l.mes, fechaProgramada: l.fechaProgramada })) errores.push(pre + e);
      if (!unidades.has(l.unidadId)) unidades.set(l.unidadId, await this.comun.unidadDeBpch(tenantId, l.unidadId));
    }
    if (errores.length) throw new BadRequestException(errores.join(" "));
    for (const u of unidades.values()) await this.comun.exigirOperarEnUnidad(req, u);
    await this.prisma.$transaction(async (tx) => {
      for (const l of lineas)
        await tx.$executeRawUnsafe(
          `INSERT INTO bpch_pn_inspeccion (tenant_id, oc_id, oc_producto_id, unidad_id, mes, fecha_programada, lugar, lote, cantidad, observaciones, created_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::date, $7, $8, $9, $10, $11::uuid)`,
          tenantId,
          ocId,
          l.ocProductoId,
          l.unidadId,
          l.mes,
          l.fechaProgramada ?? null,
          l.lugar ?? o.raf_planta ?? null,
          l.lote ?? null,
          l.cantidad ?? null,
          l.observaciones ?? null,
          usuarioId,
        );
    });
    return this.ocDetalle(tenantId, ocId);
  }

  private async lineaFila(tenantId: string, id: string) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT l.*, ot.estado AS ot_estado, ot.codigo AS ot_codigo, u.codigo AS unidad_codigo, u.nombre AS unidad_nombre
         FROM bpch_pn_inspeccion l JOIN unidad u ON u.id = l.unidad_id LEFT JOIN orden_trabajo ot ON ot.id = l.ot_id
        WHERE l.id = $1::uuid AND l.tenant_id = $2::uuid`,
      id,
      tenantId,
    );
    if (!filas[0]) throw new NotFoundException("Inspección del programa no encontrada.");
    return filas[0];
  }

  async editarLinea(req: any, tenantId: string, id: string, body: unknown) {
    const d = EditarLinea.parse(body ?? {});
    const l = await this.lineaFila(tenantId, id);
    const o = await this.ocFila(tenantId, l.oc_id);
    const e = estadoLinea(this.aLinea(l));
    if (e === "anulada") throw new ConflictException("La inspección está anulada.");
    if (e === "ejecutada") throw new ConflictException(`La OT ${l.ot_codigo} ya está cerrada: la inspección no se modifica.`);
    const conOt = e === "en_curso";
    if (conOt && (d.mes !== undefined || d.unidadId !== undefined || d.ocProductoId !== undefined))
      throw new ConflictException(`La inspección ya tiene la OT ${l.ot_codigo}: no se cambia el mes, la unidad ni el producto.`);
    const unidadActual = { id: l.unidad_id, codigo: l.unidad_codigo, nombre: l.unidad_nombre, tipo: null };
    await this.comun.exigirOperarEnUnidad(req, unidadActual);
    if (d.unidadId && d.unidadId !== l.unidad_id) await this.comun.exigirOperarEnUnidad(req, await this.comun.unidadDeBpch(tenantId, d.unidadId));
    if (d.ocProductoId) {
      const productos = new Set((await this.productosDe(l.oc_id)).map((p) => p.id));
      if (!productos.has(d.ocProductoId)) throw new BadRequestException("El producto no es de esta O/C.");
    }
    if (!conOt) {
      const errores = validarLinea(this.ocVigencia(o), {
        mes: d.mes ?? Number(l.mes),
        fechaProgramada: d.fechaProgramada !== undefined ? d.fechaProgramada : iso(l.fecha_programada),
      });
      if (errores.length) throw new BadRequestException(errores.join(" "));
    }
    const mapa: Record<string, [string, string?]> = {
      ocProductoId: ["oc_producto_id", "::uuid"],
      unidadId: ["unidad_id", "::uuid"],
      mes: ["mes"],
      fechaProgramada: ["fecha_programada", "::date"],
      lugar: ["lugar"],
      lote: ["lote"],
      cantidad: ["cantidad"],
      observaciones: ["observaciones"],
    };
    const cols: Record<string, unknown> = {};
    const tipos: Record<string, string> = {};
    for (const [k, v] of Object.entries(d)) {
      if (v === undefined || !mapa[k]) continue;
      cols[mapa[k][0]] = v;
      if (mapa[k][1]) tipos[mapa[k][0]] = mapa[k][1]!;
    }
    if (Object.keys(cols).length) {
      const s = setDinamico(cols, 2, tipos);
      await this.prisma.$executeRawUnsafe(`UPDATE bpch_pn_inspeccion SET ${s.sql}, updated_at = now() WHERE id = $1::uuid`, id, ...s.valores);
    }
    return this.ocDetalle(tenantId, l.oc_id);
  }

  async anularLinea(req: any, tenantId: string, id: string, usuarioId: string | null, body: unknown) {
    const { motivo } = Motivo.parse(body ?? {});
    const l = await this.lineaFila(tenantId, id);
    const e = estadoLinea(this.aLinea(l));
    if (e === "anulada") throw new ConflictException("La inspección ya está anulada.");
    if (e === "en_curso" || e === "ejecutada")
      throw new ConflictException(`La inspección tiene la OT ${l.ot_codigo} (${l.ot_estado}): anule la OT antes o déjela terminar.`);
    await this.comun.exigirOperarEnUnidad(req, { id: l.unidad_id, codigo: l.unidad_codigo, nombre: l.unidad_nombre, tipo: null });
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_pn_inspeccion SET anulada = TRUE, anulada_motivo = $2, anulada_por = $3::uuid, anulada_at = now(), updated_at = now() WHERE id = $1::uuid`,
      id,
      motivo,
      usuarioId,
    );
    return this.ocDetalle(tenantId, l.oc_id);
  }

  /** Genera la OT de una inspección programada (flujo general, origen PRODUCCION_NACIONAL). */
  async generarOt(req: any, tenantId: string, usuarioId: string | null, lineaId: string) {
    const l = await this.lineaFila(tenantId, lineaId);
    const o = await this.ocFila(tenantId, l.oc_id);
    const unidad = await this.comun.unidadDeBpch(tenantId, l.unidad_id);
    await this.comun.exigirOperarEnUnidad(req, unidad);
    const { errores, avisos } = comprobarGeneracionOt(
      this.aLinea(l),
      this.ocVigencia(o),
      { numero: o.raf_numero, estado: o.raf_estado, tipoLinea: o.raf_tipo_linea, vigenciaHasta: iso(o.raf_vigencia_hasta) },
      hoyCl(),
    );
    if (errores.length) throw new ConflictException(`No se puede generar la OT. ${errores.join(" ")}`);
    const producto = (await this.productosDe(l.oc_id)).find((p) => p.id === l.oc_producto_id);
    const linea = o.raf_tipo_linea === "MOVIL" ? "línea móvil (camión fábrica)" : "línea fija";
    const descripcion = [
      `Producción Nacional · inspección del programa ${String(l.mes).padStart(2, "0")}/${o.anio}.`,
      `Fabricante: ${o.cliente_nombre} (${o.cliente_rut}). RAF DGMN ${o.raf_numero} (${linea}). O/C operativa ${o.numero}.`,
      `Producto: ${producto?.producto ?? "—"}${l.lote ? ` · lote ${l.lote}` : ""}${l.cantidad !== null ? ` · ${fmtNum(Number(l.cantidad), 3)} ${producto?.unidad_medida ?? ""}` : ""}.`,
      l.lugar ? `Lugar de inspección: ${l.lugar}.` : "",
      ...avisos.map((a) => `Aviso: ${a}`),
    ]
      .filter(Boolean)
      .join("\n");

    const ot = await this.prisma.$transaction(async (tx) => {
      // Bloqueo de la línea: dos clics simultáneos no generan dos OT.
      const bloqueada = await tx.$queryRawUnsafe<{ ot_id: string | null }[]>(
        `SELECT ot_id FROM bpch_pn_inspeccion WHERE id = $1::uuid FOR UPDATE`,
        lineaId,
      );
      if (bloqueada[0]?.ot_id && bloqueada[0].ot_id !== l.ot_id) throw new ConflictException("La inspección ya tiene una OT.");
      const creada = await this.comun.crearOt(tx, {
        tenantId,
        usuarioId,
        clienteId: o.cliente_id,
        unidad,
        origen: "PRODUCCION_NACIONAL",
        conCobro: o.con_cobro,
        resolucion: o.raf_numero,
        descripcion,
        elementoGenerico: producto?.producto ?? null,
        catElementoId: producto?.cat_elemento_id ?? null,
        detalleHistorial: {
          ocId: o.id,
          ocNumero: o.numero,
          rafNumero: o.raf_numero,
          inspeccionId: lineaId,
          mes: Number(l.mes),
          anteriorOt: l.ot_id ? { id: l.ot_id, codigo: l.ot_codigo } : null,
        },
      });
      await tx.$executeRawUnsafe(
        `UPDATE bpch_pn_inspeccion SET ot_id = $2::uuid, ot_generada_por = $3::uuid, ot_generada_at = now(), updated_at = now() WHERE id = $1::uuid`,
        lineaId,
        creada.id,
        usuarioId,
      );
      return creada;
    });
    return { ot, avisos, oc: await this.ocDetalle(tenantId, l.oc_id) };
  }

  /* ----------------------------------------------------- correlación de ventas --- */

  private async correlacionFila(tenantId: string, id: string) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*, ui.nombre_completo AS informe_por_nombre, ur.nombre_completo AS remitido_por_nombre
         FROM bpch_pn_correlacion c
         LEFT JOIN usuario ui ON ui.id = c.informe_por
         LEFT JOIN usuario ur ON ur.id = c.remitido_dco_por
        WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid`,
      id,
      tenantId,
    );
    if (!filas[0]) throw new NotFoundException("Correlación no encontrada.");
    return filas[0];
  }

  private async calcularCorrelacion(c: any, o: any) {
    const [productos, lineas, ventas] = await Promise.all([
      this.productosDe(c.oc_id),
      this.lineasDe(c.oc_id),
      this.prisma.$queryRawUnsafe<{ oc_producto_id: string; cantidad_ventas: string }[]>(
        `SELECT oc_producto_id, cantidad_ventas FROM bpch_pn_correlacion_linea WHERE correlacion_id = $1::uuid`,
        c.id,
      ),
    ]);
    const desde = iso(c.periodo_desde)!;
    const hasta = iso(c.periodo_hasta)!;
    const ejecutadas = lineas
      .filter((l) => estadoLinea(this.aLinea(l)) === "ejecutada")
      .filter((l) => {
        const f = fechaReferenciaLinea(Number(o.anio), { mes: Number(l.mes), fechaProgramada: iso(l.fecha_programada) });
        return f >= desde && f <= hasta;
      })
      .map((l) => ({ ocProductoId: l.oc_producto_id, cantidad: l.cantidad === null ? null : Number(l.cantidad), otId: l.ot_id as string | null }));
    const filas = correlacionar(
      productos.map((p) => this.aProducto(p)),
      new Map(ventas.map((v) => [v.oc_producto_id, Number(v.cantidad_ventas)])),
      ejecutadas,
    );
    // B-073 (recorrido MP-07, D07-09; maqueta: Declarado · Inspeccionado · Certificado · Desviación).
    // «Certificado»: cantidad de las inspecciones ejecutadas cuya OT tiene su documento oficial
    // (Informe de Inspección o Certificado de Conformidad) y ningún Informe de Incumplimiento.
    // Regla POR CONFIRMAR con el IDIC (carta BPCH-28: qué cuenta como inspeccionado y certificado).
    const otIds = [...new Set(ejecutadas.map((e) => e.otId).filter((x): x is string => !!x))];
    const certificadas = new Set(
      otIds.length
        ? (
            await this.prisma.$queryRawUnsafe<{ ot_id: string }[]>(
              `SELECT c.ot_id FROM certificado c
                WHERE c.ot_id = ANY($1::uuid[]) AND c.deleted_at IS NULL AND c.estado IN ('oficial', 'emitido')
                  AND c.tipo_documento IN ('INFORME_INSPECCION', 'CERTIFICADO_CONFORMIDAD')
                  AND NOT EXISTS (SELECT 1 FROM certificado x WHERE x.ot_id = c.ot_id AND x.deleted_at IS NULL
                                    AND x.tipo_documento = 'INFORME_INCUMPLIMIENTO' AND x.estado <> 'anulado')`,
              otIds,
            )
          ).map((f) => f.ot_id)
        : [],
    );
    const certificadoPor = new Map<string, number>();
    for (const e of ejecutadas)
      if (e.otId && certificadas.has(e.otId) && e.cantidad !== null)
        certificadoPor.set(e.ocProductoId, (certificadoPor.get(e.ocProductoId) ?? 0) + e.cantidad);
    const conCertificado = filas.map((f: any) => ({ ...f, certificado: certificadoPor.get(f.ocProductoId) ?? 0 }));
    return { filas: conCertificado, lineasConVentas: ventas.length, sinCantidad: ejecutadas.filter((e) => e.cantidad === null).length };
  }

  private mapearCorrelacion(c: any, calc: { filas: any[]; lineasConVentas: number; sinCantidad: number }, o: any) {
    const datos = {
      conforme: c.conforme,
      requerimientoSucursal: c.requerimiento_sucursal,
      respuestaSucursal: c.respuesta_sucursal,
      respondeRequerimiento: c.responde_requerimiento,
      solicitudDgmn: c.solicitud_dgmn,
      respuestaDgmn: c.respuesta_dgmn,
      propuestaTecnica: c.propuesta_tecnica,
      lineasConVentas: calc.lineasConVentas,
    };
    return {
      id: c.id,
      oc: { id: o.id, numero: o.numero, anio: o.anio, cliente: { razonSocial: o.cliente_nombre, rut: o.cliente_rut }, raf: o.raf_numero },
      periodoDesde: iso(c.periodo_desde),
      periodoHasta: iso(c.periodo_hasta),
      relacionVentasRef: c.relacion_ventas_ref,
      relacionVentasAt: iso(c.relacion_ventas_at),
      filas: calc.filas,
      lineasEjecutadasSinCantidad: calc.sinCantidad,
      sugerenciaConforme: sugerenciaConforme(calc.filas),
      conforme: c.conforme,
      observaciones: c.observaciones,
      requerimientoSucursal: c.requerimiento_sucursal,
      requerimientoSucursalAt: iso(c.requerimiento_sucursal_at),
      respuestaSucursal: c.respuesta_sucursal,
      respuestaSucursalAt: iso(c.respuesta_sucursal_at),
      respondeRequerimiento: c.responde_requerimiento,
      solicitudDgmn: c.solicitud_dgmn,
      solicitudDgmnAt: iso(c.solicitud_dgmn_at),
      respuestaDgmn: c.respuesta_dgmn,
      respuestaDgmnAt: iso(c.respuesta_dgmn_at),
      propuestaTecnica: c.propuesta_tecnica,
      estado: c.estado,
      faltantesInforme: c.estado === "borrador" ? faltantesInforme(datos) : [],
      informe: c.informe_numero
        ? { numero: c.informe_numero, hash: c.informe_hash, at: c.informe_at, por: c.informe_por_nombre }
        : null,
      remitidoDco: c.remitido_dco_at ? { at: c.remitido_dco_at, por: c.remitido_por_nombre } : null,
    };
  }

  async correlacion(tenantId: string, id: string) {
    const c = await this.correlacionFila(tenantId, id);
    const o = await this.ocFila(tenantId, c.oc_id);
    return this.mapearCorrelacion(c, await this.calcularCorrelacion(c, o), o);
  }

  private async guardarVentas(tx: Pick<PrismaService, "$executeRawUnsafe">, correlacionId: string, ventas: { ocProductoId: string; cantidad: number }[]) {
    await tx.$executeRawUnsafe(`DELETE FROM bpch_pn_correlacion_linea WHERE correlacion_id = $1::uuid`, correlacionId);
    for (const v of ventas)
      await tx.$executeRawUnsafe(
        `INSERT INTO bpch_pn_correlacion_linea (correlacion_id, oc_producto_id, cantidad_ventas) VALUES ($1::uuid, $2::uuid, $3)`,
        correlacionId,
        v.ocProductoId,
        v.cantidad,
      );
  }

  private async validarVentas(ocId: string, ventas?: { ocProductoId: string }[]) {
    if (!ventas?.length) return;
    const productos = new Set((await this.productosDe(ocId)).map((p) => p.id));
    if (ventas.some((v) => !productos.has(v.ocProductoId))) throw new BadRequestException("Hay productos que no son de esta O/C.");
    if (new Set(ventas.map((v) => v.ocProductoId)).size !== ventas.length) throw new BadRequestException("Un producto aparece dos veces.");
  }

  async crearCorrelacion(tenantId: string, usuarioId: string | null, ocId: string, body: unknown) {
    const d = CrearCorrelacion.parse(body ?? {});
    const o = await this.ocFila(tenantId, ocId);
    if (o.estado === "anulada") throw new ConflictException("La O/C está anulada.");
    await this.validarVentas(ocId, d.ventas);
    const id = await this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO bpch_pn_correlacion (tenant_id, oc_id, periodo_desde, periodo_hasta, relacion_ventas_ref, relacion_ventas_at, created_by)
         VALUES ($1::uuid, $2::uuid, $3::date, $4::date, $5, $6::date, $7::uuid) RETURNING id`,
        tenantId,
        ocId,
        d.periodoDesde,
        d.periodoHasta,
        d.relacionVentasRef ?? null,
        d.relacionVentasAt ?? null,
        usuarioId,
      );
      if (d.ventas?.length) await this.guardarVentas(tx, filas[0].id, d.ventas);
      return filas[0].id;
    });
    return this.correlacion(tenantId, id);
  }

  async editarCorrelacion(tenantId: string, id: string, body: unknown) {
    const d = EditarCorrelacion.parse(body ?? {});
    const c = await this.correlacionFila(tenantId, id);
    if (c.estado !== "borrador") throw new ConflictException("El informe técnico ya se emitió: la correlación no se modifica.");
    await this.validarVentas(c.oc_id, d.ventas);
    const mapa: Record<string, [string, string?]> = {
      relacionVentasRef: ["relacion_ventas_ref"],
      relacionVentasAt: ["relacion_ventas_at", "::date"],
      conforme: ["conforme"],
      observaciones: ["observaciones"],
      requerimientoSucursal: ["requerimiento_sucursal"],
      requerimientoSucursalAt: ["requerimiento_sucursal_at", "::date"],
      respuestaSucursal: ["respuesta_sucursal"],
      respuestaSucursalAt: ["respuesta_sucursal_at", "::date"],
      respondeRequerimiento: ["responde_requerimiento"],
      solicitudDgmn: ["solicitud_dgmn"],
      solicitudDgmnAt: ["solicitud_dgmn_at", "::date"],
      respuestaDgmn: ["respuesta_dgmn"],
      respuestaDgmnAt: ["respuesta_dgmn_at", "::date"],
      propuestaTecnica: ["propuesta_tecnica"],
    };
    const cols: Record<string, unknown> = {};
    const tipos: Record<string, string> = {};
    for (const [k, v] of Object.entries(d)) {
      if (v === undefined || !mapa[k]) continue;
      cols[mapa[k][0]] = v;
      if (mapa[k][1]) tipos[mapa[k][0]] = mapa[k][1]!;
    }
    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(cols).length) {
        const s = setDinamico(cols, 2, tipos);
        await tx.$executeRawUnsafe(`UPDATE bpch_pn_correlacion SET ${s.sql}, updated_at = now() WHERE id = $1::uuid`, id, ...s.valores);
      }
      if (d.ventas) await this.guardarVentas(tx, id, d.ventas);
    });
    return this.correlacion(tenantId, id);
  }

  /** Emite y sella el informe técnico a DCO (ITPN-AAAA-NNNN). */
  async emitirInforme(tenantId: string, usuarioId: string | null, id: string) {
    const c = await this.correlacionFila(tenantId, id);
    if (c.estado !== "borrador") throw new ConflictException("El informe técnico ya se emitió.");
    const o = await this.ocFila(tenantId, c.oc_id);
    const calc = await this.calcularCorrelacion(c, o);
    const faltan = faltantesInforme({
      conforme: c.conforme,
      requerimientoSucursal: c.requerimiento_sucursal,
      respuestaSucursal: c.respuesta_sucursal,
      respondeRequerimiento: c.responde_requerimiento,
      solicitudDgmn: c.solicitud_dgmn,
      respuestaDgmn: c.respuesta_dgmn,
      propuestaTecnica: c.propuesta_tecnica,
      lineasConVentas: calc.lineasConVentas,
    });
    if (faltan.length) throw new ConflictException(`No se puede emitir el informe técnico. ${faltan.join(" ")}`);
    const usuario = usuarioId ? await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nombreCompleto: true } }) : null;
    const ahora = new Date();
    await this.prisma.$transaction(async (tx) => {
      const numero = await this.comun.correlativo(tx, tenantId, "ITPN");
      const cuerpo = cuerpoInformeTecnico({
        numero,
        fecha: fmtFecha(ahora),
        fabricante: o.cliente_nombre,
        rut: o.cliente_rut,
        raf: o.raf_numero,
        linea: o.raf_tipo_linea === "MOVIL" ? "Móvil (camión fábrica)" : "Fija",
        oc: o.numero,
        anio: o.anio,
        periodo: `${fmtFecha(c.periodo_desde)} a ${fmtFecha(c.periodo_hasta)}`,
        relacionVentas: [c.relacion_ventas_ref, c.relacion_ventas_at ? fmtFecha(c.relacion_ventas_at) : ""].filter(Boolean).join(" · "),
        conforme: c.conforme === true,
        observaciones: c.observaciones ?? "",
        requerimientoSucursal: c.requerimiento_sucursal ?? "",
        respuestaSucursal: c.respuesta_sucursal ?? "",
        responde: c.responde_requerimiento,
        solicitudDgmn: c.solicitud_dgmn ?? "",
        respuestaDgmn: c.respuesta_dgmn ?? "",
        propuestaTecnica: c.propuesta_tecnica ?? "",
        elaboro: usuario?.nombreCompleto ?? "",
        filas: calc.filas,
      });
      const hash = createHash("sha256").update(cuerpo, "utf8").digest("hex");
      const n = await tx.$executeRawUnsafe(
        `UPDATE bpch_pn_correlacion SET estado = 'emitido', informe_numero = $2, informe_html = $3, informe_hash = $4,
                informe_codigo_verificacion = $5, informe_por = $6::uuid, informe_at = $7, updated_at = now()
          WHERE id = $1::uuid AND estado = 'borrador'`,
        id,
        numero,
        cuerpo,
        hash,
        nuevoCodigoVerificacion(FORMATO_BPCH),
        usuarioId,
        ahora,
      );
      if (n !== 1) throw new ConflictException("La correlación cambió mientras se emitía el informe.");
    });
    return this.correlacion(tenantId, id);
  }

  async remitirDco(tenantId: string, usuarioId: string | null, id: string) {
    const c = await this.correlacionFila(tenantId, id);
    if (c.estado !== "emitido")
      throw new ConflictException(c.estado === "remitido" ? "El informe ya se remitió a DCO." : "Emita primero el informe técnico.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_pn_correlacion SET estado = 'remitido', remitido_dco_por = $2::uuid, remitido_dco_at = now(), updated_at = now() WHERE id = $1::uuid`,
      id,
      usuarioId,
    );
    // B-018 (EP-07 7.18): el Departamento Comercial recibe el aviso en Mi bandeja, como la
    // remisión del expediente de internación (Ventas, Planificación y Jefe DCO).
    const oc = await this.ocFila(tenantId, c.oc_id).catch(() => null);
    await this.avisos
      ?.emitir(
        tenantId,
        {
          tipo: "despacho",
          titulo: `Informe técnico${c.informe_numero ? ` ${c.informe_numero}` : ""} de Producción Nacional remitido a DCO`,
          mensaje: `La correlación de ventas de la O/C ${oc?.numero ?? ""}${oc?.cliente_nombre ? ` (${oc.cliente_nombre})` : ""} fue remitida al Departamento Comercial con su informe técnico.`,
          ruta: `/bpch/produccion-nacional/correlacion/${id}`,
          clave: `pn_remision_dco:${id}`,
          creadoPor: usuarioId,
        },
        { roles: [{ rol: "COMERCIAL" }, { rol: "PLANIFICACION" }, { rol: "JEFE_DEPTO", unidadCodigo: "DCO" }] },
      )
      .catch(() => undefined);
    return this.correlacion(tenantId, id);
  }

  private async informeDoc(tenantId: string, id: string) {
    const c = await this.correlacionFila(tenantId, id);
    if (!c.informe_html) throw new NotFoundException("El informe técnico aún no se ha emitido.");
    const sello: Sello = {
      numero: c.informe_numero,
      codigoVerificacion: c.informe_codigo_verificacion ?? "—",
      hash: c.informe_hash ?? "",
      fecha: fmtFecha(c.informe_at),
      urlVerificacion: this.baseVerificacion,
    };
    return { c, sello, titulo: `${c.informe_numero} · Informe técnico Producción Nacional` };
  }

  async informeHtml(tenantId: string, id: string) {
    const { c, sello, titulo } = await this.informeDoc(tenantId, id);
    return documentoCompleto(c.informe_html, sello, titulo);
  }

  async informePdf(tenantId: string, id: string) {
    const { c, sello, titulo } = await this.informeDoc(tenantId, id);
    return { buffer: await generarPdf(c.informe_html, sello, titulo), nombre: `${c.informe_numero}.pdf` };
  }

  /** Datos de origen de una OT de Producción Nacional (para el expediente de la OT). */
  async origenDeOt(otId: string) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT l.id, l.mes, l.lote, l.cantidad, l.lugar, o.id AS oc_id, o.numero AS oc_numero, o.anio, r.numero AS raf_numero, r.tipo_linea,
              p.producto, p.unidad_medida, c.id AS clas_id, c.codigo AS clas_codigo, c.explosiva, c.clase_division, c.grupo_compatibilidad, c.numero_onu
         FROM bpch_pn_inspeccion l
         JOIN bpch_oc_operativa o ON o.id = l.oc_id
         JOIN bpch_raf r ON r.id = o.raf_id
         JOIN bpch_oc_producto p ON p.id = l.oc_producto_id
         LEFT JOIN bpch_clasificacion c ON c.id = p.clasificacion_id
        WHERE l.ot_id = $1::uuid`,
      otId,
    );
    return filas[0] ?? null;
  }
}
