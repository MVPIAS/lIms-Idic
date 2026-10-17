import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { MailService } from "../configuracion/configuracion.module";
import { PlantillaRenderService } from "./plantilla-render.service";
import { decidirFirma, esOficial, pasosActuales, quedaOficial, puedeTransitarDocumento } from "./reglas-emision";
import { escapeHtml, fmtFecha, fmtFechaHora } from "./html.util";

/** Medios de entrega admitidos (los mismos que usa Comercial para el envío). */
export const MEDIOS_ENTREGA = ["correo", "mano", "oficina_partes", "courier", "plataforma", "otro"] as const;

function usuarioDe(req: any): string {
  const id = req?.user?.sub ?? req?.user?.id;
  if (!id) throw new ForbiddenException("Usuario no identificado");
  return id;
}
function tenantDe(req: any): string | undefined {
  return req?.user?.tenantId;
}
function tienePermiso(req: any, codigo: string): boolean {
  const u = req?.user ?? {};
  return (u.roles ?? []).includes("SUPERADMIN") || (u.permisos ?? []).includes(codigo);
}

/** SQL del paso «actual» de un documento: pendiente y del menor orden pendiente. */
const SQL_PASO_ACTUAL = `
  df.estado = 'pendiente'
  AND df.orden = (SELECT min(x.orden) FROM documento_firma x
                   WHERE x.certificado_id = df.certificado_id AND x.estado = 'pendiente')`;

/**
 * Circuito de firma de informes y certificados (ver docs/FLUJO_FIRMA_CIERRE.md):
 * bandeja «Documentos por firmar», firmar, devolver, anular, reemitir, entregar
 * y enviar por correo. La EMISIÓN (que crea el documento en firma con sus pasos)
 * vive en PlantillaRenderService.emitir.
 */
