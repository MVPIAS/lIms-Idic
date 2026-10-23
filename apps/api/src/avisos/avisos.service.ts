/**
 * Avisos internos y por correo (T20, frente r4c · docs/FLUJO_AVISOS_DESPACHO_OFICIO.md).
 *
 * Un aviso es una fila por persona en `aviso` («Mi bandeja › Avisos») y, si el
 * parámetro lo pide, un correo con el MailService del LIMS. Si el correo no está
 * configurado o falla, el aviso queda igual (estado del correo «sin configurar»
 * o «error») y en la bitácora de Mensajería (`correo_enviado`): nunca falla la
 * operación que lo originó. Los avisos de una OT dejan además un hito en su
 * historial (`ot_historial`, tipo «aviso»).
 *
 * Disparadores:
 *   · resultado aprobado No cumple / Contaminado (evento «resultado.aprobado»);
 *   · documento oficial (evento «documento.oficial») → Comercial;
 *   · plazos de las OT (revisión cada hora y botón «Avisar →»);
 *   · despacho, plazo asignado y oficios (los llaman sus servicios).
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { MailService } from "../configuracion/configuracion.module";
import { alEvento } from "../common/eventos";
import { escapeHtml } from "../plantilla-render/html.util";
import { hoyCl } from "../ot/plazos";
import {
  TIPOS_AVISO,
  alertaDeResultado,
  avisoDePlazo,
  configAvisos,
  correosValidos,
  estadoCorreo,
  type ConfigAvisos,
  type EstadoCorreo,
  type Severidad,
  type TipoAviso,
} from "./reglas-avisos";

export interface NuevoAviso {
  tipo: TipoAviso;
  titulo: string;
  mensaje: string;
  ruta?: string | null;
  otId?: string | null;
  certificadoId?: string | null;
  /** Clave sin repetir por persona (p. ej. `ot_vencida:<ot>:<día>`). */
  clave: string;
  severidad?: Severidad;
  creadoPor?: string | null;
}

/** A quién avisar: personas concretas o resueltas por su rol y unidad. */
export interface Destinatarios {
  usuarios?: (string | null | undefined)[];
  /** Jefes (titular, subrogante o rol JEFE_LAB) de estas unidades. */
  jefesDe?: (string | null | undefined)[];
  /** Personas con estos roles (canónicos) en estas unidades por código; sin unidad = en cualquier unidad. */
  roles?: { rol: string; unidadCodigo?: string | null }[];
  /** Correos externos (cliente): solo correo, sin aviso interno. */
  correosExternos?: (string | null | undefined)[];
}

const UNA_HORA = 60 * 60 * 1000;

