/**
 * Integración asíncrona con el software de armas del BPCH (docs/INTEGRACION_ARMAS_BPCH.md).
 *
 *   · Salida: la OT se encola (integracion_armas_envio) y un trabajador la envía
 *     a POST {url_base}/api/v1/integracion/lims/ordenes-trabajo con el token del
 *     BPCH (BPCH_ARMAS_TOKEN) y X-Idempotency-Key. La resolución va DENTRO del
 *     mensaje en base64 (parámetro modo_adjunto; alternativa: enlace firmado).
 *     201/409 → enviada; 4xx → error sin reintento (aviso); 5xx/red → reintento
 *     1 min, 5 min, 15 min, 1 h y luego cada 6 h, hasta 48 h.
 *   · Entrada: un mismo manejador (`recibirEstado`) para el webhook firmado con
 *     HMAC, el POST directo con token de integración y la consulta periódica.
 *     Valida, GUARDA el evento y responde 200 (acuse); lo aplica enseguida si
 *     cabe en el tiempo del acuse y, si no, en segundo plano (y un trabajador
 *     reintenta los que quedaron sin aplicar). Un estado con fecha anterior al
 *     último aplicado se registra «fuera de orden» sin retroceder el estado.
 *   · Mapa de estados configurable (integracion_armas_estado): un código
 *     desconocido se guarda y avisa; el rechazo total y los certificados de
 *     rechazo dejan pendiente la notificación a la DGMN.
 *   · Sin FEA del lado LIMS: los certificados firmados quedan en el BPCH y el
 *     LIMS solo guarda sus enlaces. Nunca cierra ni anula la OT del LIMS.
 */
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "../../common/prisma.service";
import { sqlDia } from "../../common/fecha-chile";
import { AvisosService } from "../../avisos/avisos.service";
import { alEvento } from "../../common/eventos";
import { guardarAdjunto, listarAdjuntos, type ArchivoAdjunto } from "../../common/adjuntos";
import { DESTINATARIOS_DGMN } from "../../bpch/notificacion-dgmn/reglas-notificacion";
import {
  RUTA_CREAR_OT,
  bpchIdDe,
  clasificarRespuesta,
  configArmas,
  construirPayload,
  cuerpoSinBase64,
  descripcionEstado,
  efectoEstado,
  esperaReintentoMs,
  firmarEnlace,
  fueraDeOrden,
  hostsPermitidos,
  idEvento,
  leerEnlaces,
  leerEvento,
  mapaEstados,
  nombrePdf,
  notificacionesDgmn,
  pdfDeBase64,
  reintentosAgotados,
  rutaDescargaAdjunto,
  rutaEnlaces,
  rutaEstadoOt,
  urlBaseLims,
  urlBaseValida,
  validarUrlEnlace,
  verificarEnlace,
  type ConfigArmas,
  type DatosOtArmas,
  type DatosPersona,
  type EnlaceRecibido,
  type EstadoConfig,
  type EventoEstado,
} from "./reglas-armas";

