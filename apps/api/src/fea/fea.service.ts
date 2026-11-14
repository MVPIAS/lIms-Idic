/**
 * Firma Electrónica Avanzada (FEA) en el PDF final: servicio común para los
 * documentos de `certificado` (origen «informe»: informes y certificados por
 * OT, BPCH, certificados por arma de la D11) y los certificados de calibración
 * de `met_calibracion` (origen «metrologia»). Ver docs/FLUJO_FEA_DOCUMENTOS.md.
 *
 *   · «Descargar PDF para firmar»: el PDF oficial se CONGELA (bytes exactos) la
 *     primera vez; mientras el documento no cambie (huella: sello + firmas), se
 *     entrega el mismo archivo. Es contra lo que se compara el prefijo.
 *   · «Subir versión firmada con FEA»: el firmante del documento (o una
 *     jefatura con documento.fea.gestionar). Debe traer firma digital y
 *     corresponder al emitido; si no corresponde, solo una jefatura lo acepta
 *     con motivo escrito (queda en el historial como excepción).
 *   · Desde ahí, la descarga, el envío y la verificación usan la versión FEA.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { PlantillaRenderService } from "../plantilla-render/plantilla-render.service";
import { pdfEmitido } from "../metrologia/ficha.datos";
import {
  analizarSubida,
  errorMotivoExcepcion,
  exigeFea,
  leyendaFea,
  nombreArchivoFea,
  sha256,
  type OrigenFea,
} from "./fea.reglas";
import { filasParametroFea, nombreTipoFea } from "./fea.datos";

const PERMISO_GESTIONAR = "documento.fea.gestionar";

interface DocFea {
  origen: OrigenFea;
  id: string;
  tenantId: string;
  numero: string;
  tipoDocumento: string | null;
  estado: string;
  oficial: boolean;
  otId: string | null;
  otCodigo: string | null;
  unidades: (string | null)[];
  firmantes: { usuarioId: string; nombre: string | null }[];
  huella: string;
  entregadoAt: Date | null;
}

const usuarioDe = (req: any): string => {
  const id = req?.user?.sub ?? req?.user?.id;
  if (!id) throw new ForbiddenException("Usuario no identificado");
  return id;
};
const tenantDe = (req: any): string => {
  const t = req?.user?.tenantId;
  if (!t) throw new ForbiddenException("Usuario sin institución asociada");
  return t;
};
const tiene = (req: any, permiso: string) => {
  const u = req?.user ?? {};
  return (u.roles ?? []).includes("SUPERADMIN") || (u.permisos ?? []).includes(permiso);
};

@Injectable()
export class FeaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly render: PlantillaRenderService,
  ) {}

  /* ------------------------------------------------------------ carga --- */

  private async cargar(origen: OrigenFea, id: string, tenantId: string): Promise<DocFea> {
    if (origen === "informe") {
      const f = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT c.id, c.tenant_id, COALESCE(c.numero, c.codigo) AS numero, c.tipo_documento, c.estado, c.hash_sha256, c.ot_id,
                c.unidad_id, c.emitido_por, c.entregado_at, o.codigo AS ot_codigo, o.unidad_principal, ue.nombre_completo AS emisor_nombre
           FROM certificado c LEFT JOIN orden_trabajo o ON o.id = c.ot_id LEFT JOIN usuario ue ON ue.id = c.emitido_por
          WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid AND c.deleted_at IS NULL`,
        id,
        tenantId,
      );
      if (!f.length) throw new NotFoundException("Documento no encontrado.");
      const c = f[0];
      const pasos = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, orden, obligatorio, estado, firmado_por, firmante_nombre, firmado_at
           FROM documento_firma WHERE certificado_id = $1::uuid ORDER BY orden, created_at`,
        id,
      );
      const firmados = pasos.filter((p) => p.estado === "firmado" && p.firmado_por);
      const oblig = firmados.filter((p) => p.obligatorio !== false);
      const maxOrden = Math.max(-1, ...oblig.map((p) => Number(p.orden)));
      const firmantes = oblig.filter((p) => Number(p.orden) === maxOrden).map((p) => ({ usuarioId: p.firmado_por, nombre: p.firmante_nombre }));
      if (!firmantes.length && c.emitido_por) firmantes.push({ usuarioId: c.emitido_por, nombre: c.emisor_nombre });
      const huella = sha256(
        Buffer.from(`${c.hash_sha256 ?? ""}|${c.estado}|${firmados.map((p) => `${p.id}:${new Date(p.firmado_at ?? 0).toISOString()}`).join(",")}`),
      );
      return {
        origen,
        id,
        tenantId,
        numero: c.numero,
        tipoDocumento: c.tipo_documento,
        estado: c.estado,
        oficial: c.estado === "oficial" || c.estado === "emitido",
        otId: c.ot_id,
        otCodigo: c.ot_codigo,
        unidades: [c.unidad_id, c.unidad_principal],
        firmantes,
        huella,
        entregadoAt: c.entregado_at,
      };
    }
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id, c.tenant_id, COALESCE(c.numero_certificado, c.codigo) AS numero, c.estado, c.certificado_hash, c.ot_id, c.unidad_id,
              c.emitido_by, c.entregado_at, o.codigo AS ot_codigo, o.unidad_principal, ue.nombre_completo AS emisor_nombre
         FROM met_calibracion c LEFT JOIN orden_trabajo o ON o.id = c.ot_id LEFT JOIN usuario ue ON ue.id = c.emitido_by
        WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid AND c.deleted_at IS NULL`,
      id,
      tenantId,
    );
    if (!f.length) throw new NotFoundException("Certificado de calibración no encontrado.");
    const c = f[0];
    const pasos = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT orden, usuario_id, nombre FROM met_calibracion_firma WHERE calibracion_id = $1::uuid AND usuario_id IS NOT NULL ORDER BY orden`,
      id,
    );
    const maxOrden = Math.max(-1, ...pasos.map((p) => Number(p.orden)));
    const firmantes = pasos.filter((p) => Number(p.orden) === maxOrden).map((p) => ({ usuarioId: p.usuario_id, nombre: p.nombre }));
    if (c.emitido_by && !firmantes.some((x) => x.usuarioId === c.emitido_by)) firmantes.push({ usuarioId: c.emitido_by, nombre: c.emisor_nombre });
    return {
      origen,
      id,
      tenantId,
      numero: c.numero,
      tipoDocumento: "CERTIFICADO_CALIBRACION",
      estado: c.estado,
      oficial: c.estado === "emitida",
      otId: c.ot_id,
      otCodigo: c.ot_codigo,
      unidades: [c.unidad_id, c.unidad_principal],
      firmantes,
      huella: sha256(Buffer.from(`${c.certificado_hash ?? ""}|${c.estado}`)),
      entregadoAt: c.entregado_at,
    };
  }

  /** Quién es: firmante del documento, jefatura con permiso, y si lo ve por su alcance. */
  private async acceso(doc: DocFea, req: any) {
    const yo = usuarioDe(req);
    const esFirmante = doc.firmantes.some((f) => f.usuarioId === yo);
    let ve = esFirmante;
    for (const u of doc.unidades) if (!ve && u && (await this.alcance.puedeVerUnidad(req, u))) ve = true;
    if (!ve && (req?.user?.roles ?? []).includes("SUPERADMIN")) ve = true;
    const gestiona = tiene(req, PERMISO_GESTIONAR) && ve;
    return { yo, esFirmante, ve, gestiona };
  }

  private async exigirVer(doc: DocFea, req: any) {
    const a = await this.acceso(doc, req);
    if (!a.ve) throw new ForbiddenException(`Fuera de su alcance: el documento ${doc.numero} pertenece a una unidad que usted no tiene asignada.`);
    return a;
  }

  private async evento(tenantId: string, doc: DocFea, accion: string, usuarioId: string | null, detalle: string | null, archivoId: string | null = null, db: any = this.prisma) {
    await db.$executeRawUnsafe(
      `INSERT INTO documento_fea_evento (tenant_id, origen, documento_id, accion, usuario_id, archivo_id, detalle)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5::uuid, $6::uuid, $7)`,
      tenantId,
      doc.origen,
      doc.id,
      accion,
      usuarioId,
      archivoId,
      detalle,
    );
  }

  /** PDF del sistema (sin la versión FEA). */
  private async pdfSistema(doc: DocFea): Promise<Buffer> {
    if (doc.origen === "informe") return (await this.render.pdf(doc.id, doc.tenantId, { sistema: true })).buffer;
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT numero_certificado, codigo_verificacion, documento_html, certificado_hash, emitido_at FROM met_calibracion WHERE id = $1::uuid`,
      doc.id,
    );
    if (!f[0]?.documento_html) throw new NotFoundException(`El certificado ${doc.numero} no tiene documento sellado.`);
    return (await pdfEmitido(f[0])).buffer;
  }

  /* ------------------------------------------------------- operaciones --- */

  /**
   * PDF emitido para firmar con FEA: el congelado de la huella actual o, si no
   * lo hay, se genera y se congela ahora. Siempre los mismos bytes.
   */
  async original(origen: OrigenFea, id: string, req: any) {
    const tenantId = tenantDe(req);
    const doc = await this.cargar(origen, id, tenantId);
    await this.exigirVer(doc, req);
    if (!doc.oficial)
      throw new ConflictException(
        `El documento ${doc.numero} todavía no es oficial (${doc.estado.replace("_", " ")}): la firma electrónica avanzada se aplica al PDF final, cuando terminen las firmas internas.`,
      );
    const r = await this.congelar(doc, usuarioDe(req));
    await this.evento(tenantId, doc, "DESCARGA_PARA_FIRMAR", usuarioDe(req), `PDF emitido descargado para firmar (SHA-256 ${r.hash.slice(0, 16)}…).`, r.id);
    return { buffer: r.datos, nombre: nombreArchivoFea(doc.numero, false) };
  }

  private async congelar(doc: DocFea, usuarioId: string | null): Promise<{ id: string; datos: Buffer; hash: string }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))::text`, `fea:${doc.origen}:${doc.id}`);
      const ya = await tx.$queryRawUnsafe<any[]>(
        `SELECT id, datos, hash_sha256 FROM documento_fea_archivo
          WHERE origen = $1 AND documento_id = $2::uuid AND clase = 'original' AND huella = $3
          ORDER BY created_at DESC LIMIT 1`,
        doc.origen,
        doc.id,
        doc.huella,
      );
      if (ya.length) return { id: ya[0].id, datos: Buffer.from(ya[0].datos), hash: ya[0].hash_sha256 };
      const datos = await this.pdfSistema(doc);
      const hash = sha256(datos);
      await tx.$executeRawUnsafe(
        `UPDATE documento_fea_archivo SET vigente = false WHERE origen = $1 AND documento_id = $2::uuid AND clase = 'original' AND vigente`,
        doc.origen,
        doc.id,
      );
      const ins = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO documento_fea_archivo (tenant_id, origen, documento_id, clase, vigente, nombre, bytes, datos, hash_sha256, huella, subido_por)
         VALUES ($1::uuid, $2, $3::uuid, 'original', true, $4, $5, $6, $7, $8, $9::uuid) RETURNING id`,
        doc.tenantId,
        doc.origen,
        doc.id,
        nombreArchivoFea(doc.numero, false),
        datos.length,
        datos,
        hash,
        doc.huella,
        usuarioId,
      );
      return { id: ins[0].id, datos, hash };
    });
  }

  /** Sube la versión firmada (ver cabecera). */
  async subir(origen: OrigenFea, id: string, archivo: { buffer: Buffer; originalname?: string } | undefined, motivoExcepcion: string | null, req: any) {
    const tenantId = tenantDe(req);
    const doc = await this.cargar(origen, id, tenantId);
    const a = await this.exigirVer(doc, req);
    if (!a.esFirmante && !a.gestiona)
      throw new ForbiddenException(
        `Solo sube la versión firmada con FEA quien firmó ${doc.numero} (${doc.firmantes.map((f) => f.nombre).filter(Boolean).join(", ") || "el firmante"}) o una jefatura con permiso para gestionar la FEA.`,
      );
    if (!doc.oficial)
      throw new ConflictException(`El documento ${doc.numero} no es oficial (${doc.estado.replace("_", " ")}): no admite versión firmada con FEA.`);
    if (!archivo?.buffer?.length) throw new BadRequestException("Seleccione el PDF firmado con FirmaGob (campo «archivo»).");

    const originales = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, datos FROM documento_fea_archivo WHERE origen = $1 AND documento_id = $2::uuid AND clase = 'original' ORDER BY created_at DESC`,
      origen,
      id,
    );
    const an = analizarSubida(archivo.buffer, originales.map((o) => Buffer.from(o.datos)));
    if (an.errores.length) {
      await this.evento(tenantId, doc, "RECHAZADO", a.yo, an.errores.join(" "));
      throw new BadRequestException(an.errores.join(" "));
    }
    const motivo = (motivoExcepcion ?? "").trim() || null;
    if (!an.corresponde) {
      if (!motivo) {
        await this.evento(tenantId, doc, "RECHAZADO", a.yo, an.noCorresponde);
        throw new ConflictException({
          statusCode: 409,
          error: "Conflict",
          requiereExcepcion: true,
          puedeAceptar: a.gestiona,
          message: `${an.noCorresponde}${a.gestiona ? " Si aun así corresponde aceptarlo, escriba el motivo de la excepción." : " Solo una jefatura con permiso puede aceptarlo con un motivo escrito."}`,
        });
      }
      if (!a.gestiona) throw new ForbiddenException("Solo una jefatura con permiso para gestionar la FEA puede aceptar un PDF que no corresponde al emitido.");
      const e = errorMotivoExcepcion(motivo);
      if (e) throw new BadRequestException(e);
    }
    const f = an.firma!;
    const datos = archivo.buffer;
    const hash = createHash("sha256").update(datos).digest("hex");
    const original = an.originalIndice >= 0 ? originales[an.originalIndice].id : null;
    const integridad = f.integra === true ? "comprobada" : f.integra === false ? "no_cuadra" : "sin_comprobar";
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))::text`, `fea:${doc.origen}:${doc.id}`);
      await tx.$executeRawUnsafe(
        `UPDATE documento_fea_archivo SET vigente = false WHERE origen = $1 AND documento_id = $2::uuid AND clase = 'firmado' AND vigente`,
        origen,
        id,
      );
      const ins = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO documento_fea_archivo (tenant_id, origen, documento_id, clase, vigente, nombre, bytes, datos, hash_sha256, original_id,
                                            corresponde, excepcion_motivo, excepcion_por, firmante_nombre, firma_fecha, firma_fecha_texto,
                                            firmas, integridad, subido_por)
         VALUES ($1::uuid, $2, $3::uuid, 'firmado', true, $4, $5, $6, $7, $8::uuid, $9, $10, $11::uuid, $12, $13::timestamptz, $14, $15, $16, $17::uuid)
         RETURNING id`,
        tenantId,
        origen,
        id,
        nombreArchivoFea(doc.numero, true),
        datos.length,
        datos,
        hash,
        original,
        an.corresponde,
        an.corresponde ? null : motivo,
        an.corresponde ? null : a.yo,
        f.nombre?.slice(0, 300) ?? null,
        f.fecha,
        f.fechaTexto?.slice(0, 60) ?? null,
        an.firmas.length,
        integridad,
        a.yo,
      );
      const detalle = an.corresponde
        ? `Versión firmada con FEA subida: corresponde al documento emitido. Firmante: ${f.nombre ?? "sin nombre en la firma"}${f.fecha ? `, firmado el ${f.fecha}` : ""}. SHA-256 ${hash}.`
        : `EXCEPCIÓN aceptada por una jefatura: el PDF no corresponde al emitido (${an.noCorresponde}). Motivo: ${motivo}. Firmante: ${f.nombre ?? "sin nombre en la firma"}. SHA-256 ${hash}.`;
      await this.evento(tenantId, doc, an.corresponde ? "SUBIDO" : "EXCEPCION", a.yo, detalle, ins[0].id, tx);
    });
    return this.estado(origen, id, req);
  }

  /** Estado FEA del documento para su ficha. */
  async estado(origen: OrigenFea, id: string, req: any) {
    const tenantId = tenantDe(req);
    const doc = await this.cargar(origen, id, tenantId);
    const a = await this.exigirVer(doc, req);
    const archivos = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT x.id, x.clase, x.vigente, x.nombre, x.bytes, x.hash_sha256, x.huella, x.corresponde, x.excepcion_motivo, x.firmante_nombre,
              x.firma_fecha, x.firma_fecha_texto, x.firmas, x.integridad, x.created_at, us.nombre_completo AS subido_por, ue.nombre_completo AS excepcion_por
         FROM documento_fea_archivo x LEFT JOIN usuario us ON us.id = x.subido_por LEFT JOIN usuario ue ON ue.id = x.excepcion_por
        WHERE x.origen = $1 AND x.documento_id = $2::uuid ORDER BY x.created_at DESC`,
      origen,
      id,
    );
    const historial = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.accion, e.detalle, e.created_at AS "createdAt", u.nombre_completo AS usuario
         FROM documento_fea_evento e LEFT JOIN usuario u ON u.id = e.usuario_id
        WHERE e.origen = $1 AND e.documento_id = $2::uuid ORDER BY e.created_at DESC LIMIT 50`,
      origen,
      id,
    );
    const exige = exigeFea(await filasParametroFea(this.prisma, tenantId), doc.tipoDocumento);
    const fv = archivos.find((x) => x.clase === "firmado" && x.vigente);
    const ov = archivos.find((x) => x.clase === "original" && x.huella === doc.huella);
    const firmadoVista = (x: any) => ({
      id: x.id,
      nombre: x.nombre,
      bytes: x.bytes,
      hash: x.hash_sha256,
      vigente: x.vigente,
      firmanteNombre: x.firmante_nombre,
      firmaFecha: x.firma_fecha,
      firmaFechaTexto: x.firma_fecha_texto,
      firmas: x.firmas,
      integridad: x.integridad,
      corresponde: x.corresponde,
      excepcionMotivo: x.excepcion_motivo,
      excepcionPor: x.excepcion_por,
      subidoPor: x.subido_por,
      subidoAt: x.created_at,
      leyenda: leyendaFea(x.firmante_nombre, x.firma_fecha ?? x.created_at),
    });
    return {
      origen,
      documentoId: id,
      numero: doc.numero,
      tipoDocumento: doc.tipoDocumento,
      tipoDocumentoNombre: nombreTipoFea(doc.tipoDocumento),
      estado: doc.estado,
      oficial: doc.oficial,
      exigeFea: exige,
      entregado: !!doc.entregadoAt,
      firmantes: doc.firmantes.map((f) => f.nombre).filter(Boolean),
      original: ov ? { id: ov.id, hash: ov.hash_sha256, bytes: ov.bytes, congeladoAt: ov.created_at } : null,
      firmado: fv ? firmadoVista(fv) : null,
      anteriores: archivos.filter((x) => x.clase === "firmado" && !x.vigente).map(firmadoVista),
      historial,
      puedo: {
        descargar: doc.oficial,
        subir: doc.oficial && (a.esFirmante || a.gestiona),
        aceptarExcepcion: doc.oficial && a.gestiona,
      },
      soyFirmante: a.esFirmante,
    };
  }

  /** PDF firmado vigente (para descargarlo desde la ficha). */
  async firmado(origen: OrigenFea, id: string, req: any) {
    const tenantId = tenantDe(req);
    const doc = await this.cargar(origen, id, tenantId);
    await this.exigirVer(doc, req);
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT datos FROM documento_fea_archivo WHERE origen = $1 AND documento_id = $2::uuid AND clase = 'firmado' AND vigente LIMIT 1`,
      origen,
      id,
    );
    if (!f.length) throw new NotFoundException(`El documento ${doc.numero} todavía no tiene versión firmada con FEA.`);
    return { buffer: Buffer.from(f[0].datos), nombre: nombreArchivoFea(doc.numero, true) };
  }

  /**
   * Documentos emitidos pendientes de firma FEA: los oficiales sin versión
   * firmada en que el usuario es el firmante. Con `todos` (jefatura con
   * permiso), los de su alcance. `soloExigidos`: solo los tipos que el
   * parámetro obliga a firmar con FEA.
   */
  async pendientes(req: any, o: { todos?: boolean; soloExigidos?: boolean }) {
    const tenantId = tenantDe(req);
    const yo = usuarioDe(req);
    const todos = !!o.todos && tiene(req, PERMISO_GESTIONAR);
    const unidades = todos ? await this.alcance.filtroUnidades(req) : null;
    const args: unknown[] = [tenantId, yo, todos, unidades];
    const informes = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT 'informe' AS origen, c.id, COALESCE(c.numero, c.codigo) AS numero, c.tipo_documento AS "tipoDocumento",
              COALESCE(c.oficial_at, c.fecha) AS "oficialAt", c.entregado_at AS "entregadoAt", o.id AS "otId", o.codigo AS "otCodigo",
              cl.razon_social AS cliente, un.codigo AS laboratorio,
              (SELECT string_agg(DISTINCT f.firmante_nombre, ', ') FROM documento_firma f
                WHERE f.certificado_id = c.id AND f.estado = 'firmado' AND f.obligatorio
                  AND f.orden = (SELECT max(g.orden) FROM documento_firma g WHERE g.certificado_id = c.id AND g.estado = 'firmado' AND g.obligatorio)) AS firmante
         FROM certificado c
         LEFT JOIN orden_trabajo o ON o.id = c.ot_id
         LEFT JOIN cliente cl ON cl.id = o.cliente_id
         LEFT JOIN unidad un ON un.id = COALESCE(c.unidad_id, o.unidad_principal)
        WHERE c.tenant_id = $1::uuid AND c.deleted_at IS NULL AND c.estado = 'oficial'
          AND NOT EXISTS (SELECT 1 FROM documento_fea_archivo x WHERE x.origen = 'informe' AND x.documento_id = c.id AND x.clase = 'firmado' AND x.vigente)
          AND (
            ($3::boolean AND ($4::uuid[] IS NULL OR COALESCE(c.unidad_id, o.unidad_principal) = ANY($4::uuid[])))
            OR EXISTS (SELECT 1 FROM documento_firma f WHERE f.certificado_id = c.id AND f.estado = 'firmado' AND f.obligatorio AND f.firmado_por = $2::uuid
                        AND f.orden = (SELECT max(g.orden) FROM documento_firma g WHERE g.certificado_id = c.id AND g.estado = 'firmado' AND g.obligatorio))
          )
        ORDER BY COALESCE(c.oficial_at, c.fecha) DESC
        LIMIT 300`,
      ...args,
    );
    const calibraciones = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT 'metrologia' AS origen, c.id, COALESCE(c.numero_certificado, c.codigo) AS numero, 'CERTIFICADO_CALIBRACION' AS "tipoDocumento",
              c.emitido_at AS "oficialAt", c.entregado_at AS "entregadoAt", o.id AS "otId", o.codigo AS "otCodigo",
              cl.razon_social AS cliente, un.codigo AS laboratorio, ue.nombre_completo AS firmante
         FROM met_calibracion c
         LEFT JOIN orden_trabajo o ON o.id = c.ot_id
         LEFT JOIN cliente cl ON cl.id = o.cliente_id
         LEFT JOIN unidad un ON un.id = COALESCE(c.unidad_id, o.unidad_principal)
         LEFT JOIN usuario ue ON ue.id = c.emitido_by
        WHERE c.tenant_id = $1::uuid AND c.deleted_at IS NULL AND c.estado = 'emitida'
          AND NOT EXISTS (SELECT 1 FROM documento_fea_archivo x WHERE x.origen = 'metrologia' AND x.documento_id = c.id AND x.clase = 'firmado' AND x.vigente)
          AND (
            ($3::boolean AND ($4::uuid[] IS NULL OR COALESCE(c.unidad_id, o.unidad_principal) = ANY($4::uuid[])))
            OR c.emitido_by = $2::uuid
            OR EXISTS (SELECT 1 FROM met_calibracion_firma f WHERE f.calibracion_id = c.id AND f.usuario_id = $2::uuid
                        AND f.orden = (SELECT max(g.orden) FROM met_calibracion_firma g WHERE g.calibracion_id = c.id))
          )
        ORDER BY c.emitido_at DESC NULLS LAST
        LIMIT 300`,
      ...args,
    );
    const filas = await filasParametroFea(this.prisma, tenantId);
    const data = [...informes, ...calibraciones]
      .map((d) => ({ ...d, tipoDocumentoNombre: nombreTipoFea(d.tipoDocumento), exigeFea: exigeFea(filas, d.tipoDocumento) }))
      .filter((d) => !o.soloExigidos || d.exigeFea)
      .sort((x, y) => new Date(y.oficialAt ?? 0).getTime() - new Date(x.oficialAt ?? 0).getTime());
    return { data, total: data.length, todos, puedeVerTodos: tiene(req, PERMISO_GESTIONAR) };
  }
}
