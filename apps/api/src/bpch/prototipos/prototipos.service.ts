import {
  BadRequestException,
  ConflictException,
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
import {
  DOCUMENTO_DICTAMEN,
  PLANTILLAS_PROTOTIPO,
  etapaPrototipo,
  faltantesDictamen,
  faltantesGenerarOt,
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

  async listar(tenantId: string, f: { q?: string; estado?: string }) {
    const args: unknown[] = [tenantId];
    const where = ["p.tenant_id = $1::uuid"];
    if (f.q?.trim()) {
      args.push(`%${f.q.trim()}%`);
      where.push(`(p.codigo ILIKE $2 OR p.elemento ILIKE $2 OR cl.razon_social ILIKE $2 OR cl.rut ILIKE $2 OR p.solicitud_dgmn ILIKE $2)`);
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
      anulado: p.anulado_at ? { motivo: p.anulado_motivo, at: p.anulado_at } : null,
      faltantes: {
        generarOt: faltantesGenerarOt({
          estado: p.estado,
          otId: p.ot_id,
          otEstado: p.ot_estado,
          sacTamanoMuestra: p.sac_tamano_muestra,
          unidadId: "-", // la unidad y el cobro se eligen al generar
          conCobro: true,
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

  async crear(tenantId: string, usuarioId: string | null, body: unknown) {
    const d = CrearPrototipo.parse(body ?? {});
    await this.validarRefs(tenantId, d);
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

  /** Datos de origen de una OT de prototipo (para el expediente de la OT). */
  async origenDeOt(otId: string) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(`${SELECT} WHERE p.ot_id = $1::uuid`, otId);
    return filas[0] ? this.resumen(filas[0]) : null;
  }
}