/** Entidad con que se guardan en registro_adjunto los archivos de la integración. */
export const ENTIDAD_ADJUNTO = "integracion_armas_ot";
const UN_MINUTO = 60_000;
/** Tiempo que el acuse espera la aplicación del evento antes de seguir en segundo plano (respondemos en < 2 s). */
const PRESUPUESTO_ACUSE_MS = 1_500;
const MAX_INTENTOS_EVENTO = 10;

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
  private ocupadoEventos = false;
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
      this.relojEnvio = setInterval(() => {
        void this.procesarCola().catch((e) => this.log.warn(`cola de envíos: ${e?.message ?? e}`));
        void this.procesarEventosPendientes().catch((e) => this.log.warn(`eventos pendientes: ${e?.message ?? e}`));
      }, UN_MINUTO);
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

  /** Mapa de estados del BPCH (tabla integracion_armas_estado; sin filas, los valores conocidos). */
  async estados(tenantId: string): Promise<Map<number, EstadoConfig>> {
    const filas = await this.prisma
      .$queryRawUnsafe<EstadoConfig[]>(
        `SELECT codigo, descripcion, tipo, terminal, por_confirmar AS "porConfirmar" FROM integracion_armas_estado
          WHERE tenant_id = $1::uuid AND activo ORDER BY orden, codigo`,
        tenantId,
      )
      .catch(() => []);
    return mapaEstados(filas);
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
              c.es_persona_natural AS "personaNatural", c.nombres, c.apellidos, c.email::text AS "personaEmail", c.telefono,
              c.direccion AS "domicilio", c.comuna,
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
    return f[0];
  }

  /** Datos con que se construye el envío: los de la OT, corregibles a mano. Sin adjuntos (se agregan al enviar). */
  async datosEnvio(tenantId: string, otId: string, manual: DatosManuales = {}): Promise<DatosOtArmas> {
    const o = await this.ot(tenantId, otId);
    const tipoOrden = manual.tipoOrden ?? (o.internacionId ? 2 : 1);
    const persona: DatosPersona | null = o.personaNatural
      ? { rut: o.clienteRut, nombres: o.nombres, apellidos: o.apellidos, email: o.personaEmail, telefono: o.telefono, domicilio: o.domicilio, comuna: o.comuna }
      : null;
    return {
      limsOtId: o.codigo,
      tipoOrden,
      resolucionNumero: manual.resolucionNumero ?? o.resolucionNumero,
      resolucionFecha: manual.resolucionFecha ?? o.resolucionFecha,
      solicitanteRut: manual.solicitanteRut ?? o.clienteRut,
      solicitanteEmail: manual.solicitanteEmail ?? o.clienteEmail,
      // El LIMS no guarda el RUT de sus usuarios: por confirmar (ver la guía).
      creadorRut: null,
      cantidadArmas: manual.cantidadArmas ?? (o.armasResolucion || o.armasOt || null),
      observaciones: manual.observaciones ?? o.descripcion,
      adjuntos: [],
      persona,
    };
  }

  /** Resolución y antecedentes de la OT: en base64 (por defecto) o con enlace firmado que vence. */
  private async adjuntosEnvio(tenantId: string, otId: string, cfg: ConfigArmas, conContenido: boolean) {
    const filas = (await listarAdjuntos(this.prisma as any, tenantId, ENTIDAD_ADJUNTO, [otId])).filter((a: any) => a.clase === "resolucion");
    if (cfg.modoAdjunto === "base64") {
      const out: { nombre: string; base64: string }[] = [];
      for (const a of filas) {
        if (!conContenido) {
          out.push({ nombre: a.nombre, base64: `<${a.bytes} bytes en base64>` });
          continue;
        }
        const [d] = await this.prisma.$queryRawUnsafe<{ datos: Buffer }[]>(`SELECT datos FROM registro_adjunto WHERE id = $1::uuid`, a.id);
        if (d) out.push({ nombre: a.nombre, base64: Buffer.from(d.datos).toString("base64") });
      }
      return out;
    }
    const expira = Date.now() / 1000 + cfg.vigenciaEnlaceHoras * 3600;
    const base = urlBaseLims(this.env);
    return filas.map((a: any) => ({ nombre: a.nombre as string, url: base + rutaDescargaAdjunto(firmarEnlace(a.id, expira, this.secretoEnlace())) }));
  }

  /* ------------------------------------------------------------------ salida --- */

  /** Vista previa del JSON que se enviaría y sus errores (no envía nada; el base64 se resume). */
  async previsualizar(tenantId: string, otId: string, manual: DatosManuales = {}) {
    const cfg = await this.config(tenantId);
    const datos = await this.datosEnvio(tenantId, otId, manual);
    datos.adjuntos = await this.adjuntosEnvio(tenantId, otId, cfg, false);
    const r = construirPayload(datos, cfg.rutConDv);
    return { ...r, config: { activa: cfg.activa, urlBaseConfigurada: !!cfg.urlBase, tokenConfigurado: !!this.env.BPCH_ARMAS_TOKEN, modoAdjunto: cfg.modoAdjunto } };
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
    // La cola guarda el mensaje SIN los adjuntos: se agregan al enviar (base64 o enlace vigente).
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
      if (!o.unidad || !cfg.unidades.includes(String(o.unidad).toUpperCase())) return;
      await this.encolar(tenantId, otId, usuarioId);
    } catch (e: any) {
      this.log.warn(`OT ${otId} no se encoló para el software de armas: ${e?.response?.errores?.join(" ") ?? e?.message ?? e}`);
    }
  }

  /** Reintenta un envío en error o descartado (vuelve a pendiente, intentos a 0, nueva ventana de 48 h). */
  async reintentar(tenantId: string, envioId: string) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `UPDATE integracion_armas_envio SET estado = 'pendiente', intentos = 0, proximo_intento_at = now(), ultimo_error = NULL,
              created_at = now(), updated_at = now()
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
        `SELECT id, tenant_id AS "tenantId", ot_id AS "otId", payload, intentos, created_at AS "creado"
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

  private async enviarUno(f: { id: string; tenantId: string; otId: string; payload: any; intentos: number; creado?: Date }, cfg: ConfigArmas) {
    const token = this.env.BPCH_ARMAS_TOKEN?.trim();
    const idem = await this.prisma.$queryRawUnsafe<{ k: string }[]>(`SELECT idempotency_key::text AS k FROM integracion_armas_ot WHERE ot_id = $1::uuid`, f.otId);
    if (!cfg.urlBase || !urlBaseValida(cfg.urlBase) || !token) {
      await this.marcarEnvio(f.id, "error", f.intentos, null, null, "Falta la dirección del BPCH (parámetro url_base) o el token BPCH_ARMAS_TOKEN.");
      return;
    }
    const adjuntos = await this.adjuntosEnvio(f.tenantId, f.otId, cfg, true);
    const cuerpo = {
      ...f.payload,
      documentos_adjuntos: adjuntos.map((a: any) =>
        a.base64 ? { nombre: a.nombre, tipo: "resolucion", contenido_base64: a.base64 } : { nombre: a.nombre, tipo: "resolucion", url_descarga: a.url },
      ),
    };
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
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(10_000),
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
    if (clase === "rechazado" || reintentosAgotados(intentos, cfg.maxIntentos, f.creado ?? new Date())) {
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
   * Recibe un aviso de cambio de estado del BPCH (las tres opciones):
   *   1. valida el cuerpo y el acta (rápido; un cuerpo inválido → 400 y no se guarda);
   *   2. GUARDA el evento ya normalizado (sin base64) y el acta en PDF;
   *   3. responde 200 (acuse): lo aplica en el tiempo del acuse si alcanza y, si
   *      no, sigue en segundo plano; un trabajador reintenta los no aplicados.
   * Un X-Event-ID / evento_id repetido responde 200 con `duplicado: true`.
   */
  async recibirEstado(body: any, origen: OrigenEvento, opts: { tenantId?: string; cabeceraEvento?: string | null; firmaValida?: boolean | null; esperarAplicacion?: boolean } = {}) {
    const tenantId = opts.tenantId ?? (await this.tenantUnico());
    const cfg = await this.config(tenantId);
    if (!cfg.activa) throw new ServiceUnavailableException("La integración con el software de armas está desactivada en el LIMS.");
    const { evento, errores } = leerEvento(body);
    if (!evento) throw new BadRequestException({ codigo: 400, error: "Error de Validación de Datos", detalles: errores });

    let actaPdf: Buffer | null = null;
    if (evento.documento?.base64 && cfg.guardarActaPdf) {
      const { datos, error } = pdfDeBase64(evento.documento.base64);
      if (!datos) throw new BadRequestException({ codigo: 400, error: "Error de Validación de Datos", detalles: [`documento_cierre: ${error}`] });
      actaPdf = datos;
    }

    const eventoId = idEvento(evento, opts.cabeceraEvento);
    const previo = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM integracion_armas_evento WHERE tenant_id = $1::uuid AND evento_id = $2`,
      tenantId,
      eventoId,
    );
    if (previo[0]) return { codigo: 200, mensaje: "Evento ya recibido anteriormente", duplicado: true, evento_id: eventoId };

    const ot = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ot_id AS "otId" FROM integracion_armas_ot
        WHERE tenant_id = $1::uuid AND (lims_ot_id = $2 OR ($3::bigint IS NOT NULL AND bpch_id = $3::bigint))`,
      tenantId,
      evento.ot,
      evento.bpchId,
    );
    if (!ot[0]) {
      // No se guarda: si el BPCH lo reenvía cuando la OT exista, debe procesarse.
      this.log.warn(`aviso del BPCH (${origen}) para una OT desconocida`);
      throw new NotFoundException({ error: "Orden de trabajo no encontrada", ot: evento.ot, mensaje: "No existe en el LIMS una OT enviada con ese identificador." });
    }
    const otId: string = ot[0].otId;

    let actaId: string | null = null;
    if (actaPdf && evento.documento) {
      const archivo: ArchivoAdjunto = { buffer: actaPdf, originalname: nombrePdf(evento.documento.nombre), size: actaPdf.length };
      const g = await guardarAdjunto(this.prisma as any, {
        tenantId,
        entidad: ENTIDAD_ADJUNTO,
        entidadId: otId,
        clase: evento.documento.tipo === "acta_finalizacion" ? "acta_finalizacion" : "documento_bpch",
        archivo,
        usuarioId: null,
        opciones: { ampliado: true, maxBytes: 15 * 1024 * 1024 },
      });
      actaId = g.id;
    }
    const datos: EventoEstado = { ...evento, documento: evento.documento ? { ...evento.documento, base64: null } : null };
    const ins = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO integracion_armas_evento (tenant_id, evento_id, origen, ot_id, ot_externa, estado, payload, firma_valida, datos, acta_adjunto_id, fecha_texto)
       VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6, $7::jsonb, $8, $9::jsonb, $10::uuid, $11)
       ON CONFLICT (tenant_id, evento_id) DO NOTHING RETURNING id`,
      tenantId,
      eventoId,
      origen,
      otId,
      evento.ot,
      evento.estado,
      JSON.stringify(cuerpoSinBase64(body)),
      opts.firmaValida ?? null,
      JSON.stringify(datos),
      actaId,
      evento.fecha,
    );
    if (!ins[0]) return { codigo: 200, mensaje: "Evento ya recibido anteriormente", duplicado: true, evento_id: eventoId };

    // Acuse: se aplica dentro del presupuesto o sigue en segundo plano.
    const aplicacion = this.procesarEvento(ins[0].id).catch((e) => {
      this.log.warn(`evento ${eventoId}: ${e?.message ?? e}`);
      return null;
    });
    const r = opts.esperarAplicacion
      ? await aplicacion
      : await Promise.race([aplicacion, new Promise<"pendiente">((ok) => setTimeout(() => ok("pendiente"), PRESUPUESTO_ACUSE_MS).unref?.())]);
    return {
      codigo: 200,
      mensaje: "Evento recibido",
      evento_id: eventoId,
      procesado: r !== "pendiente" && r !== null,
      ...(r && r !== "pendiente" && r.enlacesRechazados.length ? { enlaces_rechazados: r.enlacesRechazados } : {}),
    };
  }

  /** Aplica un evento guardado. Idempotente: si ya se aplicó, no hace nada. */
  async procesarEvento(filaEvento: string): Promise<{ enlacesRechazados: { url: string; motivo: string }[] } | null> {
    const [ev] = await this.prisma.$queryRawUnsafe<any[]>(
      `UPDATE integracion_armas_evento SET intentos = intentos + 1 WHERE id = $1::uuid AND procesado_at IS NULL
       RETURNING tenant_id AS "tenantId", ot_id AS "otId", datos, acta_adjunto_id AS "actaId"`,
      filaEvento,
    );
    if (!ev || !ev.otId || !ev.datos) return null;
    try {
      const cfg = await this.config(ev.tenantId);
      const r = await this.aplicarEvento(ev.tenantId, ev.otId, ev.datos as EventoEstado, filaEvento, cfg, ev.actaId);
      const nota = r.enlacesRechazados.length ? `Enlaces descartados: ${r.enlacesRechazados.map((x) => x.motivo).join(" | ")}`.slice(0, 2000) : null;
      await this.prisma.$executeRawUnsafe(`UPDATE integracion_armas_evento SET procesado_at = now(), error = $2 WHERE id = $1::uuid`, filaEvento, nota);
      return r;
    } catch (e: any) {
      await this.prisma.$executeRawUnsafe(`UPDATE integracion_armas_evento SET error = $2 WHERE id = $1::uuid`, filaEvento, String(e?.message ?? e).slice(0, 2000));
      throw e;
    }
  }

  /** Reintenta los eventos guardados que no se pudieron aplicar (trabajador cada minuto). */
  async procesarEventosPendientes(limite = 50): Promise<{ aplicados: number }> {
    if (this.ocupadoEventos) return { aplicados: 0 };
    this.ocupadoEventos = true;
    try {
      const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM integracion_armas_evento WHERE procesado_at IS NULL AND intentos < $1 AND created_at < now() - interval '30 seconds'
          ORDER BY created_at LIMIT $2`,
        MAX_INTENTOS_EVENTO,
        limite,
      );
      let n = 0;
      for (const f of filas) if (await this.procesarEvento(f.id).catch(() => null)) n++;
      return { aplicados: n };
    } finally {
      this.ocupadoEventos = false;
    }
  }

  private async aplicarEvento(tenantId: string, otId: string, e: EventoEstado, eventoFila: string, cfg: ConfigArmas, actaId: string | null) {
    const mapa = await this.estados(tenantId);
    const conocido = mapa.get(e.estado);
    const efecto = efectoEstado(e.estado, e.motivo, mapa);
    const descripcion = descripcionEstado(e.estado, e.motivo, e.descripcionEnviada, mapa);
    const enlaces: EnlaceRecibido[] = [...e.enlaces];
    if (e.documento?.url)
      enlaces.push({
        tipo: e.documento.tipo === "acta_finalizacion" ? "acta" : "otro",
        etiqueta: e.documento.descripcion ?? e.documento.nombre,
        numeroSerie: null,
        idExterno: null,
        url: e.documento.url,
      });

    // Orden: un aviso con fecha anterior al último aplicado no retrocede el estado.
    const [actual] = await this.prisma.$queryRawUnsafe<{ fecha: Date | null; estado: number | null }[]>(
      `SELECT fecha_estado AS fecha, estado_externo AS estado FROM integracion_armas_ot WHERE ot_id = $1::uuid`,
      otId,
    );
    const fechaNueva = e.fecha ? new Date(e.fecha) : new Date();
    const atrasado = fueraDeOrden(fechaNueva, actual?.fecha);
    if (!atrasado) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE integracion_armas_ot SET estado_externo = $2, estado_descripcion = $3, motivo = $4, operador_rut = $5, fecha_estado = $6,
                fecha_estado_texto = $7, total_certificados = COALESCE($8, total_certificados), total_disparos = COALESCE($9, total_disparos),
                bpch_id = COALESCE(bpch_id, $10), updated_at = now()
          WHERE ot_id = $1::uuid`,
        otId,
        e.estado,
        descripcion,
        e.motivo,
        e.operadorRut,
        fechaNueva,
        e.fecha,
        e.totalCertificados,
        e.totalDisparos,
        e.bpchId,
      );
    } else if (e.totalDisparos !== null || e.totalCertificados !== null) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE integracion_armas_ot SET total_certificados = COALESCE(total_certificados, $2), total_disparos = COALESCE(total_disparos, $3), updated_at = now() WHERE ot_id = $1::uuid`,
        otId,
        e.totalCertificados,
        e.totalDisparos,
      );
    }
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO integracion_armas_historial (tenant_id, ot_id, evento_id, estado_anterior, estado_nuevo, estado_descripcion, motivo, operador_rut,
                                               fecha_cambio, fecha_cambio_texto, tipo_estado, fuera_de_orden, estado_desconocido)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      tenantId,
      otId,
      eventoFila,
      actual?.estado ?? null,
      e.estado,
      descripcion,
      e.motivo,
      e.operadorRut,
      fechaNueva,
      e.fecha,
      conocido?.tipo ?? null,
      atrasado,
      !conocido,
    );

    const r = await this.guardarEnlaces(tenantId, otId, enlaces, cfg, "evento");

    await this.historialOt(tenantId, otId, "integracion_armas", {
      accion: "estado_bpch",
      estado: e.estado,
      descripcion,
      motivo: e.motivo,
      fueraDeOrden: atrasado,
      desconocido: !conocido,
      actaPdf: !!actaId,
      enlaces: r.guardados,
      enlacesRechazados: r.rechazados.length,
    }, null);

    // DGMN: rechazo total o certificado de rechazo → notificación pendiente para la Subdirección BPCH.
    const enlacesValidos = enlaces.filter((x) => !r.rechazados.some((y) => y.url === x.url.slice(0, 200)));
    const dgmn = notificacionesDgmn(atrasado && efecto === "rechazo_total" ? "rechazo_total" : efecto, enlacesValidos);
    const nuevasDgmn = await this.notificarDgmn(tenantId, otId, dgmn);

    if (!atrasado) {
      if (efecto === "desconocido")
        await this.avisar(tenantId, otId, "rechazo", `El BPCH informó el estado ${e.estado}, que no está en el mapa de estados del LIMS (Parámetros › estados del sistema de armas). Se guardó igual.`, `estado:${eventoFila}`);
      if (efecto === "rechazo") await this.avisar(tenantId, otId, "rechazo", `El BPCH devolvió la OT (${descripcion}): ${e.motivo ?? "sin motivo"}`, `estado:${eventoFila}`);
      if (efecto === "rechazo_total") await this.avisar(tenantId, otId, "rechazo", `Rechazo total de la OT en el BPCH: ${e.motivo ?? "sin motivo"}.`, `estado:${eventoFila}`);
      if (efecto === "firmada") await this.avisar(tenantId, otId, "firmada", "El BPCH firmó con FEA los certificados de la OT; pasa a Comercial.", `estado:${eventoFila}`);
      if (efecto === "finalizada") {
        await this.avisar(tenantId, otId, "finalizada", `El BPCH finalizó la OT${e.totalCertificados !== null ? ` (${e.totalCertificados} certificados)` : ""}.`, `estado:${eventoFila}`);
        if (cfg.cerrarOtAlFinalizar) {
          // Punto preparado: el cierre automático de la OT del LIMS espera la decisión del IDIC.
          await this.historialOt(tenantId, otId, "integracion_armas", { accion: "cierre_solicitado_por_bpch" }, null);
        }
      }
      if (efecto === "anulada") await this.avisar(tenantId, otId, "rechazo", "El BPCH anuló la OT.", `estado:${eventoFila}`);
    }
    if (nuevasDgmn > 0)
      await this.avisar(tenantId, otId, "rechazo", `Queda pendiente notificar a la DGMN (${nuevasDgmn}): ${dgmn.map((d) => d.motivo).join(" ")} La registra la Subdirección BPCH en la OT.`, `dgmn:${eventoFila}`, true);
    // Firmada y finalizada: se piden al BPCH los enlaces de los certificados (si hay ruta configurada), en segundo plano.
    if (!atrasado && (efecto === "firmada" || efecto === "finalizada"))
      setImmediate(() => void this.pedirEnlaces(tenantId, otId).catch((x) => this.log.warn(`enlaces de la OT ${otId}: ${x?.message ?? x}`)));
    return { enlacesRechazados: r.rechazados };
  }

  /** Deja pendientes las notificaciones a la DGMN (sin repetir la misma referencia). Devuelve cuántas son nuevas. */
  private async notificarDgmn(tenantId: string, otId: string, lista: { referencia: string; motivo: string; url: string | null }[]): Promise<number> {
    let nuevas = 0;
    for (const n of lista) {
      const f = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO bpch_notificacion_dgmn (tenant_id, ot_id, destinatarios, origen, estado, referencia, motivo, url_documento)
         VALUES ($1::uuid, $2::uuid, $3::text[], 'integracion_armas', 'pendiente', $4, $5, $6)
         ON CONFLICT (ot_id, referencia) WHERE origen = 'integracion_armas' DO NOTHING RETURNING id`,
        tenantId,
        otId,
        [...DESTINATARIOS_DGMN],
        n.referencia,
        n.motivo,
        n.url,
      );
      if (f[0]) {
        nuevas++;
        await this.historialOt(tenantId, otId, "notificacion_dgmn", { accion: "pendiente", origen: "integracion_armas", referencia: n.referencia }, null);
      }
    }
    return nuevas;
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
        `INSERT INTO integracion_armas_enlace (tenant_id, ot_id, tipo, etiqueta, numero_serie, id_externo, url, origen, total_disparos)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (ot_id, tipo, COALESCE(numero_serie, ''), COALESCE(id_externo, ''), url) WHERE vigente
         DO UPDATE SET etiqueta = EXCLUDED.etiqueta, total_disparos = COALESCE(EXCLUDED.total_disparos, integracion_armas_enlace.total_disparos), recibido_at = now()`,
        tenantId,
        otId,
        en.tipo,
        en.etiqueta.slice(0, 200),
        en.numeroSerie,
        en.idExterno,
        v.url,
        origen,
        en.totalDisparos ?? null,
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
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status !== 200) return { pedidos: false, motivo: `El BPCH respondió HTTP ${r.status}.`, guardados: 0, rechazados: [] };
    const { enlaces, errores } = leerEnlaces(await r.json());
    if (errores.length) return { pedidos: false, motivo: errores.join(" "), guardados: 0, rechazados: [] };
    const g = await this.guardarEnlaces(tenantId, otId, enlaces, cfg, "consulta");
    const dgmn = await this.notificarDgmn(tenantId, otId, notificacionesDgmn("avance", enlaces.filter((x) => !g.rechazados.some((y) => y.url === x.url.slice(0, 200)))));
    if (dgmn > 0) await this.avisar(tenantId, otId, "rechazo", `Queda pendiente notificar a la DGMN (${dgmn}) un certificado de rechazo del BPCH.`, `dgmn:enlaces:${Date.now()}`, true);
    return { pedidos: true, motivo: null, ...g };
  }

  private async avisar(tenantId: string, otId: string, tipo: "rechazo" | "firmada" | "finalizada", mensaje: string, clave: string, aBpch = false) {
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
        {
          jefesDe: [o[0]?.unidad],
          roles: [{ rol: "JEFE_LAB", unidadCodigo: "D11" }, { rol: "COMERCIAL" }, ...(aBpch ? [{ rol: "JEFE_DEPTO", unidadCodigo: "BPCH" }, { rol: "JEFE_SECCION", unidadCodigo: "BPCH" }] : [])],
        },
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
      const mapa = await this.estados(t.id);
      const terminales = [...mapa.values()].filter((e) => e.terminal).map((e) => e.codigo);
      const abiertas = await this.prisma.$queryRawUnsafe<{ otId: string; lims: string }[]>(
        `SELECT ot_id AS "otId", lims_ot_id AS lims FROM integracion_armas_ot
          WHERE tenant_id = $1::uuid AND enviado_at IS NOT NULL AND (estado_externo IS NULL OR NOT (estado_externo = ANY($4::int[])))
            AND ($2::boolean OR ultima_consulta_at IS NULL OR ultima_consulta_at < now() - ($3::int * interval '1 minute'))
          ORDER BY ultima_consulta_at NULLS FIRST LIMIT 50`,
        t.id,
        forzar,
        cfg.intervaloPullMin,
        terminales,
      );
      for (const a of abiertas) {
        await this.prisma.$executeRawUnsafe(`UPDATE integracion_armas_ot SET ultima_consulta_at = now() WHERE ot_id = $1::uuid`, a.otId);
        try {
          const r = await this.fetcher(cfg.urlBase + rutaEstadoOt(a.lims), {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
          });
          if (r.status !== 200) continue;
          const body = await r.json();
          await this.recibirEstado({ ...body, ot: body?.ot ?? a.lims }, "pull", { tenantId: t.id, esperarAplicacion: true }).catch(() => undefined);
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

  /** Descarga pública por enlace firmado (solo la resolución que acompaña a la OT; modo_adjunto = url). */
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

  /** Estado externo de una OT, su historial, adjuntos, enlaces y notificaciones a la DGMN pendientes. */
  async estadoOt(tenantId: string, otId: string) {
    const mapa = await this.estados(tenantId);
    const [estado] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT lims_ot_id AS "limsOtId", bpch_id::text AS "bpchId", tipo_orden AS "tipoOrden", estado_externo AS "estado", estado_descripcion AS "descripcion",
              motivo, operador_rut AS "operadorRut", fecha_estado AS "fechaEstado", fecha_estado_texto AS "fechaEstadoTexto",
              total_certificados AS "totalCertificados", total_disparos AS "totalDisparos",
              enviado_at AS "enviadoAt", ultimo_error AS "ultimoError", url_ot_externa AS "urlOtExterna"
         FROM integracion_armas_ot WHERE ot_id = $1::uuid AND tenant_id = $2::uuid`,
      otId,
      tenantId,
    );
    if (estado) {
      const e = mapa.get(Number(estado.estado));
      estado.tipo = e?.tipo ?? (estado.estado === null ? null : "desconocido");
      estado.terminal = e ? e.terminal : false;
    }
    const historial = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT estado_anterior AS "anterior", estado_nuevo AS "nuevo", estado_descripcion AS "descripcion", motivo, operador_rut AS "operadorRut",
              fecha_cambio AS "fecha", fecha_cambio_texto AS "fechaTexto", tipo_estado AS "tipo", fuera_de_orden AS "fueraDeOrden",
              estado_desconocido AS "desconocido", created_at AS "recibido"
         FROM integracion_armas_historial WHERE ot_id = $1::uuid ORDER BY created_at`,
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
        `SELECT id, tipo, etiqueta, numero_serie AS "numeroSerie", id_externo AS "idExterno", url, origen, total_disparos AS "totalDisparos", recibido_at AS "recibido"
           FROM integracion_armas_enlace WHERE ot_id = $1::uuid AND tenant_id = $2::uuid AND vigente
          ORDER BY CASE tipo WHEN 'ot' THEN 0 WHEN 'acta' THEN 1 WHEN 'certificado_rechazo' THEN 2 WHEN 'certificado' THEN 3 ELSE 4 END, numero_serie NULLS FIRST, recibido_at`,
        otId,
        tenantId,
      )
    ).filter((x) => !!validarUrlEnlace(x.url, hosts).url);
    const dgmn = await this.prisma
      .$queryRawUnsafe<any[]>(
        `SELECT id, estado, referencia, motivo, url_documento AS "url", medio, oficio_numero AS "oficioNumero", fecha_envio AS "fechaEnvio", created_at AS "creada"
           FROM bpch_notificacion_dgmn WHERE ot_id = $1::uuid AND origen = 'integracion_armas' ORDER BY created_at`,
        otId,
      )
      .catch(() => []);
    return {
      enviada: !!estado,
      estado: estado ?? null,
      historial,
      envios,
      adjuntos,
      enlaces,
      notificacionesDgmn: dgmn,
      // Paso 9 de la D11: con la OT en el sistema de armas, el LIMS no emite certificados por arma.
      certificadosD11Bloqueados: !!estado,
    };
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
              ev.fecha_texto AS "fechaTexto", ev.procesado_at AS "procesado", ev.intentos, ev.error, ev.created_at AS "recibido"
         FROM integracion_armas_evento ev WHERE ev.tenant_id = $1::uuid ORDER BY ev.created_at DESC LIMIT $2`,
      tenantId,
      limite,
    );
    const cfg = await this.config(tenantId);
    const mapa = await this.estados(tenantId);
    return {
      config: { ...cfg, tokenConfigurado: !!this.env.BPCH_ARMAS_TOKEN, claveHmacConfigurada: !!this.env.BPCH_ARMAS_HMAC_SECRET },
      estados: [...mapa.values()],
      envios,
      eventos,
    };
  }

  /**
   * Estadísticas de la integración (control de fases): OT por estado actual,
   * tiempo promedio y mediano en cada fase (desde el historial, sin los avisos
   * fuera de orden), rechazos por etapa y motivo, y rechazos totales.
   * Filtros: desde/hasta (fecha de envío de la OT, días de Chile) y tipo de orden.
   */
  async estadisticas(tenantId: string, q: { desde?: string; hasta?: string; tipoOrden?: number | null }) {
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(q.desde ?? "") ? q.desde! : null;
    const hasta = /^\d{4}-\d{2}-\d{2}$/.test(q.hasta ?? "") ? q.hasta! : null;
    const tipo = q.tipoOrden === 1 || q.tipoOrden === 2 ? q.tipoOrden : null;
    const filtro = `i.tenant_id = $1::uuid AND ($2::date IS NULL OR ${sqlDia("i.enviado_at")} >= $2::date)
                    AND ($3::date IS NULL OR ${sqlDia("i.enviado_at")} <= $3::date)
                    AND ($4::int IS NULL OR i.tipo_orden = $4::int)`;
    const args = [tenantId, desde, hasta, tipo];
    const porEstado = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT i.estado_externo AS estado, COALESCE(e.descripcion, i.estado_descripcion, 'Sin respuesta del BPCH') AS descripcion,
              COALESCE(e.tipo, CASE WHEN i.estado_externo IS NULL THEN NULL ELSE 'desconocido' END) AS tipo, COUNT(*)::int AS ot
         FROM integracion_armas_ot i
         LEFT JOIN integracion_armas_estado e ON e.tenant_id = i.tenant_id AND e.codigo = i.estado_externo
        WHERE ${filtro}
        GROUP BY 1, 2, 3 ORDER BY 4 DESC`,
      ...args,
    );
    const fases = await this.prisma.$queryRawUnsafe<any[]>(
      `WITH h AS (
         SELECT h.ot_id, h.estado_nuevo AS estado, h.fecha_cambio AS inicio,
                LEAD(h.fecha_cambio) OVER (PARTITION BY h.ot_id ORDER BY h.fecha_cambio, h.created_at) AS fin
           FROM integracion_armas_historial h JOIN integracion_armas_ot i ON i.ot_id = h.ot_id
          WHERE NOT h.fuera_de_orden AND ${filtro})
       SELECT h.estado, COALESCE(e.descripcion, 'Estado ' || h.estado) AS descripcion, COUNT(*)::int AS veces,
              ROUND(AVG(EXTRACT(EPOCH FROM (fin - inicio)) / 3600.0)::numeric, 2) AS horas_promedio,
              ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (fin - inicio)) / 3600.0))::numeric, 2) AS horas_mediana
         FROM h LEFT JOIN integracion_armas_estado e ON e.tenant_id = $1::uuid AND e.codigo = h.estado
        WHERE fin IS NOT NULL
        GROUP BY 1, 2 ORDER BY MIN(COALESCE(e.orden, 99)), 1`,
      ...args,
    );
    const rechazos = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT h.estado_anterior AS etapa, COALESCE(ea.descripcion, 'Estado ' || h.estado_anterior, 'Sin estado previo') AS etapa_descripcion,
              COALESCE(h.tipo_estado, 'rechazo') AS tipo, COALESCE(NULLIF(TRIM(h.motivo), ''), '(sin motivo)') AS motivo, COUNT(*)::int AS veces
         FROM integracion_armas_historial h JOIN integracion_armas_ot i ON i.ot_id = h.ot_id
         LEFT JOIN integracion_armas_estado ea ON ea.tenant_id = h.tenant_id AND ea.codigo = h.estado_anterior
        WHERE ${filtro} AND (h.tipo_estado IN ('rechazo', 'rechazo_total') OR (h.estado_nuevo = 1 AND h.motivo IS NOT NULL))
        GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC`,
      ...args,
    );
    const [totales] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS ot,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM integracion_armas_historial h WHERE h.ot_id = i.ot_id AND h.tipo_estado = 'rechazo_total'))::int AS rechazos_totales,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM integracion_armas_historial h WHERE h.ot_id = i.ot_id AND (h.tipo_estado = 'rechazo' OR (h.estado_nuevo = 1 AND h.motivo IS NOT NULL))))::int AS ot_con_devolucion
         FROM integracion_armas_ot i WHERE ${filtro}`,
      ...args,
    );
    return { filtros: { desde, hasta, tipoOrden: tipo }, totales, porEstado, fases, rechazos };
  }
}
