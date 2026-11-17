/**
 * Solicitud de adquisición de bienes y/o servicios (IDIC-PG06-IT02-FORM01 Rev. 02).
 *
 * El laboratorio crea la solicitud (alcance por unidad, adquisicion.crear), su
 * jefatura da el V°B° o la devuelve con motivo (adquisicion.visar, nunca quien
 * la creó) y Abastecimiento (SAB, adquisicion.gestionar) la recibe, anota la
 * orden de compra (Nº, fecha, proveedor y estado) y su recepción en bodega.
 * Convive con los sistemas de compra de SAB y Finanzas: no maneja presupuesto,
 * ni las firmas de Finanzas y Dirección, ni emite la O/C.
 *
 * Reglas puras (transiciones, validaciones, totales y PDF) en reglas-adquisicion.ts.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { NumeracionService } from "../plantilla-render/numeracion.service";
import { AvisosService } from "../avisos/avisos.service";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import { fechaChile, fechaHoraChile } from "../common/fecha-chile";
import { hoyCl } from "../ot/plazos";
import {
  accionesDisponibles,
  editableAdquisicion,
  errorAutoVisado,
  erroresOrdenCompra,
  erroresRecepcionBodega,
  erroresSolicitud,
  errorTransicion,
  estadoTras,
  htmlSolicitud,
  itemsParaIngresoBodega,
  totales,
  type AccionAdquisicion,
  type Actor,
  type Capacidades,
  type EstadoAdquisicion,
  type ItemSolicitud,
} from "./reglas-adquisicion";

const TIPO = "SOLICITUD_ADQUISICION";
const esSuper = (req: any) => (req?.user?.roles ?? []).includes("SUPERADMIN");
const tienePermiso = (req: any, p: string) => esSuper(req) || (req?.user?.permisos ?? []).includes(p);
const usuarioDe = (req: any): string => req?.user?.sub;
const tenantDe = (req: any): string => req?.user?.tenantId;

export interface SolicitudDto {
  unidadId: string;
  fecha?: string;
  centroCosto: string;
  solicitanteNombre: string;
  solicitanteCargo?: string | null;
  delegacionAtribuciones?: boolean;
  objetivo: string;
  aplicaIva?: boolean;
  otId?: string | null;
  items: ItemSolicitud[];
}

@Injectable()
export class SolicitudAdquisicionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly numeracion: NumeracionService,
    private readonly avisos: AvisosService,
  ) {}

  /* --------------------------------------------------------------- lectura --- */

  private async fila(id: string, req: any) {
    const [s] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT s.*, s.fecha::text AS fecha_txt, s.oc_fecha::text AS oc_fecha_txt, s.bodega_fecha::text AS bodega_fecha_txt,
              u.codigo AS unidad_codigo, u.nombre AS unidad_nombre, ot.codigo AS ot_codigo,
              uc.nombre_completo AS creado_por_nombre, uv.nombre_completo AS visada_por_nombre, uv.cargo AS visada_por_cargo,
              us.nombre_completo AS sab_recibida_por_nombre, uo.nombre_completo AS oc_registrada_por_nombre,
              ub.nombre_completo AS bodega_recibida_por_nombre
         FROM solicitud_adquisicion s
         JOIN unidad u ON u.id = s.unidad_id
         LEFT JOIN orden_trabajo ot ON ot.id = s.ot_id
         LEFT JOIN usuario uc ON uc.id = s.creado_por
         LEFT JOIN usuario uv ON uv.id = s.visada_por
         LEFT JOIN usuario us ON us.id = s.sab_recibida_por
         LEFT JOIN usuario uo ON uo.id = s.oc_registrada_por
         LEFT JOIN usuario ub ON ub.id = s.bodega_recibida_por
        WHERE s.id = $1::uuid AND s.tenant_id = $2::uuid`,
      id,
      tenantDe(req),
    );
    if (!s) throw new NotFoundException("Solicitud de adquisición no encontrada.");
    return s;
  }

  private items(solicitudId: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT i.id, i.orden, i.cantidad::float8 AS cantidad, i.unidad_medida AS "unidadMedida", i.descripcion,
              i.valor_unitario::float8 AS "valorUnitario", i.consumible_id AS "consumibleId", i.equipo_id AS "equipoId",
              c.codigo AS "consumibleCodigo", c.nombre AS "consumibleNombre", c.unidad_medida AS "consumibleUnidad",
              e.codigo AS "equipoCodigo", COALESCE(e.nombre, e.descripcion) AS "equipoNombre"
         FROM solicitud_adquisicion_item i
         LEFT JOIN consumible c ON c.id = i.consumible_id
         LEFT JOIN equipo e ON e.id = i.equipo_id
        WHERE i.solicitud_id = $1::uuid ORDER BY i.orden, i.id`,
      solicitudId,
    );
  }

  private eventos(solicitudId: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.id, e.accion, e.estado_desde AS "estadoDesde", e.estado_hasta AS "estadoHasta", e.motivo, e.detalle,
              e.created_at AS "createdAt", u.nombre_completo AS usuario
         FROM solicitud_adquisicion_evento e LEFT JOIN usuario u ON u.id = e.usuario_id
        WHERE e.solicitud_id = $1::uuid ORDER BY e.created_at, e.id`,
      solicitudId,
    );
  }

  /** Qué puede hacer la persona con una solicitud de esa unidad. */
  private async capacidades(req: any, s: { unidad_id: string; creado_por: string | null }): Promise<Capacidades> {
    const laboratorio = tienePermiso(req, "adquisicion.crear") && (await this.alcance.puedeVerUnidad(req, s.unidad_id, "adquisicion.crear"));
    const jefatura = tienePermiso(req, "adquisicion.visar") && (await this.alcance.puedeVerUnidad(req, s.unidad_id, "adquisicion.visar"));
    return { esCreador: !!s.creado_por && s.creado_por === usuarioDe(req), laboratorio, jefatura, sab: tienePermiso(req, "adquisicion.gestionar") };
  }

  /** La ve quien tiene adquisicion.ver en su laboratorio, Abastecimiento (todas) y quien la creó. */
  private async exigirVer(s: any, req: any) {
    if (s.creado_por === usuarioDe(req) || tienePermiso(req, "adquisicion.gestionar")) return;
    if (!tienePermiso(req, "adquisicion.ver")) throw new ForbiddenException("No tiene permiso para ver solicitudes de adquisición (adquisicion.ver).");
    await this.alcance.exigirUnidad(req, s.unidad_id, `la solicitud ${s.numero ?? ""}`.trim(), "adquisicion.ver");
  }

  async detalle(id: string, req: any) {
    const s = await this.fila(id, req);
    await this.exigirVer(s, req);
    const [items, eventos, cap] = await Promise.all([this.items(id), this.eventos(id), this.capacidades(req, s)]);
    const t = totales(items, s.aplica_iva);
    const acciones = accionesDisponibles(s.estado, cap);
    const puedeBodega = s.estado === "recibida_bodega" && tienePermiso(req, "consumible.gestionar");
    return {
      id: s.id,
      numero: s.numero,
      estado: s.estado as EstadoAdquisicion,
      fecha: s.fecha_txt,
      unidad: { id: s.unidad_id, codigo: s.unidad_codigo, nombre: s.unidad_nombre },
      centroCosto: s.centro_costo,
      solicitanteNombre: s.solicitante_nombre,
      solicitanteCargo: s.solicitante_cargo,
      delegacionAtribuciones: s.delegacion_atribuciones,
      objetivo: s.objetivo,
      aplicaIva: s.aplica_iva,
      ot: s.ot_id ? { id: s.ot_id, codigo: s.ot_codigo } : null,
      items: items.map((i, k) => ({ ...i, total: t.lineas[k] })),
      totales: { subtotal: t.subtotal, iva: t.iva, total: t.total, sinValor: t.sinValor },
      creadoPor: s.creado_por_nombre,
      createdAt: s.created_at,
      enviadaAt: s.enviada_at,
      vb: s.visada_por ? { nombre: s.visada_por_nombre, cargo: s.visada_por_cargo, at: s.visada_at } : null,
      devueltaMotivo: s.devuelta_motivo,
      anuladaMotivo: s.anulada_motivo,
      sab: s.sab_recibida_por ? { numero: s.sab_numero, nombre: s.sab_recibida_por_nombre, at: s.sab_recibida_at } : null,
      oc: s.oc_numero
        ? { numero: s.oc_numero, fecha: s.oc_fecha_txt, proveedor: s.oc_proveedor, estado: s.oc_estado, por: s.oc_registrada_por_nombre, at: s.oc_registrada_at }
        : null,
      bodega: s.bodega_fecha ? { fecha: s.bodega_fecha_txt, por: s.bodega_recibida_por_nombre, at: s.bodega_recibida_at } : null,
      eventos,
      // Recibida en bodega: se ofrece (no se obliga) registrar el ingreso del lote en Bodegas.
      ingresoBodega: puedeBodega
        ? itemsParaIngresoBodega(items).map((i) => ({
            itemId: i.id,
            consumibleId: i.consumibleId,
            consumible: `${i.consumibleCodigo} · ${i.consumibleNombre}`,
            cantidad: i.cantidad,
            unidadMedida: i.unidadMedida ?? i.consumibleUnidad,
            valorUnitario: i.valorUnitario,
          }))
        : [],
      puedo: {
        editar: editableAdquisicion(s.estado) && cap.laboratorio,
        acciones,
        motivoNoVisar: s.estado === "enviada" && cap.jefatura && cap.esCreador ? errorAutoVisado(s.creado_por, usuarioDe(req)) : null,
      },
    };
  }

  /**
   * Listado de su ámbito con filtros por estado y laboratorio. Abastecimiento ve
   * todas. «por_visar»: enviadas de los laboratorios donde da el V°B° (no las
   * suyas); «por_gestionar»: con V°B° o en manos de SAB; «mias»: las que creó.
   */
  async listar(req: any, f: { estado?: string; unidadId?: string; vista?: string; otId?: string; q?: string }) {
    const yo = usuarioDe(req);
    const sab = tienePermiso(req, "adquisicion.gestionar");
    const filtro = sab ? null : await this.alcance.filtroUnidades(req, "adquisicion.ver");
    let estados: string[] | null = f.estado ? [f.estado] : null;
    let unidades: string[] | null = filtro;
    let soloAjenas = false;
    if (f.vista === "por_visar") {
      if (!tienePermiso(req, "adquisicion.visar")) return { data: [], total: 0 };
      estados = ["enviada"];
      unidades = await this.alcance.filtroUnidades(req, "adquisicion.visar");
      soloAjenas = true;
    } else if (f.vista === "por_gestionar") {
      if (!sab) return { data: [], total: 0 };
      estados = ["visada", "recibida_sab", "en_compra"];
    }
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT s.id, s.numero, s.estado, s.fecha::text AS fecha, s.objetivo, s.centro_costo AS "centroCosto",
              s.solicitante_nombre AS "solicitante", u.id AS "unidadId", u.codigo AS unidad, u.nombre AS "unidadNombre",
              ot.codigo AS ot, s.oc_numero AS "ocNumero", s.oc_estado AS "ocEstado", s.sab_numero AS "sabNumero",
              s.creado_por = $3::uuid AS "esMia", s.updated_at AS "updatedAt",
              (SELECT count(*)::int FROM solicitud_adquisicion_item i WHERE i.solicitud_id = s.id) AS items,
              (SELECT COALESCE(sum(round(i.cantidad * i.valor_unitario)), 0)::float8 FROM solicitud_adquisicion_item i WHERE i.solicitud_id = s.id) AS subtotal,
              s.aplica_iva AS "aplicaIva"
         FROM solicitud_adquisicion s
         JOIN unidad u ON u.id = s.unidad_id
         LEFT JOIN orden_trabajo ot ON ot.id = s.ot_id
        WHERE s.tenant_id = $1::uuid
          AND ($2::uuid[] IS NULL OR s.unidad_id = ANY($2::uuid[]) OR (NOT $8::boolean AND s.creado_por = $3::uuid))
          AND ($4::text[] IS NULL OR s.estado = ANY($4::text[]))
          AND ($5::uuid IS NULL OR s.unidad_id = $5::uuid)
          AND ($6::uuid IS NULL OR s.ot_id = $6::uuid)
          AND (NOT $8::boolean OR s.creado_por IS DISTINCT FROM $3::uuid)
          AND ($7::text IS NULL OR s.numero ILIKE $7 OR s.objetivo ILIKE $7 OR s.oc_numero ILIKE $7 OR s.solicitante_nombre ILIKE $7)
          AND ($9::boolean IS NOT TRUE OR s.creado_por = $3::uuid)
        ORDER BY s.updated_at DESC LIMIT 300`,
      tenantDe(req),
      unidades,
      yo,
      estados,
      f.unidadId || null,
      f.otId || null,
      f.q?.trim() ? `%${f.q.trim()}%` : null,
      soloAjenas,
      f.vista === "mias",
    );
    for (const r of data) {
      const iva = r.aplicaIva ? Math.round(Number(r.subtotal) * 0.19) : 0;
      r.total = Number(r.subtotal) + iva;
    }
    return { data, total: data.length };
  }

  /** Laboratorios donde la persona puede crear solicitudes, con su centro de costo y su nombre como solicitante. */
  async opciones(req: any) {
    const filtro = await this.alcance.filtroUnidades(req, "adquisicion.crear");
    const unidades = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, nombre, centro_costo AS "centroCosto", tipo FROM unidad
        WHERE tenant_id = $1::uuid AND activa IS NOT FALSE AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
        ORDER BY codigo`,
      tenantDe(req),
      filtro,
    );
    const [u] = await this.prisma.$queryRawUnsafe<any[]>(`SELECT nombre_completo, cargo FROM usuario WHERE id = $1::uuid`, usuarioDe(req));
    return {
      unidades: unidades.map((x) => ({ ...x, centroCostoSugerido: x.centroCosto ? `${x.centroCosto} «${x.nombre}»` : `${x.codigo} · ${x.nombre}` })),
      solicitante: { nombre: u?.nombre_completo ?? req?.user?.username ?? "", cargo: u?.cargo ?? null },
    };
  }

  /** Consumibles del kardex para ligar un ítem (los laboratorios no tienen consumible.gestionar). */
  buscarConsumibles(req: any, q?: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, nombre, unidad_medida AS "unidadMedida", unidad_compra AS "unidadCompra", costo_unitario_clp::float8 AS "costoUnitario"
         FROM consumible WHERE tenant_id = $1::uuid AND activo IS NOT FALSE
          AND ($2::text IS NULL OR codigo ILIKE $2 OR nombre ILIKE $2)
        ORDER BY nombre LIMIT 30`,
      tenantDe(req),
      q?.trim() ? `%${q.trim()}%` : null,
    );
  }

  /** Equipos para ligar un ítem (reparación, repuesto, mantención): primero los del laboratorio. */
  buscarEquipos(req: any, q?: string, unidadId?: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.id, e.codigo, COALESCE(e.nombre, e.descripcion) AS nombre, u.codigo AS unidad
         FROM equipo e LEFT JOIN unidad u ON u.id = e.unidad_id
        WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL
          AND ($2::text IS NULL OR e.codigo ILIKE $2 OR e.nombre ILIKE $2 OR e.descripcion ILIKE $2 OR e.serie ILIKE $2)
        ORDER BY (e.unidad_id IS NOT DISTINCT FROM $3::uuid) DESC, e.codigo LIMIT 30`,
      tenantDe(req),
      q?.trim() ? `%${q.trim()}%` : null,
      unidadId || null,
    );
  }

  /* ---------------------------------------------------------- crear / editar --- */

  /** Comprueba el laboratorio, la OT y los vínculos de los ítems. */
  private async validar(dto: SolicitudDto, req: any) {
    const errores = erroresSolicitud(dto);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const tenantId = tenantDe(req);
    const [u] = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id, codigo FROM unidad WHERE id = $1::uuid AND tenant_id = $2::uuid`, dto.unidadId, tenantId);
    if (!u) throw new BadRequestException("El laboratorio solicitante no existe.");
    if (!(await this.alcance.puedeVerUnidad(req, u.id, "adquisicion.crear")))
      throw new ForbiddenException(`Solo puede crear solicitudes de adquisición de su laboratorio: ${u.codigo} no está en su alcance.`);
    if (dto.otId) {
      const [ot] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, codigo, unidad_principal FROM orden_trabajo WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        dto.otId,
        tenantId,
      );
      if (!ot) throw new BadRequestException("La OT indicada no existe.");
      if (!(await this.alcance.puedeVerUnidad(req, ot.unidad_principal, "ot.ver")))
        throw new ForbiddenException(`La OT ${ot.codigo} no está en su alcance: elija una OT de su laboratorio.`);
    }
    const consumibles = [...new Set(dto.items.map((i) => i.consumibleId).filter(Boolean))] as string[];
    if (consumibles.length) {
      const n = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id FROM consumible WHERE id = ANY($1::uuid[]) AND tenant_id = $2::uuid`, consumibles, tenantId);
      if (n.length !== consumibles.length) throw new BadRequestException("Un ítem está ligado a un consumible que no existe en el kardex.");
    }
    const equipos = [...new Set(dto.items.map((i) => i.equipoId).filter(Boolean))] as string[];
    if (equipos.length) {
      const n = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM equipo WHERE id = ANY($1::uuid[]) AND tenant_id = $2::uuid AND deleted_at IS NULL`,
        equipos,
        tenantId,
      );
      if (n.length !== equipos.length) throw new BadRequestException("Un ítem está ligado a un equipo que no existe o fue dado de baja.");
    }
  }

  private async guardarItems(tx: any, tenantId: string, solicitudId: string, items: ItemSolicitud[]) {
    await tx.$executeRawUnsafe(`DELETE FROM solicitud_adquisicion_item WHERE solicitud_id = $1::uuid`, solicitudId);
    for (const [k, i] of items.entries())
      await tx.$executeRawUnsafe(
        `INSERT INTO solicitud_adquisicion_item (tenant_id, solicitud_id, orden, cantidad, unidad_medida, descripcion, valor_unitario, consumible_id, equipo_id)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid, $9::uuid)`,
        tenantId,
        solicitudId,
        k + 1,
        i.cantidad,
        i.unidadMedida?.trim() || null,
        i.descripcion.trim(),
        i.valorUnitario ?? null,
        i.consumibleId || null,
        i.equipoId || null,
      );
  }

  private async evento(db: any, s: { id: string; tenant_id: string }, accion: string, desde: string | null, hasta: string | null, req: any, motivo?: string | null, detalle?: unknown) {
    await db.$executeRawUnsafe(
      `INSERT INTO solicitud_adquisicion_evento (tenant_id, solicitud_id, accion, estado_desde, estado_hasta, motivo, detalle, usuario_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8::uuid)`,
      s.tenant_id,
      s.id,
      accion,
      desde,
      hasta,
      motivo ?? null,
      detalle === undefined ? null : JSON.stringify(detalle),
      usuarioDe(req),
    );
  }

  async crear(dto: SolicitudDto, req: any) {
    await this.validar(dto, req);
    const tenantId = tenantDe(req);
    const id = await this.prisma.$transaction(async (tx) => {
      const [f] = await tx.$queryRawUnsafe<{ id: string; tenant_id: string }[]>(
        `INSERT INTO solicitud_adquisicion (tenant_id, unidad_id, fecha, centro_costo, solicitante_nombre, solicitante_cargo,
                                            delegacion_atribuciones, objetivo, aplica_iva, ot_id, creado_por)
         VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6, $7, $8, $9, $10::uuid, $11::uuid) RETURNING id, tenant_id`,
        tenantId,
        dto.unidadId,
        dto.fecha ?? hoyCl(),
        dto.centroCosto.trim(),
        dto.solicitanteNombre.trim(),
        dto.solicitanteCargo?.trim() || null,
        dto.delegacionAtribuciones ?? false,
        dto.objetivo.trim(),
        dto.aplicaIva ?? true,
        dto.otId || null,
        usuarioDe(req),
      );
      await this.guardarItems(tx, tenantId, f.id, dto.items);
      await this.evento(tx, f, "creada", null, "borrador", req);
      return f.id;
    });
    return this.detalle(id, req);
  }

  async editar(id: string, dto: SolicitudDto, req: any) {
    const s = await this.fila(id, req);
    const cap = await this.capacidades(req, s);
    if (!cap.laboratorio) throw new ForbiddenException("Solo el laboratorio solicitante corrige la solicitud.");
    if (!editableAdquisicion(s.estado)) throw new ConflictException("Solo se corrige una solicitud en borrador o devuelta.");
    if (dto.unidadId !== s.unidad_id) throw new BadRequestException("El laboratorio solicitante no se cambia: anule la solicitud y cree otra.");
    await this.validar(dto, req);
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.$executeRawUnsafe(
        `UPDATE solicitud_adquisicion SET fecha = COALESCE($2::date, fecha), centro_costo = $3, solicitante_nombre = $4, solicitante_cargo = $5,
                delegacion_atribuciones = $6, objetivo = $7, aplica_iva = $8, ot_id = $9::uuid, updated_at = now()
          WHERE id = $1::uuid AND estado IN ('borrador', 'devuelta')`,
        id,
        dto.fecha ?? null,
        dto.centroCosto.trim(),
        dto.solicitanteNombre.trim(),
        dto.solicitanteCargo?.trim() || null,
        dto.delegacionAtribuciones ?? false,
        dto.objetivo.trim(),
        dto.aplicaIva ?? true,
        dto.otId || null,
      );
      if (Number(n) !== 1) throw new ConflictException("La solicitud cambió de estado. Actualice la pantalla.");
      await this.guardarItems(tx, s.tenant_id, id, dto.items);
      await this.evento(tx, s, "corregida", s.estado, s.estado, req);
    });
    return this.detalle(id, req);
  }

  /* --------------------------------------------------------------- circuito --- */

  /** Actor con el que la persona ejecuta la acción, o 403/409 con el motivo. */
  private async actor(s: any, accion: AccionAdquisicion, req: any): Promise<Actor> {
    const cap = await this.capacidades(req, s);
    const candidatos: Actor[] = [];
    if (cap.laboratorio) candidatos.push("laboratorio");
    if (cap.jefatura) candidatos.push("jefatura");
    if (cap.sab) candidatos.push("sab");
    const ok = candidatos.find((a) => !errorTransicion(s.estado, accion, a));
    if (ok) {
      if (accion === "visar") {
        const e = errorAutoVisado(s.creado_por, usuarioDe(req));
        if (e) throw new ForbiddenException(e);
      }
      return ok;
    }
    const err = errorTransicion(s.estado, accion, candidatos[0] ?? "laboratorio");
    // Estado que no admite la acción: 409. Estado correcto pero sin el rol que corresponde: 403.
    const algunActor = (["laboratorio", "jefatura", "sab"] as Actor[]).some((a) => !errorTransicion(s.estado, accion, a));
    if (algunActor) throw new ForbiddenException(err ?? "No le corresponde este paso de la solicitud.");
    throw new ConflictException(err ?? "La solicitud no admite este paso.");
  }

  /** Cambia el estado con bloqueo optimista y deja el evento en el historial. */
  private async mover(s: any, accion: AccionAdquisicion, req: any, sets: string, params: unknown[], motivo?: string | null, detalle?: unknown) {
    const hasta = estadoTras(accion);
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.$executeRawUnsafe(
        `UPDATE solicitud_adquisicion SET estado = $2${sets ? `, ${sets}` : ""}, updated_at = now() WHERE id = $1::uuid AND estado = $3`,
        s.id,
        hasta,
        s.estado,
        ...params,
      );
      if (Number(n) !== 1) throw new ConflictException("La solicitud cambió de estado mientras la tenía abierta. Actualice la pantalla.");
      await this.evento(tx, s, accion, s.estado, hasta, req, motivo, detalle);
    });
  }

  /** Enviar a la jefatura: valida, asigna el Nº de registro (numeración SOLICITUD_ADQUISICION) y avisa a la jefatura. */
  async enviar(id: string, req: any) {
    const s = await this.fila(id, req);
    await this.actor(s, "enviar", req);
    const items = await this.items(id);
    const errores = erroresSolicitud({ centroCosto: s.centro_costo, solicitanteNombre: s.solicitante_nombre, objetivo: s.objetivo, items });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.prisma.$transaction(async (tx) => {
      const [b] = await tx.$queryRawUnsafe<{ estado: string; numero: string | null }[]>(`SELECT estado, numero FROM solicitud_adquisicion WHERE id = $1::uuid FOR UPDATE`, id);
      if (b.estado !== s.estado) throw new ConflictException("La solicitud cambió de estado. Actualice la pantalla.");
      let numero = b.numero;
      if (!numero) {
        const r = await this.numeracion.reservar(
          tx,
          { tenantId: s.tenant_id, unidadId: s.unidad_id, tipo: TIPO, fecha: new Date(), ot: s.ot_codigo ?? null },
          async (n) => (await tx.$queryRawUnsafe<any[]>(`SELECT 1 FROM solicitud_adquisicion WHERE tenant_id = $1::uuid AND numero = $2`, s.tenant_id, n)).length > 0,
        );
        if (!r.numero)
          throw new ConflictException(
            "No hay numeración para las solicitudes de adquisición de este laboratorio: pida a Administración que la configure en Administración › Numeración de documentos (tipo «Solicitud de adquisición»).",
          );
        numero = r.numero;
      }
      await tx.$executeRawUnsafe(
        `UPDATE solicitud_adquisicion SET estado = 'enviada', numero = $2, enviada_por = $3::uuid, enviada_at = now(),
                visada_por = NULL, visada_at = NULL, updated_at = now() WHERE id = $1::uuid`,
        id,
        numero,
        usuarioDe(req),
      );
      await this.evento(tx, s, "enviar", s.estado, "enviada", req, null, { numero });
    });
    const d = await this.detalle(id, req);
    await this.avisos
      .emitir(
        s.tenant_id,
        {
          tipo: "adquisicion_vb",
          titulo: `Solicitud de adquisición ${d.numero} · V°B° pendiente`,
          mensaje: `${d.unidad.codigo} pide: ${d.objetivo.slice(0, 160)}. Revise la solicitud y dé su V°B° o devuélvala con motivo.`,
          ruta: `/solicitudes-adquisicion/${id}`,
          clave: `adquisicion_vb:${id}:${d.numero}:${Date.now()}`,
          creadoPor: usuarioDe(req),
        },
        { jefesDe: [s.unidad_id] },
      )
      .catch(() => undefined);
    return d;
  }

  async visar(id: string, req: any) {
    const s = await this.fila(id, req);
    await this.actor(s, "visar", req);
    await this.mover(s, "visar", req, "visada_por = $4::uuid, visada_at = now(), devuelta_motivo = NULL", [usuarioDe(req)]);
    await this.resolverAvisosVb(s);
    const d = await this.detalle(id, req);
    await this.avisos
      .emitir(
        s.tenant_id,
        {
          tipo: "adquisicion_sab",
          titulo: `Solicitud de adquisición ${d.numero} con V°B°: por recibir`,
          mensaje: `${d.unidad.codigo} · ${d.objetivo.slice(0, 160)}. Recíbala en Abastecimiento y anote su Nº de registro interno.`,
          ruta: `/solicitudes-adquisicion/${id}`,
          clave: `adquisicion_sab:${id}:visada`,
          creadoPor: usuarioDe(req),
        },
        { roles: [{ rol: "ABASTECIMIENTO" }], usuarios: [s.creado_por] },
      )
      .catch(() => undefined);
    return d;
  }

  async devolver(id: string, motivo: string, req: any) {
    const s = await this.fila(id, req);
    const actor = await this.actor(s, "devolver", req);
    await this.mover(s, "devolver", req, "devuelta_motivo = $4", [motivo.trim()], motivo.trim(), { por: actor === "sab" ? "Abastecimiento" : "Jefatura" });
    await this.resolverAvisosVb(s);
    await this.avisos
      .emitir(
        s.tenant_id,
        {
          tipo: "adquisicion_devuelta",
          titulo: `Solicitud de adquisición ${s.numero ?? ""} devuelta`.replace(/\s+/g, " "),
          mensaje: `Devuelta por ${actor === "sab" ? "Abastecimiento (SAB)" : "la jefatura del laboratorio"}: ${motivo.trim()}. Corríjala y vuelva a enviarla.`,
          ruta: `/solicitudes-adquisicion/${id}`,
          clave: `adquisicion_devuelta:${id}:${Date.now()}`,
          creadoPor: usuarioDe(req),
        },
        { usuarios: [s.creado_por] },
      )
      .catch(() => undefined);
    return this.detalle(id, req);
  }

  async recibirSab(id: string, dto: { numeroSab?: string | null }, req: any) {
    const s = await this.fila(id, req);
    await this.actor(s, "recibir_sab", req);
    await this.mover(s, "recibir_sab", req, "sab_numero = $4, sab_recibida_por = $5::uuid, sab_recibida_at = now()", [dto.numeroSab?.trim() || null, usuarioDe(req)], null, {
      numeroSab: dto.numeroSab?.trim() || null,
    });
    return this.detalle(id, req);
  }

  /** SAB anota la O/C (Nº, fecha, proveedor y estado). En «en proceso de compra» corrige esos datos. */
  async registrarOc(id: string, dto: { numero: string; fecha: string; proveedor: string; estado?: string | null }, req: any) {
    const s = await this.fila(id, req);
    await this.actor(s, "registrar_oc", req);
    const errores = erroresOrdenCompra({ numero: dto.numero, fecha: dto.fecha, proveedor: dto.proveedor, hoy: hoyCl() });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const oc = { numero: dto.numero.trim(), fecha: dto.fecha, proveedor: dto.proveedor.trim(), estado: dto.estado?.trim() || null };
    await this.mover(
      s,
      "registrar_oc",
      req,
      "oc_numero = $4, oc_fecha = $5::date, oc_proveedor = $6, oc_estado = $7, oc_registrada_por = $8::uuid, oc_registrada_at = now()",
      [oc.numero, oc.fecha, oc.proveedor, oc.estado, usuarioDe(req)],
      null,
      { ...oc, correccion: s.estado === "en_compra" },
    );
    if (s.estado !== "en_compra")
      await this.avisos
        .emitir(
          s.tenant_id,
          {
            tipo: "adquisicion_sab",
            titulo: `Solicitud ${s.numero}: O/C ${oc.numero} emitida`,
            mensaje: `Abastecimiento registró la orden de compra ${oc.numero} del ${fechaChile(oc.fecha)} a ${oc.proveedor}.`,
            ruta: `/solicitudes-adquisicion/${id}`,
            clave: `adquisicion_sab:${id}:oc`,
            creadoPor: usuarioDe(req),
          },
          { usuarios: [s.creado_por] },
        )
        .catch(() => undefined);
    return this.detalle(id, req);
  }

  async recibirBodega(id: string, dto: { fecha?: string; observacion?: string | null }, req: any) {
    const s = await this.fila(id, req);
    await this.actor(s, "recibir_bodega", req);
    const fecha = dto.fecha ?? hoyCl();
    const errores = erroresRecepcionBodega({ fecha, hoy: hoyCl(), fechaOc: s.oc_fecha_txt });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.mover(s, "recibir_bodega", req, "bodega_fecha = $4::date, bodega_recibida_por = $5::uuid, bodega_recibida_at = now()", [fecha, usuarioDe(req)], dto.observacion?.trim() || null, {
      fecha,
    });
    await this.avisos
      .emitir(
        s.tenant_id,
        {
          tipo: "adquisicion_sab",
          titulo: `Solicitud ${s.numero}: recibida en bodega`,
          mensaje: `Lo solicitado (O/C ${s.oc_numero ?? "—"}) llegó a bodega el ${fechaChile(fecha)}.`,
          ruta: `/solicitudes-adquisicion/${id}`,
          clave: `adquisicion_sab:${id}:bodega`,
          creadoPor: usuarioDe(req),
        },
        { usuarios: [s.creado_por] },
      )
      .catch(() => undefined);
    return this.detalle(id, req);
  }

  async anular(id: string, motivo: string, req: any) {
    const s = await this.fila(id, req);
    await this.actor(s, "anular", req);
    await this.mover(s, "anular", req, "anulada_motivo = $4", [motivo.trim()], motivo.trim());
    await this.resolverAvisosVb(s);
    return this.detalle(id, req);
  }

  /** Avisos «V°B° pendiente» de la solicitud: dejan de estar pendientes al visar, devolver o anular. */
  private async resolverAvisosVb(s: { id: string; tenant_id: string }) {
    await this.prisma
      .$executeRawUnsafe(
        `UPDATE aviso SET leido_at = now() WHERE tenant_id = $1::uuid AND clave LIKE $2 AND leido_at IS NULL`,
        s.tenant_id,
        `adquisicion_vb:${s.id}:%`,
      )
      .catch(() => undefined);
  }

  /* -------------------------------------------------------------------- PDF --- */

  async pdf(id: string, req: any): Promise<{ buffer: Buffer; nombre: string }> {
    const d = await this.detalle(id, req);
    const cuerpo = htmlSolicitud({
      numero: d.numero,
      estado: d.estado,
      fecha: d.fecha,
      centroCosto: d.centroCosto,
      solicitanteNombre: d.solicitanteNombre,
      solicitanteCargo: d.solicitanteCargo,
      delegacionAtribuciones: d.delegacionAtribuciones,
      objetivo: d.objetivo,
      aplicaIva: d.aplicaIva,
      items: d.items.map((i: any) => ({
        ...i,
        vinculo: i.consumibleId ? `consumible ${i.consumibleCodigo}` : i.equipoId ? `equipo ${i.equipoCodigo}` : null,
      })),
      ot: d.ot?.codigo ?? null,
      vb: d.vb ? { nombre: d.vb.nombre, cargo: d.vb.cargo, fecha: fechaHoraChile(d.vb.at) } : null,
      sab: d.sab ? { numero: d.sab.numero, fecha: fechaChile(d.sab.at), nombre: d.sab.nombre } : null,
      oc: d.oc ? { numero: d.oc.numero, fecha: d.oc.fecha, proveedor: d.oc.proveedor, estado: d.oc.estado } : null,
    });
    const hash = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    const estadoDocumento = d.estado === "enviada" ? "en_firma" : d.estado === "devuelta" ? "devuelto" : d.estado === "anulada" ? "anulado" : "oficial";
    const buffer = await generarPdf(
      cuerpo,
      {
        numero: d.numero ?? "BORRADOR",
        codigoVerificacion: "—",
        hash,
        fecha: fechaChile(d.fecha),
        urlVerificacion: "",
        borrador: d.estado === "borrador",
        estadoDocumento,
        motivoEstado: d.devueltaMotivo ?? d.anuladaMotivo ?? null,
      },
      `Solicitud de adquisición ${d.numero ?? "borrador"}`,
    );
    return { buffer, nombre: `Solicitud_adquisicion_${(d.numero ?? "borrador").replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf` };
  }
}
