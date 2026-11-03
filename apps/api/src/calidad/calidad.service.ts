/**
 * Calidad del laboratorio (bloque A del contrato):
 *   · re-análisis de resultados (§4.2.6 / §4.3.9): bandeja, solicitud manual y descarte;
 *   · POE (procedimiento operativo estándar) de cada método y su margen de advertencia (§4.3.1);
 *   · acreditaciones ISO/IEC 17025 y su alcance por método (§4.3.5);
 *   · alícuotas de una muestra (§4.2.1).
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { AlcanceResultadoService } from "../rbac/alcance-resultado.service";
import { libroXlsx } from "../common/xlsx-escritura";
import { TablaError, leerTabla, leerXlsx } from "../common/tabla-archivo";
import { validarFormula } from "../common/formula";
import { hoyCl } from "../ot/plazos";
import { emitirEvento } from "../common/eventos";
import { filasDePlanilla } from "./formula-excel";
import { leerConfigResultados } from "./reanalisis";
import { codigoAlicuota, erroresAcreditacion, erroresMovimientoAlicuota, planMovimientoAlicuota, type MovimientoAlicuota } from "./reglas-calidad";

const tenantDe = (req: any): string => req?.user?.tenantId;
const usuarioDe = (req: any): string | null => req?.user?.sub ?? null;
const texto = (v: unknown, max: number) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t.slice(0, max) : null;
};
const motivoValido = (v: unknown) => {
  const m = texto(v, 500);
  if (!m || m.length < 5) throw new BadRequestException("Indique el motivo (mínimo 5 caracteres).");
  return m;
};

@Injectable()
export class CalidadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly alcanceResultado: AlcanceResultadoService,
  ) {}

  /* ------------------------------------------------------------ re-análisis --- */

  /** Bandeja de re-análisis (abiertos por defecto) de los laboratorios del usuario. */
  async reanalisis(req: any, estado?: string) {
    const unidades = await this.alcance.filtroUnidades(req, "resultado.ver");
    const est = ["solicitado", "realizado", "descartado"].includes(String(estado)) ? estado : estado === "todos" ? null : "solicitado";
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ra.id, ra.resultado_id AS "resultadoId", ra.ot_id AS "otId", o.codigo AS "otCodigo", m.codigo AS muestra,
              COALESCE(can.nombre, a.nombre, ce.nombre, cm.nombre, 'ensayo') AS ensayo, ra.origen, ra.motivo, ra.estado,
              ra.valor_anterior AS "valorAnterior", ra.valor_nuevo AS "valorNuevo", ra.cierre_motivo AS "cierreMotivo",
              ra.solicitado_at AS "solicitadoAt", ra.cerrado_at AS "cerradoAt", us.nombre_completo AS "solicitadoPor", uc.nombre_completo AS "cerradoPor",
              ul.codigo AS laboratorio
         FROM resultado_reanalisis ra
         JOIN resultado r ON r.id = ra.resultado_id
         JOIN muestra m ON m.id = r.muestra_id
         LEFT JOIN orden_trabajo o ON o.id = ra.ot_id
         LEFT JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
         LEFT JOIN cat_ensayo ce ON ce.id = cm.ensayo_id
         LEFT JOIN analito a ON a.id = r.analito_id
         -- El ensayo con el mismo nombre que en la captura (el analito del catálogo, p. ej. «Proteína cruda»).
         LEFT JOIN cat_analito can ON can.id = r.cat_analito_id
         LEFT JOIN usuario us ON us.id = ra.solicitado_por
         LEFT JOIN usuario uc ON uc.id = ra.cerrado_por
         LEFT JOIN LATERAL lims_lab_de_resultado(r.id) lr ON TRUE
         LEFT JOIN unidad ul ON ul.id = lr.unidad_id
        WHERE ra.tenant_id = $1::uuid AND ($2::text IS NULL OR ra.estado = $2)
          AND ($3::uuid[] IS NULL OR lr.unidad_id = ANY($3::uuid[]))
        ORDER BY ra.estado = 'solicitado' DESC, ra.solicitado_at DESC
        LIMIT 300`,
      tenantDe(req),
      est,
      unidades,
    );
  }

  /** El revisor pide repetir la determinación (re-análisis manual). */
  async solicitarReanalisis(req: any, resultadoId: string, body: any) {
    const motivo = motivoValido(body?.motivo);
    await this.alcanceResultado.exigir(req, resultadoId, "revisar", "resultado.revisar", "el resultado");
    const [r] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id, r.estado, r.ot_id, r.valor_numerico, r.valor_texto, r.veredicto, r.advertencia, m.tenant_id
         FROM resultado r JOIN muestra m ON m.id = r.muestra_id WHERE r.id = $1::uuid AND r.deleted_at IS NULL`,
      resultadoId,
    );
    if (!r || r.tenant_id !== tenantDe(req)) throw new NotFoundException("Resultado no encontrado.");
    if (!["capturado", "revisado_n1"].includes(r.estado))
      throw new ConflictException("Solo se pide re-análisis de un ensayo capturado o revisado (aún no aprobado). Un resultado aprobado se reabre.");
    const n = await this.prisma.$executeRawUnsafe(
      `INSERT INTO resultado_reanalisis (tenant_id, resultado_id, ot_id, origen, motivo, valor_anterior, solicitado_por)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'manual', $4, $5::jsonb, $6::uuid)
       ON CONFLICT (resultado_id) WHERE estado = 'solicitado' DO NOTHING`,
      tenantDe(req),
      resultadoId,
      r.ot_id,
      motivo,
      JSON.stringify({ numerico: r.valor_numerico, texto: r.valor_texto, veredicto: r.veredicto, advertencia: r.advertencia }),
      usuarioDe(req),
    );
    if (!n) throw new ConflictException("Este ensayo ya tiene un re-análisis pendiente.");
    // Lo revisado vuelve a capturado: se repite y se revisa de nuevo.
    await this.prisma.$executeRawUnsafe(`UPDATE resultado SET estado = 'capturado', revisado_n1_por = NULL, revisado_n1_at = NULL WHERE id = $1::uuid AND estado = 'revisado_n1'`, resultadoId);
    await this.auditar(req, "reanalisis_solicitado", "resultado", resultadoId, { estadoAnterior: r.estado, motivo });
    // Mismo aviso que el re-análisis automático (analista y jefatura del laboratorio).
    const cfg = await leerConfigResultados(this.prisma as any, tenantDe(req));
    emitirEvento("resultado.alerta", {
      resultadoId,
      tenantId: tenantDe(req),
      usuarioId: usuarioDe(req),
      tipo: "reanalisis",
      origen: "manual",
      motivo,
      correo: cfg.avisarAdvertencia,
    });
    return { ok: true };
  }

  /**
   * Descarta el re-análisis pendiente de un ensayo (desde la captura por OT, que
   * conoce el resultado y no siempre el id del re-análisis recién abierto).
   */
  async descartarReanalisisDeResultado(req: any, resultadoId: string, body: any) {
    const [ra] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM resultado_reanalisis WHERE resultado_id = $1::uuid AND tenant_id = $2::uuid AND estado = 'solicitado'`,
      resultadoId,
      tenantDe(req),
    );
    if (!ra) throw new NotFoundException("Este ensayo no tiene un re-análisis pendiente.");
    return this.descartarReanalisis(req, ra.id, body);
  }

  /** La jefatura descarta el re-análisis (no se repite) con motivo. */
  async descartarReanalisis(req: any, id: string, body: any) {
    const motivo = motivoValido(body?.motivo);
    const [ra] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, resultado_id, estado, origen, motivo AS "motivoSolicitud" FROM resultado_reanalisis WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      id,
      tenantDe(req),
    );
    if (!ra) throw new NotFoundException("Re-análisis no encontrado.");
    if (ra.estado !== "solicitado") throw new ConflictException("El re-análisis ya está cerrado.");
    await this.alcanceResultado.exigir(req, ra.resultado_id, "aprobar", "resultado.aprobar", "el resultado");
    await this.prisma.$executeRawUnsafe(
      `UPDATE resultado_reanalisis SET estado = 'descartado', cerrado_por = $2::uuid, cerrado_at = now(), cierre_motivo = $3 WHERE id = $1::uuid`,
      id,
      usuarioDe(req),
      motivo,
    );
    await this.auditar(req, "reanalisis_descartado", "resultado", ra.resultado_id, {
      reanalisisId: id,
      origen: ra.origen,
      motivoSolicitud: ra.motivoSolicitud,
      motivo,
    });
    return { ok: true };
  }

  /* ------------------------------------------------------- métodos y POE --- */

  async buscarMetodos(req: any, q?: string) {
    const t = texto(q, 80);
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT cm.id, cm.codigo, cm.nombre, cm.norma, ce.nombre AS ensayo, cm.margen_advertencia_pct::float AS "margenAdvertenciaPct",
              (SELECT count(*)::int FROM cat_metodo_poe p WHERE p.cat_metodo_id = cm.id) AS poes
         FROM cat_metodo cm LEFT JOIN cat_ensayo ce ON ce.id = cm.ensayo_id
        WHERE cm.tenant_id = $1::uuid AND cm.deleted_at IS NULL AND cm.activo IS NOT FALSE
          AND ($2::text IS NULL OR cm.codigo ILIKE '%' || $2 || '%' OR cm.nombre ILIKE '%' || $2 || '%' OR ce.nombre ILIKE '%' || $2 || '%' OR cm.norma ILIKE '%' || $2 || '%')
        ORDER BY cm.codigo LIMIT 50`,
      tenantDe(req),
      t,
    );
  }

  private async metodo(req: any, id: string) {
    const [m] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, nombre, margen_advertencia_pct::float AS "margenAdvertenciaPct" FROM cat_metodo WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id,
      tenantDe(req),
    );
    if (!m) throw new NotFoundException("Método no encontrado.");
    return m;
  }

  /** Escritura sobre un método: solo de un laboratorio del alcance del usuario (o común). */
  private async metodoEditable(req: any, metodoId: string) {
    const m = await this.metodo(req, metodoId);
    const unidades = await this.alcance.filtroUnidades(req, "catalogo.gestionar");
    if (!unidades) return m;
    const [r] = await this.prisma.$queryRawUnsafe<{ unidades: string[] }[]>(
      `SELECT COALESCE(array_agg(u.id::text), '{}') AS unidades
         FROM cat_metodo cm JOIN cat_ensayo e ON e.id = cm.ensayo_id JOIN cat_familia f ON f.id = e.familia_id
         JOIN unidad u ON u.tenant_id = f.tenant_id
                      AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))
        WHERE cm.id = $1::uuid`,
      metodoId,
    );
    const del = r?.unidades ?? [];
    if (del.length && !del.some((u) => unidades.includes(u)))
      throw new ForbiddenException(`El método ${m.codigo} es de un laboratorio que usted no tiene asignado.`);
    return m;
  }

  async poeDeMetodo(req: any, metodoId: string) {
    const m = await this.metodo(req, metodoId);
    const poe = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT d.id AS "documentoId", d.codigo, d.titulo, d.version_publicada AS version, p.principal, p.nota, p.creado_en AS "creadoEn",
              (SELECT v.nombre_archivo FROM doc_version v WHERE v.documento_id = d.id AND v.numero = d.version_publicada) AS archivo
         FROM cat_metodo_poe p JOIN doc_documento d ON d.id = p.documento_id AND d.deleted_at IS NULL
        WHERE p.cat_metodo_id = $1::uuid ORDER BY p.principal DESC, d.codigo`,
      metodoId,
    );
    const acreditaciones = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.id, a.organismo, a.numero, a.vigente_desde::text AS "vigenteDesde", a.vigente_hasta::text AS "vigenteHasta", aa.matriz, aa.rango
         FROM acreditacion_alcance aa JOIN acreditacion a ON a.id = aa.acreditacion_id AND a.deleted_at IS NULL
        WHERE aa.cat_metodo_id = $1::uuid ORDER BY a.vigente_hasta DESC NULLS FIRST`,
      metodoId,
    );
    return { metodo: m, poe, acreditaciones };
  }

  /** Documentos del gestor documental para elegir el POE (título o código). */
  async buscarDocumentos(req: any, q?: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT d.id, d.codigo, d.titulo, d.version_publicada AS version, c.nombre AS carpeta
         FROM doc_documento d JOIN doc_carpeta c ON c.id = d.carpeta_id
        WHERE d.tenant_id = $1::uuid AND d.deleted_at IS NULL
          AND ($2::text IS NULL OR d.codigo ILIKE '%' || $2 || '%' OR d.titulo ILIKE '%' || $2 || '%')
        ORDER BY d.codigo LIMIT 30`,
      tenantDe(req),
      texto(q, 80),
    );
  }

  async vincularPoe(req: any, metodoId: string, body: any) {
    const m = await this.metodoEditable(req, metodoId);
    const documentoId = texto(body?.documentoId, 40);
    if (!documentoId) throw new BadRequestException("Elija el documento del POE.");
    const [d] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo FROM doc_documento WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      documentoId,
      tenantDe(req),
    );
    if (!d) throw new NotFoundException("Documento no encontrado en el gestor documental.");
    const principal = body?.principal !== false;
    const nota = texto(body?.nota, 200);
    if (principal) await this.prisma.$executeRawUnsafe(`UPDATE cat_metodo_poe SET principal = FALSE WHERE cat_metodo_id = $1::uuid`, metodoId);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO cat_metodo_poe (tenant_id, cat_metodo_id, documento_id, principal, nota, creado_por)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)
       ON CONFLICT (cat_metodo_id, documento_id) DO UPDATE SET principal = EXCLUDED.principal, nota = EXCLUDED.nota`,
      tenantDe(req),
      metodoId,
      documentoId,
      principal,
      nota,
      usuarioDe(req),
    );
    await this.auditar(req, "poe_vinculado", "cat_metodo", metodoId, { metodo: m.codigo, documentoId, documento: d.codigo, principal, nota });
    return this.poeDeMetodo(req, metodoId);
  }

  async desvincularPoe(req: any, metodoId: string, documentoId: string) {
    const m = await this.metodoEditable(req, metodoId);
    const [d] = await this.prisma.$queryRawUnsafe<{ codigo: string }[]>(
      `SELECT d.codigo FROM cat_metodo_poe p JOIN doc_documento d ON d.id = p.documento_id WHERE p.cat_metodo_id = $1::uuid AND p.documento_id = $2::uuid`,
      metodoId,
      documentoId,
    );
    const n = await this.prisma.$executeRawUnsafe(`DELETE FROM cat_metodo_poe WHERE cat_metodo_id = $1::uuid AND documento_id = $2::uuid`, metodoId, documentoId);
    if (n) await this.auditar(req, "poe_desvinculado", "cat_metodo", metodoId, { metodo: m.codigo, documentoId, documento: d?.codigo ?? null });
    return this.poeDeMetodo(req, metodoId);
  }

  /** Margen de advertencia propio del método (vacío = el general; 0 = sin advertencias). */
  async margenMetodo(req: any, metodoId: string, body: any) {
    const m = await this.metodoEditable(req, metodoId);
    const v = body?.margenPct;
    const n = v === null || v === "" || v === undefined ? null : Number(String(v).replace(",", "."));
    if (n != null && !(Number.isFinite(n) && n >= 0 && n <= 50)) throw new BadRequestException("El margen de advertencia va de 0 a 50 %.");
    await this.prisma.$executeRawUnsafe(`UPDATE cat_metodo SET margen_advertencia_pct = $2 WHERE id = $1::uuid`, metodoId, n);
    if ((m.margenAdvertenciaPct ?? null) !== n)
      await this.auditar(req, "margen_advertencia", "cat_metodo", metodoId, { metodo: m.codigo, anterior: m.margenAdvertenciaPct ?? null, nuevo: n });
    return this.metodo(req, metodoId);
  }

  /* -------------------------------------------------------- acreditaciones --- */

  async acreditaciones(req: any) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.id, a.organismo, a.numero, a.norma, a.unidad_id AS "unidadId", u.codigo AS unidad, u.nombre AS "unidadNombre",
              a.vigente_desde::text AS "vigenteDesde", a.vigente_hasta::text AS "vigenteHasta", a.observacion,
              COALESCE(json_agg(json_build_object('metodoId', cm.id, 'codigo', cm.codigo, 'nombre', cm.nombre, 'ensayo', ce.nombre,
                       'matriz', aa.matriz, 'rango', aa.rango) ORDER BY cm.codigo) FILTER (WHERE cm.id IS NOT NULL), '[]') AS alcance
         FROM acreditacion a
         LEFT JOIN unidad u ON u.id = a.unidad_id
         LEFT JOIN acreditacion_alcance aa ON aa.acreditacion_id = a.id
         LEFT JOIN cat_metodo cm ON cm.id = aa.cat_metodo_id
         LEFT JOIN cat_ensayo ce ON ce.id = cm.ensayo_id
        WHERE a.tenant_id = $1::uuid AND a.deleted_at IS NULL
        GROUP BY a.id, u.codigo, u.nombre
        ORDER BY a.vigente_hasta DESC NULLS FIRST, a.numero`,
      tenantDe(req),
    );
    return filas;
  }

  private datosAcreditacion(body: any) {
    const d = {
      organismo: texto(body?.organismo, 80) ?? "INN",
      numero: texto(body?.numero, 40),
      norma: texto(body?.norma, 80) ?? "NCh-ISO/IEC 17025",
      unidadId: texto(body?.unidadId, 40),
      vigenteDesde: texto(body?.vigenteDesde, 10),
      vigenteHasta: texto(body?.vigenteHasta, 10),
      observacion: texto(body?.observacion, 1000),
    };
    const e = erroresAcreditacion(d);
    if (e.length) throw new BadRequestException(e.join(" "));
    return d;
  }

  async crearAcreditacion(req: any, body: any) {
    const d = this.datosAcreditacion(body);
    const [ya] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT 1 FROM acreditacion WHERE tenant_id = $1::uuid AND organismo = $2 AND numero = $3 AND deleted_at IS NULL`,
      tenantDe(req),
      d.organismo,
      d.numero,
    );
    if (ya) throw new ConflictException(`Ya existe la acreditación ${d.organismo} ${d.numero}.`);
    try {
      const [a] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO acreditacion (tenant_id, unidad_id, organismo, numero, norma, vigente_desde, vigente_hasta, observacion, creado_por)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::date, $7::date, $8, $9::uuid) RETURNING id`,
        tenantDe(req), d.unidadId, d.organismo, d.numero, d.norma, d.vigenteDesde, d.vigenteHasta, d.observacion, usuarioDe(req),
      );
      await this.auditar(req, "acreditacion_creada", "acreditacion", a.id, { nuevo: d });
      return { id: a.id };
    } catch (e: any) {
      if (/ux_acreditacion_numero|23505/.test(`${e?.message ?? ""} ${JSON.stringify(e?.meta ?? {})}`)) throw new ConflictException(`Ya existe la acreditación ${d.organismo} ${d.numero}.`);
      throw e;
    }
  }

  /** Datos actuales de una acreditación (para la auditoría: antes y después). */
  private async acreditacionActual(req: any, id: string) {
    const [a] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT organismo, numero, norma, unidad_id AS "unidadId", vigente_desde::text AS "vigenteDesde", vigente_hasta::text AS "vigenteHasta", observacion
         FROM acreditacion WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id,
      tenantDe(req),
    );
    return a ?? null;
  }

  async editarAcreditacion(req: any, id: string, body: any) {
    const d = this.datosAcreditacion(body);
    const anterior = await this.acreditacionActual(req, id);
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE acreditacion SET unidad_id = $3::uuid, organismo = $4, numero = $5, norma = $6, vigente_desde = $7::date, vigente_hasta = $8::date,
              observacion = $9, actualizado_en = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id, tenantDe(req), d.unidadId, d.organismo, d.numero, d.norma, d.vigenteDesde, d.vigenteHasta, d.observacion,
    );
    if (!n) throw new NotFoundException("Acreditación no encontrada.");
    await this.auditar(req, "acreditacion_modificada", "acreditacion", id, { anterior, nuevo: d });
    return { id };
  }

  async borrarAcreditacion(req: any, id: string) {
    const anterior = await this.acreditacionActual(req, id);
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE acreditacion SET deleted_at = now() WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id,
      tenantDe(req),
    );
    if (!n) throw new NotFoundException("Acreditación no encontrada.");
    await this.auditar(req, "acreditacion_baja", "acreditacion", id, { anterior });
    return { ok: true };
  }

  async agregarAlcance(req: any, id: string, body: any) {
    const ids: string[] = Array.isArray(body?.metodoIds) ? body.metodoIds.filter((x: unknown) => typeof x === "string") : [];
    if (!ids.length) throw new BadRequestException("Elija al menos un método.");
    const [a] = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id FROM acreditacion WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`, id, tenantDe(req));
    if (!a) throw new NotFoundException("Acreditación no encontrada.");
    const n = await this.prisma.$executeRawUnsafe(
      `INSERT INTO acreditacion_alcance (acreditacion_id, cat_metodo_id, matriz, rango)
       SELECT $1::uuid, cm.id, $3, $4 FROM cat_metodo cm WHERE cm.id = ANY($2::uuid[]) AND cm.tenant_id = $5::uuid
       ON CONFLICT (acreditacion_id, cat_metodo_id) DO UPDATE SET matriz = EXCLUDED.matriz, rango = EXCLUDED.rango`,
      id,
      ids,
      texto(body?.matriz, 160),
      texto(body?.rango, 120),
      tenantDe(req),
    );
    await this.auditar(req, "acreditacion_alcance_agregado", "acreditacion", id, {
      metodoIds: ids,
      matriz: texto(body?.matriz, 160),
      rango: texto(body?.rango, 120),
      agregados: n,
    });
    return { agregados: n };
  }

  async quitarAlcance(req: any, id: string, metodoId: string) {
    const [a] = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id FROM acreditacion WHERE id = $1::uuid AND tenant_id = $2::uuid`, id, tenantDe(req));
    if (!a) throw new NotFoundException("Acreditación no encontrada.");
    const [q] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT cm.codigo, aa.matriz, aa.rango FROM acreditacion_alcance aa JOIN cat_metodo cm ON cm.id = aa.cat_metodo_id
        WHERE aa.acreditacion_id = $1::uuid AND aa.cat_metodo_id = $2::uuid`,
      id,
      metodoId,
    );
    const n = await this.prisma.$executeRawUnsafe(`DELETE FROM acreditacion_alcance WHERE acreditacion_id = $1::uuid AND cat_metodo_id = $2::uuid`, id, metodoId);
    if (n) await this.auditar(req, "acreditacion_alcance_quitado", "acreditacion", id, { metodoId, metodo: q?.codigo ?? null, matriz: q?.matriz ?? null, rango: q?.rango ?? null });
    return { ok: true };
  }

  /* ------------------------------------------- consumo del método (§4.4.5) --- */

  async consumiblesDeMetodo(req: any, metodoId: string) {
    await this.metodo(req, metodoId);
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT mc.consumible_id AS "consumibleId", c.codigo, c.nombre, c.unidad_medida AS unidad, mc.cantidad::float AS cantidad, mc.por, mc.nota,
              COALESCE((SELECT SUM(l.cantidad_actual) FROM lote_consumible l
                         WHERE l.consumible_id = c.id AND l.cantidad_actual > 0 AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= $2::date)), 0)::float AS stock
         FROM cat_metodo_consumible mc JOIN consumible c ON c.id = mc.consumible_id
        WHERE mc.cat_metodo_id = $1::uuid ORDER BY c.codigo`,
      metodoId,
      hoyCl(),
    );
  }

  async buscarConsumibles(req: any, q?: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, nombre, unidad_medida AS unidad, unidad_compra AS "unidadCompra", factor_conversion::float AS "factorConversion"
         FROM consumible WHERE tenant_id = $1::uuid AND activo IS NOT FALSE
          AND ($2::text IS NULL OR codigo ILIKE '%' || $2 || '%' OR nombre ILIKE '%' || $2 || '%')
        ORDER BY codigo LIMIT 30`,
      tenantDe(req),
      texto(q, 80),
    );
  }

  async agregarConsumibleMetodo(req: any, metodoId: string, body: any) {
    await this.metodoEditable(req, metodoId);
    const consumibleId = texto(body?.consumibleId, 40);
    const cantidad = Number(String(body?.cantidad ?? "").replace(",", "."));
    const por = body?.por === "replica" ? "replica" : "ensayo";
    if (!consumibleId) throw new BadRequestException("Elija el consumible.");
    if (!(Number.isFinite(cantidad) && cantidad > 0)) throw new BadRequestException("La cantidad por determinación debe ser mayor que cero.");
    const [c] = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id FROM consumible WHERE id = $1::uuid AND tenant_id = $2::uuid`, consumibleId, tenantDe(req));
    if (!c) throw new NotFoundException("Consumible no encontrado.");
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO cat_metodo_consumible (tenant_id, cat_metodo_id, consumible_id, cantidad, por, nota, creado_por)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid)
       ON CONFLICT (cat_metodo_id, consumible_id) DO UPDATE SET cantidad = EXCLUDED.cantidad, por = EXCLUDED.por, nota = EXCLUDED.nota`,
      tenantDe(req),
      metodoId,
      consumibleId,
      cantidad,
      por,
      texto(body?.nota, 200),
      usuarioDe(req),
    );
    return this.consumiblesDeMetodo(req, metodoId);
  }

  async quitarConsumibleMetodo(req: any, metodoId: string, consumibleId: string) {
    await this.metodoEditable(req, metodoId);
    await this.prisma.$executeRawUnsafe(`DELETE FROM cat_metodo_consumible WHERE cat_metodo_id = $1::uuid AND consumible_id = $2::uuid`, metodoId, consumibleId);
    return this.consumiblesDeMetodo(req, metodoId);
  }

  /* ------------------------------------------ fórmulas desde Excel (§4.3.4) --- */

  plantillaFormulas(): Buffer {
    return libroXlsx([
      {
        nombre: "Fórmulas",
        anchos: [12, 14, 34, 16, 18, 16],
        filas: [
          ["Método", "Analito", "Fórmula", "C1 masa (g)", "C2 volumen (mL)", "C3 normalidad"],
          ["403", "PROT", "(C2*C3*1,4*6,25)/C1", 1, 12.3, 0.1],
        ],
      },
      {
        nombre: "Instrucciones",
        anchos: [110],
        filas: [
          ["Una fila por analito: código del método, código del analito y su fórmula."],
          ["La fórmula puede ser una fórmula de Excel de la misma fila (=(E2*F2*1,4)/D2) o un texto con las variables C1, C2… del método."],
          ["Las columnas desde la D nombran las variables en su cabecera (C1, C2… o un nombre de una palabra); sus valores sirven solo para probar la fórmula en Excel."],
          ["Funciones: PROMEDIO/AVERAGE, SUMA/SUM, MIN, MAX, ABS, RAIZ/SQRT, LOG, LN, POTENCIA/POWER, REDONDEAR/ROUND."],
          ["Al subirla, el LIMS muestra la vista previa: nada cambia en el catálogo hasta aplicar."],
        ],
      },
    ]);
  }

  async vistaPreviaFormulas(req: any, archivo: { originalname: string; buffer: Buffer } | undefined) {
    if (!archivo?.buffer?.length) throw new BadRequestException("Adjunte la planilla (.xlsx o .csv).");
    let filas: string[][];
    try {
      const esZip = archivo.buffer.length > 4 && archivo.buffer.readUInt32LE(0) === 0x04034b50;
      filas = esZip ? leerXlsx(archivo.buffer, { formulas: true }) : leerTabla(archivo.originalname, archivo.buffer);
    } catch (e: any) {
      if (e instanceof TablaError) throw new BadRequestException(e.message);
      throw new BadRequestException("No se pudo leer la planilla: guárdela como .xlsx o .csv.");
    }
    const p = filasDePlanilla(filas.map((f) => f.map((c) => String(c ?? "").trim())));
    if (p.error) throw new BadRequestException(p.error);
    const unidades = await this.alcance.filtroUnidades(req, "catalogo.gestionar");
    const salida: any[] = [];
    for (const f of p.filas) {
      const base = { fila: f.fila, metodo: f.metodo, analito: f.analito, formulaExcel: f.formulaExcel, formula: f.formula, analitoId: null as string | null, formulaActual: null as string | null };
      if (f.error) {
        salida.push({ ...base, estado: "error", detalle: f.error });
        continue;
      }
      const [a] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT a.id, a.formula, a.nombre,
                COALESCE((SELECT array_agg(u.id::text) FROM cat_ensayo e JOIN cat_familia fa ON fa.id = e.familia_id
                           JOIN unidad u ON u.tenant_id = fa.tenant_id
                      AND fa.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))
                          WHERE e.id = cm.ensayo_id), '{}') AS unidades
           FROM cat_metodo cm JOIN cat_analito a ON a.metodo_id = cm.id AND a.deleted_at IS NULL
          WHERE cm.tenant_id = $1::uuid AND cm.deleted_at IS NULL AND upper(cm.codigo) = upper($2) AND upper(a.codigo) = upper($3)
          LIMIT 1`,
        tenantDe(req),
        f.metodo,
        f.analito,
      );
      if (!a) {
        salida.push({ ...base, estado: "no_encontrado", detalle: `No hay un analito ${f.analito} en el método ${f.metodo}.` });
        continue;
      }
      const ok = { ...base, analitoId: a.id, formulaActual: a.formula ?? null, analitoNombre: a.nombre };
      if (unidades && a.unidades.length && !a.unidades.some((u: string) => unidades.includes(u)))
        salida.push({ ...ok, estado: "fuera_alcance", detalle: "El método es de un laboratorio que usted no tiene asignado." });
      else if ((a.formula ?? "").replace(/\s+/g, "") === f.formula) salida.push({ ...ok, estado: "sin_cambios", detalle: null });
      else salida.push({ ...ok, estado: "listo", detalle: a.formula ? "Reemplaza la fórmula actual." : "Fórmula nueva." });
    }
    const resumen: Record<string, number> = {};
    for (const x of salida) resumen[x.estado] = (resumen[x.estado] ?? 0) + 1;
    return { archivo: archivo.originalname, resumen, filas: salida };
  }

  /** Guarda las fórmulas elegidas de la vista previa (se vuelven a validar y quedan en la auditoría). */
  async aplicarFormulas(req: any, body: any) {
    const filas: { analitoId: string; formula: string }[] = Array.isArray(body?.filas) ? body.filas : [];
    if (!filas.length) throw new BadRequestException("No hay fórmulas para aplicar.");
    const motivo = motivoValido(body?.motivo);
    let aplicadas = 0;
    const errores: { analitoId: string; error: string }[] = [];
    for (const f of filas.slice(0, 500)) {
      const v = validarFormula(String(f?.formula ?? ""));
      if (!v.ok) {
        errores.push({ analitoId: f?.analitoId, error: v.error ?? "Fórmula no válida." });
        continue;
      }
      const [a] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT a.id, a.metodo_id, a.formula FROM cat_analito a JOIN cat_metodo cm ON cm.id = a.metodo_id
          WHERE a.id = $1::uuid AND cm.tenant_id = $2::uuid AND a.deleted_at IS NULL`,
        f.analitoId,
        tenantDe(req),
      );
      if (!a) {
        errores.push({ analitoId: f.analitoId, error: "Analito no encontrado." });
        continue;
      }
      try {
        await this.metodoEditable(req, a.metodo_id);
      } catch (e: any) {
        errores.push({ analitoId: f.analitoId, error: e.message });
        continue;
      }
      const nueva = String(f.formula).trim();
      await this.prisma.$executeRawUnsafe(`UPDATE cat_analito SET formula = $2 WHERE id = $1::uuid`, a.id, nueva);
      await this.auditar(req, "formula_importada", "cat_analito", a.id, { anterior: a.formula ?? null, nueva, motivo });
      aplicadas++;
    }
    return { aplicadas, errores };
  }

  private async auditar(req: any, accion: string, entidad: string, id: string, detalle: unknown) {
    await this.prisma
      .$executeRawUnsafe(
        `INSERT INTO audit_log (tenant_id, usuario_id, username, accion, entidad_tipo, entidad_id, diff, motivo)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7::jsonb, $8)`,
        tenantDe(req),
        usuarioDe(req),
        req?.user?.username ?? null,
        accion,
        entidad,
        id,
        JSON.stringify(detalle),
        (detalle as any)?.motivo ?? null,
      )
      .catch(() => undefined);
  }

  /* -------------------------------------------------------------- alícuotas --- */

  /** Muestra del tenant y del alcance del usuario (por la unidad de su OT). */
  private async muestra(req: any, muestraId: string, permiso: string) {
    const [m] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.codigo, m.nombre, m.tenant_id, o.id AS ot_id, o.codigo AS ot_codigo, o.unidad_principal
         FROM muestra m LEFT JOIN orden_trabajo o ON o.id = m.ot_id
        WHERE m.id = $1::uuid AND m.deleted_at IS NULL`,
      muestraId,
    );
    if (!m || m.tenant_id !== tenantDe(req)) throw new NotFoundException("Muestra no encontrada.");
    const unidades = await this.alcance.filtroUnidades(req, permiso);
    if (unidades && !(m.unidad_principal && unidades.includes(m.unidad_principal)))
      throw new ForbiddenException(`La muestra ${m.codigo} es de otro laboratorio.`);
    return m;
  }

  /**
   * Ubicaciones (sala, gabinete, estante, caja…) donde guardar una alícuota: las
   * comunes (sin laboratorio) y las de los laboratorios del alcance del usuario.
   */
  async ubicaciones(req: any, q?: string) {
    const unidades = await this.alcance.filtroUnidades(req, "alicuota.gestionar");
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, nombre, tipo, path FROM ubicacion
        WHERE tenant_id = $1::uuid AND COALESCE(activa, TRUE)
          AND ($2::text IS NULL OR codigo ILIKE '%' || $2 || '%' OR nombre ILIKE '%' || $2 || '%' OR path ILIKE '%' || $2 || '%')
          AND ($3::uuid[] IS NULL OR unidad_id IS NULL OR unidad_id = ANY($3::uuid[]))
        ORDER BY path LIMIT 100`,
      tenantDe(req),
      texto(q, 60),
      unidades,
    );
  }

  /**
   * Alta de una ubicación (sala, gabinete, estante, caja…) con `ubicacion.gestionar`.
   * Con laboratorio, debe ser de su alcance; sin laboratorio (común a todos), solo
   * con alcance global (Calidad, Administración). La pantalla de alícuotas la ofrece
   * cuando no hay ninguna configurada.
   */
  async crearUbicacion(req: any, b: any) {
    const codigo = texto(b?.codigo, 60);
    const nombre = texto(b?.nombre, 120);
    const tipo = texto(b?.tipo, 30);
    const unidadId = typeof b?.unidadId === "string" && b.unidadId ? b.unidadId : null;
    if (!codigo || !nombre) throw new BadRequestException("Indique el código y el nombre de la ubicación.");
    if (unidadId && !/^[0-9a-f-]{36}$/i.test(unidadId)) throw new BadRequestException("El laboratorio indicado no existe.");
    const alcance = await this.alcance.filtroUnidades(req, "ubicacion.gestionar");
    if (alcance !== null && (!unidadId || !alcance.includes(unidadId)))
      throw new ForbiddenException(
        unidadId ? "Fuera de su alcance: solo registra ubicaciones de sus laboratorios." : "Una ubicación común (sin laboratorio) la registra Calidad o Administración: indique su laboratorio.",
      );
    const tenantId = tenantDe(req);
    const existe = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT 1 FROM ubicacion WHERE tenant_id = $1::uuid AND upper(codigo) = upper($2)`,
      tenantId,
      codigo,
    );
    if (existe.length) throw new ConflictException(`Ya existe la ubicación ${codigo}.`);
    const [u] = await this.prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO ubicacion (tenant_id, codigo, nombre, tipo, path, unidad_id, activa)
       SELECT $1::uuid, $2, $3, $4, $2, $5::uuid, TRUE
        WHERE $5::uuid IS NULL OR EXISTS (SELECT 1 FROM unidad WHERE id = $5::uuid AND tenant_id = $1::uuid)
       RETURNING id, codigo, nombre, tipo, path`,
      tenantId,
      codigo,
      nombre,
      tipo,
      unidadId,
    );
    if (!u) throw new BadRequestException("El laboratorio indicado no existe.");
    return u;
  }

  /** La ubicación elegida es del tenant y está activa (null si no se eligió). */
  private async ubicacionValida(req: any, ubicacionId: string | null): Promise<{ id: string; nombre: string } | null> {
    if (!ubicacionId) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ubicacionId))
      throw new BadRequestException("La ubicación elegida no existe o está inactiva.");
    const [u] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo || ' · ' || nombre AS nombre FROM ubicacion WHERE id = $1::uuid AND tenant_id = $2::uuid AND COALESCE(activa, TRUE)`,
      ubicacionId,
      tenantDe(req),
    );
    if (!u) throw new BadRequestException("La ubicación elegida no existe o está inactiva.");
    return { id: u.id, nombre: u.nombre };
  }

  async buscarMuestras(req: any, q?: string) {
    const t = texto(q, 60);
    if (!t || t.length < 2) return [];
    const unidades = await this.alcance.filtroUnidades(req, "muestra.ver");
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.codigo, m.nombre, o.codigo AS "otCodigo",
              (SELECT count(*)::int FROM alicuota a WHERE a.muestra_id = m.id) AS alicuotas
         FROM muestra m LEFT JOIN orden_trabajo o ON o.id = m.ot_id
        WHERE m.tenant_id = $1::uuid AND m.deleted_at IS NULL
          AND (m.codigo ILIKE '%' || $2 || '%' OR o.codigo ILIKE '%' || $2 || '%' OR m.nombre ILIKE '%' || $2 || '%')
          AND ($3::uuid[] IS NULL OR o.unidad_principal = ANY($3::uuid[]))
        ORDER BY m.created_at DESC LIMIT 30`,
      tenantDe(req),
      t,
      unidades,
    );
  }

  async alicuotas(req: any, muestraId: string) {
    const m = await this.muestra(req, muestraId, "muestra.ver");
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.id, a.codigo, a.cantidad::float AS cantidad, a.cantidad_restante::float AS "cantidadRestante", a.unidad, a.estado,
              a.proposito, a.observacion, a.ubicacion_id AS "ubicacionId", ub.nombre AS ubicacion, a.created_at AS "creadoEn", u.nombre_completo AS "creadoPor",
              COALESCE((SELECT json_agg(json_build_object('tipo', mv.tipo, 'cantidad', mv.cantidad, 'estadoDesde', mv.estado_desde,
                        'estadoHasta', mv.estado_hasta, 'detalle', mv.detalle, 'usuario', uu.nombre_completo, 'creadoEn', mv.creado_en) ORDER BY mv.creado_en)
                        FROM alicuota_movimiento mv LEFT JOIN usuario uu ON uu.id = mv.usuario_id WHERE mv.alicuota_id = a.id), '[]') AS movimientos
         FROM alicuota a
         LEFT JOIN ubicacion ub ON ub.id = a.ubicacion_id
         LEFT JOIN usuario u ON u.id = a.creado_por
        WHERE a.muestra_id = $1::uuid
        ORDER BY a.created_at, a.codigo`,
      muestraId,
    );
    return { muestra: { id: m.id, codigo: m.codigo, nombre: m.nombre, otId: m.ot_id, otCodigo: m.ot_codigo }, alicuotas: filas };
  }

  /** Prepara N alícuotas iguales (código correlativo «<muestra>-A1, -A2…»). */
  async crearAlicuotas(req: any, muestraId: string, body: any) {
    const m = await this.muestra(req, muestraId, "alicuota.gestionar");
    const n = Math.trunc(Number(body?.n ?? 1));
    if (!(n >= 1 && n <= 50)) throw new BadRequestException("Se preparan de 1 a 50 alícuotas a la vez.");
    const cantidad = body?.cantidad == null || body?.cantidad === "" ? null : Number(String(body.cantidad).replace(",", "."));
    if (cantidad != null && !(Number.isFinite(cantidad) && cantidad > 0)) throw new BadRequestException("La cantidad debe ser mayor que cero.");
    const unidad = texto(body?.unidad, 20);
    if (cantidad != null && !unidad) throw new BadRequestException("Indique la unidad de la cantidad (g, mL…).");
    const ubicacionId = (await this.ubicacionValida(req, texto(body?.ubicacionId, 40)))?.id ?? null;
    const existentes = await this.prisma.$queryRawUnsafe<{ codigo: string }[]>(`SELECT codigo FROM alicuota WHERE muestra_id = $1::uuid`, muestraId);
    const usados = existentes.map((e) => e.codigo);
    const creadas: string[] = [];
    for (let i = 0; i < n; i++) {
      const codigo = codigoAlicuota(m.codigo, [...usados, ...creadas]);
      const [a] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO alicuota (muestra_id, tenant_id, codigo, cantidad, cantidad_restante, unidad, ubicacion_id, estado, proposito, observacion, creado_por)
         VALUES ($1::uuid, $2::uuid, $3, $4, $4, $5, $6::uuid, 'disponible', $7, $8, $9::uuid) RETURNING id`,
        muestraId,
        tenantDe(req),
        codigo,
        cantidad,
        unidad,
        ubicacionId,
        texto(body?.proposito, 160),
        texto(body?.observacion, 1000),
        usuarioDe(req),
      );
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO alicuota_movimiento (alicuota_id, tipo, cantidad, estado_hasta, detalle, usuario_id) VALUES ($1::uuid, 'preparacion', $2, 'disponible', $3, $4::uuid)`,
        a.id,
        cantidad,
        texto(body?.proposito, 160),
        usuarioDe(req),
      );
      creadas.push(codigo);
    }
    return { creadas };
  }

  /** Consumo, traslado, cambio de estado o descarte de una alícuota. */
  async moverAlicuota(req: any, id: string, body: any) {
    const [a] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, muestra_id, codigo, estado, cantidad_restante::float AS restante, unidad FROM alicuota WHERE id = $1::uuid`,
      id,
    );
    if (!a) throw new NotFoundException("Alícuota no encontrada.");
    await this.muestra(req, a.muestra_id, "alicuota.gestionar");
    const mov: MovimientoAlicuota = {
      tipo: body?.tipo,
      cantidad: body?.cantidad == null || body?.cantidad === "" ? null : Number(String(body.cantidad).replace(",", ".")),
      estado: texto(body?.estado, 30),
      ubicacionId: texto(body?.ubicacionId, 40),
      detalle: texto(body?.detalle, 500),
    };
    const e = erroresMovimientoAlicuota(mov, { estado: a.estado, restante: a.restante });
    if (e.length) throw new BadRequestException(e.join(" "));
    // El traslado deja en el historial a dónde se llevó la alícuota.
    const destino = mov.tipo === "traslado" ? await this.ubicacionValida(req, mov.ubicacionId) : null;
    const detalle = destino ? `A ${destino.nombre}${mov.detalle ? ` · ${mov.detalle}` : ""}`.slice(0, 500) : mov.detalle;
    const plan = planMovimientoAlicuota(mov, { estado: a.estado, restante: a.restante });
    await this.prisma.$executeRawUnsafe(
      `UPDATE alicuota SET estado = $2, cantidad_restante = $3, ubicacion_id = COALESCE($4::uuid, ubicacion_id), actualizado_en = now() WHERE id = $1::uuid`,
      id,
      plan.estado,
      plan.restante,
      mov.tipo === "traslado" ? mov.ubicacionId : null,
    );
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO alicuota_movimiento (alicuota_id, tipo, cantidad, estado_desde, estado_hasta, resultado_id, detalle, usuario_id)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7, $8::uuid)`,
      id,
      mov.tipo,
      mov.tipo === "consumo" ? mov.cantidad : null,
      a.estado,
      plan.estado,
      texto(body?.resultadoId, 40),
      detalle,
      usuarioDe(req),
    );
    return { id, estado: plan.estado, cantidadRestante: plan.restante };
  }
}
