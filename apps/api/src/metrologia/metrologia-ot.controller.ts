import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException,
  Param, ParseUUIDPipe, Post, Put, Req, UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { exigirMedioEnvioActivo, textoEnFrase, zMedioEnvio } from "../common/medios-envio";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { caminoEstadosOt } from "../ot/plazos";
import { motivoHabilitacion, type Firmante } from "./metrologia.reglas";
import {
  ESTADOS_FISICOS, ESTADOS_SIN_CIERRE_TECNICO, instanteChile, calibracionVigente, etiquetaInstrumento, faltantesCierreTecnico,
  faltantesMetrologia, motivoCalibrar, motivoDevolucion, motivoEntrega, motivoRecepcion,
} from "./metrologia-ot.reglas";
import { LABS_SAM, calibracionesDeOt, metrologiaParaCierre, instrumentosDeOt, type InstrumentoFila } from "./metrologia-ot.datos";
import { actualizarEquipoDueno, enviarCertificado, leerConfigFicha, textoErrorCorreo } from "./ficha.datos";
import { MailService } from "../configuracion/configuracion.module";
import { SQL_ZONA, hoyChile } from "../common/fecha-chile";

// ---------------------------------------------------------------------------
// Metrología ligada a la OT (EP-04, entrega R1): ítems «instrumento» de la OT,
// recepción con custodia, asignación del metrólogo habilitado, entrega del
// certificado, devolución del instrumento con acta y cierre técnico.
// Va bajo /ot (no bajo /metrologia) para que Comercial y Planificación, que no
// trabajan en la Sección Metrología, vean y entreguen lo de sus OT: el alcance
// lo da el laboratorio de la OT. Reglas puras: metrologia-ot.reglas.ts.
// ---------------------------------------------------------------------------

const texto = (max: number) => z.string().trim().max(max).nullish().transform((x) => (x ? x : null));
const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const fechaHora = z.string().trim().min(10, "Indique la fecha y hora").max(40);

const InstrumentoSchema = z.object({
  descripcion: z.string().trim().min(2, "Indique la descripción del instrumento").max(300),
  marca: texto(120), modelo: texto(120), serie: texto(120), idEspecial: texto(120),
  capacidad: texto(120), resolucion: texto(120), rango: texto(160),
  procesoCodigo: texto(20),
  sentido: z.enum(["T", "C", "T+C"]).nullish(),
  puntos: texto(500),
  intervaloMeses: z.coerce.number().int().min(0).max(120).nullish(),
  /** Código del equipo en el maestro de Equipos (OT interna: equipo del laboratorio dueño). */
  equipoCodigo: texto(40),
});
const AccesorioSchema = z.object({
  tipo: z.string().trim().min(1).max(80), marca: texto(80), modelo: texto(80), serie: texto(80), detalle: texto(200),
});
const RecepcionSchema = z.object({
  fechaHora,
  entregadoPor: z.string().trim().max(160),
  estadoFisico: z.enum(ESTADOS_FISICOS),
  estadoFisicoObs: texto(1000),
  accesorios: z.array(AccesorioSchema).max(20).default([]),
  ubicacion: z.string().trim().max(160),
  calibrable: z.boolean(),
  motivoNoCalibrable: texto(1000),
  requiereExterno: z.boolean().nullish(),
  sentido: z.enum(["T", "C", "T+C"]).nullish(),
  acondicionamientoH: z.coerce.number().min(0).max(1000).nullish(),
  tempAmbiente: z.coerce.number().min(-50).max(100).nullish(),
  // Datos del instrumento heredados de la OT, editables al recibir.
  descripcion: z.string().trim().min(2).max(300).optional(),
  marca: texto(120).optional(), modelo: texto(120).optional(), serie: texto(120).optional(), idEspecial: texto(120).optional(),
  capacidad: texto(120).optional(), resolucion: texto(120).optional(),
});
const AsignarSchema = z.object({ metrologoId: z.string().uuid(), fechaPrevista: fechaDia.nullish() });
const DevolucionSchema = z.object({
  fechaHora,
  recibidoPor: z.string().trim().max(160),
  estadoFisico: z.enum(ESTADOS_FISICOS),
  observacion: texto(1000),
  guia: texto(80),
});
const EntregaSchema = z.object({
  /** AAAA-MM-DD (día de Chile) o fecha-hora; sin ella, ahora. */
  fecha: z.string().trim().max(40).optional(),
  // Frente f5: «Parámetros del sistema › medio_envio» (se comprueba que esté activo al entregar).
  medio: zMedioEnvio,
  destinatario: z.string().trim().min(2, "Indique a quién se entregó").max(160),
  observacion: texto(1000),
});
const MotivoSchema = z.object({ motivo: z.string().trim().min(5, "Indique el motivo (mínimo 5 caracteres)").max(1000) });
const CorreoSchema = z.object({
  destinatarios: z.array(z.string().trim().email("Correo no válido").max(160)).min(1, "Indique al menos un correo").max(10),
  mensaje: z.string().trim().max(1000).nullish(),
});

