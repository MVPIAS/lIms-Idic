/**
 * Seguimiento, despacho, entrega y envío de la OT (T20 y T23, frente r4c ·
 * docs/FLUJO_AVISOS_DESPACHO_OFICIO.md):
 *   · «Notificar plazo al cliente» (EP-00 4.3);
 *   · «Despachar →» del documento oficial y su recepción por el destino
 *     (EP-01 6.3, EP-03 6.2, EP-05 8.1; «Remitir a DCO» del BPCH, EP-06 6.14 y EP-07 7.18);
 *   · «Registrar recepción → enviar al cliente» en DCO (EP-00 6.3);
 *   · «Documentos y envío»: documentos no-informe y envío conjunto de
 *     documentos y factura (EP-00 6.4, EP-06 6.18);
 *   · Carpeta de Trabajo (EP-05 9.3, contrato §4.6.2).
 * Todo se acota a la OT del alcance del usuario.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { MailService } from "../configuracion/configuracion.module";
import { PlantillaRenderService } from "../plantilla-render/plantilla-render.service";
import { AvisosService } from "../avisos/avisos.service";
import { escapeHtml } from "../plantilla-render/html.util";
import { hoyCl } from "../ot/plazos";
import { exigirMedioEnvioActivo } from "../common/medios-envio";
import { ramaDeUnidad } from "../bpch/cabecera/cabecera-ot";
import {
  NOMBRE_DESTINO,
  atrasoRecepcionDco,
  correosValidos,
  destinoSugerido,
  errorFechaRecepcionDco,
  erroresDespacho,
  estadoCorreo,
  type DestinoDespacho,
} from "../avisos/reglas-avisos";
import { faltaOficio, seguimientoDocumento } from "./datos-seguimiento";

const OFICIAL = ["oficial", "emitido"];
const tienePermiso = (req: any, p: string) => (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes(p);
const fechaCl = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("-") : "—");

export interface DespachoDto {
  destino: DestinoDespacho;
  unidadDestinoId?: string;
  fecha?: string;
  ejemplares: number;
  distribucion?: { destinatario: string; ejemplares: number }[];
  copiaArchivada?: boolean;
  archivoUbicacion?: string;
  retencionMeses?: number;
  oficioId?: string;
  observacion?: string;
}

export interface EnvioDto {
  fecha?: string;
  medio: string;
  destinatario: string;
  certificadoIds?: string[];
  registroIds?: string[];
  oficioIds?: string[];
  facturaId?: string;
  guia?: string;
  observacion?: string;
  correo?: { destinatarios: string[]; mensaje?: string };
}

export interface RegistroDto {
  tipo: string;
  numero: string;
  copias?: number;
  fecha?: string;
  descripcion?: string;
  /** Fichero subido en multipart (campo «archivo»). */
  archivo?: { nombre: string; mime: string; buffer: Buffer };
}

export const VISTAS_PENDIENTE = ["por_despachar", "por_recibir", "plazo_por_informar", "recepcion_dco", "por_enviar"] as const;
export type VistaPendiente = (typeof VISTAS_PENDIENTE)[number];
const PERMISO_VISTA: Record<VistaPendiente, string> = {
  por_despachar: "certificado.despachar",
  por_recibir: "certificado.entregar",
  plazo_por_informar: "ot.seguimiento",
  recepcion_dco: "ot.seguimiento",
  por_enviar: "ot.seguimiento",
};
export interface FilaPendiente {
  id: string;
  numero: string;
  otId: string;
  ot: string;
  cliente: string | null;
  fecha: string | null;
  detalle: string | null;
}

/** ¿El contenido es del tipo declarado? PDF «%PDF», PNG, JPEG y los Office abiertos (ZIP «PK»). */
export function contenidoCoincide(mime: string, b: Buffer): boolean {
  const ini = (bytes: number[]) => bytes.every((x, i) => b[i] === x);
  if (mime === "application/pdf") return ini([0x25, 0x50, 0x44, 0x46]);
  if (mime === "image/png") return ini([0x89, 0x50, 0x4e, 0x47]);
  if (mime === "image/jpeg") return ini([0xff, 0xd8, 0xff]);
  if (mime.startsWith("application/vnd.openxmlformats-officedocument.")) return ini([0x50, 0x4b, 0x03, 0x04]);
  return false;
}

const MIME_ARCHIVO = ["application/pdf", "image/png", "image/jpeg", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];

