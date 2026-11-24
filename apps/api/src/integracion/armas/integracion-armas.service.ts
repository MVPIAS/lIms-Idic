/**
 * Integración asíncrona con el software de armas del BPCH (docs/INTEGRACION_ARMAS_BPCH.md).
 *
 *   · Salida: la OT se encola (integracion_armas_envio) y un trabajador la envía
 *     a POST {url_base}/api/v1/integracion/lims/ordenes-trabajo con el token del
 *     BPCH (BPCH_ARMAS_TOKEN) y X-Idempotency-Key. 201/409 → enviada; 400 → error
 *     sin reintento (aviso); 5xx/red → reintento con espera exponencial.
 *   · Entrada: un mismo manejador (`recibirEstado`) para el webhook firmado con
 *     HMAC, el POST directo con token de integración y la consulta periódica.
 *     Registra el estado externo, el historial, el PDF (documento_cierre) como
 *     adjunto de la OT y avisa en Mi bandeja a la D11 y a Comercial.
 *   · Nunca cierra ni anula la OT del LIMS (decisión pendiente del IDIC).
 */
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "../../common/prisma.service";
import { AvisosService } from "../../avisos/avisos.service";
import { alEvento } from "../../common/eventos";
import { guardarAdjunto, listarAdjuntos, type ArchivoAdjunto } from "../../common/adjuntos";
import {
  RUTA_CREAR_OT,
  bpchIdDe,
  clasificarRespuesta,
  configArmas,
  construirPayload,
  cuerpoSinBase64,
  efectoEstado,
  esperaReintentoMs,
  firmarEnlace,
  idEvento,
  leerEvento,
  nombrePdf,
  pdfDeBase64,
  rutaDescargaAdjunto,
  rutaEstadoOt,
  hostsPermitidos,
  leerEnlaces,
  rutaEnlaces,
  urlBaseLims,
  urlBaseValida,
  validarUrlEnlace,
  verificarEnlace,
  type ConfigArmas,
  type DatosOtArmas,
  type EnlaceRecibido,
  type EventoEstado,
} from "./reglas-armas";

/** Entidad con que se guardan en registro_adjunto los archivos de la integración. */
export const ENTIDAD_ADJUNTO = "integracion_armas_ot";
const UN_MINUTO = 60_000;

export type OrigenEvento = "webhook" | "post" | "pull";

export interface DatosManuales {
  tipoOrden?: 1 | 2;
  resolucionNumero?: string;
  resolucionFecha?: string;
  solicitanteRut?: string;
  solicitanteEmail?: string;
  cantidadArmas?: number;
  observaciones?: string;
}

type Fetch = typeof fetch;