/**
 * Instante de la entrega: un día AAAA-MM-DD se lee en hora de Chile (hoy → ahora; otro
 * día → mediodía de ese día), para que «20-10» no se guarde como el 19 a las 21:00.
 */
export function fechaEntrega(f?: string | null, ahora = new Date()): Date {
  if (!f) return ahora;
  if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
    const hoy = hoyChile(ahora);
    return f === hoy ? ahora : new Date(instanteChile(`${f}T12:00`));
  }
  return new Date(instanteChile(f));
}

const tiene = (req: any, p: string) => (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes(p);

/** Permisos de cada acción (basta uno, con alcance sobre el laboratorio de la OT). */
export const PERMISOS_ACCION = {
  registrar: ["ot.crear", "ot.asignar", "metrologia.crear"],
  recibir: ["metrologia.crear", "muestra.crear"],
  asignar: ["ot.asignar"],
  devolver: ["metrologia.crear", "certificado.entregar"],
  entregar: ["certificado.entregar", "metrologia.crear"],
  cierreTecnico: ["ot.asignar"],
} as const;
type Accion = keyof typeof PERMISOS_ACCION;

@Injectable()
export class MetrologiaOtService {
  constructor(private readonly prisma: PrismaService, private readonly alcance: AlcanceService, private readonly mail: MailService) {}

  private tenant(req: any): string {
    const t = req?.user?.tenantId;
    if (!t) throw new NotFoundException("Tenant no resuelto");
    return t;
  }

  /** OT del tenant, con su laboratorio, dentro del alcance de lectura del usuario. */
  async cargarOt(id: string, req: any) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id, o.codigo, o.estado, o.tenant_id AS "tenantId", o.unidad_principal AS "unidadId", o.con_cobro AS "conCobro",
              o.cotizacion_id AS "cotizacionId", o.origen_trabajo AS "origen", o.created_at AS "createdAt",
              to_char(COALESCE(o.fecha_recepcion, o.created_at) AT TIME ZONE ${SQL_ZONA}, 'YYYY-MM-DD') AS "fechaOt",
              u.codigo AS laboratorio, u.nombre AS "laboratorioNombre", c.razon_social AS cliente, c.direccion AS "clienteDireccion",
              cc.nombre AS "labSolicitante", NULLIF(trim(o.solicitante), '') AS solicitante,
              NULLIF(concat_ws(' · ', NULLIF(COALESCE(ct.telefono, c.contacto_telefono), ''), NULLIF(COALESCE(ct.email::text, c.contacto_email::text), '')), '') AS contacto
         FROM orden_trabajo o
         LEFT JOIN unidad u ON u.id = o.unidad_principal
         LEFT JOIN cliente c ON c.id = o.cliente_id
         LEFT JOIN centro_costo cc ON cc.id = o.lab_solicitante_cc_id
         LEFT JOIN cotizacion cz ON cz.id = o.cotizacion_id
         LEFT JOIN contacto ct ON ct.id = cz.solicitante_contacto_id
        WHERE o.id = $1::uuid AND o.tenant_id = $2::uuid`,
      id, this.tenant(req),
    );
    if (!filas.length) throw new NotFoundException(`OT ${id} no encontrada`);
    const ot = filas[0];
    await this.alcance.exigirUnidad(req, ot.unidadId, `la OT ${ot.codigo}`, "ot.ver");
    return ot as {
      id: string; codigo: string; estado: string; tenantId: string; unidadId: string | null; conCobro: boolean; cotizacionId: string | null;
      origen: string | null; fechaOt: string; laboratorio: string | null; laboratorioNombre: string | null; cliente: string | null;
      clienteDireccion: string | null; labSolicitante: string | null; solicitante: string | null; contacto: string | null;
    };
  }

  /** ¿Puede el usuario hacer la acción en la OT? (permiso + alcance en el laboratorio de la OT). */
  async puede(req: any, accion: Accion, unidadId: string | null): Promise<boolean> {
    for (const p of PERMISOS_ACCION[accion]) {
      if (tiene(req, p) && (await this.alcance.puedeVerUnidad(req, unidadId, p))) return true;
    }
    return false;
  }

  private async exigir(req: any, accion: Accion, ot: { unidadId: string | null; codigo: string }) {
    if (await this.puede(req, accion, ot.unidadId)) return;
    const que: Record<Accion, string> = {
      registrar: "registrar instrumentos", recibir: "recibir instrumentos", asignar: "asignar metrólogos",
      devolver: "registrar la devolución de instrumentos", entregar: "registrar la entrega de certificados", cierreTecnico: "cerrar técnicamente la OT",
    };
    throw new ForbiddenException(
      `No puede ${que[accion]} en la OT ${ot.codigo}: requiere ${PERMISOS_ACCION[accion].join(" o ")} en el laboratorio de la OT.`,
    );
  }

  private exigirMetrologia(ot: { laboratorio: string | null; codigo: string }) {
    if (!ot.laboratorio || !LABS_SAM.includes(ot.laboratorio))
      throw new BadRequestException(`La OT ${ot.codigo} no es de un laboratorio de Metrología (${LABS_SAM.join(", ")}): sus trabajos se registran como muestras.`);
  }

  private exigirAbierta(ot: { estado: string; codigo: string }) {
    if (ot.estado === "cerrada" || ot.estado === "anulada") throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}.`);
  }

  private async item(otId: string, itemId: string, tx: any = this.prisma, bloquear = false): Promise<InstrumentoFila> {
    if (bloquear) await tx.$queryRawUnsafe(`SELECT 1 FROM met_ot_instrumento WHERE id = $1::uuid FOR UPDATE`, itemId);
    const it = (await instrumentosDeOt(tx, otId)).find((x) => x.id === itemId);
    if (!it) throw new NotFoundException("Instrumento no encontrado en esta OT");
    return it;
  }

  /** Proceso válido para el laboratorio de la OT (o sin laboratorio fijo, como PTS01). */
  private async validarProceso(codigo: string | null, laboratorio: string | null) {
    if (!codigo) return null;
    const p = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.codigo, p.laboratorio, m.codigo AS magnitud FROM met_proceso p JOIN met_magnitud m ON m.id = p.magnitud_id WHERE p.codigo = $1 AND p.activo`, codigo);
    if (!p.length) throw new BadRequestException(`Proceso de calibración desconocido: ${codigo}`);
    if (p[0].laboratorio && p[0].laboratorio !== laboratorio)
      throw new BadRequestException(`El proceso ${codigo} es del ${p[0].laboratorio}; la OT es del ${laboratorio ?? "laboratorio sin fijar"}.`);
    return p[0] as { codigo: string; laboratorio: string | null; magnitud: string };
  }

  private async equipoId(tenantId: string, codigo: string | null): Promise<string | null> {
    if (!codigo) return null;
    const e = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM equipo WHERE tenant_id = $1::uuid AND codigo = $2 AND deleted_at IS NULL LIMIT 1`, tenantId, codigo);
    if (!e.length) throw new BadRequestException(`No hay un equipo con el código ${codigo} en el maestro de Equipos.`);
    return e[0].id;
  }

  /* ------------------------------------------------------------- lectura --- */
  /** Instrumentos, calibraciones, qué falta y qué puede hacer el usuario. */
  async resumen(otId: string, req: any) {
    const ot = await this.cargarOt(otId, req);
    // Mismos datos y reglas que el cierre final (ot-cierre.controller.ts) y la Ruta de la OT (D04-31).
    const metro = await metrologiaParaCierre(this.prisma, otId, ot.tenantId);
    const { items, cals, exigeDevolucion: exige } = metro;
    const esMetrologia = !!ot.laboratorio && LABS_SAM.includes(ot.laboratorio);
    const abierta = ot.estado !== "cerrada" && ot.estado !== "anulada";
    const [registrar, recibir, asignar, devolver, entregar, cierreTecnico] = await Promise.all(
      (["registrar", "recibir", "asignar", "devolver", "entregar", "cierreTecnico"] as Accion[]).map((a) => this.puede(req, a, ot.unidadId)),
    );
    const puedeCalibrar = tiene(req, "metrologia.crear") && (await this.alcance.puedeVerUnidad(req, ot.unidadId, "metrologia.crear"));
    const yo = req?.user?.sub;
    // B-029: documento de cada ítem no calibrable (informe técnico o certificado externo) para la tabla y el cierre.
    const docsNoCal = metro.docsNoCalibrables;
    const instrumentos = items.map((i) => {
      const v = calibracionVigente(cals, i.id);
      const acciones: string[] = [];
      if (abierta && esMetrologia) {
        if (i.estado === "por_recibir" && registrar) acciones.push("EDITAR", "ANULAR");
        if (i.estado === "por_recibir" && recibir) acciones.push("RECIBIR");
        if ((i.estado === "por_recibir" || i.estado === "recibido") && asignar && !v) acciones.push("ASIGNAR");
        if (puedeCalibrar && !motivoCalibrar({ ...i, otEstado: ot.estado }, cals) && (!i.metrologoId || i.metrologoId === yo || asignar)) acciones.push("CALIBRAR");
        if (devolver && (i.estado === "no_apto" || (i.estado === "recibido" && v?.estado === "emitida"))) acciones.push("DEVOLVER");
        if (v && v.estado === "emitida" && !v.entregadoAt && entregar) acciones.push("ENTREGAR");
      }
      return {
        ...i, calibracion: v, acciones,
        documentosNoCalibrable: docsNoCal.filter((x) => x.instrumentoId === i.id)
          .map((x) => ({ itemId: x.instrumentoId, tipo: x.tipo, numero: x.numero, estado: x.estado, entregadoAt: x.entregadoAt, entregaMedio: x.entregaMedio ?? null })),
      };
    });
    const reglas = { exigeDevolucion: exige, noAptoExigeDocumento: metro.noAptoExigeDocumento };
    // D04-31: «Para cerrar la OT falta:» y el cierre técnico dicen lo mismo. Antes del cierre técnico la
    // lista es la del cierre técnico (documentos oficiales y entregados, devueltos, ningún externo a
    // medio camino); después, la parte de Metrología del cierre final (las mismas reglas).
    const faltaCt = esMetrologia ? faltantesCierreTecnico(ot.estado, items, cals, docsNoCal, reglas) : ["La OT no es de Metrología."];
    const sinCt = (ESTADOS_SIN_CIERRE_TECNICO as readonly string[]).includes(ot.estado);
    const faltantes = esMetrologia && items.length
      ? sinCt ? (ot.estado === "cerrada" || ot.estado === "anulada" ? [] : faltantesMetrologia(items, cals, docsNoCal, reglas)) : faltaCt
      : [];
    return {
      ot: { ...ot, esMetrologia },
      instrumentos,
      calibraciones: cals,
      exigeDevolucion: exige,
      faltantes,
      // posible: sin faltantes y con permiso; faltantes: lo que falta (el botón se muestra deshabilitado con esa lista).
      cierreTecnico: {
        posible: !faltaCt.length && cierreTecnico,
        motivo: faltaCt.length ? faltaCt.join(" ") : null,
        faltantes: sinCt ? [] : faltaCt,
        aplica: esMetrologia && !sinCt && items.some((i) => i.estado !== "anulado"),
      },
      puedo: { registrar: registrar && abierta && esMetrologia, recibir, asignar, devolver, entregar, cierreTecnico, calibrar: puedeCalibrar },
    };
  }

  /** Metrólogos que se pueden asignar al ítem: del laboratorio de la OT y habilitados para la magnitud. */
  async metrologos(otId: string, itemId: string, req: any) {
    const ot = await this.cargarOt(otId, req);
    const it = await this.item(otId, itemId);
    const proc = await this.validarProceso(it.procesoCodigo, ot.laboratorio);
    return { data: await this.candidatos(ot, proc?.magnitud ?? null), magnitud: proc?.magnitud ?? null };
  }

  private async candidatos(ot: { tenantId: string; unidadId: string | null; laboratorio: string | null }, magnitud: string | null) {
    if (!ot.unidadId) return [];
    const usuarios = await this.prisma.$queryRawUnsafe<{ id: string; nombre: string; username: string }[]>(
      `SELECT DISTINCT u.id, u.nombre_completo AS nombre, u.username
         FROM usuario u
         JOIN usuario_rol ur ON ur.usuario_id = u.id AND ur.unidad_id = $2::uuid
         JOIN rol_permiso rp ON rp.rol_id = ur.rol_id
         JOIN permiso p ON p.id = rp.permiso_id AND p.codigo = 'metrologia.crear'
        WHERE u.tenant_id = $1::uuid AND u.deleted_at IS NULL AND u.estado = 'activo'
          AND (ur.vigente_desde IS NULL OR ur.vigente_desde <= now()) AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta >= now())
        ORDER BY 2`,
      ot.tenantId, ot.unidadId,
    );
    const registro = await this.registro(ot.tenantId);
    return usuarios.map((u) => {
      const motivo = magnitud ? motivoHabilitacion(registro, u.id, ot.laboratorio, magnitud) : null;
      return { ...u, habilitado: !motivo, motivo };
    });
  }

  private async registro(tenantId: string): Promise<Firmante[]> {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT funcion, magnitudes, laboratorios, usuario_id, activo, iniciales FROM met_firmante WHERE tenant_id = $1::uuid`, tenantId);
    return rows.map((r) => ({ funcion: r.funcion, magnitudes: r.magnitudes ?? [], laboratorios: r.laboratorios ?? [], usuarioId: r.usuario_id, activo: r.activo, iniciales: r.iniciales }));
  }

  /* -------------------------------------------------------------- ítems --- */
  async registrar(otId: string, body: unknown, req: any) {
    const d = InstrumentoSchema.parse(body ?? {});
    const ot = await this.cargarOt(otId, req);
    this.exigirMetrologia(ot); this.exigirAbierta(ot);
    await this.exigir(req, "registrar", ot);
    await this.validarProceso(d.procesoCodigo, ot.laboratorio);
    const equipoId = await this.equipoId(ot.tenantId, d.equipoCodigo);
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT 1 FROM orden_trabajo WHERE id = $1::uuid FOR UPDATE`, otId);
      const n = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COALESCE(MAX(numero), 0)::int + 1 AS n FROM met_ot_instrumento WHERE ot_id = $1::uuid`, otId);
      const r = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO met_ot_instrumento (tenant_id, ot_id, numero, descripcion, marca, modelo, serie, id_especial, capacidad, resolucion, rango,
                                         proceso_codigo, sentido, puntos, intervalo_meses, equipo_id, created_by)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::uuid, $17::uuid) RETURNING id`,
        ot.tenantId, otId, n[0].n, d.descripcion, d.marca, d.modelo, d.serie, d.idEspecial, d.capacidad, d.resolucion, d.rango,
        d.procesoCodigo, d.sentido ?? null, d.puntos, d.intervaloMeses ?? null, equipoId, req?.user?.sub ?? null);
      return r[0].id;
    });
    return { data: { id } };
  }

  /** Corrige un ítem aún no recibido (el proceso lo cambia quien registra o la jefatura). */
  async editar(otId: string, itemId: string, body: unknown, req: any) {
    const d = InstrumentoSchema.parse(body ?? {});
    const ot = await this.cargarOt(otId, req);
    this.exigirMetrologia(ot); this.exigirAbierta(ot);
    await this.exigir(req, "registrar", ot);
    const it = await this.item(otId, itemId);
    if (it.estado !== "por_recibir") throw new ConflictException(`El ítem ${it.numero} ya fue recibido: sus datos se corrigen en la recepción o en la calibración.`);
    await this.validarProceso(d.procesoCodigo, ot.laboratorio);
    const equipoId = await this.equipoId(ot.tenantId, d.equipoCodigo);
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE met_ot_instrumento SET descripcion = $2, marca = $3, modelo = $4, serie = $5, id_especial = $6, capacidad = $7, resolucion = $8,
              rango = $9, proceso_codigo = $10, sentido = $11, puntos = $12, intervalo_meses = $13, equipo_id = $14::uuid, updated_at = now()
        WHERE id = $1::uuid AND estado = 'por_recibir'`,
      itemId, d.descripcion, d.marca, d.modelo, d.serie, d.idEspecial, d.capacidad, d.resolucion, d.rango, d.procesoCodigo, d.sentido ?? null,
      d.puntos, d.intervaloMeses ?? null, equipoId);
    if (!n) throw new ConflictException("El ítem cambió de estado mientras tanto; recargue la OT");
    return { data: { id: itemId } };
  }

  async anular(otId: string, itemId: string, body: unknown, req: any) {
    const { motivo } = MotivoSchema.parse(body ?? {});
    const ot = await this.cargarOt(otId, req);
    this.exigirAbierta(ot);
    await this.exigir(req, "registrar", ot);
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE met_ot_instrumento SET estado = 'anulado', anulado_motivo = $2, updated_at = now() WHERE id = $1::uuid AND ot_id = $3::uuid AND estado = 'por_recibir'`,
      itemId, motivo, otId);
    if (!n) throw new ConflictException("Solo se anula un instrumento que aún no se ha recibido.");
    return { data: { id: itemId, estado: "anulado" } };
  }

  /** Un ítem por unidad de cada línea de la cotización aceptada de la OT (sin duplicar las ya cargadas). */
  async desdeCotizacion(otId: string, req: any) {
    const ot = await this.cargarOt(otId, req);
    this.exigirMetrologia(ot); this.exigirAbierta(ot);
    await this.exigir(req, "registrar", ot);
    if (!ot.cotizacionId) throw new BadRequestException(`La OT ${ot.codigo} no viene de una cotización.`);
    // EP-04 P3.2 (BL-033): el servicio del catálogo (código EN) trae su IT; se hereda si es un proceso del laboratorio de la OT.
    const lineas = await this.prisma.$queryRawUnsafe<{
      id: string; descripcion: string | null; cantidad: number; ensayo_codigo: string | null; proceso: string | null;
      instrumento: string | null; marca: string | null; modelo: string | null; rango: string | null; puntos: string | null; sentido: string | null;
    }[]>(
      `SELECT l.id, l.descripcion, l.cantidad, l.ensayo_codigo, p.codigo AS proceso,
              l.instrumento, l.instrumento_marca AS marca, l.instrumento_modelo AS modelo, l.instrumento_rango AS rango,
              l.instrumento_puntos AS puntos, l.instrumento_sentido AS sentido
         FROM linea_cotizacion l
         LEFT JOIN cat_ensayo e ON e.id = l.cat_ensayo_id
         LEFT JOIN met_proceso p ON p.codigo = e.instruccion_trabajo AND p.activo AND (p.laboratorio IS NULL OR p.laboratorio = $2)
        WHERE l.cotizacion_id = $1::uuid ORDER BY l.orden NULLS LAST, l.id`, ot.cotizacionId, ot.laboratorio);
    const creados = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT 1 FROM orden_trabajo WHERE id = $1::uuid FOR UPDATE`, otId);
      const ya = new Set((await tx.$queryRawUnsafe<{ l: string }[]>(
        `SELECT DISTINCT linea_cotizacion_id::text AS l FROM met_ot_instrumento WHERE ot_id = $1::uuid AND linea_cotizacion_id IS NOT NULL`, otId)).map((x) => x.l));
      const n0 = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COALESCE(MAX(numero), 0)::int AS n FROM met_ot_instrumento WHERE ot_id = $1::uuid`, otId);
      let n = n0[0].n, total = 0;
      for (const l of lineas) {
        if (ya.has(l.id)) continue;
        const cuantos = Math.min(Math.max(1, Number(l.cantidad) || 1), 50);
        for (let k = 0; k < cuantos; k++) {
          n += 1; total += 1;
          await tx.$executeRawUnsafe(
            `INSERT INTO met_ot_instrumento (tenant_id, ot_id, numero, descripcion, linea_cotizacion_id, proceso_codigo, created_by,
                                             marca, modelo, rango, puntos, sentido)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7::uuid, $8, $9, $10, $11, $12)`,
            // B-045: el ítem hereda el instrumento de la línea (no el texto del servicio).
            ot.tenantId, otId, n, (l.instrumento || l.descripcion || l.ensayo_codigo || "Instrumento").slice(0, 300), l.id, l.proceso ?? null, req?.user?.sub ?? null,
            l.marca, l.modelo, l.rango, l.puntos, l.sentido);
        }
      }
      return total;
    });
    return { data: { creados } };
  }

  /* ---------------------------------------------------------- programación --- */
  async asignar(otId: string, itemId: string, body: unknown, req: any) {
    const d = AsignarSchema.parse(body ?? {});
    const ot = await this.cargarOt(otId, req);
    this.exigirMetrologia(ot); this.exigirAbierta(ot);
    await this.exigir(req, "asignar", ot);
    const it = await this.item(otId, itemId);
    if (!["por_recibir", "recibido"].includes(it.estado)) throw new ConflictException(`El ítem ${it.numero} está ${it.estado.replace("_", " ")}: ya no se asigna.`);
    const proc = await this.validarProceso(it.procesoCodigo, ot.laboratorio);
    const c = (await this.candidatos(ot, proc?.magnitud ?? null)).find((x) => x.id === d.metrologoId);
    if (!c) throw new BadRequestException(`La persona elegida no es metrólogo del ${ot.laboratorio}.`);
    if (!c.habilitado) throw new BadRequestException(c.motivo ?? "No está habilitado para la magnitud.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE met_ot_instrumento SET metrologo_id = $2::uuid, fecha_prevista = $3::date, asignado_at = now(), asignado_por = $4::uuid, updated_at = now()
        WHERE id = $1::uuid`,
      itemId, d.metrologoId, d.fechaPrevista ?? null, req?.user?.sub ?? null);
    return { data: { id: itemId, metrologo: c.nombre } };
  }

  /* ------------------------------------------------------------ recepción --- */
  async recibir(otId: string, itemId: string, body: unknown, req: any) {
    const d = RecepcionSchema.parse(body ?? {});
    const ot = await this.cargarOt(otId, req);
    this.exigirMetrologia(ot); this.exigirAbierta(ot);
    await this.exigir(req, "recibir", ot);
    const res = await this.prisma.$transaction(async (tx) => {
      const it = await this.item(otId, itemId, tx, true);
      const motivo = motivoRecepcion(it, { ...d, sentido: d.sentido ?? it.sentido }, { fechaOt: ot.fechaOt, laboratorio: ot.laboratorio });
      if (motivo) throw new BadRequestException(motivo);
      const etiqueta = etiquetaInstrumento(ot.codigo, it.numero);
      await tx.$executeRawUnsafe(
        `UPDATE met_ot_instrumento SET
            estado = $2, recibido_at = $3::timestamptz, recibido_por = $4::uuid, entregado_por = $5, estado_fisico = $6, estado_fisico_obs = $7,
            accesorios = $8::jsonb, ubicacion = $9, calibrable = $10, motivo_no_calibrable = $11, requiere_externo = $12, sentido = COALESCE($13, sentido),
            acondicionamiento_h = $14, temp_ambiente = $15, etiqueta = $16,
            descripcion = COALESCE($17, descripcion), marca = CASE WHEN $18 THEN $19 ELSE marca END, modelo = CASE WHEN $20 THEN $21 ELSE modelo END,
            serie = CASE WHEN $22 THEN $23 ELSE serie END, id_especial = CASE WHEN $24 THEN $25 ELSE id_especial END,
            capacidad = CASE WHEN $26 THEN $27 ELSE capacidad END, resolucion = CASE WHEN $28 THEN $29 ELSE resolucion END, updated_at = now()
          WHERE id = $1::uuid AND estado = 'por_recibir'`,
        itemId, d.calibrable ? "recibido" : "no_apto", new Date(instanteChile(d.fechaHora)).toISOString(), req?.user?.sub ?? null, d.entregadoPor, d.estadoFisico,
        d.estadoFisicoObs, JSON.stringify(d.accesorios), d.ubicacion, d.calibrable, d.calibrable ? null : d.motivoNoCalibrable,
        d.calibrable ? null : d.requiereExterno ?? null, d.sentido ?? null, d.acondicionamientoH ?? null, d.tempAmbiente ?? null, etiqueta,
        d.descripcion ?? null, d.marca !== undefined, d.marca ?? null, d.modelo !== undefined, d.modelo ?? null, d.serie !== undefined, d.serie ?? null,
        d.idEspecial !== undefined, d.idEspecial ?? null, d.capacidad !== undefined, d.capacidad ?? null, d.resolucion !== undefined, d.resolucion ?? null);
      // La OT pasa a «en análisis» con el primer instrumento recibido (como con la primera muestra).
      const est = await tx.$queryRawUnsafe<{ estado: string }[]>(`SELECT estado FROM orden_trabajo WHERE id = $1::uuid FOR UPDATE`, otId);
      if (["recepcionada", "recibida"].includes(est[0]?.estado))
        await tx.$executeRawUnsafe(`UPDATE orden_trabajo SET estado = 'en_analisis', updated_at = now() WHERE id = $1::uuid`, otId);
      return { etiqueta, estado: d.calibrable ? "recibido" : "no_apto" };
    });
    return { data: { id: itemId, ...res } };
  }

  /* ----------------------------------------------------------- devolución --- */
  async devolver(otId: string, itemId: string, body: unknown, req: any) {
    const d = DevolucionSchema.parse(body ?? {});
    const ot = await this.cargarOt(otId, req);
    this.exigirAbierta(ot);
    await this.exigir(req, "devolver", ot);
    await this.prisma.$transaction(async (tx) => {
      const it = await this.item(otId, itemId, tx, true);
      const cals = await calibracionesDeOt(tx, otId);
      const motivo = motivoDevolucion(it, cals, d);
      if (motivo) throw new BadRequestException(motivo);
      await tx.$executeRawUnsafe(
        `UPDATE met_ot_instrumento SET estado = 'devuelto', devuelto_at = $2::timestamptz, devuelto_recibe = $3, devuelto_estado = $4, devuelto_obs = $5,
                devuelto_guia = $6, devuelto_por = $7::uuid, devuelto_registrado_at = now(), updated_at = now()
          WHERE id = $1::uuid AND estado IN ('recibido', 'no_apto')`,
        itemId, new Date(instanteChile(d.fechaHora)).toISOString(), d.recibidoPor, d.estadoFisico, d.observacion, d.guia, req?.user?.sub ?? null);
    });
    return { data: { id: itemId, estado: "devuelto" } };
  }

  /* -------------------------------------------------- entrega del certificado --- */
  async entregar(otId: string, calId: string, body: unknown, req: any) {
    const d = EntregaSchema.parse(body ?? {});
    const ot = await this.cargarOt(otId, req);
    await this.exigir(req, "entregar", ot);
    const medio = textoEnFrase(await exigirMedioEnvioActivo(this.prisma, ot.tenantId, d.medio));
    await this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRawUnsafe<any[]>(
        `SELECT id, codigo, numero_certificado AS "numeroCertificado", estado, emitido_at AS "emitidoAt", entregado_at AS "entregadoAt"
           FROM met_calibracion WHERE id = $1::uuid AND ot_id = $2::uuid AND deleted_at IS NULL FOR UPDATE`, calId, otId);
      if (!filas.length) throw new NotFoundException("Calibración no encontrada en esta OT");
      const fecha = fechaEntrega(d.fecha);
      const motivo = motivoEntrega(filas[0], fecha);
      if (motivo) throw new ConflictException(motivo);
      await tx.$executeRawUnsafe(
        `UPDATE met_calibracion SET entregado_at = $2, entrega_medio = $3, entrega_destinatario = $4, entrega_observacion = $5, entregado_por = $6::uuid,
                entrega_registrada_at = now(), updated_at = now()
          WHERE id = $1::uuid AND entregado_at IS NULL`,
        calId, fecha, d.medio, d.destinatario, d.observacion, req?.user?.sub ?? null);
      await tx.$executeRawUnsafe(
        `INSERT INTO met_calibracion_evento (calibracion_id, accion, estado_desde, estado_hasta, usuario_id, comentario)
         VALUES ($1::uuid, 'ENTREGADA', 'emitida', 'emitida', $2::uuid, $3)`,
        calId, req?.user?.sub ?? null, `Entregado a ${d.destinatario} · ${medio}${d.observacion ? ` · ${d.observacion}` : ""}`);
    });
    // P8.4 con el parámetro «al entregar»: el equipo del laboratorio dueño toma el certificado ahora.
    const cfg = await leerConfigFicha(this.prisma as any, ot.tenantId);
    const equipo = cfg.actualizarEquipo === "entregar" ? await actualizarEquipoDueno(this.prisma as any, calId, req?.user?.sub ?? null, "entregar") : null;
    return { data: { id: calId, entregado: true, equipo } };
  }

  /**
   * «Enviar por correo» (EP-04 P8.1): el PDF sellado del certificado emitido a los correos
   * indicados. Si sale y la entrega no estaba registrada, la registra (medio «correo»).
   */
  async enviarCorreo(otId: string, calId: string, body: unknown, req: any) {
    const d = CorreoSchema.parse(body ?? {});
    const ot = await this.cargarOt(otId, req);
    await this.exigir(req, "entregar", ot);
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, estado, numero_certificado AS "numeroCertificado", codigo, emitido_at AS "emitidoAt", entregado_at AS "entregadoAt"
         FROM met_calibracion WHERE id = $1::uuid AND ot_id = $2::uuid AND deleted_at IS NULL`, calId, otId);
    if (!filas.length) throw new NotFoundException("Calibración no encontrada en esta OT");
    if (filas[0].estado !== "emitida") throw new ConflictException(`Solo se envía un certificado emitido: ${filas[0].numeroCertificado ?? filas[0].codigo} está ${filas[0].estado}.`);
    const destinatarios = [...new Set(d.destinatarios.map((x) => x.toLowerCase()))];
    const r = await enviarCertificado(this.prisma as any, this.mail, calId, destinatarios, { mensaje: d.mensaje ?? null, usuarioId: req?.user?.sub ?? null, motivo: "envio" });
    let entregado = !!filas[0].entregadoAt;
    if (r.ok && !entregado) {
      await this.entregar(otId, calId, { medio: "correo", destinatario: destinatarios.join(", ").slice(0, 160), observacion: "Enviado por correo desde el LIMS (PDF sellado adjunto)." }, req);
      entregado = true;
    }
    return {
      data: {
        ok: r.ok, destinatarios, entregado,
        error: r.ok ? null : `No se pudo enviar el correo: ${textoErrorCorreo(r.error)}. Revise la configuración de correo o registre la entrega manualmente.`,
      },
    };
  }

  /* ------------------------------------------------------- cierre técnico --- */
  async cierreTecnico(otId: string, req: any) {
    const ot = await this.cargarOt(otId, req);
    this.exigirMetrologia(ot);
    await this.exigir(req, "cierreTecnico", ot);
    const r = await this.prisma.$transaction(async (tx) => {
      const est = await tx.$queryRawUnsafe<{ estado: string }[]>(`SELECT estado FROM orden_trabajo WHERE id = $1::uuid FOR UPDATE`, otId);
      const estado = est[0]?.estado ?? ot.estado;
      // D04-31: lo mismo que exige el cierre final en lo técnico (409 con la lista de lo que falta).
      const m = await metrologiaParaCierre(tx, otId, ot.tenantId);
      const faltan = faltantesCierreTecnico(estado, m.items, m.cals, m.docsNoCalibrables, {
        exigeDevolucion: m.exigeDevolucion, noAptoExigeDocumento: m.noAptoExigeDocumento,
      });
      if (faltan.length)
        throw new ConflictException({ statusCode: 409, error: "Conflict", message: `No se puede cerrar técnicamente la OT ${ot.codigo}. ${faltan.join(" ")}`, faltantes: faltan });
      const camino = caminoEstadosOt(estado, "finalizada");
      if (!camino) throw new ConflictException(`La OT está en un estado ('${estado}') desde el que no se llega a «finalizada».`);
      await tx.$executeRawUnsafe(`UPDATE orden_trabajo SET estado = 'finalizada', updated_at = now() WHERE id = $1::uuid`, otId);
      return [estado, ...camino];
    });
    return { data: { id: otId, estado: "finalizada", recorrido: r } };
  }
}

