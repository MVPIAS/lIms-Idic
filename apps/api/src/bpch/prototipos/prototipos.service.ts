import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../../common/prisma.service";
import { escapeHtml } from "../../plantilla-render/html.util";
import { PlantillaRenderService } from "../../plantilla-render/plantilla-render.service";
import { etiquetaVeredicto } from "../../laboratorio/veredicto";
import { OtDesdeProcesoService } from "../ot-desde-proceso.service";
import { ClasificacionService } from "../clasificacion/clasificacion.service";
import { textoClasificacion } from "../clasificacion/reglas-clasificacion";
import { PuenteAnalisisService } from "../../flujo-real/flujo-real.module";
import { normalizarCnc } from "../comun/reglas-bpch";
import { guardarAdjunto, leerAdjunto, listarAdjuntos, type ArchivoAdjunto } from "../../common/adjuntos";

/** Adjuntos del ingreso del prototipo (EP-08 8.8). */
export const CLASES_ADJUNTO_PROTOTIPO = ["ficha_tecnica", "hoja_seguridad"] as const;
import {
  DOCUMENTO_DICTAMEN,
  PLANTILLAS_PROTOTIPO,
  etapaPrototipo,
  faltantesDictamen,
  faltantesGenerarOt,
  faltantesInscripcionCu,
  faltantesParametrizacion,
  erroresParametros,
  NOMBRE_ESTADO_PARAMETRIZACION,
  textoLimite,
  type EstadoParametrizacion,
  mensajeCodificado,
  revisarCodificado,
  type CandidatoCodificado,
  validarCodigoCnc,
  resultadoDictamen,
  veredictoOt,
  type Dictamen,
} from "./reglas-prototipo";

const texto = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v), z.string().max(max).nullable().optional());
const fechaOpcional = z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").nullable().optional());

const Campos = {
  clienteId: z.string().uuid({ message: "Seleccione el fabricante." }),
  elemento: z.string().trim().min(1, "Indique el elemento nuevo.").max(240),
  descripcionTecnica: texto(8000),
  fichaTecnica: texto(200),
  hojaSeguridad: texto(200),
  solicitudDgmn: z.string().trim().min(1, "Indique la solicitud o resolución DGMN del prototipo.").max(120),
  fechaSolicitud: fechaOpcional,
  grupoPropuesto: texto(200),
  clasificacionId: z.string().uuid().nullable().optional(),
};
export const CrearPrototipo = z.object(Campos).strict();
export const EditarPrototipo = z.object(Campos).partial().strict();
export const PronunciamientoSac = z
  .object({
    consultaAt: fechaOpcional,
    referencia: texto(200),
    tamanoMuestra: z.coerce.number().int().positive("El tamaño de muestra debe ser mayor que cero.").max(100000),
    respuestaAt: fechaOpcional,
    observacion: texto(4000),
  })
  .strict();
export const GenerarOt = z
  .object({
    unidadId: z.string().uuid({ message: "Indique la sucursal o sección que inspeccionará." }),
    conCobro: z.boolean({ required_error: "Indique si la OT es con cobro o sin cobro.", invalid_type_error: "Indique si la OT es con cobro o sin cobro." }),
  })
  .strict();
export const DictamenDto = z
  .object({ dictamen: z.enum(["aprobado", "rechazado"]), motivo: texto(4000) })
  .strict();
export const CodigoCnc = z.object({ codigo: z.string().trim().max(60) }).strict();
const numOpc = z.number().finite().min(-1e12).max(1e12).nullable().optional();
export const ParametrosBody = z
  .object({
    filas: z
      .array(
        z.object({
          metodoId: z.string().uuid("Elija el método de cada fila."),
          ensayo: z.string().trim().min(1, "Indique el ensayo.").max(200),
          minimo: numOpc,
          nominal: numOpc,
          maximo: numOpc,
          unidad: z.string().trim().max(30).nullable().optional(),
          formula: z.string().trim().max(500).nullable().optional(),
          tipoFormula: z.enum(["general", "especifica"]).nullable().optional(),
        }),
      )
      .max(60),
  })
  .strict();
export const Motivo = z.object({ motivo: z.string().trim().min(5, "Indique el motivo (al menos 5 caracteres).").max(2000) });

const iso = (d: unknown) => (d ? new Date(d as any).toISOString().slice(0, 10) : null);

const SELECT = `
  SELECT p.*, cl.razon_social AS cliente_nombre, cl.rut AS cliente_rut,
         u.codigo AS unidad_codigo, u.nombre AS unidad_nombre,
         ot.codigo AS ot_codigo, ot.estado AS ot_estado, ot.con_cobro AS ot_con_cobro, ot.unidad_principal AS ot_unidad,
         uo.codigo AS ot_unidad_codigo, uo.nombre AS ot_unidad_nombre,
         c.codigo AS clas_codigo, c.version AS clas_version, c.estado AS clas_estado, c.explosiva AS clas_explosiva,
         c.clase_division AS clas_clase, c.grupo_compatibilidad AS clas_grupo, c.numero_onu AS clas_onu,
         d.numero AS doc_numero, d.estado AS doc_estado, d.tipo_documento AS doc_tipo,
         ud.nombre_completo AS dictamen_por_nombre, uc.nombre_completo AS cnc_por_nombre
    FROM bpch_prototipo p
    JOIN cliente cl ON cl.id = p.cliente_id
    LEFT JOIN unidad u ON u.id = p.unidad_id
    LEFT JOIN orden_trabajo ot ON ot.id = p.ot_id
    LEFT JOIN unidad uo ON uo.id = ot.unidad_principal
    LEFT JOIN bpch_clasificacion c ON c.id = p.clasificacion_id
    LEFT JOIN certificado d ON d.id = p.documento_id
    LEFT JOIN usuario ud ON ud.id = p.dictamen_por
    LEFT JOIN usuario uc ON uc.id = p.codigo_cnc_por`;