@Injectable()
export class IntegracionArmasService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(IntegracionArmasService.name);
  private relojEnvio: NodeJS.Timeout | null = null;
  private relojPull: NodeJS.Timeout | null = null;
  private bajas: (() => void)[] = [];
  private ocupado = false;
  /** Se sustituye en las pruebas. */
  fetcher: Fetch = (...a) => fetch(...a);
  env: NodeJS.ProcessEnv = process.env;

  constructor(
    private readonly prisma: PrismaService,
    private readonly avisos: AvisosService,
  ) {}

  onModuleInit() {
    this.bajas.push(alEvento("ot.creada", (d) => this.alCrearOt(d.otId, d.tenantId, d.usuarioId)));
    if (this.env.NODE_ENV !== "test" && this.env.INTEGRACION_ARMAS_TRABAJADOR !== "false") {
      this.relojEnvio = setInterval(() => void this.procesarCola().catch((e) => this.log.warn(`cola de envíos: ${e?.message ?? e}`)), UN_MINUTO);
      this.relojEnvio.unref?.();
      this.relojPull = setInterval(() => void this.consultarEstados().catch((e) => this.log.warn(`consulta de estados: ${e?.message ?? e}`)), UN_MINUTO);
      this.relojPull.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.relojEnvio) clearInterval(this.relojEnvio);
    if (this.relojPull) clearInterval(this.relojPull);
    this.bajas.forEach((b) => b());
  }

  /* ------------------------------------------------------------ parámetros --- */

  async config(tenantId: string): Promise<ConfigArmas> {
    const filas = await this.prisma
      .$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
        `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'integracion_armas'`,
        tenantId,
      )
      .catch(() => []);
    return configArmas(filas);
  }

  private secretoEnlace(): string {
    const base = this.env.JWT_SECRET ?? "";
    if (!base) throw new ServiceUnavailableException("JWT_SECRET no está configurado.");
    return createHash("sha256").update(`armas-enlace|${base}`).digest("hex");
  }

  /* ------------------------------------------------------------ datos de la OT --- */

  private async ot(tenantId: string, otId: string) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ot.id, ot.codigo, ot.tenant_id AS "tenantId", ot.descripcion_trabajo AS "descripcion",
              u.codigo AS "unidad", c.rut AS "clienteRut", COALESCE(NULLIF(c.contacto_email, ''), c.email::text) AS "clienteEmail",
              bi.resolucion_numero AS "resolucionNumero", bi.resolucion_fecha AS "resolucionFecha", bi.id AS "internacionId",
              (SELECT COALESCE(SUM(r.cantidad), 0)::int FROM d11_resolucion_arma r WHERE r.internacion_id = bi.id) AS "armasResolucion",
              (SELECT COUNT(*)::int FROM d11_arma_ot a WHERE a.ot_id = ot.id) AS "armasOt"
         FROM orden_trabajo ot
         JOIN cliente c ON c.id = ot.cliente_id
         LEFT JOIN unidad u ON u.id = ot.unidad_principal
         LEFT JOIN LATERAL (SELECT * FROM bpch_internacion b WHERE b.ot_id = ot.id ORDER BY b.created_at DESC LIMIT 1) bi ON TRUE
        WHERE ot.id = $1::uuid AND ot.tenant_id = $2::uuid`,
      otId,
      tenantId,
    );
    if (!f[0]) throw new NotFoundException("OT no encontrada.");
    return f[0] as {
      id: string;
      codigo: string;
      tenantId: string;
      descripcion: string | null;
      unidad: string | null;
      clienteRut: string | null;
      clienteEmail: string | null;
      resolucionNumero: string | null;
      resolucionFecha: Date | null;
      internacionId: string | null;
      armasResolucion: number;
      armasOt: number;
    };
  }

  /** Datos con que se construye el envío: los de la OT, corregibles a mano. */
  async datosEnvio(tenantId: string, otId: string, manual: DatosManuales = {}): Promise<DatosOtArmas> {
    const o = await this.ot(tenantId, otId);
    const adjuntos = await this.enlacesAdjuntos(tenantId, otId);
    return {
      limsOtId: o.codigo,
      tipoOrden: manual.tipoOrden ?? (o.internacionId ? 2 : 1),
      resolucionNumero: manual.resolucionNumero ?? o.resolucionNumero,
      resolucionFecha: manual.resolucionFecha ?? o.resolucionFecha,
      solicitanteRut: manual.solicitanteRut ?? o.clienteRut,
      solicitanteEmail: manual.solicitanteEmail ?? o.clienteEmail,
      // El LIMS no guarda el RUT de sus usuarios: por confirmar (ver la guía).
      creadorRut: null,
      cantidadArmas: manual.cantidadArmas ?? (o.armasResolucion || o.armasOt || null),
      observaciones: manual.observaciones ?? o.descripcion,
      adjuntos,
    };
  }

  /** Enlaces firmados (con vencimiento) de los PDF que se mandan con la OT. */
  private async enlacesAdjuntos(tenantId: string, otId: string) {
    const cfg = await this.config(tenantId);
    const filas = (await listarAdjuntos(this.prisma as any, tenantId, ENTIDAD_ADJUNTO, [otId])).filter((a: any) => a.clase === "resolucion");
    const expira = Date.now() / 1000 + cfg.vigenciaEnlaceHoras * 3600;
    const base = urlBaseLims(this.env);
    return filas.map((a: any) => ({ nombre: a.nombre as string, url: base + rutaDescargaAdjunto(firmarEnlace(a.id, expira, this.secretoEnlace())) }));
  }

  /* ------------------------------------------------------------------ salida --- */

  /** Vista previa del JSON que se enviaría y sus errores (no envía nada). */
  async previsualizar(tenantId: string, otId: string, manual: DatosManuales = {}) {
    const cfg = await this.config(tenantId);
    const r = construirPayload(await this.datosEnvio(tenantId, otId, manual), cfg.rutConDv);
    return { ...r, config: { activa: cfg.activa, urlBaseConfigurada: !!cfg.urlBase, tokenConfigurado: !!this.env.BPCH_ARMAS_TOKEN } };
  }

  /** Encola el envío de la OT. Idempotente: si ya hay un envío vivo, lo devuelve. */
  async encolar(tenantId: string, otId: string, usuarioId: string | null, manual: DatosManuales = {}) {
    const cfg = await this.config(tenantId);
    const { payload, errores } = construirPayload(await this.datosEnvio(tenantId, otId, manual), cfg.rutConDv);
    if (!payload) throw new BadRequestException({ message: "La OT no se puede enviar al software de armas.", errores });

    const vivo = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, estado FROM integracion_armas_envio WHERE ot_id = $1::uuid AND tipo = 'crear_ot' AND estado IN ('pendiente', 'enviado')`,
      otId,
    );
    if (vivo[0]) return { envioId: vivo[0].id, estado: vivo[0].estado, yaExistia: true };

    const dup = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ot_id FROM integracion_armas_ot WHERE tenant_id = $1::uuid AND lims_ot_id = $2 AND ot_id <> $3::uuid`,
      tenantId,
      payload.lims_ot_id,
      otId,
    );
    if (dup[0]) throw new BadRequestException("Otra OT ya se envió con ese mismo código.");

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO integracion_armas_ot (ot_id, tenant_id, lims_ot_id, tipo_orden, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid)
       ON CONFLICT (ot_id) DO UPDATE SET lims_ot_id = EXCLUDED.lims_ot_id, tipo_orden = EXCLUDED.tipo_orden, updated_at = now()`,
      otId,
      tenantId,
      payload.lims_ot_id,
      payload.tipo_orden,
      usuarioId,
    );
    const f = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO integracion_armas_envio (tenant_id, ot_id, tipo, payload, creado_por) VALUES ($1::uuid, $2::uuid, 'crear_ot', $3::jsonb, $4::uuid) RETURNING id`,
      tenantId,
      otId,
      JSON.stringify(payload),
      usuarioId,
    );
    await this.historialOt(tenantId, otId, "integracion_armas", { accion: "encolado", envioId: f[0].id }, usuarioId);
    return { envioId: f[0].id, estado: "pendiente", yaExistia: false };
  }

  /** Envío automático al crear la OT (parámetros activa + enviar_automatico + unidad). */
  private async alCrearOt(otId: string, tenantId: string, usuarioId: string | null) {
    try {
      const cfg = await this.config(tenantId);
      if (!cfg.activa || !cfg.enviarAutomatico) return;
      const o = await this.ot(tenantId, otId);
      if (!o.unidad || !cfg.unidades.includes(o.unidad.toUpperCase())) return;
      await this.encolar(tenantId, otId, usuarioId);
    } catch (e: any) {
      this.log.warn(`OT ${otId} no se encoló para el software de armas: ${e?.response?.errores?.join(" ") ?? e?.message ?? e}`);
    }
  }

  /** Reintenta un envío en error o descartado (vuelve a pendiente, intentos a 0). */
  async reintentar(tenantId: string, envioId: string) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `UPDATE integracion_armas_envio SET estado = 'pendiente', intentos = 0, proximo_intento_at = now(), ultimo_error = NULL, updated_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND estado IN ('error', 'descartado') RETURNING id`,
      envioId,
      tenantId,
    );
    if (!f[0]) throw new BadRequestException("Solo se reintenta un envío en error o descartado.");
    return { envioId, estado: "pendiente" };
  }

  /** Recorre la cola: envíos pendientes cuya hora llegó, de los tenants con la integración activa. */
  async procesarCola(limite = 20): Promise<{ procesados: number }> {
    if (this.ocupado) return { procesados: 0 };
    this.ocupado = true;
    try {
      const filas = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, tenant_id AS "tenantId", ot_id AS "otId", payload, intentos
           FROM integracion_armas_envio WHERE estado = 'pendiente' AND proximo_intento_at <= now()
          ORDER BY proximo_intento_at LIMIT $1`,
        limite,
      );
      let n = 0;
      for (const f of filas) {
        const cfg = await this.config(f.tenantId);
        if (!cfg.activa) continue;
        await this.enviarUno(f, cfg);
        n++;
      }
      return { procesados: n };
    } finally {
      this.ocupado = false;
    }
  }

  private async enviarUno(f: { id: string; tenantId: string; otId: string; payload: any; intentos: number }, cfg: ConfigArmas) {
    const token = this.env.BPCH_ARMAS_TOKEN?.trim();
    const idem = await this.prisma.$queryRawUnsafe<{ k: string }[]>(`SELECT idempotency_key::text AS k FROM integracion_armas_ot WHERE ot_id = $1::uuid`, f.otId);
    if (!cfg.urlBase || !urlBaseValida(cfg.urlBase) || !token) {
      await this.marcarEnvio(f.id, "error", f.intentos, null, null, "Falta la dirección del BPCH (parámetro url_base) o el token BPCH_ARMAS_TOKEN.");
      return;
    }
    let status: number | null = null;
    let respuesta: any = null;
    let error: string | null = null;
    try {
      const r = await this.fetcher(cfg.urlBase + RUTA_CREAR_OT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Idempotency-Key": idem[0]?.k ?? randomUUID(),
        },
        body: JSON.stringify(f.payload),
        signal: AbortSignal.timeout(20_000),
      });
      status = r.status;
      const texto = await r.text();
      try {
        respuesta = texto ? JSON.parse(texto) : null;
      } catch {
        respuesta = { texto: texto.slice(0, 2000) };
      }
    } catch (e: any) {
      error = `Sin respuesta del BPCH: ${e?.message ?? e}`;
    }
    const intentos = f.intentos + 1;
    const clase = clasificarRespuesta(status);
    if (clase === "enviado" || clase === "duplicado") {
      await this.marcarEnvio(f.id, "enviado", intentos, status, respuesta, null);
      const bpchId = bpchIdDe(respuesta);
      const inicial = Number(respuesta?.data?.estado_inicial);
      await this.prisma.$executeRawUnsafe(
        `UPDATE integracion_armas_ot SET bpch_id = COALESCE($2, bpch_id), enviado_at = COALESCE(enviado_at, now()), ultimo_error = NULL,
                estado_externo = COALESCE(estado_externo, $3), estado_descripcion = COALESCE(estado_descripcion, $4), updated_at = now()
          WHERE ot_id = $1::uuid`,
        f.otId,
        bpchId,
        Number.isInteger(inicial) && inicial > 0 ? inicial : 1,
        respuesta?.data?.estado_descripcion ?? "Pendiente",
      );
      await this.historialOt(f.tenantId, f.otId, "integracion_armas", { accion: clase === "duplicado" ? "ya_registrada" : "enviada", bpchId, http: status }, null);
      return;
    }
    const detalle = error ?? `HTTP ${status}: ${JSON.stringify(respuesta?.detalles ?? respuesta?.mensaje ?? respuesta?.error ?? respuesta).slice(0, 1500)}`;
    if (clase === "rechazado" || intentos >= cfg.maxIntentos) {
      await this.marcarEnvio(f.id, "error", intentos, status, respuesta, detalle);
      await this.prisma.$executeRawUnsafe(`UPDATE integracion_armas_ot SET ultimo_error = $2, updated_at = now() WHERE ot_id = $1::uuid`, f.otId, detalle);
      await this.avisar(f.tenantId, f.otId, "rechazo", `El BPCH no aceptó la OT: ${detalle}`, `envio:${f.id}:${intentos}`);
      return;
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE integracion_armas_envio SET intentos = $2, http_status = $3, respuesta = $4::jsonb, ultimo_error = $5,
              proximo_intento_at = now() + ($6::int * interval '1 millisecond'), updated_at = now() WHERE id = $1::uuid`,
      f.id,
      intentos,
      status,
      respuesta === null ? null : JSON.stringify(respuesta),
      detalle,
      esperaReintentoMs(intentos),
    );
  }

  private async marcarEnvio(id: string, estado: string, intentos: number, status: number | null, respuesta: any, error: string | null) {
    await this.prisma.$executeRawUnsafe(
      `UPDATE integracion_armas_envio SET estado = $2, intentos = $3, http_status = $4, respuesta = $5::jsonb, ultimo_error = $6,
              enviado_at = CASE WHEN $2 = 'enviado' THEN now() ELSE enviado_at END, updated_at = now() WHERE id = $1::uuid`,
      id,
      estado,
      intentos,
      status,
      respuesta === null || respuesta === undefined ? null : JSON.stringify(respuesta),
      error,
    );
  }

  /* ------------------------------------------------------------------ entrada --- */

  /**
   * Institución que recibe un aviso sin sesión (webhook): la que tiene la
   * integración activa. El LIMS del IDIC es mono-institución.
   */
  private async tenantUnico(): Promise<string> {
    const f = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT DISTINCT tenant_id AS id FROM parametro_sistema
        WHERE categoria = 'integracion_armas' AND codigo = 'activa' AND valor = 'si' AND activo IS NOT FALSE LIMIT 2`,
    );
    if (!f.length) throw new ServiceUnavailableException("La integración con el software de armas está desactivada en el LIMS.");
    if (f.length > 1) throw new ServiceUnavailableException("La integración está activa en más de una institución del LIMS.");
    return f[0].id;
  }

  /**
   * Procesa un aviso de cambio de estado del BPCH (las tres opciones).
   * Devuelve `duplicado: true` si ese evento ya se había procesado.
   */
  async recibirEstado(body: any, origen: OrigenEvento, opts: { tenantId?: string; cabeceraEvento?: string | null; firmaValida?: boolean | null } = {}) {
    const tenantId = opts.tenantId ?? (await this.tenantUnico());
    const cfg = await this.config(tenantId);
    if (!cfg.activa) throw new ServiceUnavailableException("La integración con el software de armas está desactivada en el LIMS.");
    const { evento, errores } = leerEvento(body);
    if (!evento) throw new BadRequestException({ codigo: 400, error: "Error de Validación de Datos", detalles: errores });

    const ot = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ot_id AS "otId", estado_externo AS "estado" FROM integracion_armas_ot
        WHERE tenant_id = $1::uuid AND (lims_ot_id = $2 OR ($3::bigint IS NOT NULL AND bpch_id = $3::bigint))`,
      tenantId,
      evento.ot,
      evento.bpchId,
    );
    const eventoId = idEvento(evento, opts.cabeceraEvento);
    const ins = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO integracion_armas_evento (tenant_id, evento_id, origen, ot_id, ot_externa, estado, payload, firma_valida)
       VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6, $7::jsonb, $8)
       ON CONFLICT (tenant_id, evento_id) DO NOTHING RETURNING id`,
      tenantId,
      eventoId,
      origen,
      ot[0]?.otId ?? null,
      evento.ot,
      evento.estado,
      JSON.stringify(cuerpoSinBase64(body)),
      opts.firmaValida ?? null,
    );
    if (!ins[0]) return { codigo: 200, mensaje: "Evento ya procesado anteriormente", duplicado: true, evento_id: eventoId };
    const filaEvento = ins[0].id;

    if (!ot[0]) {
      // No se guarda: si el BPCH lo reenvía cuando la OT exista, debe procesarse.
      await this.prisma.$executeRawUnsafe(`DELETE FROM integracion_armas_evento WHERE id = $1::uuid`, filaEvento).catch(() => undefined);
      this.log.warn(`aviso del BPCH (${origen}) para una OT desconocida`);
      throw new NotFoundException({ error: "Orden de trabajo no encontrada", ot: evento.ot, mensaje: "No existe en el LIMS una OT enviada con ese identificador." });
    }
    let rechazados: { url: string; motivo: string }[] = [];
    try {
      rechazados = (await this.aplicarEvento(tenantId, ot[0].otId, ot[0].estado, evento, filaEvento, cfg)).enlacesRechazados;
      const nota = rechazados.length ? `Enlaces descartados: ${rechazados.map((x) => x.motivo).join(" | ")}`.slice(0, 2000) : null;
      await this.cerrarEvento(filaEvento, nota, true);
    } catch (e: any) {
      // Se borra para que el BPCH pueda reintentar el mismo evento.
      await this.prisma.$executeRawUnsafe(`DELETE FROM integracion_armas_evento WHERE id = $1::uuid`, filaEvento).catch(() => undefined);
      throw e;
    }
    return {
      codigo: 200,
      mensaje: "Estado de la orden actualizado exitosamente en LIMS",
      evento_id: eventoId,
      ...(rechazados.length ? { enlaces_rechazados: rechazados } : {}),
    };
  }

  private async cerrarEvento(id: string, nota: string | null, procesado: boolean) {
    await this.prisma.$executeRawUnsafe(
      `UPDATE integracion_armas_evento SET procesado_at = CASE WHEN $3 THEN now() ELSE procesado_at END, error = $2 WHERE id = $1::uuid`,
      id,
      nota,
      procesado,
    );
  }

  private async aplicarEvento(tenantId: string, otId: string, anterior: number | null, e: EventoEstado, eventoFila: string, cfg: ConfigArmas) {
    // El acta en PDF primero: si no es un PDF válido, el aviso entero se rechaza (el BPCH lo reintenta).
    // Los certificados por arma NO se guardan: quedan en el BPCH y la OT guarda su enlace.
    let acta: { clase: string; nombre: string; datos: Buffer } | null = null;
    const enlaces = [...e.enlaces];
    if (e.documento) {
      const esActa = e.documento.tipo === "acta_finalizacion";
      if (e.documento.base64 && cfg.guardarActaPdf) {
        const { datos, error } = pdfDeBase64(e.documento.base64);
        if (!datos) throw new BadRequestException({ codigo: 400, error: "Error de Validación de Datos", detalles: [`documento_cierre: ${error}`] });
        acta = { clase: esActa ? "acta_finalizacion" : "documento_bpch", nombre: nombrePdf(e.documento.nombre), datos };
      }
      if (e.documento.url)
        enlaces.push({ tipo: esActa ? "acta" : "otro", etiqueta: e.documento.descripcion ?? e.documento.nombre, numeroSerie: null, idExterno: null, url: e.documento.url });
    }

    // Un estado viejo que llega tarde no pisa a uno más nuevo.
    const actual = await this.prisma.$queryRawUnsafe<{ fecha: Date | null }[]>(`SELECT fecha_estado AS fecha FROM integracion_armas_ot WHERE ot_id = $1::uuid`, otId);
    const fechaNueva = e.fecha ? new Date(e.fecha) : new Date();
    const masNuevo = !actual[0]?.fecha || fechaNueva.getTime() >= new Date(actual[0].fecha).getTime();
    if (masNuevo) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE integracion_armas_ot SET estado_externo = $2, estado_descripcion = $3, motivo = $4, operador_rut = $5, fecha_estado = $6,
                total_certificados = COALESCE($7, total_certificados), bpch_id = COALESCE(bpch_id, $8), updated_at = now()
          WHERE ot_id = $1::uuid`,
        otId,
        e.estado,
        e.descripcion,
        e.motivo,
        e.operadorRut,
        fechaNueva,
        e.totalCertificados,
        e.bpchId,
      );
    }
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO integracion_armas_historial (tenant_id, ot_id, evento_id, estado_anterior, estado_nuevo, estado_descripcion, motivo, operador_rut, fecha_cambio)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9)`,
      tenantId,
      otId,
      eventoFila,
      anterior,
      e.estado,
      e.descripcion,
      e.motivo,
      e.operadorRut,
      fechaNueva,
    );

    let actaId: string | null = null;
    if (acta) {
      const archivo: ArchivoAdjunto = { buffer: acta.datos, originalname: acta.nombre, size: acta.datos.length };
      const g = await guardarAdjunto(this.prisma as any, {
        tenantId,
        entidad: ENTIDAD_ADJUNTO,
        entidadId: otId,
        clase: acta.clase,
        archivo,
        usuarioId: null,
        opciones: { ampliado: true, maxBytes: 15 * 1024 * 1024 },
      });
      actaId = g.id;
    }
    const r = await this.guardarEnlaces(tenantId, otId, enlaces, cfg, "evento");

    await this.historialOt(tenantId, otId, "integracion_armas", {
      accion: "estado_bpch",
      estado: e.estado,
      descripcion: e.descripcion,
      motivo: e.motivo,
      actaPdf: !!actaId,
      enlaces: r.guardados,
      enlacesRechazados: r.rechazados.length,
    }, null);

    const efecto = efectoEstado(e.estado, e.motivo);
    if (efecto === "rechazo") await this.avisar(tenantId, otId, "rechazo", `El BPCH devolvió la OT: ${e.motivo}`, `estado:${eventoFila}`);
    if (efecto === "firmada") await this.avisar(tenantId, otId, "firmada", "El BPCH firmó con FEA los certificados de la OT; pasa a Comercial.", `estado:${eventoFila}`);
    if (efecto === "finalizada") {
      await this.avisar(tenantId, otId, "finalizada", `El BPCH finalizó la OT${e.totalCertificados !== null ? ` (${e.totalCertificados} certificados)` : ""}.`, `estado:${eventoFila}`);
      if (cfg.cerrarOtAlFinalizar) {
        // Punto preparado: el cierre automático de la OT del LIMS espera la decisión del IDIC.
        // Por ahora solo se deja constancia; el cierre lo hace la persona en OT › Informe y cierre.
        await this.historialOt(tenantId, otId, "integracion_armas", { accion: "cierre_solicitado_por_bpch" }, null);
      }
    }
    if (efecto === "anulada") await this.avisar(tenantId, otId, "rechazo", "El BPCH anuló la OT.", `estado:${eventoFila}`);
    // Firmada (2) y finalizada (8): se piden al BPCH los enlaces de los certificados (si hay ruta
    // configurada), en segundo plano para responder al aviso sin esperar.
    if (efecto === "firmada" || efecto === "finalizada")
      setImmediate(() => void this.pedirEnlaces(tenantId, otId).catch((x) => this.log.warn(`enlaces de la OT ${otId}: ${x?.message ?? x}`)));
    return { enlacesRechazados: r.rechazados };
  }

  /**
   * Guarda los enlaces válidos (http/https a un servidor permitido). Uno nuevo
   * para la misma OT, tipo y elemento (serie o id externo) deja al anterior como
   * no vigente. Los inválidos se descartan y se devuelven con su motivo.
   */
  async guardarEnlaces(tenantId: string, otId: string, enlaces: EnlaceRecibido[], cfg: ConfigArmas, origen: "evento" | "consulta") {
    const hosts = hostsPermitidos(cfg);
    const rechazados: { url: string; motivo: string }[] = [];
    let guardados = 0;
    for (const en of enlaces) {
      const v = validarUrlEnlace(en.url, hosts);
      if (!v.url) {
        rechazados.push({ url: en.url.slice(0, 200), motivo: v.error ?? "Enlace inválido." });
        continue;
      }
      if (en.tipo === "ot") {
        await this.prisma.$executeRawUnsafe(`UPDATE integracion_armas_ot SET url_ot_externa = $2, updated_at = now() WHERE ot_id = $1::uuid`, otId, v.url);
      }
      if (en.tipo !== "otro") {
        await this.prisma.$executeRawUnsafe(
          `UPDATE integracion_armas_enlace SET vigente = FALSE
            WHERE ot_id = $1::uuid AND vigente AND tipo = $2 AND COALESCE(numero_serie, '') = COALESCE($3, '')
              AND COALESCE(id_externo, '') = COALESCE($4, '') AND url <> $5`,
          otId,
          en.tipo,
          en.numeroSerie,
          en.idExterno,
          v.url,
        );
      }
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO integracion_armas_enlace (tenant_id, ot_id, tipo, etiqueta, numero_serie, id_externo, url, origen)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (ot_id, tipo, COALESCE(numero_serie, ''), COALESCE(id_externo, ''), url) WHERE vigente
         DO UPDATE SET etiqueta = EXCLUDED.etiqueta, recibido_at = now()`,
        tenantId,
        otId,
        en.tipo,
        en.etiqueta.slice(0, 200),
        en.numeroSerie,
        en.idExterno,
        v.url,
        origen,
      );
      guardados++;
    }
    if (rechazados.length) this.log.warn(`OT ${otId}: ${rechazados.length} enlace(s) del BPCH descartados (${rechazados[0].motivo})`);
    return { guardados, rechazados };
  }

  /**
   * Pide al BPCH los enlaces de una OT: GET {url_base}{ruta_enlaces_ot} con
   * {ot}/{bpch_id} reemplazados. Ruta y formato POR CONFIRMAR con el BPCH.
   * No sigue redirecciones (un 3xx se trata como error).
   */
  async pedirEnlaces(tenantId: string, otId: string) {
    const cfg = await this.config(tenantId);
    const token = this.env.BPCH_ARMAS_TOKEN?.trim();
    const [o] = await this.prisma.$queryRawUnsafe<{ lims: string; bpch: string | null }[]>(
      `SELECT lims_ot_id AS lims, bpch_id::text AS bpch FROM integracion_armas_ot WHERE ot_id = $1::uuid AND tenant_id = $2::uuid`,
      otId,
      tenantId,
    );
    if (!o) throw new NotFoundException("La OT no se ha enviado al software de armas.");
    const ruta = rutaEnlaces(cfg.rutaEnlacesOt, o.lims, o.bpch);
    if (!cfg.activa || !ruta || !cfg.urlBase || !urlBaseValida(cfg.urlBase) || !token)
      return { pedidos: false, motivo: "Falta activar la integración, la ruta de enlaces (ruta_enlaces_ot), la dirección base o el token.", guardados: 0, rechazados: [] };
    const r = await this.fetcher(cfg.urlBase + ruta, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status !== 200) return { pedidos: false, motivo: `El BPCH respondió HTTP ${r.status}.`, guardados: 0, rechazados: [] };
    const { enlaces, errores } = leerEnlaces(await r.json());
    if (errores.length) return { pedidos: false, motivo: errores.join(" "), guardados: 0, rechazados: [] };
    const g = await this.guardarEnlaces(tenantId, otId, enlaces, cfg, "consulta");
    return { pedidos: true, motivo: null, ...g };
  }

  private async avisar(tenantId: string, otId: string, tipo: "rechazo" | "firmada" | "finalizada", mensaje: string, clave: string) {
    try {
      const o = await this.prisma.$queryRawUnsafe<{ codigo: string; unidad: string | null }[]>(
        `SELECT codigo, unidad_principal::text AS unidad FROM orden_trabajo WHERE id = $1::uuid`,
        otId,
      );
      await this.avisos.emitir(
        tenantId,
        {
          tipo: tipo === "rechazo" ? "armas_bpch_rechazo" : "armas_bpch",
          titulo: `OT ${o[0]?.codigo ?? ""} · software de armas del BPCH`,
          mensaje,
          ruta: `/ot/${otId}`,
          otId,
          clave: `armas:${clave}`.slice(0, 200),
        },
        { jefesDe: [o[0]?.unidad], roles: [{ rol: "JEFE_LAB", unidadCodigo: "D11" }, { rol: "COMERCIAL" }] },
      );
    } catch (e: any) {
      this.log.warn(`aviso de la integración de armas no emitido: ${e?.message ?? e}`);
    }
  }

  private async historialOt(tenantId: string, otId: string, tipo: string, detalle: any, usuarioId: string | null) {
    await this.prisma
      .$executeRawUnsafe(
        `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::uuid)`,
        tenantId,
        otId,
        tipo,
        JSON.stringify(detalle),
        usuarioId,
      )
      .catch(() => undefined);
  }

  /* ------------------------------------------------------ consulta (pull) --- */

  /** En modo «pull», consulta el estado de las OT abiertas cuando toca (intervalo_pull_min). */
  async consultarEstados(forzar = false): Promise<{ consultadas: number }> {
    const tenants = await this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM tenant`);
    let n = 0;
    for (const t of tenants) {
      const cfg = await this.config(t.id);
      if (!cfg.activa || (cfg.modoRetorno !== "pull" && !forzar)) continue;
      const token = this.env.BPCH_ARMAS_TOKEN?.trim();
      if (!cfg.urlBase || !urlBaseValida(cfg.urlBase) || !token) continue;
      const abiertas = await this.prisma.$queryRawUnsafe<{ otId: string; lims: string }[]>(
        `SELECT ot_id AS "otId", lims_ot_id AS lims FROM integracion_armas_ot
          WHERE tenant_id = $1::uuid AND enviado_at IS NOT NULL AND (estado_externo IS NULL OR estado_externo NOT IN (3, 8))
            AND ($2::boolean OR ultima_consulta_at IS NULL OR ultima_consulta_at < now() - ($3::int * interval '1 minute'))
          ORDER BY ultima_consulta_at NULLS FIRST LIMIT 50`,
        t.id,
        forzar,
        cfg.intervaloPullMin,
      );
      for (const a of abiertas) {
        await this.prisma.$executeRawUnsafe(`UPDATE integracion_armas_ot SET ultima_consulta_at = now() WHERE ot_id = $1::uuid`, a.otId);
        try {
          const r = await this.fetcher(cfg.urlBase + rutaEstadoOt(a.lims), {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            signal: AbortSignal.timeout(20_000),
          });
          if (r.status !== 200) continue;
          const body = await r.json();
          await this.recibirEstado({ ...body, ot: body?.ot ?? a.lims }, "pull", { tenantId: t.id }).catch(() => undefined);
          n++;
        } catch (e: any) {
          this.log.warn(`consulta de estado de ${a.lims}: ${e?.message ?? e}`);
        }
      }
    }
    return { consultadas: n };
  }

  /* ------------------------------------------------------- adjuntos y vistas --- */

  /** Sube un PDF que acompañará a la OT (resolución DGMN u otro antecedente). */
  async adjuntar(tenantId: string, otId: string, archivo: ArchivoAdjunto | undefined, usuarioId: string | null) {
    await this.ot(tenantId, otId);
    if (!archivo?.buffer || archivo.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new BadRequestException("Adjunte un PDF.");
    return guardarAdjunto(this.prisma as any, {
      tenantId,
      entidad: ENTIDAD_ADJUNTO,
      entidadId: otId,
      clase: "resolucion",
      archivo,
      usuarioId,
      opciones: { ampliado: true, maxBytes: 15 * 1024 * 1024 },
    });
  }

  /** Descarga pública por enlace firmado (solo adjuntos de la integración). */
  async descargaPorEnlace(token: string) {
    const { adjuntoId, error } = verificarEnlace(token, this.secretoEnlace());
    if (!adjuntoId) throw new NotFoundException(error ?? "Enlace inválido.");
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT nombre, mime, datos FROM registro_adjunto WHERE id = $1::uuid AND entidad = $2 AND clase = 'resolucion' AND deleted_at IS NULL`,
      adjuntoId,
      ENTIDAD_ADJUNTO,
    );
    if (!f[0]) throw new NotFoundException("Documento no encontrado.");
    return f[0] as { nombre: string; mime: string; datos: Buffer };
  }

  /** Estado externo de una OT, su historial, adjuntos y certificados recibidos. */
  async estadoOt(tenantId: string, otId: string) {
    const [estado] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT lims_ot_id AS "limsOtId", bpch_id::text AS "bpchId", tipo_orden AS "tipoOrden", estado_externo AS "estado", estado_descripcion AS "descripcion",
              motivo, operador_rut AS "operadorRut", fecha_estado AS "fechaEstado", total_certificados AS "totalCertificados",
              enviado_at AS "enviadoAt", ultimo_error AS "ultimoError", url_ot_externa AS "urlOtExterna"
         FROM integracion_armas_ot WHERE ot_id = $1::uuid AND tenant_id = $2::uuid`,
      otId,
      tenantId,
    );
    const historial = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT estado_anterior AS "anterior", estado_nuevo AS "nuevo", estado_descripcion AS "descripcion", motivo, operador_rut AS "operadorRut",
              fecha_cambio AS "fecha", created_at AS "recibido" FROM integracion_armas_historial WHERE ot_id = $1::uuid ORDER BY created_at`,
      otId,
    );
    const envios = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, estado, intentos, http_status AS "http", ultimo_error AS "error", created_at AS "creado", enviado_at AS "enviado"
         FROM integracion_armas_envio WHERE ot_id = $1::uuid ORDER BY created_at DESC`,
      otId,
    );
    const adjuntos = await listarAdjuntos(this.prisma as any, tenantId, ENTIDAD_ADJUNTO, [otId]);
    // Solo enlaces vigentes y que sigan pasando la lista de servidores permitidos de hoy.
    const cfg = await this.config(tenantId);
    const hosts = hostsPermitidos(cfg);
    const enlaces = (
      await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, tipo, etiqueta, numero_serie AS "numeroSerie", id_externo AS "idExterno", url, origen, recibido_at AS "recibido"
           FROM integracion_armas_enlace WHERE ot_id = $1::uuid AND tenant_id = $2::uuid AND vigente
          ORDER BY CASE tipo WHEN 'ot' THEN 0 WHEN 'acta' THEN 1 WHEN 'certificado' THEN 2 ELSE 3 END, numero_serie NULLS FIRST, recibido_at`,
        otId,
        tenantId,
      )
    ).filter((x) => !!validarUrlEnlace(x.url, hosts).url);
    return { enviada: !!estado, estado: estado ?? null, historial, envios, adjuntos, enlaces };
  }

  /** Bandeja: envíos y eventos recientes (con su error si lo hubo). */
  async bandeja(tenantId: string, q: { estado?: string; limite?: number } = {}) {
    const limite = Math.min(Math.max(Number(q.limite) || 100, 1), 500);
    const estado = ["pendiente", "enviado", "error", "descartado"].includes(String(q.estado)) ? String(q.estado) : null;
    const envios = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.id, e.ot_id AS "otId", ot.codigo AS "ot", e.estado, e.intentos, e.http_status AS "http", e.ultimo_error AS "error",
              e.proximo_intento_at AS "proximoIntento", e.created_at AS "creado", e.enviado_at AS "enviado"
         FROM integracion_armas_envio e JOIN orden_trabajo ot ON ot.id = e.ot_id
        WHERE e.tenant_id = $1::uuid AND ($2::text IS NULL OR e.estado = $2)
        ORDER BY e.created_at DESC LIMIT $3`,
      tenantId,
      estado,
      limite,
    );
    const eventos = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ev.id, ev.evento_id AS "eventoId", ev.origen, ev.ot_externa AS "ot", ev.ot_id AS "otId", ev.estado, ev.firma_valida AS "firmaValida",
              ev.procesado_at AS "procesado", ev.error, ev.created_at AS "recibido"
         FROM integracion_armas_evento ev WHERE ev.tenant_id = $1::uuid ORDER BY ev.created_at DESC LIMIT $2`,
      tenantId,
      limite,
    );
    const cfg = await this.config(tenantId);
    return {
      config: { ...cfg, tokenConfigurado: !!this.env.BPCH_ARMAS_TOKEN, claveHmacConfigurada: !!this.env.BPCH_ARMAS_HMAC_SECRET },
      envios,
      eventos,
    };
  }
}