@ApiTags("ot")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ot")
export class MetrologiaOtController {
  constructor(private readonly svc: MetrologiaOtService) {}

  @Get(":id/metrologia")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Instrumentos de la OT de calibración, sus calibraciones, qué falta para cerrar y qué puede hacer el usuario" })
  resumen(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.resumen(id, req);
  }

  @Post(":id/instrumentos")
  @RequierePermiso("ot.ver")
  registrar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.registrar(id, body, req);
  }

  @Post(":id/instrumentos/desde-cotizacion")
  @RequierePermiso("ot.ver")
  desdeCotizacion(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.desdeCotizacion(id, req);
  }

  @Put(":id/instrumentos/:item")
  @RequierePermiso("ot.ver")
  editar(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editar(id, item, body, req);
  }

  @Post(":id/instrumentos/:item/anular")
  @RequierePermiso("ot.ver")
  anular(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.anular(id, item, body, req);
  }

  @Get(":id/instrumentos/:item/metrologos")
  @RequierePermiso("ot.ver")
  metrologos(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Req() req: any) {
    return this.svc.metrologos(id, item, req);
  }

  @Post(":id/instrumentos/:item/asignar")
  @RequierePermiso("ot.asignar")
  asignar(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.asignar(id, item, body, req);
  }

  @Post(":id/instrumentos/:item/recepcion")
  @RequierePermiso("ot.ver")
  recibir(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.recibir(id, item, body, req);
  }

  @Post(":id/instrumentos/:item/devolucion")
  @RequierePermiso("ot.ver")
  devolver(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.devolver(id, item, body, req);
  }

  @Post(":id/calibraciones/:cal/entregar")
  @RequierePermiso("ot.ver")
  entregar(@Param("id", ParseUUIDPipe) id: string, @Param("cal", ParseUUIDPipe) cal: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.entregar(id, cal, body, req);
  }

  @Post(":id/calibraciones/:cal/enviar-correo")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Envía por correo el certificado de calibración emitido (PDF sellado) y, si sale, registra la entrega" })
  enviarCorreo(@Param("id", ParseUUIDPipe) id: string, @Param("cal", ParseUUIDPipe) cal: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.enviarCorreo(id, cal, body, req);
  }

  @Post(":id/metrologia/cierre-tecnico")
  @RequierePermiso("ot.asignar")
  cierreTecnico(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.cierreTecnico(id, req);
  }
}
