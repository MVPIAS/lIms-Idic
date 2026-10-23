/**
 * Oficio conductor (T03 · BL-005, BL-207; EP-00 3.1–3.3 y EP-05 7.2).
 *
 * El oficio nace en borrador desde una cotización (Ejército y FF.AA.; unidad
 * emisora DCO) o desde documentos oficiales de una OT (IVC, Informe Técnico,
 * Rechazo; unidad emisora la del documento). «Generar oficio → firmas» le da el
 * número de su unidad (numeración OFICIO) y resuelve el circuito con la matriz
 * de firmas (tipo OFICIO: V°B° del Jefe de Departamento → firma del Director).
 * Firmar y devolver no llevan permiso: los autoriza la matriz, como en los
 * informes. Firmado, la Oficina de partes registra el Nº y la fecha de despacho.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { FirmasMatrizService } from "../rbac/firmas-matriz.controller";
import { NumeracionService } from "../plantilla-render/numeracion.service";
import { AvisosService } from "../avisos/avisos.service";
import { decidirFirma, idsResponsables, pasosActuales, quedaOficial } from "../plantilla-render/reglas-emision";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import { fechaChile, fechaHoraChile } from "../common/fecha-chile";
import { nuevoCodigoVerificacion } from "../common/codigo-verificacion";
import { hoyCl } from "../ot/plazos";
import { editable, errorTransicionOficio, erroresDespachoOficio, erroresOficio, htmlOficio, type EstadoOficio } from "./reglas-oficio";

const tienePermiso = (req: any, p: string) => (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes(p);
const usuarioDe = (req: any): string => req?.user?.sub;

export interface OficioDto {
  cotizacionId?: string;
  otId?: string;
  documentos?: string[];
  destinatario: string;
  materia: string;
  cuerpo?: string;
  fecha?: string;
  distribucion?: { destinatario: string; ejemplares: number }[];
}

@Injectable()
export class OficioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly matriz: FirmasMatrizService,
    private readonly numeracion: NumeracionService,
    private readonly avisos: AvisosService,
  ) {}

  /* --------------------------------------------------------------- lectura --- */

  private async fila(id: string, req: any) {
    const [o] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT f.*, f.fecha::text AS fecha_txt, f.despacho_fecha::text AS despacho_fecha_txt,
              u.codigo AS unidad_codigo, u.nombre AS unidad_nombre,
              c.codigo AS cotizacion_codigo, ot.codigo AS ot_codigo, uc.nombre_completo AS creado_por_nombre,
              ud.nombre_completo AS despachado_por_nombre
         FROM oficio f
         JOIN unidad u ON u.id = f.unidad_id
         LEFT JOIN cotizacion c ON c.id = f.cotizacion_id
         LEFT JOIN orden_trabajo ot ON ot.id = f.ot_id
         LEFT JOIN usuario uc ON uc.id = f.creado_por
         LEFT JOIN usuario ud ON ud.id = f.despachado_por
        WHERE f.id = $1::uuid AND ($2::uuid IS NULL OR f.tenant_id = $2::uuid)`,
      id,
      req?.user?.tenantId ?? null,
    );
    if (!o) throw new NotFoundException("Oficio no encontrado.");
    return o;
  }

  private pasos(oficioId: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.id, p.orden, p.accion, p.rol_codigo AS "rolCodigo", p.rol_nombre AS "rolNombre", u.codigo AS "unidadCodigo",
              p.responsables, p.estado, p.firmado_por AS "firmadoPor", p.firmado_at AS "firmadoAt", p.comentario,
              us.nombre_completo AS "firmanteNombre", us.cargo AS "firmanteCargo"
         FROM oficio_firma p LEFT JOIN unidad u ON u.id = p.unidad_id LEFT JOIN usuario us ON us.id = p.firmado_por
        WHERE p.oficio_id = $1::uuid ORDER BY p.orden, p.id`,
      oficioId,
    );
  }

  /** Lo ve quien tiene oficio.ver en la unidad emisora o es responsable de alguno de sus pasos. */
  private async exigirVer(o: any, pasos: any[], req: any) {
    const yo = usuarioDe(req);
    if (pasos.some((p) => idsResponsables(p.responsables).includes(yo))) return;
    await this.alcance.exigirUnidad(req, o.unidad_id, `el oficio ${o.numero ?? ""}`.trim());
  }

  private async documentosDe(ids: string[]) {
    if (!ids?.length) return [];
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id, COALESCE(c.numero, c.codigo) AS numero, c.estado, c.tipo_documento AS "tipoDocumento", c.ot_id AS "otId", p.nombre AS plantilla
         FROM certificado c LEFT JOIN plantilla_informe p ON p.id = c.plantilla_id WHERE c.id = ANY($1::uuid[])`,
      ids,
    );
  }

  async detalle(id: string, req: any) {
    const o = await this.fila(id, req);
    const pasos = await this.pasos(id);
    await this.exigirVer(o, pasos, req);
    const yo = usuarioDe(req);
    const decision = o.estado === "en_firma" ? decidirFirma(pasos, yo) : { paso: null, motivo: null };
    const actuales = o.estado === "en_firma" ? pasosActuales(pasos) : [];
    const esAutor = o.creado_por === yo;
    return {
      id: o.id,
      numero: o.numero,
      estado: o.estado as EstadoOficio,
      fecha: o.fecha_txt,
      destinatario: o.destinatario,
      materia: o.materia,
      cuerpo: o.cuerpo,
      distribucion: o.distribucion ?? [],
      unidad: { id: o.unidad_id, codigo: o.unidad_codigo, nombre: o.unidad_nombre },
      cotizacion: o.cotizacion_id ? { id: o.cotizacion_id, codigo: o.cotizacion_codigo } : null,
      ot: o.ot_id ? { id: o.ot_id, codigo: o.ot_codigo } : null,
      documentos: await this.documentosDe(o.documentos ?? []),
      devueltoMotivo: o.devuelto_motivo,
      anuladoMotivo: o.anulado_motivo,
      despacho: o.despacho_numero ? { numero: o.despacho_numero, fecha: o.despacho_fecha_txt, por: o.despachado_por_nombre, at: o.despachado_at } : null,
      creadoPor: o.creado_por_nombre,
      createdAt: o.created_at,
      pasos,
      pasoActual: actuales.map((p) => p.id),
      puedo: {
        editar: editable(o.estado) && (esAutor || tienePermiso(req, "oficio.crear")),
        generar: editable(o.estado) && tienePermiso(req, "oficio.crear"),
        firmar: !!decision.paso,
        motivoNoFirmar: o.estado === "en_firma" ? decision.motivo : null,
        despachar: o.estado === "firmado" && tienePermiso(req, "oficio.despachar"),
        anular: !["despachado", "anulado"].includes(o.estado) && tienePermiso(req, "oficio.crear"),
      },
    };
  }

  /** Listado: de mi ámbito, «por firmar» (me toca un paso) o «por despachar» (Oficina de partes). */
  async listar(req: any, f: { estado?: string; vista?: string; otId?: string; cotizacionId?: string }) {
    const tenantId = req?.user?.tenantId;
    const yo = usuarioDe(req);
    const filtro = await this.alcance.filtroUnidades(req);
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT f.id, f.numero, f.estado, f.fecha::text AS fecha, f.destinatario, f.materia, u.codigo AS unidad,
              c.codigo AS cotizacion, ot.codigo AS ot, f.ot_id AS "otId", f.cotizacion_id AS "cotizacionId",
              f.despacho_numero AS "despachoNumero", f.created_at AS "createdAt",
              EXISTS (SELECT 1 FROM oficio_firma p WHERE p.oficio_id = f.id AND p.estado = 'pendiente'
                         AND p.orden = (SELECT min(x.orden) FROM oficio_firma x WHERE x.oficio_id = f.id AND x.estado = 'pendiente')
                         AND p.responsables @> jsonb_build_array(jsonb_build_object('usuarioId', $3::text))) AS "meToca"
         FROM oficio f JOIN unidad u ON u.id = f.unidad_id
         LEFT JOIN cotizacion c ON c.id = f.cotizacion_id
         LEFT JOIN orden_trabajo ot ON ot.id = f.ot_id
        WHERE f.tenant_id = $1::uuid
          AND ($2::uuid[] IS NULL OR f.unidad_id = ANY($2::uuid[])
               OR EXISTS (SELECT 1 FROM oficio_firma p WHERE p.oficio_id = f.id AND p.responsables @> jsonb_build_array(jsonb_build_object('usuarioId', $3::text))))
          AND ($4::text IS NULL OR f.estado = $4)
          AND ($5::uuid IS NULL OR f.ot_id = $5::uuid)
          AND ($6::uuid IS NULL OR f.cotizacion_id = $6::uuid)
        ORDER BY f.created_at DESC LIMIT 300`,
      tenantId,
      filtro,
      yo,
      f.estado || null,
      f.otId || null,
      f.cotizacionId || null,
    );
    const data =
      f.vista === "por_firmar"
        ? filas.filter((x) => x.estado === "en_firma" && x.meToca)
        : f.vista === "por_despachar"
          ? filas.filter((x) => x.estado === "firmado")
          : filas;
    return { data, total: data.length };
  }

  /* ---------------------------------------------------------------- crear --- */

  /** Unidad emisora y vínculo, comprobando el alcance. */
  private async origen(dto: OficioDto, req: any): Promise<{ unidadId: string; otId: string | null; cotizacionId: string | null; documentos: string[] }> {
    const tenantId = req?.user?.tenantId;
    if (dto.cotizacionId) {
      const [c] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT c.id, (SELECT o.id FROM orden_trabajo o WHERE o.cotizacion_id = c.id ORDER BY o.created_at LIMIT 1) AS ot_id
           FROM cotizacion c WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid`,
        dto.cotizacionId,
        tenantId,
      );
      if (!c) throw new NotFoundException("Cotización no encontrada.");
      const [dco] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM unidad WHERE codigo = 'DCO' AND tenant_id = $1::uuid`, tenantId);
      if (!dco) throw new ConflictException("No existe el Departamento Comercial (DCO) en el organigrama.");
      await this.alcance.exigirUnidad(req, dco.id, "el Departamento Comercial");
      return { unidadId: dco.id, otId: null, cotizacionId: c.id, documentos: [] };
    }
    if (!dto.otId) throw new BadRequestException("El oficio conduce una cotización o documentos de una OT.");
    const [ot] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, unidad_principal FROM orden_trabajo WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      dto.otId,
      tenantId,
    );
    if (!ot) throw new NotFoundException("OT no encontrada.");
    await this.alcance.exigirUnidad(req, ot.unidad_principal, `la OT ${ot.codigo}`);
    const docs = await this.documentosDe(dto.documentos ?? []);
    if (docs.length !== (dto.documentos ?? []).length || docs.some((d) => d.otId !== ot.id))
      throw new BadRequestException("Los documentos del oficio deben ser de la misma OT.");
    const noOficial = docs.find((d) => !["oficial", "emitido"].includes(d.estado));
    if (noOficial) throw new ConflictException(`El oficio conduce documentos oficiales: ${noOficial.numero} está ${noOficial.estado}.`);
    // Unidad emisora: la del primer documento (o la de la OT).
    const [u] = docs.length
      ? await this.prisma.$queryRawUnsafe<{ unidad_id: string | null }[]>(`SELECT unidad_id FROM certificado WHERE id = $1::uuid`, docs[0].id)
      : [{ unidad_id: null }];
    return { unidadId: u?.unidad_id ?? ot.unidad_principal, otId: ot.id, cotizacionId: null, documentos: docs.map((d) => d.id) };
  }

  async crear(dto: OficioDto, req: any) {
    const o = await this.origen(dto, req);
    const errores = erroresOficio({ ...o, destinatario: dto.destinatario, materia: dto.materia, distribucion: dto.distribucion ?? [] });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const [f] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO oficio (tenant_id, unidad_id, fecha, destinatario, materia, cuerpo, distribucion, cotizacion_id, ot_id, documentos, creado_por)
       VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6, $7::jsonb, $8::uuid, $9::uuid, $10::uuid[], $11::uuid) RETURNING id`,
      req.user.tenantId,
      o.unidadId,
      dto.fecha ?? hoyCl(),
      dto.destinatario.trim(),
      dto.materia.trim(),
      dto.cuerpo?.trim() || null,
      JSON.stringify(dto.distribucion ?? []),
      o.cotizacionId,
      o.otId,
      o.documentos,
      usuarioDe(req),
    );
    await this.historial(f.id, "elaborado (borrador)", req);
    return this.detalle(f.id, req);
  }

  async editar(id: string, dto: Partial<OficioDto>, req: any) {
    const o = await this.fila(id, req);
    await this.alcance.exigirUnidad(req, o.unidad_id, "el oficio");
    if (!editable(o.estado)) throw new ConflictException("Solo se corrige un oficio en borrador o devuelto.");
    const destinatario = dto.destinatario?.trim() ?? o.destinatario;
    const materia = dto.materia?.trim() ?? o.materia;
    const distribucion = dto.distribucion ?? o.distribucion ?? [];
    let documentos: string[] = o.documentos ?? [];
    if (dto.documentos && o.ot_id) {
      const r = await this.origen({ otId: o.ot_id, documentos: dto.documentos, destinatario, materia }, req);
      documentos = r.documentos;
    }
    const errores = erroresOficio({ destinatario, materia, distribucion, documentos, otId: o.ot_id, cotizacionId: o.cotizacion_id });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.prisma.$executeRawUnsafe(
      `UPDATE oficio SET destinatario = $2, materia = $3, cuerpo = $4, distribucion = $5::jsonb, documentos = $6::uuid[],
              fecha = COALESCE($7::date, fecha), updated_at = now() WHERE id = $1::uuid`,
      id,
      destinatario,
      materia,
      dto.cuerpo !== undefined ? dto.cuerpo?.trim() || null : o.cuerpo,
      JSON.stringify(distribucion),
      documentos,
      dto.fecha ?? null,
    );
    return this.detalle(id, req);
  }

  /* ---------------------------------------------------------- circuito --- */

  /** «Generar oficio → firmas»: número de la unidad y pasos de la matriz OFICIO. */
  async generar(id: string, req: any) {
    const o = await this.fila(id, req);
    await this.alcance.exigirUnidad(req, o.unidad_id, "el oficio");
    const err = errorTransicionOficio(o.estado, "en_firma");
    if (err) throw new ConflictException(err);
    const errores = erroresOficio({
      destinatario: o.destinatario,
      materia: o.materia,
      distribucion: o.distribucion ?? [],
      documentos: o.documentos ?? [],
      otId: o.ot_id,
      cotizacionId: o.cotizacion_id,
    });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const res = await this.matriz.resolver("OFICIO", o.unidad_id, o.tenant_id);
    if (!res.pasos.length) throw new ConflictException("La matriz de firmas no tiene pasos para el tipo OFICIO: configúrelos en Administración › Matriz de firmas.");
    const sinResponsable = res.pasos.find((p) => p.obligatorio && !p.responsables.length);
    if (sinResponsable) throw new ConflictException(`No se puede enviar a firmas: ${sinResponsable.advertencia ?? `nadie firma el paso ${sinResponsable.orden}`}.`);

    await this.prisma.$transaction(async (tx) => {
      const [b] = await tx.$queryRawUnsafe<{ estado: string; numero: string | null }[]>(`SELECT estado, numero FROM oficio WHERE id = $1::uuid FOR UPDATE`, id);
      if (errorTransicionOficio(b.estado, "en_firma")) throw new ConflictException("El oficio cambió de estado. Actualice la pantalla.");
      let numero = b.numero;
      if (!numero) {
        const r = await this.numeracion.reservar(
          tx,
          { tenantId: o.tenant_id, unidadId: o.unidad_id, tipo: "OFICIO", fecha: new Date(), ot: o.ot_codigo ?? null },
          async (n) => (await tx.$queryRawUnsafe<any[]>(`SELECT 1 FROM oficio WHERE tenant_id = $1::uuid AND numero = $2`, o.tenant_id, n)).length > 0,
        );
        if (!r.numero) throw new ConflictException("No hay numeración para los oficios de esta unidad: configúrela en Administración › Numeración de documentos (tipo OFICIO).");
        numero = r.numero;
      }
      await tx.$executeRawUnsafe(`UPDATE oficio_firma SET estado = 'anulado' WHERE oficio_id = $1::uuid AND estado = 'pendiente'`, id);
      for (const p of res.pasos)
        await tx.$executeRawUnsafe(
          `INSERT INTO oficio_firma (tenant_id, oficio_id, orden, accion, rol_codigo, rol_nombre, unidad_id, responsables)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8::jsonb)`,
          o.tenant_id,
          id,
          p.orden,
          p.accion,
          p.rol.codigo,
          p.rol.nombre,
          p.unidad?.id ?? null,
          JSON.stringify(p.responsables.map((r) => ({ usuarioId: r.usuarioId, nombre: r.nombre, via: r.via }))),
        );
      await tx.$executeRawUnsafe(
        `UPDATE oficio SET estado = 'en_firma', numero = $2, devuelto_motivo = NULL, codigo_verificacion = COALESCE(codigo_verificacion, $3), updated_at = now()
          WHERE id = $1::uuid`,
        id,
        numero,
        nuevoCodigoVerificacion(),
      );
    });
    await this.historial(id, "enviado a firmas", req);
    await this.avisarPasoActual(id, req);
    return this.detalle(id, req);
  }

  private async avisarPasoActual(id: string, req: any) {
    const o = await this.fila(id, req);
    const actuales = pasosActuales(await this.pasos(id));
    for (const p of actuales)
      await this.avisos
        .emitir(
          o.tenant_id,
          {
            tipo: "oficio_firma",
            titulo: `Oficio ${o.numero} · ${p.accion === "VB" ? "V°B°" : "firma"} pendiente`,
            mensaje: `El oficio ${o.numero} (${o.materia}) a ${o.destinatario} espera su ${p.accion === "VB" ? "V°B°" : "firma"}.`,
            ruta: `/oficios/${id}`,
            otId: o.ot_id,
            clave: `oficio_firma:${p.id}`,
            creadoPor: usuarioDe(req),
          },
          { usuarios: idsResponsables(p.responsables) },
        )
        .catch(() => undefined);
  }

  async firmar(id: string, comentario: string | undefined, req: any) {
    const o = await this.fila(id, req);
    if (o.estado !== "en_firma") throw new ConflictException(errorTransicionOficio(o.estado, "firmado") ?? "El oficio no está en firma.");
    const pasos = await this.pasos(id);
    const { paso, motivo } = decidirFirma(pasos, usuarioDe(req));
    if (!paso) throw new ForbiddenException(motivo ?? "No le corresponde firmar este oficio.");
    const final = quedaOficial(pasos, paso.id);
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.$executeRawUnsafe(
        `UPDATE oficio_firma SET estado = 'firmado', firmado_por = $2::uuid, firmado_at = now(), comentario = $3 WHERE id = $1::uuid AND estado = 'pendiente'`,
        paso.id,
        usuarioDe(req),
        comentario?.trim() || null,
      );
      if (Number(n) !== 1) throw new ConflictException("Este paso ya fue firmado por otra persona. Actualice la pantalla.");
      if (final) await tx.$executeRawUnsafe(`UPDATE oficio SET estado = 'firmado', updated_at = now() WHERE id = $1::uuid AND estado = 'en_firma'`, id);
    });
    await this.historial(id, final ? "firmado (todas las firmas)" : `${paso.accion === "VB" ? "V°B°" : "firma"} de ${paso.rolNombre ?? paso.rolCodigo}`, req);
    if (final)
      await this.avisos
        .emitir(
          o.tenant_id,
          {
            tipo: "oficio_firmado",
            titulo: `Oficio ${o.numero} firmado: por despachar`,
            mensaje: `El oficio ${o.numero} a ${o.destinatario} tiene todas sus firmas. La Oficina de partes registra su Nº y fecha de despacho.`,
            ruta: `/oficios/${id}`,
            otId: o.ot_id,
            clave: `oficio_firmado:${id}`,
            creadoPor: usuarioDe(req),
          },
          { usuarios: [o.creado_por], roles: [{ rol: "DIRECTOR" }, { rol: "SUBDIRECTOR" }] },
        )
        .catch(() => undefined);
    else await this.avisarPasoActual(id, req);
    return this.detalle(id, req);
  }

  async devolver(id: string, motivo: string, req: any) {
    const o = await this.fila(id, req);
    if (o.estado !== "en_firma") throw new ConflictException(errorTransicionOficio(o.estado, "devuelto") ?? "El oficio no está en firma.");
    const { paso, motivo: m } = decidirFirma(await this.pasos(id), usuarioDe(req));
    if (!paso) throw new ForbiddenException(m ?? "No le corresponde devolver este oficio.");
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE oficio_firma SET estado = 'devuelto', firmado_por = $2::uuid, firmado_at = now(), comentario = $3 WHERE id = $1::uuid`,
        paso.id,
        usuarioDe(req),
        motivo.trim(),
      );
      await tx.$executeRawUnsafe(`UPDATE oficio_firma SET estado = 'anulado' WHERE oficio_id = $1::uuid AND estado = 'pendiente'`, id);
      await tx.$executeRawUnsafe(`UPDATE oficio SET estado = 'devuelto', devuelto_motivo = $2, updated_at = now() WHERE id = $1::uuid`, id, motivo.trim());
    });
    await this.historial(id, `devuelto: ${motivo.trim()}`, req);
    await this.avisos
      .emitir(
        o.tenant_id,
        {
          tipo: "oficio_devuelto",
          titulo: `Oficio ${o.numero} devuelto`,
          mensaje: `Devuelto por ${paso.rolNombre ?? paso.rolCodigo}: ${motivo.trim()}. Corríjalo y vuelva a enviarlo a firmas.`,
          ruta: `/oficios/${id}`,
          otId: o.ot_id,
          clave: `oficio_devuelto:${paso.id}`,
          creadoPor: usuarioDe(req),
        },
        { usuarios: [o.creado_por] },
      )
      .catch(() => undefined);
    return this.detalle(id, req);
  }

  /** EP-00 3.3: la Oficina de partes registra el Nº y la fecha de despacho. */
  async despachar(id: string, dto: { numero: string; fecha?: string }, req: any) {
    const o = await this.fila(id, req);
    const err = errorTransicionOficio(o.estado, "despachado");
    if (err) throw new ConflictException(err);
    const fecha = dto.fecha ?? hoyCl();
    const errores = erroresDespachoOficio({ numero: dto.numero, fecha, hoy: hoyCl() });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.prisma.$executeRawUnsafe(
      `UPDATE oficio SET estado = 'despachado', despacho_numero = $2, despacho_fecha = $3::date, despachado_por = $4::uuid, despachado_at = now(), updated_at = now()
        WHERE id = $1::uuid AND estado = 'firmado'`,
      id,
      dto.numero.trim(),
      fecha,
      usuarioDe(req),
    );
    await this.historial(id, `despachado por Oficina de partes (Nº ${dto.numero.trim()})`, req);
    return this.detalle(id, req);
  }

  async anular(id: string, motivo: string, req: any) {
    const o = await this.fila(id, req);
    await this.alcance.exigirUnidad(req, o.unidad_id, "el oficio");
    const err = errorTransicionOficio(o.estado, "anulado");
    if (err) throw new ConflictException(err);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE oficio_firma SET estado = 'anulado' WHERE oficio_id = $1::uuid AND estado = 'pendiente'`, id);
      await tx.$executeRawUnsafe(`UPDATE oficio SET estado = 'anulado', anulado_motivo = $2, updated_at = now() WHERE id = $1::uuid`, id, motivo.trim());
    });
    await this.historial(id, `anulado: ${motivo.trim()}`, req);
    return this.detalle(id, req);
  }

  /** Hito en el historial de la OT del oficio (si tiene OT). */
  private async historial(id: string, accion: string, req: any) {
    await this.prisma
      .$executeRawUnsafe(
        `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id)
         SELECT tenant_id, ot_id, 'oficio', jsonb_build_object('numero', COALESCE(numero, '(borrador)'), 'accion', $2::text), $3::uuid
           FROM oficio WHERE id = $1::uuid AND ot_id IS NOT NULL`,
        id,
        accion,
        usuarioDe(req),
      )
      .catch(() => undefined);
  }

  /* -------------------------------------------------------------------- PDF --- */

  async pdf(id: string, req: any): Promise<{ buffer: Buffer; nombre: string }> {
    const d = await this.detalle(id, req);
    const referencias = [
      ...(d.cotizacion ? [`Cotización ${d.cotizacion.codigo}`] : []),
      ...(d.ot ? [`OT ${d.ot.codigo}`] : []),
      ...d.documentos.map((x: any) => `${x.plantilla ?? x.tipoDocumento ?? "Documento"} ${x.numero}`),
    ];
    const cuerpo = htmlOficio({
      numero: d.numero,
      unidad: { codigo: d.unidad.codigo, nombre: d.unidad.nombre },
      fecha: fechaChile(d.fecha),
      destinatario: d.destinatario,
      materia: d.materia,
      cuerpo: d.cuerpo,
      referencias,
      distribucion: d.distribucion,
      despacho: d.despacho ? { numero: d.despacho.numero, fecha: fechaChile(d.despacho.fecha) } : null,
    });
    const hash = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    const [o] = await this.prisma.$queryRawUnsafe<{ codigo_verificacion: string | null }[]>(`SELECT codigo_verificacion FROM oficio WHERE id = $1::uuid`, id);
    const estadoDocumento = d.estado === "firmado" || d.estado === "despachado" ? "oficial" : d.estado === "borrador" ? "en_firma" : d.estado;
    const buffer = await generarPdf(
      cuerpo,
      {
        numero: d.numero ?? "BORRADOR",
        codigoVerificacion: o?.codigo_verificacion ?? "—",
        hash,
        fecha: fechaChile(d.fecha),
        urlVerificacion: "",
        borrador: d.estado === "borrador",
        estadoDocumento,
        motivoEstado: d.devueltoMotivo ?? d.anuladoMotivo ?? null,
        firmas: d.pasos.map((p: any) => ({
          accion: p.accion,
          rol: p.rolNombre ?? p.rolCodigo,
          unidad: p.unidadCodigo,
          nombre: p.estado === "firmado" ? p.firmanteNombre : (Array.isArray(p.responsables) ? p.responsables.map((r: any) => r.nombre).join(" o ") : null),
          cargo: p.estado === "firmado" ? p.firmanteCargo : null,
          fecha: p.firmadoAt ? fechaHoraChile(p.firmadoAt) : null,
          pendiente: p.estado !== "firmado",
        })),
      },
      `Oficio ${d.numero ?? "borrador"}`,
    );
    return { buffer, nombre: `Oficio_${(d.numero ?? "borrador").replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf` };
  }
}