@Injectable()
export class SeguimientoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly mail: MailService,
    private readonly render: PlantillaRenderService,
    private readonly avisos: AvisosService,
  ) {}

  /* ---------------------------------------------------------------- base --- */

  private async ot(id: string, req: any) {
    const tenantId = req?.user?.tenantId;
    const [o] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id, o.tenant_id, o.codigo, o.estado, o.unidad_principal, o.origen_trabajo, o.con_cobro,
              o.fecha_recepcion, o.created_at, o.fecha_compromiso::text AS fecha_compromiso,
              o.fecha_recep_dco::text AS fecha_recep_dco, o.dias_atraso, o.estado_envio, o.medio_envio,
              o.fecha_entrega_cliente::text AS fecha_entrega_cliente, o.recep_dco_at,
              o.plazo_notificado_at, o.plazo_notificado_medio, o.carpeta_archivada_at, o.carpeta_ubicacion,
              u.codigo AS unidad, c.razon_social AS cliente, c.email AS cliente_email, cot.ejecutivo_id
         FROM orden_trabajo o
         LEFT JOIN unidad u ON u.id = o.unidad_principal
         LEFT JOIN cliente c ON c.id = o.cliente_id
         LEFT JOIN cotizacion cot ON cot.id = o.cotizacion_id
        WHERE o.id = $1::uuid AND ($2::uuid IS NULL OR o.tenant_id = $2::uuid)`,
      id,
      tenantId ?? null,
    );
    if (!o) throw new NotFoundException(`OT ${id} no encontrada`);
    await this.alcance.exigirUnidad(req, o.unidad_principal, `la OT ${o.codigo}`);
    return o;
  }

  private async historial(o: { tenant_id: string; id: string }, tipo: string, detalle: Record<string, unknown>, usuario: string | null) {
    await this.prisma
      .$executeRawUnsafe(
        `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::uuid)`,
        o.tenant_id,
        o.id,
        tipo,
        JSON.stringify(detalle),
        usuario,
      )
      .catch(() => undefined);
  }

  private async documentosOt(otId: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id, COALESCE(c.numero, c.codigo) AS numero, c.estado, c.tipo_documento AS "tipoDocumento", c.version,
              c.entregado_at AS "entregadoAt", c.unidad_id AS "unidadId", p.nombre AS plantilla,
              d.destino AS "despachoDestino", d.fecha::text AS "despachoFecha", d.recibido_at AS "despachoRecibidoAt"
         FROM certificado c
         LEFT JOIN plantilla_informe p ON p.id = c.plantilla_id
         LEFT JOIN documento_despacho d ON d.certificado_id = c.id
        WHERE c.ot_id = $1::uuid AND c.deleted_at IS NULL
        ORDER BY c.fecha`,
      otId,
    );
  }

  /* --------------------------------------------------------- vista de la OT --- */

  async vista(id: string, req: any) {
    const o = await this.ot(id, req);
    const [documentos, registros, envios, oficios, factura] = await Promise.all([
      this.documentosOt(id),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT r.id, r.tipo, r.numero, r.version, r.copias, r.fecha::text AS fecha, r.descripcion, r.archivo_nombre AS "archivoNombre",
                r.archivo_bytes AS "archivoBytes", r.created_at AS "createdAt", u.nombre_completo AS "registradoPor"
           FROM ot_documento_registro r LEFT JOIN usuario u ON u.id = r.registrado_por
          WHERE r.ot_id = $1::uuid AND r.deleted_at IS NULL ORDER BY r.tipo, r.numero, r.version`,
        id,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT e.id, e.fecha::text AS fecha, e.medio, e.destinatario, e.documentos, e.guia, e.observacion, e.correo_estado AS "correoEstado",
                f.numero AS factura, e.created_at AS "createdAt", u.nombre_completo AS "registradoPor"
           FROM ot_envio e LEFT JOIN factura f ON f.id = e.factura_id LEFT JOIN usuario u ON u.id = e.registrado_por
          WHERE e.ot_id = $1::uuid ORDER BY e.created_at`,
        id,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, numero, estado, destinatario, materia, fecha::text AS fecha, despacho_numero AS "despachoNumero"
           FROM oficio WHERE ot_id = $1::uuid AND estado <> 'anulado' ORDER BY created_at`,
        id,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, numero, estado FROM factura WHERE ot_id = $1::uuid AND deleted_at IS NULL AND estado <> 'anulada' ORDER BY created_at DESC LIMIT 1`,
        id,
      ),
    ]);
    const rama = await ramaDeUnidad(this.prisma, o.unidad_principal).catch(() => null);
    const oficiales = documentos.filter((d) => OFICIAL.includes(d.estado));
    return {
      ot: { id: o.id, codigo: o.codigo, estado: o.estado, cliente: o.cliente, emailCliente: o.cliente_email, conCobro: o.con_cobro },
      plazo: {
        fechaCompromiso: o.fecha_compromiso,
        notificadoAt: o.plazo_notificado_at,
        medio: o.plazo_notificado_medio,
      },
      recepcionDco: o.fecha_recep_dco
        ? { fecha: o.fecha_recep_dco, diasAtraso: o.dias_atraso, registradaAt: o.recep_dco_at, ...atrasoRecepcionDco(o.fecha_recep_dco, o.fecha_compromiso) }
        : null,
      envio: { estado: o.estado_envio, medio: o.medio_envio, fechaEntregaCliente: o.fecha_entrega_cliente },
      destinoSugerido: destinoSugerido({ origen: o.origen_trabajo, ramaBpch: rama === "bpch", solicitaBpch: false }),
      documentos,
      registros,
      envios,
      oficios,
      factura: factura[0] ?? null,
      carpeta: { archivadaAt: o.carpeta_archivada_at, ubicacion: o.carpeta_ubicacion },
      puedo: {
        seguimiento: tienePermiso(req, "ot.seguimiento"),
        recepcionDco: tienePermiso(req, "ot.seguimiento") && oficiales.length > 0,
        carpeta: tienePermiso(req, "ot.carpeta"),
        oficio: tienePermiso(req, "oficio.crear"),
      },
    };
  }

  /* ------------------------------------------------------ plazo al cliente --- */

  async notificarPlazo(id: string, dto: { medio: "correo" | "oficio" | "telefono" | "otro"; destinatarios?: string[]; mensaje?: string }, req: any) {
    const o = await this.ot(id, req);
    if (["cerrada", "anulada"].includes(o.estado)) throw new ConflictException(`La OT ${o.codigo} está ${o.estado}.`);
    if (!o.fecha_compromiso)
      throw new ConflictException("La OT no tiene fecha de compromiso: el laboratorio debe asignar el plazo primero («Informe y cierre › Fijar fecha»).");
    let correo: string = "no_aplica";
    let error: string | null = null;
    if (dto.medio === "correo") {
      const para = correosValidos(dto.destinatarios?.length ? dto.destinatarios : [o.cliente_email]);
      if (!para.length) throw new BadRequestException("Indique el correo del cliente (la ficha del cliente no tiene uno).");
      const asunto = `IDIC · Plazo de entrega de la OT ${o.codigo}`;
      try {
        await this.mail.sendMail(o.tenant_id, {
          to: para,
          subject: asunto,
          html:
            `<p>Estimado(a) ${escapeHtml(o.cliente ?? "cliente")}:</p>` +
            `<p>Le informamos que los resultados de la orden de trabajo <b>${escapeHtml(o.codigo)}</b> se entregarán a más tardar el <b>${fechaCl(o.fecha_compromiso)}</b>.</p>` +
            (dto.mensaje?.trim() ? `<p>${escapeHtml(dto.mensaje.trim())}</p>` : "") +
            `<p>Instituto de Investigaciones y Control del Ejército de Chile</p>`,
        });
      } catch (e: any) {
        error = String(e?.response ?? e?.message ?? "Error al enviar").slice(0, 300);
      }
      await this.prisma
        .$executeRawUnsafe(
          `INSERT INTO correo_enviado (tenant_id, tipo, destinatarios, asunto, cuerpo_resumen, plantilla, ot_id, estado, error, enviado_por)
           VALUES ($1::uuid, 'aviso', $2, $3, $4, 'plazo_cliente', $5::uuid, $6, $7, $8::uuid)`,
          o.tenant_id,
          para.join(", "),
          asunto,
          `Entrega a más tardar el ${fechaCl(o.fecha_compromiso)}`,
          o.id,
          error ? "error" : "enviado",
          error,
          req.user?.sub ?? null,
        )
        .catch(() => undefined);
      correo = estadoCorreo({ quiere: true, destinatarios: para.length, error });
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE orden_trabajo SET plazo_notificado_at = now(), plazo_notificado_por = $2::uuid, plazo_notificado_medio = $3 WHERE id = $1::uuid`,
      o.id,
      req.user?.sub ?? null,
      dto.medio,
    );
    await this.historial(o, "plazo_notificado", { fecha: fechaCl(o.fecha_compromiso), medio: dto.medio, correo }, req.user?.sub ?? null);
    return { ...(await this.vista(id, req)), correo, error };
  }

  /* -------------------------------------------------------------- despacho --- */

  private async documento(certId: string, req: any) {
    const [c] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id, c.tenant_id, COALESCE(c.numero, c.codigo) AS numero, c.estado, c.tipo_documento, c.unidad_id, c.ot_id,
              c.entregado_at, o.codigo AS ot_codigo, o.unidad_principal, o.origen_trabajo
         FROM certificado c JOIN orden_trabajo o ON o.id = c.ot_id
        WHERE c.id = $1::uuid AND c.deleted_at IS NULL AND ($2::uuid IS NULL OR c.tenant_id = $2::uuid)`,
      certId,
      req?.user?.tenantId ?? null,
    );
    if (!c) throw new NotFoundException(`Documento ${certId} no encontrado`);
    await this.alcance.exigirUnidad(req, c.unidad_id ?? c.unidad_principal, `el documento ${c.numero}`);
    return c;
  }

  async despachar(certId: string, dto: DespachoDto, req: any) {
    const c = await this.documento(certId, req);
    const [ya] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM documento_despacho WHERE certificado_id = $1::uuid`, c.id);
    const fecha = dto.fecha ?? hoyCl();
    const errores = erroresDespacho({
      estado: c.estado,
      yaDespachado: Boolean(ya),
      destino: dto.destino,
      ejemplares: dto.ejemplares,
      fecha,
      hoy: hoyCl(),
      unidadDestino: dto.unidadDestinoId ?? null,
    });
    if (errores.length) throw new ConflictException(errores.join(" "));
    // Al cliente directo se aplica la misma regla del oficio que a la entrega.
    if (dto.destino === "CLIENTE") {
      const m = await faltaOficio(this.prisma, { id: c.id, tenantId: c.tenant_id, tipoDocumento: c.tipo_documento, unidadId: c.unidad_id ?? c.unidad_principal, numero: c.numero });
      if (m) throw new ConflictException(m);
    }
    if (dto.unidadDestinoId) {
      const [u] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM unidad WHERE id = $1::uuid AND tenant_id = $2::uuid`, dto.unidadDestinoId, c.tenant_id);
      if (!u) throw new BadRequestException("El laboratorio de destino no existe.");
    }
    if (dto.oficioId) {
      const [of] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM oficio WHERE id = $1::uuid AND tenant_id = $2::uuid AND $3::uuid = ANY(documentos) AND estado <> 'anulado'`,
        dto.oficioId,
        c.tenant_id,
        c.id,
      );
      if (!of) throw new BadRequestException("El oficio indicado no conduce este documento.");
    }
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO documento_despacho (tenant_id, certificado_id, ot_id, destino, unidad_destino_id, fecha, ejemplares, distribucion,
                                       copia_archivada, archivo_ubicacion, retencion_meses, oficio_id, observacion, registrado_por)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6::date, $7, $8::jsonb, $9, $10, $11, $12::uuid, $13, $14::uuid)`,
      c.tenant_id,
      c.id,
      c.ot_id,
      dto.destino,
      dto.unidadDestinoId ?? null,
      fecha,
      dto.ejemplares,
      JSON.stringify(dto.distribucion ?? []),
      dto.copiaArchivada ?? true,
      dto.archivoUbicacion?.trim() || null,
      dto.retencionMeses ?? null,
      dto.oficioId ?? null,
      dto.observacion?.trim() || null,
      req.user?.sub ?? null,
    );
    await this.historial({ tenant_id: c.tenant_id, id: c.ot_id }, "despacho", { numero: c.numero, destino: NOMBRE_DESTINO[dto.destino], ejemplares: dto.ejemplares }, req.user?.sub ?? null);
    // Aviso y tarjeta al destino: DCO (Ventas, Planificación y Jefe DCO), solicitante o SCC.
    const destinatarios =
      dto.destino === "DCO"
        ? { roles: [{ rol: "COMERCIAL" }, { rol: "PLANIFICACION" }, { rol: "JEFE_DEPTO", unidadCodigo: "DCO" }] }
        : dto.destino === "LAB_SOLICITANTE"
          ? { jefesDe: [dto.unidadDestinoId] }
          : dto.destino === "BPCH"
            ? { roles: [{ rol: "JEFE_SECCION", unidadCodigo: "SCC" }] }
            : { roles: [{ rol: "COMERCIAL" }] };
    await this.avisos
      .emitir(
        c.tenant_id,
        {
          tipo: "despacho",
          titulo: `Documento ${c.numero} despachado a ${NOMBRE_DESTINO[dto.destino]}`,
          mensaje: `El documento ${c.numero} de la OT ${c.ot_codigo} fue despachado (${dto.ejemplares} ejemplar${dto.ejemplares === 1 ? "" : "es"}). ${dto.destino === "CLIENTE" ? "Registre la entrega." : "Déle por recibido y regístrelo en su entrega."}`,
          ruta: `/ot/${c.ot_id}?tab=informe`,
          otId: c.ot_id,
          certificadoId: c.id,
          clave: `despacho:${c.id}`,
          creadoPor: req.user?.sub ?? null,
        },
        destinatarios,
      )
      .catch(() => undefined);
    return seguimientoDocumento(this.prisma, c.id);
  }

  async recibirDespacho(certId: string, req: any) {
    const c = await this.documento(certId, req);
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE documento_despacho SET recibido_at = now(), recibido_por = $2::uuid WHERE certificado_id = $1::uuid AND recibido_at IS NULL`,
      c.id,
      req.user?.sub ?? null,
    );
    if (!Number(n)) throw new ConflictException(`El documento ${c.numero} no tiene un despacho pendiente de recibir.`);
    const [d] = await this.prisma.$queryRawUnsafe<{ destino: DestinoDespacho }[]>(`SELECT destino FROM documento_despacho WHERE certificado_id = $1::uuid`, c.id);
    await this.historial({ tenant_id: c.tenant_id, id: c.ot_id }, "despacho_recibido", { numero: c.numero, destino: NOMBRE_DESTINO[d.destino] }, req.user?.sub ?? null);
    return seguimientoDocumento(this.prisma, c.id);
  }

  /* --------------------------------------------------------- recepción DCO --- */

  async recepcionDco(id: string, fecha: string, req: any) {
    const o = await this.ot(id, req);
    const docs = await this.documentosOt(id);
    if (!docs.some((d) => OFICIAL.includes(d.estado)))
      throw new ConflictException("La recepción en DCO se registra cuando la OT tiene al menos un documento oficial.");
    const fechaOt = (o.fecha_recepcion ?? o.created_at) ? new Date(o.fecha_recepcion ?? o.created_at).toISOString().slice(0, 10) : null;
    const err = errorFechaRecepcionDco(fecha, fechaOt, hoyCl());
    if (err) throw new BadRequestException(err);
    const a = atrasoRecepcionDco(fecha, o.fecha_compromiso);
    await this.prisma.$executeRawUnsafe(
      `UPDATE orden_trabajo SET fecha_recep_dco = $2::date, dias_atraso = $3, estado_envio = $4, recep_dco_at = now(), recep_dco_por = $5::uuid
        WHERE id = $1::uuid`,
      o.id,
      fecha,
      a.dias,
      a.estado,
      req.user?.sub ?? null,
    );
    await this.historial(o, "recepcion_dco", { fecha: fechaCl(fecha), estado: a.estado, texto: a.texto }, req.user?.sub ?? null);
    return this.vista(id, req);
  }

  /* --------------------------------------------------- documentos no-informe --- */

  async registrarDocumento(id: string, dto: RegistroDto, req: any) {
    const o = await this.ot(id, req);
    let archivo: { nombre: string; mime: string; bytes: number; datos: string; hash: string } | null = null;
    if (dto.archivo) {
      const buf = dto.archivo.buffer;
      // El tipo se comprueba por su contenido (firma del fichero), no solo por lo que declara el navegador.
      if (!MIME_ARCHIVO.includes(dto.archivo.mime) || !contenidoCoincide(dto.archivo.mime, buf))
        throw new BadRequestException("El archivo debe ser PDF, PNG, JPEG, Word (.docx) o Excel (.xlsx).");
      if (!buf.length || buf.length > 5_000_000) throw new BadRequestException("El archivo debe pesar como máximo 5 MB.");
      archivo = { nombre: dto.archivo.nombre.slice(0, 200), mime: dto.archivo.mime, bytes: buf.length, datos: buf.toString("base64"), hash: createHash("sha256").update(buf).digest("hex") };
    }
    const fecha = dto.fecha ?? hoyCl();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new BadRequestException("Fecha AAAA-MM-DD.");
    const [r] = await this.prisma.$queryRawUnsafe<{ id: string; version: number }[]>(
      `INSERT INTO ot_documento_registro (tenant_id, ot_id, tipo, numero, version, copias, fecha, descripcion,
                                          archivo_nombre, archivo_mime, archivo_bytes, archivo_datos, archivo_hash, registrado_por)
       SELECT $1::uuid, $2::uuid, $3, $4,
              COALESCE((SELECT max(version) FROM ot_documento_registro x WHERE x.ot_id = $2::uuid AND x.tipo = $3 AND x.numero = $4 AND x.deleted_at IS NULL), 0) + 1,
              $5, $6::date, $7, $8, $9, $10, $11, $12, $13::uuid
       RETURNING id, version`,
      o.tenant_id,
      o.id,
      dto.tipo,
      dto.numero.trim(),
      dto.copias ?? 1,
      fecha,
      dto.descripcion?.trim() || null,
      archivo?.nombre ?? null,
      archivo?.mime ?? null,
      archivo?.bytes ?? null,
      archivo?.datos ?? null,
      archivo?.hash ?? null,
      req.user?.sub ?? null,
    );
    await this.historial(o, "documento_registro", { tipo: dto.tipo, numero: dto.numero.trim(), version: r.version }, req.user?.sub ?? null);
    return this.vista(id, req);
  }

  async anularDocumento(id: string, registroId: string, motivo: string, req: any) {
    const o = await this.ot(id, req);
    if ((motivo ?? "").trim().length < 5) throw new BadRequestException("Indique el motivo (al menos 5 caracteres).");
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE ot_documento_registro SET deleted_at = now(), deleted_por = $3::uuid, deleted_motivo = $4
        WHERE id = $1::uuid AND ot_id = $2::uuid AND deleted_at IS NULL`,
      registroId,
      o.id,
      req.user?.sub ?? null,
      motivo.trim(),
    );
    if (!Number(n)) throw new NotFoundException("Documento no encontrado.");
    return this.vista(id, req);
  }

  async archivoDocumento(id: string, registroId: string, req: any) {
    const o = await this.ot(id, req);
    const [r] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT archivo_nombre AS nombre, archivo_mime AS mime, archivo_datos AS datos FROM ot_documento_registro
        WHERE id = $1::uuid AND ot_id = $2::uuid AND archivo_datos IS NOT NULL`,
      registroId,
      o.id,
    );
    if (!r) throw new NotFoundException("El documento no tiene archivo.");
    return { nombre: r.nombre as string, mime: r.mime as string, buffer: Buffer.from(r.datos, "base64") };
  }

  /* ---------------------------------------------------------------- envío --- */

  async registrarEnvio(id: string, dto: EnvioDto, req: any) {
    const o = await this.ot(id, req);
    await exigirMedioEnvioActivo(this.prisma, o.tenant_id, dto.medio);
    const fecha = dto.fecha ?? hoyCl();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > hoyCl()) throw new BadRequestException("La fecha del envío no puede ser futura.");
    const docs = (await this.documentosOt(id)).filter((d) => (dto.certificadoIds ?? []).includes(d.id));
    if ((dto.certificadoIds ?? []).length !== docs.length) throw new BadRequestException("Algún documento no es de esta OT.");
    const noOficial = docs.find((d) => !OFICIAL.includes(d.estado));
    if (noOficial) throw new ConflictException(`Solo se envían documentos oficiales: ${noOficial.numero} está ${noOficial.estado}.`);
    for (const d of docs.filter((x) => !x.entregadoAt)) {
      const m = await faltaOficio(this.prisma, { id: d.id, tenantId: o.tenant_id, tipoDocumento: d.tipoDocumento, unidadId: d.unidadId ?? o.unidad_principal, numero: d.numero });
      if (m) throw new ConflictException(m);
    }
    const registros = dto.registroIds?.length
      ? await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT id, tipo, numero FROM ot_documento_registro WHERE ot_id = $1::uuid AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
          o.id,
          dto.registroIds,
        )
      : [];
    const oficios = dto.oficioIds?.length
      ? await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT id, numero, estado FROM oficio WHERE ot_id = $1::uuid AND id = ANY($2::uuid[]) AND estado IN ('firmado', 'despachado')`,
          o.id,
          dto.oficioIds,
        )
      : [];
    let factura: { id: string; numero: string | null } | null = null;
    if (dto.facturaId) {
      const [f] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, numero FROM factura WHERE id = $1::uuid AND ot_id = $2::uuid AND deleted_at IS NULL AND estado IN ('emitida', 'parcial', 'pagada', 'aviso_1', 'aviso_2', 'aviso_3')`,
        dto.facturaId,
        o.id,
      );
      if (!f) throw new ConflictException("La factura no es de esta OT o aún no está emitida.");
      factura = f;
    }
    const lista = [
      ...docs.map((d) => ({ tipo: "documento", id: d.id, numero: d.numero })),
      ...registros.map((r) => ({ tipo: r.tipo, id: r.id, numero: r.numero })),
      ...oficios.map((x) => ({ tipo: "OFICIO", id: x.id, numero: x.numero })),
      ...(factura ? [{ tipo: "FACTURA", id: factura.id, numero: factura.numero }] : []),
    ];
    if (!lista.length) throw new BadRequestException("Elija al menos un documento o la factura que se envía.");

    // Por correo: adjunta los PDF oficiales de los documentos del circuito.
    let correo: string = "no_aplica";
    let error: string | null = null;
    if (dto.medio === "correo" && dto.correo) {
      const para = correosValidos(dto.correo.destinatarios);
      if (!para.length) throw new BadRequestException("Indique al menos un correo de destino.");
      const adjuntos: { filename: string; content: Buffer; contentType: string }[] = [];
      for (const d of docs) {
        const { buffer, nombre } = await this.render.pdf(d.id, o.tenant_id);
        adjuntos.push({ filename: nombre, content: buffer, contentType: "application/pdf" });
      }
      for (const r of registros) {
        const a = await this.archivoDocumento(id, r.id, req).catch(() => null);
        if (a) adjuntos.push({ filename: a.nombre, content: a.buffer, contentType: a.mime });
      }
      const asunto = `IDIC · Documentos de la OT ${o.codigo}`;
      try {
        await this.mail.sendMail(o.tenant_id, {
          to: para,
          subject: asunto,
          html:
            `<p>Estimado(a) ${escapeHtml(o.cliente ?? "cliente")}:</p><p>Adjuntamos los documentos de la orden de trabajo <b>${escapeHtml(o.codigo)}</b>: ` +
            `${escapeHtml(lista.map((x) => x.numero).join(", "))}.</p>` +
            (factura ? `<p>Factura asociada: <b>${escapeHtml(factura.numero ?? "")}</b>.</p>` : "") +
            (dto.correo.mensaje?.trim() ? `<p>${escapeHtml(dto.correo.mensaje.trim())}</p>` : "") +
            `<p>Instituto de Investigaciones y Control del Ejército de Chile</p>`,
          attachments: adjuntos,
        });
      } catch (e: any) {
        error = String(e?.response ?? e?.message ?? "Error al enviar").slice(0, 300);
      }
      await this.prisma
        .$executeRawUnsafe(
          `INSERT INTO correo_enviado (tenant_id, tipo, destinatarios, asunto, cuerpo_resumen, plantilla, ot_id, estado, error, enviado_por)
           VALUES ($1::uuid, 'envio', $2, $3, $4, 'envio_cliente', $5::uuid, $6, $7, $8::uuid)`,
          o.tenant_id,
          para.join(", "),
          asunto,
          lista.map((x) => x.numero).join(", ").slice(0, 500),
          o.id,
          error ? "error" : "enviado",
          error,
          req.user?.sub ?? null,
        )
        .catch(() => undefined);
      correo = estadoCorreo({ quiere: true, destinatarios: para.length, error });
      // Si el correo no salió, no se registra un envío que no ocurrió.
      if (error) return { ...(await this.vista(id, req)), correo, error };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO ot_envio (tenant_id, ot_id, fecha, medio, destinatario, documentos, factura_id, guia, observacion, correo_estado, registrado_por)
         VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6::jsonb, $7::uuid, $8, $9, $10, $11::uuid)`,
        o.tenant_id,
        o.id,
        fecha,
        dto.medio,
        dto.destinatario.trim(),
        JSON.stringify(lista),
        factura?.id ?? null,
        dto.guia?.trim() || null,
        dto.observacion?.trim() || null,
        correo === "enviado" ? "enviado" : "no_aplica",
        req.user?.sub ?? null,
      );
      // Los documentos del circuito que aún no tenían entrega quedan entregados con este envío.
      // El medio real del envío (B-024: «Oficio» quedaba como «Otro»).
      // Frente f5: el mismo código de «Parámetros del sistema › medio_envio» (ya validado).
      const medioEntrega = dto.medio;
      for (const d of docs.filter((x) => !x.entregadoAt))
        await tx.$executeRawUnsafe(
          `UPDATE certificado SET entregado_at = $2::date + (now() AT TIME ZONE 'America/Santiago')::time AT TIME ZONE 'America/Santiago',
                  entrega_medio = $3, entrega_destinatario = $4, entrega_observacion = $5, entrega_registrada_por = $6::uuid, entrega_guia = $7
            WHERE id = $1::uuid AND entregado_at IS NULL`,
          d.id,
          fecha,
          medioEntrega,
          dto.destinatario.trim().slice(0, 200),
          `Envío conjunto${factura ? ` con la factura ${factura.numero}` : ""}${dto.observacion?.trim() ? ` · ${dto.observacion.trim()}` : ""}`.slice(0, 1000),
          req.user?.sub ?? null,
          dto.guia?.trim() || null,
        );
      await tx.$executeRawUnsafe(
        `UPDATE orden_trabajo SET estado_envio = 'Enviado al cliente', medio_envio = $2, fecha_entrega_cliente = $3::date WHERE id = $1::uuid`,
        o.id,
        dto.medio,
        fecha,
      );
    });
    await this.historial(o, "envio_cliente", { medio: dto.medio, destinatario: dto.destinatario.trim(), documentos: lista.map((x) => x.numero) }, req.user?.sub ?? null);
    return { ...(await this.vista(id, req)), correo, error };
  }

  /**
   * Estado por laboratorio de las muestras de la OT (EP-02 4.2 «Consolidar la
   * muestra», BL-215): una fila por muestra y laboratorio dueño de sus ensayos
   * (el responsable o el destino de una orden interna), con cuántos están por
   * capturar, en revisión y aprobados.
   */
  async estadoLaboratorios(id: string, req: any) {
    await this.ot(id, req);
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id AS "muestraId", m.codigo AS muestra, u.codigo AS laboratorio, u.nombre AS "laboratorioNombre", bool_or(lr.derivado) AS derivado,
              count(*)::int AS total,
              count(*) FILTER (WHERE r.estado IN ('pendiente', 'devuelto', 'rechazado'))::int AS "porCapturar",
              count(*) FILTER (WHERE r.estado IN ('capturado', 'revisado_n1'))::int AS "enRevision",
              count(*) FILTER (WHERE r.estado = 'aprobado')::int AS aprobados,
              count(*) FILTER (WHERE r.veredicto = 'no_cumple')::int AS "noCumple"
         FROM resultado r JOIN muestra m ON m.id = r.muestra_id
         JOIN LATERAL lims_lab_de_resultado(r.id) lr ON TRUE
         LEFT JOIN unidad u ON u.id = lr.unidad_id
        WHERE r.ot_id = $1::uuid AND r.deleted_at IS NULL AND m.deleted_at IS NULL
        GROUP BY m.id, m.codigo, u.codigo, u.nombre
        ORDER BY m.codigo, u.codigo`,
      id,
    );
    const labs = [...new Set(filas.map((f) => f.laboratorio))];
    return { compartida: labs.length > 1, laboratorios: labs, filas };
  }

  /* ------------------------------------------------- pendientes (bandeja) --- */

  /**
   * Listas «lo que le toca» del seguimiento (pantalla /seguimiento y tarjetas
   * de Mi bandeja, que cuentan exactamente estas filas):
   *   por_despachar      documentos oficiales sin despacho ni entrega (jefaturas, certificado.despachar);
   *   por_recibir        despachos sin recibir con destino en su ámbito (certificado.entregar);
   *   plazo_por_informar OT abiertas con fecha de compromiso aún no informada al cliente (ot.seguimiento);
   *   recepcion_dco      OT con documento oficial sin recepción en DCO (ot.seguimiento);
   *   por_enviar         OT recibidas en DCO aún no enviadas al cliente (ot.seguimiento).
   */
  async pendientes(req: any, vista: VistaPendiente): Promise<FilaPendiente[]> {
    const t = req?.user?.tenantId;
    if (!t) return [];
    const permiso = PERMISO_VISTA[vista];
    if (!permiso || !tienePermiso(req, permiso)) return [];
    const filtro = await this.alcance.filtroUnidades(req, permiso);
    const sql: Record<VistaPendiente, string> = {
      por_despachar: `
        SELECT c.id, COALESCE(c.numero, c.codigo) AS numero, o.id AS ot_id, o.codigo AS ot, cl.razon_social AS cliente,
               COALESCE(c.oficial_at, c.fecha) AS fecha, p.nombre AS documento
          FROM certificado c JOIN orden_trabajo o ON o.id = c.ot_id
          LEFT JOIN cliente cl ON cl.id = o.cliente_id LEFT JOIN plantilla_informe p ON p.id = c.plantilla_id
         WHERE c.tenant_id = $1::uuid AND c.deleted_at IS NULL AND c.estado IN ('oficial', 'emitido') AND c.entregado_at IS NULL
           AND o.estado <> 'anulada'
           AND NOT EXISTS (SELECT 1 FROM documento_despacho d WHERE d.certificado_id = c.id)
           AND ($2::uuid[] IS NULL OR COALESCE(c.unidad_id, o.unidad_principal) = ANY($2::uuid[]))
         ORDER BY fecha`,
      por_recibir: `
        SELECT c.id, COALESCE(c.numero, c.codigo) AS numero, o.id AS ot_id, o.codigo AS ot, cl.razon_social AS cliente,
               d.fecha, d.destino AS documento
          FROM documento_despacho d JOIN certificado c ON c.id = d.certificado_id JOIN orden_trabajo o ON o.id = d.ot_id
          LEFT JOIN cliente cl ON cl.id = o.cliente_id
         WHERE d.tenant_id = $1::uuid AND d.recibido_at IS NULL AND c.deleted_at IS NULL
           AND ($2::uuid[] IS NULL
                OR (d.destino IN ('DCO', 'CLIENTE') AND EXISTS (SELECT 1 FROM unidad u WHERE u.codigo IN ('DCO', 'SVT', 'SPC') AND u.tenant_id = d.tenant_id AND u.id = ANY($2::uuid[])))
                OR (d.destino = 'LAB_SOLICITANTE' AND d.unidad_destino_id = ANY($2::uuid[]))
                OR (d.destino = 'BPCH' AND EXISTS (SELECT 1 FROM unidad u WHERE u.codigo IN ('SCC', 'BPCH') AND u.tenant_id = d.tenant_id AND u.id = ANY($2::uuid[]))))
         ORDER BY d.fecha`,
      plazo_por_informar: `
        SELECT o.id, o.codigo AS numero, o.id AS ot_id, o.codigo AS ot, cl.razon_social AS cliente, o.fecha_compromiso AS fecha, u.codigo AS documento
          FROM orden_trabajo o LEFT JOIN cliente cl ON cl.id = o.cliente_id LEFT JOIN unidad u ON u.id = o.unidad_principal
         WHERE o.tenant_id = $1::uuid AND o.estado NOT IN ('cerrada', 'anulada') AND o.fecha_compromiso IS NOT NULL
           AND o.plazo_notificado_at IS NULL AND COALESCE(o.origen_trabajo, '') NOT IN ('OT_INTERNA', 'INTERLABORATORIO')
           AND ($2::uuid[] IS NULL OR o.unidad_principal = ANY($2::uuid[]))
         ORDER BY o.fecha_compromiso`,
      recepcion_dco: `
        SELECT o.id, o.codigo AS numero, o.id AS ot_id, o.codigo AS ot, cl.razon_social AS cliente, o.fecha_compromiso AS fecha, u.codigo AS documento
          FROM orden_trabajo o LEFT JOIN cliente cl ON cl.id = o.cliente_id LEFT JOIN unidad u ON u.id = o.unidad_principal
         WHERE o.tenant_id = $1::uuid AND o.estado <> 'anulada' AND o.fecha_recep_dco IS NULL
           AND COALESCE(o.origen_trabajo, '') NOT IN ('OT_INTERNA', 'INTERLABORATORIO')
           AND EXISTS (SELECT 1 FROM certificado c WHERE c.ot_id = o.id AND c.deleted_at IS NULL AND c.estado IN ('oficial', 'emitido'))
           AND COALESCE(o.estado_envio, '') <> 'Enviado al cliente'
           AND ($2::uuid[] IS NULL OR o.unidad_principal = ANY($2::uuid[]))
         ORDER BY o.fecha_compromiso NULLS LAST`,
      por_enviar: `
        SELECT o.id, o.codigo AS numero, o.id AS ot_id, o.codigo AS ot, cl.razon_social AS cliente, o.fecha_recep_dco AS fecha, o.estado_envio AS documento
          FROM orden_trabajo o LEFT JOIN cliente cl ON cl.id = o.cliente_id
         WHERE o.tenant_id = $1::uuid AND o.estado <> 'anulada' AND o.fecha_recep_dco IS NOT NULL
           AND COALESCE(o.estado_envio, '') <> 'Enviado al cliente'
           AND ($2::uuid[] IS NULL OR o.unidad_principal = ANY($2::uuid[]))
         ORDER BY o.fecha_recep_dco`,
    };
    const filas = await this.prisma.$queryRawUnsafe<any[]>(`${sql[vista]} LIMIT 500`, t, filtro).catch(() => [] as any[]);
    return filas.map((f) => ({
      id: f.id,
      numero: f.numero,
      otId: f.ot_id,
      ot: f.ot,
      cliente: f.cliente ?? null,
      fecha: f.fecha ? new Date(f.fecha).toISOString().slice(0, 10) : null,
      detalle: f.documento ?? null,
    }));
  }

  /* ------------------------------------------------------ carpeta de trabajo --- */

  /**
   * Carpeta de Trabajo (EP-05 9.3, LVM-PG01-IT05; contrato §4.6.2): todo lo que
   * documenta la OT, con versiones: informes y certificados (todas las
   * versiones, también devueltos y anulados), oficios, formularios
   * especializados (HCP, planillas, disparos) y sus adjuntos, preparación,
   * muestreos, órdenes internas, fotos, costos reales y documentos no-informe.
   */
  async carpeta(id: string, req: any) {
    const o = await this.ot(id, req);
    const q = <T = any>(sql: string) => this.prisma.$queryRawUnsafe<T[]>(sql, id).catch(() => [] as T[]);
    const [documentos, oficios, formularios, adjuntos, muestreos, ordenes, fotos, costos, registros, envios] = await Promise.all([
      q(`SELECT c.id, COALESCE(c.numero, c.codigo) AS numero, c.version, c.estado, c.tipo_documento AS "tipoDocumento", c.fecha,
                c.oficial_at AS "oficialAt", c.entregado_at AS "entregadoAt", c.reemplaza_id AS "reemplazaId", p.nombre AS plantilla
           FROM certificado c LEFT JOIN plantilla_informe p ON p.id = c.plantilla_id
          WHERE c.ot_id = $1::uuid AND c.deleted_at IS NULL ORDER BY c.fecha`),
      // Los de la OT y los de la cotización que la originó (B-024: el oficio conductor de la cotización).
      q(`SELECT f.id, f.numero, f.estado, f.materia, f.destinatario, f.fecha::text AS fecha, f.despacho_numero AS "despachoNumero",
                CASE WHEN f.ot_id = $1::uuid THEN 'ot' ELSE 'cotizacion' END AS origen
           FROM oficio f
          WHERE f.ot_id = $1::uuid
             OR (f.ot_id IS NULL AND f.cotizacion_id = (SELECT cotizacion_id FROM orden_trabajo WHERE id = $1::uuid))
          ORDER BY f.created_at`),
      q(`SELECT r.id, r.variante, r.clave, r.estado, r.version, r.updated_at AS "updatedAt" FROM registro_especializado r
          WHERE r.ot_id = $1::uuid ORDER BY r.created_at`),
      q(`SELECT a.id, a.nombre, a.mime, a.bytes, a.created_at AS "createdAt", r.variante FROM registro_especializado_adjunto a
           JOIN registro_especializado r ON r.id = a.registro_id WHERE r.ot_id = $1::uuid AND a.deleted_at IS NULL ORDER BY a.created_at`),
      q(`SELECT numero_formulario AS numero, estado, created_at AS "createdAt" FROM ot_muestreo WHERE ot_id = $1::uuid ORDER BY created_at`),
      q(`SELECT oi.id, oi.numero, oi.estado, oi.created_at AS "createdAt" FROM orden_interna oi WHERE oi.ot_id = $1::uuid AND oi.deleted_at IS NULL ORDER BY oi.created_at`),
      q(`SELECT id, nombre, pie, created_at AS "createdAt" FROM ot_foto WHERE ot_id = $1::uuid AND deleted_at IS NULL ORDER BY orden, created_at`),
      q(`SELECT c.estado, u.codigo AS unidad, c.cerrada_at AS "cerradaAt",
                (SELECT COALESCE(sum(l.total), 0) FROM ot_costo_real_linea l WHERE l.planilla_id = c.id)::float8 AS total
           FROM ot_costo_real c LEFT JOIN unidad u ON u.id = c.unidad_id WHERE c.ot_id = $1::uuid`),
      q(`SELECT r.id, r.tipo, r.numero, r.version, r.copias, r.fecha::text AS fecha, r.descripcion, r.archivo_nombre AS "archivoNombre",
                r.deleted_at AS "anuladoAt", r.deleted_motivo AS "motivoAnulacion"
           FROM ot_documento_registro r WHERE r.ot_id = $1::uuid ORDER BY r.tipo, r.numero, r.version`),
      q(`SELECT fecha::text AS fecha, medio, destinatario, documentos FROM ot_envio WHERE ot_id = $1::uuid ORDER BY created_at`),
    ]);
    return {
      ot: { id: o.id, codigo: o.codigo, estado: o.estado, unidad: o.unidad, cliente: o.cliente },
      archivada: o.carpeta_archivada_at ? { at: o.carpeta_archivada_at, ubicacion: o.carpeta_ubicacion } : null,
      secciones: { documentos, oficios, formularios, adjuntos, muestreos, ordenes, fotos, costos, registros, envios },
      puedoArchivar: tienePermiso(req, "ot.carpeta") && o.estado === "cerrada" && !o.carpeta_archivada_at,
      faltaParaArchivar: o.estado === "cerrada" ? null : "La Carpeta de Trabajo se archiva con la OT cerrada.",
    };
  }

  async archivarCarpeta(id: string, ubicacion: string | undefined, req: any) {
    const o = await this.ot(id, req);
    if (o.estado !== "cerrada") throw new ConflictException("La Carpeta de Trabajo se archiva con la OT cerrada (EP-05 9.2 → 9.3).");
    if (o.carpeta_archivada_at) throw new ConflictException("La Carpeta de Trabajo ya está archivada.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE orden_trabajo SET carpeta_archivada_at = now(), carpeta_archivada_por = $2::uuid, carpeta_ubicacion = $3 WHERE id = $1::uuid`,
      o.id,
      req.user?.sub ?? null,
      ubicacion?.trim() || null,
    );
    await this.historial(o, "carpeta_archivada", { ubicacion: ubicacion?.trim() || null }, req.user?.sub ?? null);
    return this.carpeta(id, req);
  }
}