@Injectable()
export class AvisosService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AvisosService.name);
  private reloj: NodeJS.Timeout | null = null;
  private bajas: (() => void)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    this.bajas.push(alEvento("resultado.aprobado", (d) => this.alAprobarResultado(d.resultadoId, d.usuarioId)));
    this.bajas.push(alEvento("documento.oficial", (d) => this.alOficializar(d.certificadoId, d.tenantId, d.usuarioId)));
    // Revisión de plazos cada hora (desactivable por entorno o por parámetro).
    if (process.env.AVISOS_AUTOMATICOS !== "false" && process.env.NODE_ENV !== "test") {
      this.reloj = setInterval(() => this.revisarTodos().catch(() => undefined), UNA_HORA);
      this.reloj.unref?.();
      setTimeout(() => this.revisarTodos().catch(() => undefined), 30_000).unref?.();
    }
  }

  onModuleDestroy() {
    if (this.reloj) clearInterval(this.reloj);
    this.bajas.forEach((b) => b());
  }

  async config(tenantId: string): Promise<ConfigAvisos> {
    const filas = await this.prisma
      .$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
        `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'avisos'`,
        tenantId,
      )
      .catch(() => []);
    return configAvisos(filas);
  }

  /* -------------------------------------------------------- destinatarios --- */

  async resolver(tenantId: string, d: Destinatarios): Promise<string[]> {
    const ids = new Set<string>((d.usuarios ?? []).filter((x): x is string => !!x));
    const jefesDe = (d.jefesDe ?? []).filter((x): x is string => !!x);
    if (jefesDe.length) {
      const f = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT j.usuario_id AS id FROM unidad_jefe j WHERE j.unidad_id = ANY($1::uuid[])
         UNION
         SELECT ur.usuario_id FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id
          WHERE ur.unidad_id = ANY($1::uuid[]) AND COALESCE(r.alias_de, r.codigo) IN ('JEFE_LAB', 'JEFE_SECCION', 'JEFE_DEPTO')
            AND (ur.vigente_desde IS NULL OR ur.vigente_desde <= now()) AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta > now())`,
        jefesDe,
      );
      f.forEach((x) => ids.add(x.id));
    }
    for (const r of d.roles ?? []) {
      const f = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT DISTINCT ur.usuario_id AS id FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id
           LEFT JOIN unidad u ON u.id = ur.unidad_id
          WHERE COALESCE(r.alias_de, r.codigo) = $1 AND r.tenant_id = $3::uuid
            AND ($2::text IS NULL OR u.codigo = $2)
            AND (ur.vigente_desde IS NULL OR ur.vigente_desde <= now()) AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta > now())
         UNION
         SELECT j.usuario_id FROM unidad_jefe j JOIN unidad u ON u.id = j.unidad_id
          WHERE $2::text IS NOT NULL AND u.codigo = $2 AND u.tenant_id = $3::uuid AND $1 IN ('JEFE_LAB', 'JEFE_SECCION', 'JEFE_DEPTO')`,
        r.rol,
        r.unidadCodigo ?? null,
        tenantId,
      );
      f.forEach((x) => ids.add(x.id));
    }
    if (!ids.size) return [];
    const activos = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM usuario WHERE id = ANY($1::uuid[]) AND tenant_id = $2::uuid AND deleted_at IS NULL AND estado = 'activo'`,
      [...ids],
      tenantId,
    );
    return activos.map((x) => x.id);
  }

  /* ---------------------------------------------------------------- emitir --- */

  /**
   * Crea el aviso para cada persona que aún no lo tiene (misma clave) y, si
   * corresponde, envía UN correo a las nuevas y a los correos externos.
   * Devuelve cuántas personas lo recibieron y qué pasó con el correo.
   */
  async emitir(tenantId: string, a: NuevoAviso, d: Destinatarios, opts: { correo?: boolean } = {}): Promise<{ nuevos: number; correo: EstadoCorreo }> {
    const cfg = await this.config(tenantId);
    const usuarios = await this.resolver(tenantId, d);
    const severidad = a.severidad ?? TIPOS_AVISO[a.tipo] ?? "info";
    const nuevos: string[] = [];
    for (const u of usuarios) {
      const f = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO aviso (tenant_id, usuario_id, tipo, severidad, titulo, mensaje, ruta, ot_id, certificado_id, clave, creado_por)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid, $9::uuid, $10, $11::uuid)
         ON CONFLICT (tenant_id, usuario_id, clave) DO NOTHING RETURNING id`,
        tenantId,
        u,
        a.tipo,
        severidad,
        a.titulo.slice(0, 200),
        a.mensaje,
        a.ruta ?? null,
        a.otId ?? null,
        a.certificadoId ?? null,
        a.clave.slice(0, 200),
        a.creadoPor ?? null,
      );
      if (f.length) nuevos.push(u);
    }
    const externos = correosValidos(d.correosExternos ?? []);
    if (!nuevos.length && !externos.length) return { nuevos: 0, correo: "no_aplica" };

    // Hito en el historial de la OT (una vez por clave).
    if (a.otId && nuevos.length) {
      await this.prisma
        .$executeRawUnsafe(
          `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id)
           SELECT $1::uuid, $2::uuid, 'aviso', jsonb_build_object('tipo', $3::text, 'titulo', $4::text, 'clave', $5::text, 'personas', $6::int), $7::uuid
            WHERE NOT EXISTS (SELECT 1 FROM ot_historial h WHERE h.ot_id = $2::uuid AND h.tipo = 'aviso' AND h.detalle->>'clave' = $5)`,
          tenantId,
          a.otId,
          a.tipo,
          a.titulo,
          a.clave,
          nuevos.length,
          a.creadoPor ?? null,
        )
        .catch(() => undefined);
    }

    const quiere = (opts.correo ?? true) && cfg.enviarCorreo;
    let estado: EstadoCorreo = "no_aplica";
    if (quiere) {
      const internos = nuevos.length
        ? await this.prisma.$queryRawUnsafe<{ email: string | null }[]>(`SELECT email FROM usuario WHERE id = ANY($1::uuid[])`, nuevos)
        : [];
      const para = correosValidos([...internos.map((x) => x.email), ...externos]);
      let error: string | null = null;
      if (para.length) {
        try {
          await this.mail.sendMail(tenantId, {
            to: para,
            subject: `IDIC · ${a.titulo}`.slice(0, 300),
            html:
              `<p>${escapeHtml(a.mensaje)}</p>` +
              `<p style="color:#666">Aviso automático del LIMS del Instituto de Investigaciones y Control del Ejército de Chile. ` +
              `Lo encuentra también en «Mi bandeja».</p>`,
          });
        } catch (e: any) {
          error = String(e?.response ?? e?.message ?? "Error al enviar").slice(0, 300);
        }
        await this.prisma
          .$executeRawUnsafe(
            `INSERT INTO correo_enviado (tenant_id, tipo, destinatarios, asunto, cuerpo_resumen, plantilla, ot_id, estado, error, enviado_por)
             VALUES ($1::uuid, 'aviso', $2, $3, $4, $5, $6::uuid, $7, $8, $9::uuid)`,
            tenantId,
            para.join(", "),
            `IDIC · ${a.titulo}`.slice(0, 300),
            a.mensaje.slice(0, 500),
            `aviso_${a.tipo}`.slice(0, 60),
            a.otId ?? null,
            error ? "error" : "enviado",
            error,
            a.creadoPor ?? null,
          )
          .catch(() => undefined);
      }
      estado = estadoCorreo({ quiere, destinatarios: para.length, error });
      if (nuevos.length)
        await this.prisma
          .$executeRawUnsafe(
            `UPDATE aviso SET correo_estado = $3, correo_error = $4 WHERE tenant_id = $1::uuid AND clave = $2 AND usuario_id = ANY($5::uuid[])`,
            tenantId,
            a.clave.slice(0, 200),
            estado,
            error,
            nuevos,
          )
          .catch(() => undefined);
    }
    return { nuevos: nuevos.length, correo: estado };
  }

  /* ------------------------------------------------------------ disparadores --- */

  /** Datos comunes de una OT para los avisos. */
  private async datosOt(otId: string) {
    const [o] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id, o.codigo, o.tenant_id, o.unidad_principal, o.fecha_compromiso::text AS fecha_compromiso, o.estado,
              u.codigo AS unidad, c.razon_social AS cliente, c.email AS cliente_email, cot.ejecutivo_id
         FROM orden_trabajo o
         LEFT JOIN unidad u ON u.id = o.unidad_principal
         LEFT JOIN cliente c ON c.id = o.cliente_id
         LEFT JOIN cotizacion cot ON cot.id = o.cotizacion_id
        WHERE o.id = $1::uuid`,
      otId,
    );
    return o ?? null;
  }

  /** Contrato §4.2.6 / §4.3.9: No cumple o Contaminado al aprobar → Jefe de Laboratorio (y cliente si el parámetro lo pide). */
  async alAprobarResultado(resultadoId: string, usuarioId: string | null) {
    const [r] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id, r.ot_id, r.veredicto, r.valor_texto, r.observacion, m.codigo AS muestra, lr.unidad_id,
              COALESCE(ce.nombre, cm.nombre, a.nombre, 'ensayo') AS ensayo
         FROM resultado r
         JOIN muestra m ON m.id = r.muestra_id
         LEFT JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
         LEFT JOIN cat_ensayo ce ON ce.id = cm.ensayo_id
         LEFT JOIN analito a ON a.id = r.analito_id
         LEFT JOIN LATERAL lims_lab_de_resultado(r.id) lr ON TRUE
        WHERE r.id = $1::uuid`,
      resultadoId,
    );
    if (!r?.ot_id) return null;
    const alerta = alertaDeResultado({ veredicto: r.veredicto, valorTexto: r.valor_texto, observacion: r.observacion });
    if (!alerta) return null;
    const ot = await this.datosOt(r.ot_id);
    if (!ot) return null;
    const cfg = await this.config(ot.tenant_id);
    const titulo = alerta === "contaminado" ? `Resultado Contaminado · OT ${ot.codigo}` : `Resultado No cumple · OT ${ot.codigo}`;
    const mensaje = `${alerta === "contaminado" ? "Contaminado" : "No cumple"}: ${r.ensayo} de la muestra ${r.muestra} (OT ${ot.codigo}${ot.cliente ? `, ${ot.cliente}` : ""}). Resultado aprobado.`;
    return this.emitir(
      ot.tenant_id,
      { tipo: alerta, titulo, mensaje, ruta: `/ot/${ot.id}?tab=resultados`, otId: ot.id, clave: `${alerta}:${r.id}`, creadoPor: usuarioId },
      { jefesDe: [r.unidad_id ?? ot.unidad_principal], usuarios: [ot.ejecutivo_id], correosExternos: cfg.noCumpleAlCliente ? [ot.cliente_email] : [] },
    );
  }

  /** Documento oficial → Comercial (ejecutivo de la cotización o Ventas y Planificación) para entregarlo. */
  async alOficializar(certificadoId: string, tenantId: string, usuarioId: string | null) {
    const cfg = await this.config(tenantId);
    if (!cfg.documentoListo) return null;
    const [c] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id, COALESCE(c.numero, c.codigo) AS numero, c.ot_id FROM certificado c WHERE c.id = $1::uuid`,
      certificadoId,
    );
    if (!c) return null;
    const ot = await this.datosOt(c.ot_id);
    if (!ot) return null;
    return this.emitir(
      tenantId,
      {
        tipo: "documento_listo",
        titulo: `Documento oficial ${c.numero} · OT ${ot.codigo}`,
        mensaje: `El documento ${c.numero} de la OT ${ot.codigo}${ot.cliente ? ` (${ot.cliente})` : ""} quedó oficial con todas sus firmas: está listo para despacharlo y entregarlo.`,
        ruta: `/ot/${ot.id}?tab=informe`,
        otId: ot.id,
        certificadoId: c.id,
        clave: `documento_listo:${c.id}`,
        creadoPor: usuarioId,
      },
      ot.ejecutivo_id ? { usuarios: [ot.ejecutivo_id], jefesDe: [ot.unidad_principal] } : { roles: [{ rol: "COMERCIAL" }, { rol: "PLANIFICACION" }], jefesDe: [ot.unidad_principal] },
    );
  }

  /**
   * Plazos (EP-00 6.2): avisa las OT vencidas (una vez al día) y por vencer (una
   * vez) al laboratorio y al ejecutivo, con hito en el historial. `otIds` acota
   * a unas OT (botón «Avisar →»); sin él, todas las abiertas del tenant.
   */
  async revisarPlazos(tenantId: string, opts: { otIds?: string[]; usuarioId?: string | null; forzar?: boolean } = {}) {
    const cfg = await this.config(tenantId);
    const hoy = hoyCl();
    const ots = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id FROM orden_trabajo o
        WHERE o.tenant_id = $1::uuid AND o.estado NOT IN ('cerrada', 'anulada') AND o.fecha_compromiso IS NOT NULL
          AND ($2::uuid[] IS NULL OR o.id = ANY($2::uuid[]))`,
      tenantId,
      opts.otIds?.length ? opts.otIds : null,
    );
    let vencidas = 0;
    let porVencer = 0;
    let personas = 0;
    for (const { id } of ots) {
      const ot = await this.datosOt(id);
      if (!ot) continue;
      const tipo = avisoDePlazo(ot.fecha_compromiso, hoy, cfg.diasPorVencer);
      if (!tipo) continue;
      const vencida = tipo === "vencida";
      // «Avisar →» manual: se repite aunque ya se avisara hoy (clave con la hora).
      const sufijo = opts.forzar ? `:${Date.now()}` : "";
      const r = await this.emitir(
        tenantId,
        {
          tipo: vencida ? "ot_vencida" : "ot_por_vencer",
          titulo: `${vencida ? "OT vencida" : "OT por vencer"} · ${ot.codigo}`,
          mensaje: `La OT ${ot.codigo}${ot.cliente ? ` (${ot.cliente})` : ""} del ${ot.unidad ?? "laboratorio"} ${vencida ? "venció" : "vence"} el ${ot.fecha_compromiso.split("-").reverse().join("-")} y aún no está terminada.`,
          ruta: `/ot/${ot.id}`,
          otId: ot.id,
          clave: vencida ? `ot_vencida:${ot.id}:${hoy}${sufijo}` : `ot_por_vencer:${ot.id}:${ot.fecha_compromiso}${sufijo}`,
          creadoPor: opts.usuarioId ?? null,
        },
        { jefesDe: [ot.unidad_principal], usuarios: [ot.ejecutivo_id], roles: ot.ejecutivo_id ? [] : [{ rol: "PLANIFICACION" }] },
      );
      if (r.nuevos) {
        if (vencida) vencidas++;
        else porVencer++;
        personas += r.nuevos;
      }
    }
    return { vencidas, porVencer, personas };
  }

  /** Revisión periódica de todos los tenants con la revisión automática activa. */
  async revisarTodos() {
    const tenants = await this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM tenant`).catch(() => []);
    for (const t of tenants) {
      const cfg = await this.config(t.id);
      if (!cfg.revisionAutomatica) continue;
      await this.revisarPlazos(t.id).catch((e) => this.log.warn(`revisión de plazos omitida: ${e?.message ?? e}`));
    }
  }

  /* ----------------------------------------------------------- mis avisos --- */

  async mios(usuarioId: string, tenantId: string, soloNoLeidos: boolean, limite = 50) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.id, a.tipo, a.severidad, a.titulo, a.mensaje, a.ruta, a.ot_id AS "otId", o.codigo AS "otCodigo",
              a.correo_estado AS "correoEstado", a.leido_at AS "leidoAt", a.created_at AS "createdAt"
         FROM aviso a LEFT JOIN orden_trabajo o ON o.id = a.ot_id
        WHERE a.usuario_id = $1::uuid AND a.tenant_id = $2::uuid AND ($3::boolean = FALSE OR a.leido_at IS NULL)
        ORDER BY a.leido_at IS NOT NULL, a.created_at DESC
        LIMIT $4::int`,
      usuarioId,
      tenantId,
      soloNoLeidos,
      Math.min(Math.max(limite, 1), 200),
    );
    const [n] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM aviso WHERE usuario_id = $1::uuid AND tenant_id = $2::uuid AND leido_at IS NULL`,
      usuarioId,
      tenantId,
    );
    return { noLeidos: Number(n?.n ?? 0), data: filas };
  }

  async marcarLeido(usuarioId: string, tenantId: string, id: string | null) {
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE aviso SET leido_at = now() WHERE usuario_id = $1::uuid AND tenant_id = $2::uuid AND leido_at IS NULL AND ($3::uuid IS NULL OR id = $3::uuid)`,
      usuarioId,
      tenantId,
      id,
    );
    return { marcados: Number(n) };
  }
}