/**
 * Prototipos (BPCH): ingreso del elemento nuevo → pronunciamiento SAC (tamaño
 * de muestra) → OT (origen PROTOTIPO, flujo general) → dictamen de aprobación
 * o rechazo del tipo, emitido como documento del circuito de firmas → código
 * único CNC-DGMN del tipo aprobado. Reglas en reglas-prototipo.ts.
 */
@Injectable()
export class PrototiposService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comun: OtDesdeProcesoService,
    private readonly render: PlantillaRenderService,
    private readonly clasificaciones: ClasificacionService,
    private readonly puente: PuenteAnalisisService,
  ) {}

  /** Las plantillas del dictamen leen los datos del prototipo de su OT. */
  onModuleInit() {
    this.render.registrarContexto("prototipo", (otId, tenantId, plantilla) => this.contextoPlantilla(otId, tenantId, plantilla));
  }

  private async contextoPlantilla(otId: string, tenantId: string | undefined, plantilla: { repid: string }) {
    const propia = PLANTILLAS_PROTOTIPO.includes(plantilla.repid);
    const filas = await this.prisma.$queryRawUnsafe<any[]>(`${SELECT} WHERE p.ot_id = $1::uuid`, otId);
    const p = filas[0];
    if (!p || (tenantId && p.tenant_id !== tenantId)) {
      if (propia)
        throw new ConflictException(`La plantilla ${plantilla.repid} es del dictamen de prototipos: se emite desde BPCH › Prototipos.`);
      return null;
    }
    if (propia) {
      const esperado = Object.entries(DOCUMENTO_DICTAMEN).find(([, d]) => d.repid === plantilla.repid)?.[0];
      if (p.dictamen !== esperado)
        throw new ConflictException(`La plantilla ${plantilla.repid} no corresponde al dictamen del prototipo ${p.codigo}: emítalo desde BPCH › Prototipos.`);
    }
    return { datos: this.datosDocumento(p), bloques: { tabla_ensayos: await this.tablaEnsayos(otId) } };
  }

  private datosDocumento(p: any) {
    return {
      codigo: p.codigo,
      elemento: p.elemento,
      fabricante: p.cliente_nombre,
      rut: p.cliente_rut,
      esquema: p.esquema,
      solicitudDgmn: p.solicitud_dgmn,
      descripcionTecnica: p.descripcion_tecnica ?? "",
      unidad: p.unidad_codigo ? `${p.unidad_codigo} · ${p.unidad_nombre}` : "",
      tamanoMuestra: p.sac_tamano_muestra ? String(p.sac_tamano_muestra) : "",
      clasificacionCodigo: p.clas_codigo ? (p.clas_version > 1 ? `${p.clas_codigo}-V${p.clas_version}` : p.clas_codigo) : "",
      claseDivision: p.clas_clase ? `${p.clas_clase}${p.clas_grupo ?? ""}` : "",
      numeroOnu: p.clas_onu ? `UN ${p.clas_onu}` : "",
      dictamen: p.dictamen ?? "",
      dictamenMotivo: p.dictamen_motivo ?? "",
    };
  }

  /** Tabla de ensayos de la OT con los nombres del catálogo, la especificación y el veredicto. */
  private async tablaEnsayos(otId: string): Promise<string> {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.codigo AS muestra, COALESCE(ca.nombre, a.nombre, cm.nombre) AS ensayo, cm.codigo AS metodo,
              r.limite_inf, r.limite_sup, r.requisito, r.unidad, r.valor_numerico, r.promedio, r.resultado_final, r.valor_texto, r.veredicto
         FROM resultado r
         LEFT JOIN muestra m ON m.id = r.muestra_id
         LEFT JOIN cat_analito ca ON ca.id = r.cat_analito_id
         LEFT JOIN analito a ON a.id = r.analito_id
         LEFT JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
        WHERE r.ot_id = $1::uuid AND r.deleted_at IS NULL
        ORDER BY m.codigo, cm.codigo, ca.nombre`,
      otId,
    );
    if (!filas.length)
      return `<table class="rep"><tbody><tr><td class="vacio">Sin ensayos registrados en la orden de trabajo.</td></tr></tbody></table>`;
    const celda = (v: unknown, cls = "") => `<td${cls ? ` class="${cls}"` : ""}>${escapeHtml(v === null || v === undefined || v === "" ? "—" : String(v))}</td>`;
    const cuerpo = filas
      .map((r) => {
        const espec =
          r.limite_inf || r.limite_sup
            ? `${r.limite_inf ?? "—"} – ${r.limite_sup ?? "—"}${r.unidad ? ` ${r.unidad}` : ""}`
            : r.requisito ?? "";
        const valor = resultadoDictamen(r);
        const clase = r.veredicto === "cumple" ? "ok" : r.veredicto === "no_cumple" ? "no" : "";
        return `<tr>${celda(r.muestra)}${celda(r.ensayo)}${celda(r.metodo)}${celda(espec)}${celda(valor, "num")}${celda(etiquetaVeredicto(r.veredicto), clase)}</tr>`;
      })
      .join("");
    return `<table class="rep"><thead><tr><th>Muestra</th><th>Ensayo</th><th>Método</th><th>Especificación</th><th class="num">Resultado</th><th>Condición</th></tr></thead><tbody>${cuerpo}</tbody></table>`;
  }

  private async fila(tenantId: string, id: string) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(`${SELECT} WHERE p.id = $1::uuid AND p.tenant_id = $2::uuid`, id, tenantId);
    if (!filas[0]) throw new NotFoundException("Prototipo no encontrado.");
    return filas[0];
  }

  private resumen(p: any) {
    return {
      id: p.id,
      codigo: p.codigo,
      elemento: p.elemento,
      cliente: { id: p.cliente_id, razonSocial: p.cliente_nombre, rut: p.cliente_rut },
      solicitudDgmn: p.solicitud_dgmn,
      fechaSolicitud: iso(p.fecha_solicitud),
      esquema: p.esquema,
      estado: p.estado,
      etapa: etapaPrototipo({
        estado: p.estado,
        dictamen: p.dictamen,
        documentoEstado: p.doc_estado,
        otId: p.ot_id && p.ot_estado !== "anulada" ? p.ot_id : null,
        sacTamanoMuestra: p.sac_tamano_muestra,
      }),
      dictamen: p.dictamen,
      ot: p.ot_id ? { id: p.ot_id, codigo: p.ot_codigo, estado: p.ot_estado } : null,
      unidad: p.unidad_id ? { id: p.unidad_id, codigo: p.unidad_codigo, nombre: p.unidad_nombre } : null,
      codigoCnc: p.codigo_cnc,
      createdAt: p.created_at,
    };
  }

  /**
   * Unidad del prototipo para el alcance: la ACTUAL de su OT o, si no la hay,
   * la de su alta (null mientras no se genera la OT). 404 si no existe.
   */
  async unidadDe(tenantId: string, id: string): Promise<string | null> {
    const p = await this.fila(tenantId, id);
    return p.ot_unidad ?? p.unidad_id ?? null;
  }

  /** `unidades`: null = todos; si no, solo los prototipos de esas unidades (alcance-bpch.ts). */
  async listar(tenantId: string, f: { q?: string; estado?: string }, unidades: string[] | null = null) {
    const args: unknown[] = [tenantId];
    const where = ["p.tenant_id = $1::uuid"];
    if (unidades) {
      args.push(unidades);
      where.push(`COALESCE(ot.unidad_principal, p.unidad_id) = ANY($${args.length}::uuid[])`);
    }
    if (f.q?.trim()) {
      args.push(`%${f.q.trim()}%`);
      const q = `$${args.length}`;
      where.push(`(p.codigo ILIKE ${q} OR p.elemento ILIKE ${q} OR cl.razon_social ILIKE ${q} OR cl.rut ILIKE ${q} OR p.solicitud_dgmn ILIKE ${q})`);
    }
    if (f.estado && ["ingresado", "en_evaluacion", "dictaminado", "anulado"].includes(f.estado)) {
      args.push(f.estado);
      where.push(`p.estado = $${args.length}`);
    }
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT} WHERE ${where.join(" AND ")} ORDER BY p.created_at DESC LIMIT 300`,
      ...args,
    );
    return { data: filas.map((p) => this.resumen(p)) };
  }

  async detalle(tenantId: string, id: string) {
    const p = await this.fila(tenantId, id);
    const otViva = p.ot_id && p.ot_estado !== "anulada";
    const resultados = otViva ? await this.comun.resultadosDeOt(p.ot_id) : [];
    const aprobados = resultados.filter((r) => r.estado === "aprobado").length;
    const veredicto = veredictoOt(resultados);
    const documentoVigente = ["en_firma", "oficial", "emitido", "devuelto"].includes(p.doc_estado ?? "");
    const base = {
      estado: p.estado,
      otId: otViva ? p.ot_id : null,
      totalResultados: resultados.length,
      aprobados,
      veredicto,
      clasificacionEstado: p.clas_estado ?? null,
      documentoVigente,
    };
    return {
      ...this.resumen(p),
      descripcionTecnica: p.descripcion_tecnica,
      fichaTecnica: p.ficha_tecnica,
      hojaSeguridad: p.hoja_seguridad,
      grupoPropuesto: p.grupo_propuesto,
      clasificacion: p.clasificacion_id
        ? {
            id: p.clasificacion_id,
            codigo: p.clas_version > 1 ? `${p.clas_codigo}-V${p.clas_version}` : p.clas_codigo,
            estado: p.clas_estado,
            resumen: textoClasificacion({
              explosiva: p.clas_explosiva,
              claseDivision: p.clas_clase,
              grupoCompatibilidad: p.clas_grupo,
              numeroOnu: p.clas_onu,
            }),
          }
        : null,
      sac: {
        consultaAt: iso(p.sac_consulta_at),
        referencia: p.sac_referencia,
        tamanoMuestra: p.sac_tamano_muestra,
        respuestaAt: iso(p.sac_respuesta_at),
        observacion: p.sac_observacion,
      },
      evaluacion: {
        resultados: resultados.length,
        aprobados,
        veredicto,
        otConCobro: p.ot_con_cobro,
      },
      dictamenDetalle: p.dictamen
        ? { dictamen: p.dictamen, motivo: p.dictamen_motivo, por: p.dictamen_por_nombre, at: p.dictamen_at }
        : null,
      documento: p.documento_id ? { id: p.documento_id, numero: p.doc_numero, estado: p.doc_estado, tipoDocumento: p.doc_tipo } : null,
      codigoCncDetalle: p.codigo_cnc ? { codigo: p.codigo_cnc, por: p.cnc_por_nombre, at: p.codigo_cnc_at } : null,
      adjuntos: await listarAdjuntos(this.prisma as any, tenantId, "prototipo", [id]),
      parametrizacion: await this.parametrizacion(tenantId, p),
      inscripcionCu: await this.inscripcionCu(tenantId, p),
      anulado: p.anulado_at ? { motivo: p.anulado_motivo, at: p.anulado_at } : null,
      faltantes: {
        generarOt: faltantesGenerarOt({
          estado: p.estado,
          otId: p.ot_id,
          otEstado: p.ot_estado,
          sacTamanoMuestra: p.sac_tamano_muestra,
          unidadId: "-", // la unidad y el cobro se eligen al generar
          conCobro: true,
          parametrizacion: { exige: await this.exigeParametrizacion(tenantId), estado: p.param_estado },
        }),
        aprobar: faltantesDictamen({ ...base, dictamen: "aprobado" }),
        rechazar: faltantesDictamen({ ...base, dictamen: "rechazado", motivo: "x" }),
      },
    };
  }

  private async validarRefs(tenantId: string, d: { clienteId?: string; clasificacionId?: string | null }) {
    if (d.clienteId) {
      const c = await this.prisma.cliente.findFirst({ where: { id: d.clienteId, tenantId, deletedAt: null }, select: { id: true } });
      if (!c) throw new BadRequestException("El fabricante indicado no existe.");
    }
    if (d.clasificacionId) await this.clasificaciones.exigirAprobada(tenantId, d.clasificacionId);
  }

  /** 8.8 · ¿Está codificado? Busca el elemento en la Codificación Única y en el catálogo. */
  async codificado(tenantId: string, elemento: string) {
    const e = String(elemento ?? "").trim().slice(0, 240);
    if (e.length < 2) return { codificado: false, exactos: [], parecidos: [] };
    const patron = `%${e.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const [cu, cat] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT producto, cnc_dgmn, fabricante_nombre, estado FROM bpch_codificacion
          WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND (producto ILIKE $2 OR $3 ILIKE '%' || producto || '%') LIMIT 50`,
        tenantId,
        patron,
        e,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT codigo, nombre FROM cat_elemento
          WHERE tenant_id = $1::uuid AND activo AND (nombre ILIKE $2 OR $3 ILIKE '%' || nombre || '%') LIMIT 50`,
        tenantId,
        patron,
        e,
      ),
    ]);
    const candidatos: CandidatoCodificado[] = [
      ...cu.map((c) => ({ origen: "codificacion" as const, nombre: c.producto, detalle: `${c.cnc_dgmn} · ${c.fabricante_nombre}${c.estado === "EN_RECESO" ? " (en receso)" : ""}` })),
      ...cat.map((c) => ({ origen: "catalogo" as const, nombre: c.nombre, detalle: `${c.codigo} · ${c.nombre}` })),
    ];
    return revisarCodificado(e, candidatos);
  }

  async crear(tenantId: string, usuarioId: string | null, body: unknown) {
    const d = CrearPrototipo.parse(body ?? {});
    await this.validarRefs(tenantId, d);
    const rev = await this.codificado(tenantId, d.elemento);
    if (rev.codificado) throw new ConflictException(mensajeCodificado(d.elemento, rev.exactos));
    const id = await this.prisma.$transaction(async (tx) => {
      const codigo = await this.comun.correlativo(tx, tenantId, "PROTO");
      const filas = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO bpch_prototipo (tenant_id, codigo, cliente_id, elemento, descripcion_tecnica, ficha_tecnica, hoja_seguridad,
                                     solicitud_dgmn, fecha_solicitud, grupo_propuesto, clasificacion_id, created_by)
         VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9::date, $10, $11::uuid, $12::uuid) RETURNING id`,
        tenantId,
        codigo,
        d.clienteId,
        d.elemento,
        d.descripcionTecnica ?? null,
        d.fichaTecnica ?? null,
        d.hojaSeguridad ?? null,
        d.solicitudDgmn,
        d.fechaSolicitud ?? null,
        d.grupoPropuesto ?? null,
        d.clasificacionId ?? null,
        usuarioId,
      );
      return filas[0].id;
    });
    return this.detalle(tenantId, id);
  }

  async editar(tenantId: string, id: string, body: unknown) {
    const d = EditarPrototipo.parse(body ?? {});
    const p = await this.fila(tenantId, id);
    if (p.estado === "anulado" || p.estado === "dictaminado")
      throw new ConflictException(`El prototipo está ${p.estado}: no se modifica.`);
    // Con OT generada solo se puede completar la clasificación y los antecedentes.
    const otViva = p.ot_id && p.ot_estado !== "anulada";
    if (otViva && (d.clienteId !== undefined || d.elemento !== undefined || d.solicitudDgmn !== undefined))
      throw new ConflictException(`El prototipo ya tiene la OT ${p.ot_codigo}: no se cambia el fabricante, el elemento ni la solicitud DGMN.`);
    await this.validarRefs(tenantId, d);
    const mapa: Record<string, [string, string?]> = {
      clienteId: ["cliente_id", "::uuid"],
      elemento: ["elemento"],
      descripcionTecnica: ["descripcion_tecnica"],
      fichaTecnica: ["ficha_tecnica"],
      hojaSeguridad: ["hoja_seguridad"],
      solicitudDgmn: ["solicitud_dgmn"],
      fechaSolicitud: ["fecha_solicitud", "::date"],
      grupoPropuesto: ["grupo_propuesto"],
      clasificacionId: ["clasificacion_id", "::uuid"],
    };
    const nombres: string[] = [];
    const valores: unknown[] = [];
    for (const [k, v] of Object.entries(d)) {
      if (v === undefined || !mapa[k]) continue;
      valores.push(v);
      nombres.push(`${mapa[k][0]} = $${valores.length + 1}${mapa[k][1] ?? ""}`);
    }
    if (nombres.length)
      await this.prisma.$executeRawUnsafe(`UPDATE bpch_prototipo SET ${nombres.join(", ")}, updated_at = now() WHERE id = $1::uuid`, id, ...valores);
    return this.detalle(tenantId, id);
  }

  async pronunciamientoSac(tenantId: string, id: string, body: unknown) {
    const d = PronunciamientoSac.parse(body ?? {});
    const p = await this.fila(tenantId, id);
    if (p.estado !== "ingresado")
      throw new ConflictException("El pronunciamiento de la SAC se registra antes de generar la OT.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_prototipo SET sac_consulta_at = $2::date, sac_referencia = $3, sac_tamano_muestra = $4, sac_respuesta_at = $5::date,
              sac_observacion = $6, updated_at = now() WHERE id = $1::uuid`,
      id,
      d.consultaAt ?? null,
      d.referencia ?? null,
      d.tamanoMuestra,
      d.respuestaAt ?? null,
      d.observacion ?? null,
    );
    return this.detalle(tenantId, id);
  }

  async generarOt(req: any, tenantId: string, usuarioId: string | null, id: string, body: unknown) {
    const d = GenerarOt.parse(body ?? {});
    const p = await this.fila(tenantId, id);
    const faltan = faltantesGenerarOt({
      estado: p.estado,
      otId: p.ot_id,
      otEstado: p.ot_estado,
      sacTamanoMuestra: p.sac_tamano_muestra,
      unidadId: d.unidadId,
      conCobro: d.conCobro,
      parametrizacion: { exige: await this.exigeParametrizacion(tenantId), estado: p.param_estado },
    });
    if (faltan.length) throw new ConflictException(`No se puede generar la OT. ${faltan.join(" ")}`);
    const unidad = await this.comun.unidadDeBpch(tenantId, d.unidadId);
    await this.comun.exigirOperarEnUnidad(req, unidad);
    const descripcion = [
      `Prototipo ${p.codigo} · evaluación de tipo (esquema ${p.esquema}).`,
      `Fabricante: ${p.cliente_nombre} (${p.cliente_rut}). Elemento: ${p.elemento}.`,
      `Solicitud / resolución DGMN: ${p.solicitud_dgmn}.`,
      `Tamaño de muestra según pronunciamiento SAC: ${p.sac_tamano_muestra}${p.sac_referencia ? ` (${p.sac_referencia})` : ""}.`,
      p.clas_codigo ? `Clasificación: ${p.clas_codigo} · ${textoClasificacion({ explosiva: p.clas_explosiva, claseDivision: p.clas_clase, grupoCompatibilidad: p.clas_grupo, numeroOnu: p.clas_onu })}.` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const ot = await this.prisma.$transaction(async (tx) => {
      const bloqueada = await tx.$queryRawUnsafe<{ ot_id: string | null }[]>(
        `SELECT ot_id FROM bpch_prototipo WHERE id = $1::uuid FOR UPDATE`,
        id,
      );
      if ((bloqueada[0]?.ot_id ?? null) !== (p.ot_id ?? null)) throw new ConflictException("El prototipo cambió: vuelva a cargarlo.");
      const creada = await this.comun.crearOt(tx, {
        tenantId,
        usuarioId,
        clienteId: p.cliente_id,
        unidad,
        origen: "PROTOTIPO",
        conCobro: d.conCobro,
        resolucion: p.solicitud_dgmn,
        descripcion,
        elementoGenerico: p.elemento,
        detalleHistorial: { prototipoId: p.id, prototipo: p.codigo, anteriorOt: p.ot_id ? { id: p.ot_id, codigo: p.ot_codigo } : null },
      });
      await tx.$executeRawUnsafe(
        `UPDATE bpch_prototipo SET ot_id = $2::uuid, unidad_id = $3::uuid, ot_generada_por = $4::uuid, ot_generada_at = now(),
                estado = 'en_evaluacion', updated_at = now() WHERE id = $1::uuid`,
        id,
        creada.id,
        unidad.id,
        usuarioId,
      );
      return creada;
    });
    return { ot, prototipo: await this.detalle(tenantId, id) };
  }

  /**
   * Dictamen del tipo y emisión de su documento por el circuito de firmas
   * (plantilla PROTO-APR / PROTO-REC). El dictamen se guarda antes de emitir
   * (la plantilla lo lee) y se revierte si la emisión no procede.
   */
  async dictaminar(req: any, tenantId: string, usuarioId: string | null, id: string, body: unknown) {
    const d = DictamenDto.parse(body ?? {});
    const p = await this.fila(tenantId, id);
    await this.exigirAlcancePrototipo(req, p);
    const otViva = p.ot_id && p.ot_estado !== "anulada";
    const resultados = otViva ? await this.comun.resultadosDeOt(p.ot_id) : [];
    const faltan = faltantesDictamen({
      estado: p.estado,
      otId: otViva ? p.ot_id : null,
      dictamen: d.dictamen,
      motivo: d.motivo,
      totalResultados: resultados.length,
      aprobados: resultados.filter((r) => r.estado === "aprobado").length,
      veredicto: veredictoOt(resultados),
      clasificacionEstado: p.clas_estado ?? null,
      documentoVigente: ["en_firma", "oficial", "emitido", "devuelto"].includes(p.doc_estado ?? ""),
    });
    if (faltan.length) throw new ConflictException(`No se puede dictaminar. ${faltan.join(" ")}`);
    const doc = DOCUMENTO_DICTAMEN[d.dictamen as Dictamen];
    const plantilla = await this.prisma.plantillaInforme.findFirst({
      where: { tenantId, repid: doc.repid, deletedAt: null },
      select: { id: true },
    });
    if (!plantilla) throw new ConflictException(`Falta la plantilla ${doc.repid} (align_bpch_pn_prototipos_clasificacion.sql).`);

    const previo = { estado: p.estado, dictamen: p.dictamen, motivo: p.dictamen_motivo, por: p.dictamen_por, at: p.dictamen_at, documento: p.documento_id };
    // El dictamen se «toma» con la fila del prototipo bloqueada: solo sigue quien
    // la encuentra igual que cuando comprobó las condiciones. Un segundo dictamen
    // simultáneo (p. ej. aprobado y rechazado a la vez) recibe 409 y no emite otro
    // documento (revisión r3, hallazgo 11).
    await this.prisma.$transaction(async (tx) => {
      const [actual] = await tx.$queryRawUnsafe<{ estado: string; dictamen: string | null; documento_id: string | null; mismo_at: boolean }[]>(
        `SELECT estado, dictamen, documento_id,
                (date_trunc('milliseconds', dictamen_at) IS NOT DISTINCT FROM $2::timestamptz) AS mismo_at
           FROM bpch_prototipo WHERE id = $1::uuid FOR UPDATE`,
        id,
        previo.at ?? null,
      );
      if (
        !actual ||
        actual.estado !== previo.estado ||
        (actual.dictamen ?? null) !== (previo.dictamen ?? null) ||
        (actual.documento_id ?? null) !== (previo.documento ?? null) ||
        !actual.mismo_at
      )
        throw new ConflictException("Otra persona acaba de dictaminar este prototipo: vuelva a cargarlo.");
      await tx.$executeRawUnsafe(
        `UPDATE bpch_prototipo SET dictamen = $2, dictamen_motivo = $3, dictamen_por = $4::uuid, dictamen_at = now(), updated_at = now() WHERE id = $1::uuid`,
        id,
        d.dictamen,
        d.motivo ?? null,
        usuarioId,
      );
    });
    let emitido: Awaited<ReturnType<PlantillaRenderService["emitir"]>>;
    try {
      emitido = await this.render.emitir(p.ot_id, plantilla.id, tenantId, usuarioId ?? undefined, { tipoDocumento: doc.tipoDocumento });
    } catch (e) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE bpch_prototipo SET estado = $2, dictamen = $3, dictamen_motivo = $4, dictamen_por = $5::uuid, dictamen_at = $6, updated_at = now() WHERE id = $1::uuid`,
        id,
        previo.estado,
        previo.dictamen,
        previo.motivo,
        previo.por,
        previo.at,
      );
      throw e;
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_prototipo SET estado = 'dictaminado', documento_id = $2::uuid, updated_at = now() WHERE id = $1::uuid`,
      id,
      emitido.certificado.id,
    );
    return {
      documento: { id: emitido.certificado.id, numero: emitido.numero, estado: emitido.estado, tipoDocumento: emitido.tipoDocumento, pasos: emitido.pasos },
      avisos: emitido.avisos,
      prototipo: await this.detalle(tenantId, id),
    };
  }

  /** Alcance sobre la unidad ACTUAL de la OT del prototipo (o la de su alta si no hay OT). */
  private async exigirAlcancePrototipo(req: any, p: any) {
    const id = p.ot_unidad ?? p.unidad_id;
    if (!id) return;
    await this.comun.exigirOperarEnUnidad(req, {
      id,
      codigo: p.ot_unidad ? p.ot_unidad_codigo : p.unidad_codigo,
      nombre: p.ot_unidad ? p.ot_unidad_nombre : p.unidad_nombre,
      tipo: null,
    });
  }

  /** Código único CNC-DGMN del tipo aprobado (cuando su certificado es oficial). */
  async registrarCodigo(req: any, tenantId: string, usuarioId: string | null, id: string, body: unknown) {
    const { codigo } = CodigoCnc.parse(body ?? {});
    const p = await this.fila(tenantId, id);
    await this.exigirAlcancePrototipo(req, p);
    if (p.dictamen !== "aprobado" || p.estado !== "dictaminado")
      throw new ConflictException("Solo un prototipo aprobado recibe código único.");
    if (p.doc_estado !== "oficial" && p.doc_estado !== "emitido")
      throw new ConflictException("El certificado de aprobación de tipo aún no es oficial (falta su firma).");
    const error = validarCodigoCnc(codigo);
    if (error) throw new BadRequestException(error);
    const dup = await this.prisma.$queryRawUnsafe<{ codigo: string }[]>(
      `SELECT codigo FROM bpch_prototipo WHERE tenant_id = $1::uuid AND codigo_cnc = $2 AND id <> $3::uuid`,
      tenantId,
      codigo.trim(),
      id,
    );
    if (dup[0]) throw new ConflictException(`El código ${codigo.trim()} ya está asignado al prototipo ${dup[0].codigo}.`);
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_prototipo SET codigo_cnc = $2, codigo_cnc_por = $3::uuid, codigo_cnc_at = now(), updated_at = now() WHERE id = $1::uuid`,
      id,
      codigo.trim(),
      usuarioId,
    );
    return this.detalle(tenantId, id);
  }

  async anular(tenantId: string, usuarioId: string | null, id: string, body: unknown) {
    const { motivo } = Motivo.parse(body ?? {});
    const p = await this.fila(tenantId, id);
    if (p.estado === "anulado") throw new ConflictException("El prototipo ya está anulado.");
    if (p.estado === "dictaminado") throw new ConflictException("El prototipo tiene dictamen: anule su documento si corresponde.");
    if (p.ot_id && p.ot_estado !== "anulada")
      throw new ConflictException(`El prototipo tiene la OT ${p.ot_codigo} vigente: anúlela antes.`);
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_prototipo SET estado = 'anulado', anulado_motivo = $2, anulado_por = $3::uuid, anulado_at = now(), updated_at = now() WHERE id = $1::uuid`,
      id,
      motivo,
      usuarioId,
    );
    return this.detalle(tenantId, id);
  }

  /* ------------------------------------------ 8.11 · parametrizar el elemento --- */

  /** Parámetro de la operación: ¿la OT exige la parametrización validada? (por confirmar, EP-08 P4). */
  private async exigeParametrizacion(tenantId: string) {
    const [f] = await this.prisma.$queryRawUnsafe<{ valor: string | null; activo: boolean }[]>(
      `SELECT valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'bpch_prototipo' AND codigo = 'exige_parametrizacion'`,
      tenantId,
    );
    return f?.activo !== false && f?.valor === "si";
  }

  private async parametrizacion(tenantId: string, p: any) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT pp.cat_metodo_id AS "metodoId", m.codigo AS "metodoCodigo", m.nombre AS "metodoNombre", pp.ensayo,
              pp.minimo::float8 AS minimo, pp.nominal::float8 AS nominal, pp.maximo::float8 AS maximo, pp.unidad, pp.formula, pp.tipo_formula AS "tipoFormula"
         FROM bpch_prototipo_parametro pp JOIN cat_metodo m ON m.id = pp.cat_metodo_id
        WHERE pp.prototipo_id = $1::uuid AND pp.tenant_id = $2::uuid ORDER BY pp.orden`,
      p.id,
      tenantId,
    );
    const nombres = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT u1.nombre_completo AS enviada, u2.nombre_completo AS validada FROM bpch_prototipo b
         LEFT JOIN usuario u1 ON u1.id = b.param_enviada_por LEFT JOIN usuario u2 ON u2.id = b.param_validada_por WHERE b.id = $1::uuid`,
      p.id,
    );
    return {
      estado: p.param_estado as EstadoParametrizacion,
      estadoNombre: NOMBRE_ESTADO_PARAMETRIZACION[p.param_estado as EstadoParametrizacion] ?? p.param_estado,
      exigeParaOt: await this.exigeParametrizacion(tenantId),
      filas,
      enviada: p.param_enviada_at ? { por: nombres[0]?.enviada ?? null, at: p.param_enviada_at } : null,
      validada: p.param_validada_at ? { por: nombres[0]?.validada ?? null, at: p.param_validada_at } : null,
      devueltaMotivo: p.param_devuelta_motivo ?? null,
    };
  }

  private estadoParam(p: any, usuario: string | null, accion: "editar" | "enviar" | "validar" | "devolver", filas: number, motivo?: string | null) {
    const f = faltantesParametrizacion(accion, {
      prototipoEstado: p.estado,
      otViva: Boolean(p.ot_id && p.ot_estado !== "anulada"),
      estado: p.param_estado,
      filas,
      enviadaPor: p.param_enviada_por ?? null,
      usuario,
      motivo,
    });
    if (f.length) throw new ConflictException(f.join(" "));
  }

  async guardarParametros(tenantId: string, usuarioId: string | null, id: string, body: unknown) {
    const d = ParametrosBody.parse(body ?? {});
    const p = await this.fila(tenantId, id);
    this.estadoParam(p, usuarioId, "editar", d.filas.length);
    const errores = erroresParametros(d.filas);
    if (d.filas.length && errores.length) throw new BadRequestException(errores.join(" "));
    if (d.filas.length) {
      const metodos = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM cat_metodo WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[])`,
        tenantId,
        [...new Set(d.filas.map((x) => x.metodoId))],
      );
      if (metodos.length !== new Set(d.filas.map((x) => x.metodoId)).size) throw new BadRequestException("Algún método no existe en el catálogo.");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM bpch_prototipo_parametro WHERE prototipo_id = $1::uuid AND tenant_id = $2::uuid`, id, tenantId);
      let orden = 0;
      for (const x of d.filas)
        await tx.$executeRawUnsafe(
          `INSERT INTO bpch_prototipo_parametro (tenant_id, prototipo_id, orden, cat_metodo_id, ensayo, minimo, nominal, maximo, unidad, formula, tipo_formula)
           VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8, $9, $10, $11)`,
          tenantId,
          id,
          orden++,
          x.metodoId,
          x.ensayo,
          x.minimo ?? null,
          x.nominal ?? null,
          x.maximo ?? null,
          x.unidad || null,
          x.formula || null,
          x.formula ? x.tipoFormula ?? null : null,
        );
      await tx.$executeRawUnsafe(
        `UPDATE bpch_prototipo SET param_estado = CASE WHEN $2 > 0 THEN (CASE WHEN param_estado = 'devuelta' THEN 'devuelta' ELSE 'borrador' END) ELSE 'sin_parametros' END,
                updated_at = now() WHERE id = $1::uuid`,
        id,
        d.filas.length,
      );
    });
    return this.detalle(tenantId, id);
  }

  async enviarParametros(tenantId: string, usuarioId: string | null, id: string) {
    const p = await this.fila(tenantId, id);
    const [{ n }] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM bpch_prototipo_parametro WHERE prototipo_id = $1::uuid`, id);
    this.estadoParam(p, usuarioId, "enviar", n);
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_prototipo SET param_estado = 'en_validacion', param_enviada_por = $2::uuid, param_enviada_at = now(), param_devuelta_motivo = NULL, updated_at = now() WHERE id = $1::uuid`,
      id,
      usuarioId,
    );
    return this.detalle(tenantId, id);
  }

  async validarParametros(tenantId: string, usuarioId: string | null, id: string) {
    const p = await this.fila(tenantId, id);
    this.estadoParam(p, usuarioId, "validar", 1);
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_prototipo SET param_estado = 'validada', param_validada_por = $2::uuid, param_validada_at = now(), updated_at = now() WHERE id = $1::uuid`,
      id,
      usuarioId,
    );
    return this.detalle(tenantId, id);
  }

  async devolverParametros(tenantId: string, usuarioId: string | null, id: string, body: unknown) {
    const { motivo } = Motivo.parse(body ?? {});
    const p = await this.fila(tenantId, id);
    this.estadoParam(p, usuarioId, "devolver", 1, motivo);
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_prototipo SET param_estado = 'devuelta', param_devuelta_motivo = $2, updated_at = now() WHERE id = $1::uuid`,
      id,
      motivo,
    );
    return this.detalle(tenantId, id);
  }

  /**
   * «El panel es el que carga la OT»: la especificación validada (Mín/Nom/Máx,
   * unidad, fórmula) se aplica a los resultados de la OT del mismo método y
   * ensayo. Lo hace la jefatura de la unidad de la OT (el flujo general exige
   * resultado.aprobar para cambiar lo que vino del catálogo).
   */
  async aplicarParametros(req: any, tenantId: string, id: string) {
    // La jefatura (resultado.aprobar) aplica la parametrización a mano; al registrar la
    // muestra de la OT ya se aplica sola (B-008, flujo-real · aplicarParametrizacionPrototipo).
    if (!(req?.user?.roles ?? []).includes("SUPERADMIN") && !(req?.user?.permisos ?? []).includes("resultado.aprobar"))
      throw new ForbiddenException("La parametrización la aplica la jefatura de la unidad de la OT.");
    const p = await this.fila(tenantId, id);
    if (p.param_estado !== "validada") throw new ConflictException("La parametrización no está validada.");
    if (!p.ot_id || p.ot_estado === "anulada") throw new ConflictException("El prototipo no tiene OT vigente.");
    const params = (await this.parametrizacion(tenantId, p)).filas;
    const resultados = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id, r.estado, r.cat_metodo_id, COALESCE(an.nombre, an.codigo, '') AS analito
         FROM resultado r LEFT JOIN cat_analito an ON an.id = r.cat_analito_id
        WHERE r.ot_id = $1::uuid AND r.deleted_at IS NULL`,
      p.ot_id,
    );
    const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    let aplicados = 0;
    for (const r of resultados) {
      if (["revisado_n1", "aprobado"].includes(r.estado)) continue;
      const delMetodo = params.filter((x: any) => x.metodoId === r.cat_metodo_id);
      const par = delMetodo.length === 1 ? delMetodo[0] : delMetodo.find((x: any) => norm(x.ensayo) === norm(r.analito));
      if (!par) continue;
      await this.puente.editarEspecificacion(
        r.id,
        {
          limiteInf: textoLimite(par.minimo),
          nominal: textoLimite(par.nominal),
          limiteSup: textoLimite(par.maximo),
          unidad: par.unidad ?? undefined,
          ...(par.formula ? { formula: par.formula } : {}),
          motivo: `Parametrización validada del prototipo ${p.codigo} (EP-08 8.11)`,
        } as any,
        tenantId,
        req,
      );
      aplicados++;
    }
    if (!aplicados) throw new ConflictException("Ningún resultado de la OT coincide con el panel parametrizado (registre primero la muestra con esos métodos).");
    return { aplicados, prototipo: await this.detalle(tenantId, id) };
  }

  /** 8.17 · inscripción del tipo en la Codificación Única (si ya existe) y lo que falta para hacerla. */
  private async inscripcionCu(tenantId: string, p: any) {
    const fila = p.codigo_cnc
      ? (
          await this.prisma.$queryRawUnsafe<any[]>(
            `SELECT id, cnc_dgmn AS cnc, listado, estado FROM bpch_codificacion
              WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND cnc_normalizado = $2 LIMIT 1`,
            tenantId,
            normalizarCnc(p.codigo_cnc),
          )
        )[0]
      : null;
    return {
      inscrito: fila ?? null,
      faltantes: faltantesInscripcionCu({ estado: p.estado, dictamen: p.dictamen, documentoEstado: p.doc_estado, codigoCnc: p.codigo_cnc, yaInscrito: !!fila }),
    };
  }

  /** 8.8 · ficha técnica u hoja de datos de seguridad (PDF/PNG/JPEG). No con el prototipo anulado. */
  async adjuntar(tenantId: string, id: string, usuarioId: string | null, clase: string, archivo: ArchivoAdjunto | undefined) {
    if (!CLASES_ADJUNTO_PROTOTIPO.includes(clase as any)) throw new BadRequestException("Tipo de adjunto no admitido (ficha técnica u hoja de seguridad).");
    const p = await this.fila(tenantId, id);
    if (p.estado === "anulado") throw new ConflictException("El prototipo está anulado.");
    return guardarAdjunto(this.prisma as any, { tenantId, entidad: "prototipo", entidadId: id, clase, archivo, usuarioId });
  }

  async adjunto(tenantId: string, id: string, adjuntoId: string) {
    const a = await leerAdjunto(this.prisma as any, tenantId, ["prototipo"], adjuntoId);
    if (a.entidadId !== id) throw new NotFoundException("Adjunto no encontrado.");
    return a;
  }

  /** Datos de origen de una OT de prototipo (para el expediente de la OT). */
  async origenDeOt(otId: string) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(`${SELECT} WHERE p.ot_id = $1::uuid`, otId);
    return filas[0] ? this.resumen(filas[0]) : null;
  }
}