@Injectable()
export class FirmaDocumentoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly render: PlantillaRenderService,
    private readonly mail: MailService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Lectura                                                                 */
  /* ---------------------------------------------------------------------- */

  private async cargar(id: string, req: any) {
    const tenantId = tenantDe(req);
    const cert = await this.prisma.certificado.findFirst({
      where: { id, deletedAt: null, ...(tenantId ? { tenantId } : {}) },
      include: {
        firmas: { orderBy: [{ orden: "asc" }, { createdAt: "asc" }] },
        plantilla: { select: { id: true, repid: true, nombre: true, tipo: true } },
        ot: { select: { id: true, codigo: true, estado: true, unidadPrincipal: true, cliente: { select: { razonSocial: true, email: true } } } },
      },
    });
    if (!cert) throw new NotFoundException(`Documento ${id} no encontrado`);
    return cert;
  }

  /** Vista del documento para la pantalla: estado, pasos, paso actual y qué puede hacer el usuario. */
  private vista(cert: Awaited<ReturnType<FirmaDocumentoService["cargar"]>>, usuarioId: string, req: any) {
    const pasos = cert.firmas.map((f) => ({
      id: f.id,
      orden: f.orden,
      accion: f.accion,
      rolCodigo: f.rolCodigo,
      rolNombre: f.rolNombre,
      unidadCodigo: f.unidadCodigo,
      unidadNombre: f.unidadNombre,
      obligatorio: f.obligatorio,
      responsables: f.responsables,
      estado: f.estado,
      firmadoPor: f.firmadoPor,
      firmadoAt: f.firmadoAt,
      firmanteNombre: f.firmanteNombre,
      firmanteCargo: f.firmanteCargo,
      via: f.via,
      tieneImagen: !!f.imagenData,
      hashFirma: f.hashFirma,
      motivo: f.motivo,
    }));
    const actuales = cert.estado === "en_firma" ? pasosActuales(pasos) : [];
    const decision = cert.estado === "en_firma" ? decidirFirma(pasos, usuarioId) : { paso: null, motivo: null };
    return {
      id: cert.id,
      numero: cert.numero ?? cert.codigo,
      version: cert.version,
      reemplazaId: cert.reemplazaId,
      tipo: cert.tipo,
      tipoDocumento: cert.tipoDocumento,
      estado: cert.estado,
      oficial: esOficial(cert.estado),
      fecha: cert.fecha,
      oficialAt: cert.oficialAt,
      codigoVerificacion: cert.codigoVerificacion,
      hashSha256: cert.hashSha256,
      devueltoAt: cert.devueltoAt,
      devueltoMotivo: cert.devueltoMotivo,
      anuladoAt: cert.anuladoAt,
      anuladoMotivo: cert.anuladoMotivo,
      entregadoAt: cert.entregadoAt,
      entregaMedio: cert.entregaMedio,
      entregaDestinatario: cert.entregaDestinatario,
      entregaObservacion: cert.entregaObservacion,
      ot: cert.ot ? { id: cert.ot.id, codigo: cert.ot.codigo, estado: cert.ot.estado, cliente: cert.ot.cliente?.razonSocial ?? null, emailCliente: cert.ot.cliente?.email ?? null } : null,
      plantilla: cert.plantilla,
      pasos,
      pasoActual: actuales.map((p) => ({ id: p.id, orden: p.orden, accion: p.accion, rolNombre: p.rolNombre, unidadCodigo: p.unidadCodigo, responsables: p.responsables })),
      puedo: {
        firmar: !!decision.paso,
        motivoNoFirmar: cert.estado === "en_firma" ? decision.motivo : null,
        anular: tienePermiso(req, "certificado.anular") && puedeTransitarDocumento(cert.estado, "anulado"),
        reemitir: tienePermiso(req, "certificado.emitir") && (cert.estado === "devuelto" || cert.estado === "anulado"),
        entregar: tienePermiso(req, "certificado.entregar") && esOficial(cert.estado) && !cert.entregadoAt,
      },
    };
  }

  async circuito(id: string, req: any) {
    const cert = await this.cargar(id, req);
    const usuarioId = usuarioDe(req);
    // Quien es responsable de un paso lo ve aunque el laboratorio no sea el suyo
    // (p. ej. Calidad o la jefatura de departamento); el resto, según su alcance.
    const esResponsable = cert.firmas.some((f) =>
      Array.isArray(f.responsables) && (f.responsables as any[]).some((r) => r?.usuarioId === usuarioId),
    );
    if (!esResponsable)
      await this.alcance.exigirUnidad(req, cert.unidadId ?? cert.ot?.unidadPrincipal, `el documento ${cert.numero ?? cert.codigo}`);
    const reemplazo = await this.prisma.certificado.findFirst({
      where: { reemplazaId: cert.id, deletedAt: null },
      select: { id: true, numero: true, estado: true },
    });
    const { modalidad } = await this.render.datosDeDocumento(cert.id);
    return { ...this.vista(cert, usuarioId, req), modalidad, reemplazadoPor: reemplazo };
  }

  /**
   * Listado de documentos (pantallas Informes y Certificados) con su estado de
   * firma y entrega. Acotado al alcance por laboratorio del usuario.
   */
  async listar(req: any, f: { otId?: string; estado?: string; search?: string; page?: string; limit?: string }) {
    const tenantId = tenantDe(req);
    const filtro = await this.alcance.filtroUnidades(req);
    const page = Math.max(1, parseInt(f.page ?? "1") || 1);
    const limit = Math.min(200, Math.max(1, parseInt(f.limit ?? "50") || 50));
    const where: any = { deletedAt: null, ...(tenantId ? { tenantId } : {}) };
    if (f.otId) where.otId = f.otId;
    if (f.estado === "por_entregar") {
      where.estado = { in: ["oficial", "emitido"] };
      where.entregadoAt = null;
    } else if (f.estado) where.estado = f.estado;
    if (filtro) where.OR = [{ unidadId: { in: filtro } }, { unidadId: null, ot: { unidadPrincipal: { in: filtro } } }];
    if (f.search) {
      const s = { contains: f.search, mode: "insensitive" };
      where.AND = [{ OR: [{ numero: s }, { codigo: s }, { ot: { codigo: s } }, { ot: { cliente: { razonSocial: s } } }] }];
    }
    const [filas, total] = await Promise.all([
      this.prisma.certificado.findMany({
        where,
        orderBy: { fecha: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          numero: true,
          codigo: true,
          version: true,
          tipo: true,
          tipoDocumento: true,
          estado: true,
          fecha: true,
          oficialAt: true,
          entregadoAt: true,
          entregaMedio: true,
          entregaDestinatario: true,
          anuladoMotivo: true,
          devueltoMotivo: true,
          hashSha256: true,
          codigoVerificacion: true,
          ot: { select: { id: true, codigo: true, cliente: { select: { razonSocial: true } } } },
          plantilla: { select: { repid: true, nombre: true } },
          firmas: { select: { orden: true, estado: true, accion: true, rolNombre: true, unidadCodigo: true, responsables: true } },
        },
      }),
      this.prisma.certificado.count({ where }),
    ]);
    // Modalidad del informe (cumplimiento / solo resultados): columna de
    // align_informe_ensayo.sql, fuera del modelo Prisma.
    const modalidades = new Map<string, string | null>();
    if (filas.length) {
      try {
        const ms = await this.prisma.$queryRaw<{ id: string; modalidad: string | null }[]>`
          SELECT id, modalidad FROM certificado WHERE id = ANY(${filas.map((c) => c.id)}::uuid[])`;
        for (const m of ms) modalidades.set(m.id, m.modalidad);
      } catch {
        /* BD sin la columna: sin modalidad */
      }
    }
    const data = filas.map(({ firmas, ...c }) => {
      const actuales = c.estado === "en_firma" ? pasosActuales(firmas.map((x, i) => ({ ...x, id: String(i) }))) : [];
      return {
        ...c,
        modalidad: modalidades.get(c.id) ?? null,
        numero: c.numero ?? c.codigo,
        firmasHechas: firmas.filter((x) => x.estado === "firmado").length,
        firmasTotal: firmas.filter((x) => x.estado !== "anulado").length,
        pendienteDe: actuales.map((p) => ({
          accion: p.accion,
          rol: p.rolNombre,
          unidad: p.unidadCodigo,
          responsables: Array.isArray(p.responsables) ? (p.responsables as any[]).map((r) => r?.nombre).filter(Boolean) : [],
        })),
      };
    });
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  /** Documentos cuyo paso ACTUAL tiene al usuario entre sus responsables. */
  async porFirmar(req: any) {
    const usuarioId = usuarioDe(req);
    const tenantId = tenantDe(req) ?? null;
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id, COALESCE(c.numero, c.codigo) AS numero, c.version, c.tipo, c.tipo_documento AS "tipoDocumento",
              c.fecha, o.id AS "otId", o.codigo AS "otCodigo", cl.razon_social AS cliente,
              p.repid AS "plantillaRepid", p.nombre AS "plantillaNombre",
              df.id AS "pasoId", df.orden, df.accion, df.rol_nombre AS "rolNombre", df.unidad_codigo AS "unidadCodigo",
              (SELECT count(*) FROM documento_firma y WHERE y.certificado_id = c.id AND y.estado = 'firmado')::int AS "firmasHechas",
              (SELECT count(*) FROM documento_firma y WHERE y.certificado_id = c.id AND y.estado <> 'anulado')::int AS "firmasTotal"
         FROM documento_firma df
         JOIN certificado c ON c.id = df.certificado_id
         JOIN orden_trabajo o ON o.id = c.ot_id
         LEFT JOIN cliente cl ON cl.id = o.cliente_id
         LEFT JOIN plantilla_informe p ON p.id = c.plantilla_id
        WHERE c.estado = 'en_firma' AND c.deleted_at IS NULL
          AND c.tenant_id = COALESCE($1::uuid, c.tenant_id)
          AND df.responsables @> jsonb_build_array(jsonb_build_object('usuarioId', $2::text))
          AND ${SQL_PASO_ACTUAL}
        ORDER BY c.fecha ASC`,
      tenantId,
      usuarioId,
    );
    // Un documento puede salir dos veces si el usuario es responsable de dos
    // pasos paralelos: se deja una fila por documento.
    const vistos = new Set<string>();
    return filas.filter((f) => (vistos.has(f.id) ? false : (vistos.add(f.id), true)));
  }

  /* ---------------------------------------------------------------------- */
  /* Firmar / devolver                                                       */
  /* ---------------------------------------------------------------------- */

  async firmar(id: string, req: any, comentario?: string) {
    const usuarioId = usuarioDe(req);
    const cert = await this.cargar(id, req);
    if (cert.estado !== "en_firma")
      throw new ConflictException(`El documento ${cert.numero ?? cert.codigo} no está en firma (estado: ${cert.estado}).`);
    const { paso, motivo } = decidirFirma(cert.firmas, usuarioId);
    if (!paso) throw new ForbiddenException(motivo ?? "No le corresponde firmar este documento.");

    const [usuario, firmaReg] = await Promise.all([
      this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nombreCompleto: true, cargo: true, grado: true } }),
      this.prisma.firma.findUnique({ where: { usuarioId }, select: { imagenData: true, hashSha256: true } }),
    ]);
    const via = (Array.isArray(paso.responsables) ? (paso.responsables as any[]) : []).find((r) => r?.usuarioId === usuarioId)?.via ?? null;
    const ahora = new Date();
    const hashFirma = createHash("sha256")
      .update(`${cert.hashSha256 ?? ""}|${paso.id}|${usuarioId}|${ahora.toISOString()}`, "utf8")
      .digest("hex");
    const imagen = firmaReg?.imagenData ?? null;
    const imagenHash = imagen ? createHash("sha256").update(imagen, "utf8").digest("hex") : null;

    const oficial = quedaOficial(cert.firmas, paso.id);
    await this.prisma.$transaction(async (tx) => {
      // Firma optimista: si otro responsable firmó este paso a la vez, no se pisa.
      const r = await tx.documentoFirma.updateMany({
        where: { id: paso.id, estado: "pendiente" },
        data: {
          estado: "firmado",
          firmadoPor: usuarioId,
          firmadoAt: ahora,
          firmanteNombre: usuario?.nombreCompleto ?? null,
          firmanteCargo: usuario?.cargo ?? null,
          firmanteGrado: usuario?.grado ?? null,
          via,
          imagenData: imagen,
          imagenHash,
          hashFirma,
          motivo: comentario?.trim() || null,
        },
      });
      if (r.count !== 1) throw new ConflictException("Este paso ya fue firmado por otra persona. Actualice la pantalla.");
      if (oficial) {
        const c = await tx.certificado.updateMany({
          where: { id: cert.id, estado: "en_firma" },
          data: { estado: "oficial", oficialAt: ahora },
        });
        if (c.count !== 1) throw new ConflictException("El documento cambió de estado mientras firmaba. Actualice la pantalla.");
      }
    });
    return this.circuito(id, req);
  }

  async devolver(id: string, motivo: string, req: any) {
    const usuarioId = usuarioDe(req);
    const texto = (motivo ?? "").trim();
    if (texto.length < 5) throw new BadRequestException("Indique el motivo de la devolución (al menos 5 caracteres).");
    const cert = await this.cargar(id, req);
    if (cert.estado !== "en_firma")
      throw new ConflictException(`El documento ${cert.numero ?? cert.codigo} no está en firma (estado: ${cert.estado}).`);
    const { paso, motivo: noPuede } = decidirFirma(cert.firmas, usuarioId);
    if (!paso) throw new ForbiddenException(noPuede ?? "Solo devuelve el documento quien debe firmar el paso actual.");
    const ahora = new Date();
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.certificado.updateMany({
        where: { id: cert.id, estado: "en_firma" },
        data: { estado: "devuelto", devueltoAt: ahora, devueltoPor: usuarioId, devueltoMotivo: texto },
      });
      if (c.count !== 1) throw new ConflictException("El documento cambió de estado. Actualice la pantalla.");
      await tx.documentoFirma.update({
        where: { id: paso.id },
        data: { estado: "devuelto", firmadoPor: usuarioId, firmadoAt: ahora, motivo: texto },
      });
      await tx.documentoFirma.updateMany({
        where: { certificadoId: cert.id, estado: "pendiente" },
        data: { estado: "anulado" },
      });
    });
    return this.circuito(id, req);
  }

  /* ---------------------------------------------------------------------- */
  /* Anular / reemitir                                                       */
  /* ---------------------------------------------------------------------- */

  async anular(id: string, motivo: string, req: any) {
    const usuarioId = usuarioDe(req);
    const texto = (motivo ?? "").trim();
    if (texto.length < 5) throw new BadRequestException("Indique el motivo de la anulación (al menos 5 caracteres).");
    const cert = await this.cargar(id, req);
    await this.alcance.exigirUnidad(req, cert.unidadId ?? cert.ot?.unidadPrincipal, `el documento ${cert.numero ?? cert.codigo}`);
    if (!puedeTransitarDocumento(cert.estado, "anulado"))
      throw new ConflictException(`El documento ${cert.numero ?? cert.codigo} ya está ${cert.estado}.`);
    const ahora = new Date();
    await this.prisma.$transaction([
      this.prisma.certificado.update({
        where: { id: cert.id },
        data: { estado: "anulado", anuladoAt: ahora, anuladoPor: usuarioId, anuladoMotivo: texto },
      }),
      this.prisma.documentoFirma.updateMany({
        where: { certificadoId: cert.id, estado: "pendiente" },
        data: { estado: "anulado" },
      }),
    ]);
    return this.circuito(id, req);
  }

  async reemitir(id: string, req: any) {
    const cert = await this.cargar(id, req);
    await this.alcance.exigirUnidad(req, cert.unidadId ?? cert.ot?.unidadPrincipal, `el documento ${cert.numero ?? cert.codigo}`);
    return this.render.emitir(cert.otId, cert.plantillaId ?? "", cert.tenantId, usuarioDe(req), { reemplazaId: cert.id });
  }

  /* ---------------------------------------------------------------------- */
  /* Entrega                                                                 */
  /* ---------------------------------------------------------------------- */

  async entregar(
    id: string,
    dto: { fecha?: Date; medio: string; destinatario: string; observacion?: string },
    req: any,
  ) {
    const cert = await this.cargar(id, req);
    await this.alcance.exigirUnidad(req, cert.unidadId ?? cert.ot?.unidadPrincipal, `el documento ${cert.numero ?? cert.codigo}`);
    if (!esOficial(cert.estado))
      throw new ConflictException(
        `Solo se entrega un documento oficial. ${cert.numero ?? cert.codigo} está ${cert.estado === "en_firma" ? "en firma" : cert.estado}.`,
      );
    if (cert.entregadoAt)
      throw new ConflictException(`La entrega de ${cert.numero ?? cert.codigo} ya está registrada (${fmtFecha(cert.entregadoAt)}).`);
    const fecha = dto.fecha ?? new Date();
    if (fecha.getTime() > Date.now() + 60_000) throw new BadRequestException("La fecha de entrega no puede ser futura.");
    await this.prisma.certificado.update({
      where: { id: cert.id },
      data: {
        entregadoAt: fecha,
        entregaMedio: dto.medio,
        entregaDestinatario: dto.destinatario.trim(),
        entregaObservacion: dto.observacion?.trim() || null,
        entregaRegistradaPor: usuarioDe(req),
      },
    });
    return this.circuito(id, req);
  }

  /**
   * Envía el PDF oficial por correo con la configuración SMTP del tenant
   * (MailService de Configuración, el mismo que usa Mensajería) y lo deja en la
   * bitácora `correo_enviado` (tipo 'informe'). Si el envío sale bien y la
   * entrega no estaba registrada, la registra (medio «correo»). Si el SMTP no
   * está operativo, responde { ok:false, error } sin registrar la entrega.
   */
  async enviarCorreo(id: string, dto: { destinatarios: string[]; mensaje?: string }, req: any) {
    const cert = await this.cargar(id, req);
    await this.alcance.exigirUnidad(req, cert.unidadId ?? cert.ot?.unidadPrincipal, `el documento ${cert.numero ?? cert.codigo}`);
    if (!esOficial(cert.estado))
      throw new ConflictException(`Solo se envía un documento oficial. ${cert.numero ?? cert.codigo} está ${cert.estado}.`);
    const destinatarios = [...new Set(dto.destinatarios.map((d) => d.trim()).filter(Boolean))];
    if (!destinatarios.length) throw new BadRequestException("Indique al menos un correo de destino.");

    const { buffer, nombre } = await this.render.pdf(cert.id, cert.tenantId);
    const numero = cert.numero ?? cert.codigo;
    const asunto = `IDIC · ${cert.plantilla?.nombre ?? "Informe"} ${numero} · OT ${cert.ot?.codigo ?? ""}`.slice(0, 300);
    const html =
      `<p>Estimado(a) ${escapeHtml(cert.ot?.cliente?.razonSocial ?? "cliente")}:</p>` +
      `<p>Adjuntamos el documento <b>${escapeHtml(numero)}</b> correspondiente a la orden de trabajo ` +
      `<b>${escapeHtml(cert.ot?.codigo ?? "")}</b>.</p>` +
      (dto.mensaje?.trim() ? `<p>${escapeHtml(dto.mensaje.trim())}</p>` : "") +
      `<p>Puede verificar su autenticidad con el código <b>${escapeHtml(cert.codigoVerificacion ?? "")}</b>` +
      (cert.urlVerificacion ? ` en ${escapeHtml(cert.urlVerificacion)}` : "") +
      `.</p><p>Instituto de Investigaciones y Control del Ejército de Chile</p>`;

    let ok = true;
    let error: string | null = null;
    let messageId: string | null = null;
    try {
      const r = await this.mail.sendMail(cert.tenantId, {
        to: destinatarios,
        subject: asunto,
        html,
        attachments: [{ filename: nombre, content: buffer, contentType: "application/pdf" }],
      });
      messageId = r.messageId ?? null;
    } catch (e: any) {
      ok = false;
      error = String(e?.response ?? e?.message ?? "Error al enviar").slice(0, 300);
    }

    // Bitácora de Mensajería (tabla de align_correo_log.sql). Defensiva: si la
    // tabla no existe en esta BD, el envío no se cae por eso.
    try {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO correo_enviado (tenant_id, tipo, destinatarios, asunto, cuerpo_resumen, plantilla,
                                     ot_id, estado, error, message_id, enviado_por)
         VALUES ($1::uuid, 'informe', $2, $3, $4, NULL, $5::uuid, $6, $7, $8, $9::uuid)`,
        cert.tenantId,
        destinatarios.join(", "),
        asunto,
        `Envío del documento ${numero} (PDF adjunto).`,
        cert.otId,
        ok ? "enviado" : "error",
        error,
        messageId,
        usuarioDe(req),
      );
    } catch {
      /* sin bitácora de correo en esta BD */
    }

    if (ok && !cert.entregadoAt) {
      await this.prisma.certificado.update({
        where: { id: cert.id },
        data: {
          entregadoAt: new Date(),
          entregaMedio: "correo",
          entregaDestinatario: destinatarios.join(", ").slice(0, 200),
          entregaObservacion: `Enviado por correo desde el LIMS el ${fmtFechaHora(new Date())}.`,
          entregaRegistradaPor: usuarioDe(req),
        },
      });
    }
    return {
      ok,
      error: ok ? null : `No se pudo enviar el correo: ${error}. Revise la configuración de correo o registre la entrega manualmente.`,
      destinatarios,
      documento: await this.circuito(id, req),
    };
  }
}
