import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Module, NotFoundException,
  Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AmbitoUnidad } from "../rbac/ambito-unidad.guard";
import { AlcanceService } from "../rbac/alcance.service";
import { descendientes } from "../rbac/alcance";
import { documentoCompleto, type Sello } from "../plantilla-render/plantilla-defecto";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import { calcularCalibracion, type Componente, type Divisores, type Punto } from "./metrologia.calc";
import { REGISTRO_MOTORES, calcularConMotor, motorDeProceso, PROCESOS_POR_PUNTOS } from "./motores";
import { CASOS_REFERENCIA, esClaveExcel, verificarParidad } from "./motores/paridad";
import { CASOS_LNF, verificarParidadLNF } from "./motores/paridad-lnf";
import { certificadoHtml } from "./metrologia.certificado";
import {
  ESTADO_TRAS, accionesDisponibles, codigoCalibracion, estadoDe, fechaCalibracion, motivoRechazo, plantillaVacia,
  type AccionCal, type ContextoCal,
} from "./metrologia.flujo";

// ---------------------------------------------------------------------------
// Módulo Metrología (Sección SAM: LMT, LMTE, LNF). Cada proceso se calcula
// con su motor: los 14 validados contra los Excel del LMT, el ISO 376 del LNF,
// el formulario estándar por puntos (eléctrica, tiempo y reserva) o, para los
// procesos sin caso real (ITM03, ITV05), el motor GUM parametrizado.
// Circuito: borrador → en revisión → emitida (metrologia.flujo.ts).
// Todo por SQL crudo (las tablas met_* no están en Prisma).
// ---------------------------------------------------------------------------
const prisma = new PrismaClient();

/** Laboratorios de la Sección Metrología a los que puede pertenecer una calibración. */
const LABS_SAM = ["LMT", "LMTE", "LNF", "LCAD"];

const PuntoSchema = z.object({
  nominal: z.coerce.number(),
  correccion: z.coerce.number().default(0),
  uPatron: z.coerce.number().default(0),
  deriva: z.coerce.number().default(0),
  lecturas: z.array(z.coerce.number()).default([]),
});
const CrearSchema = z.object({
  procesoCodigo: z.string().min(2),
  patronId: z.string().uuid().nullish(),
  /** Laboratorio (LMT, LMTE, LNF, LCAD): obligatorio solo en procesos sin laboratorio fijo (PTS01). */
  laboratorio: z.string().max(10).nullish(),
  /** Fecha de calibración AAAA-MM-DD (por defecto, hoy): da el año del código. */
  fecha: z.string().max(10).nullish(),
  instrumento: z.record(z.any()).default({}),
  patronSnap: z.record(z.any()).default({}),
  ambiente: z.record(z.any()).default({}),
  cond: z.record(z.coerce.number()).default({}),
  intervaloMeses: z.coerce.number().default(12),
  puntos: z.array(PuntoSchema).default([]),
  /** Datos de entrada del motor de la IT y correcciones aplicadas (hallazgos). */
  motor: z.object({ datos: z.record(z.any()), opciones: z.record(z.boolean()).default({}) }).optional(),
});
type CrearDto = z.infer<typeof CrearSchema>;
const CalcularSchema = z.object({ datos: z.record(z.any()), opciones: z.record(z.boolean()).default({}) });

/** Quita los valores del Excel (x_, y_, z_, w_, x, xT) y deja solo las entradas. */
function soloEntradas(v: any): any {
  if (Array.isArray(v)) return v.map(soloEntradas);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !esClaveExcel(k)).map(([k, x]) => [k, soloEntradas(x)]));
  return v;
}

/** Calcula con el motor y rechaza datos incompletos (con el motivo si el motor lo da). */
function ejecutarMotor(it: string, datos: Record<string, any>, opciones: Record<string, boolean>) {
  let out: ReturnType<typeof calcularConMotor>;
  try {
    out = calcularConMotor(it, datos, opciones);
  } catch (e: any) {
    const motivo = typeof e?.message === "string" && /^[A-ZÁÉÍÓÚ]/.test(e.message) && !/undefined|null|NaN|reading/.test(e.message) ? `: ${e.message}` : ": faltan entradas o alguna no es válida";
    throw new BadRequestException(`Datos incompletos para ${it}${motivo}`);
  }
  const malos = out.resumen.puntos.filter((p) => !Number.isFinite(p.U));
  if (!out.resumen.puntos.length || malos.length)
    throw new BadRequestException(`Datos incompletos para ${it}: revise las lecturas (${malos.length} punto(s) sin resultado)`);
  return out;
}

function tenantId(req: any): string {
  const id = req?.user?.tenantId;
  if (!id) throw new NotFoundException("Tenant no resuelto");
  return id;
}
const permisosDe = (req: any): string[] => req?.user?.permisos ?? [];
const esSuperadmin = (req: any) => (req?.user?.roles ?? []).includes("SUPERADMIN");
const tiene = (req: any, p: string) => esSuperadmin(req) || permisosDe(req).includes(p);

async function cargarDivisores(): Promise<Divisores> {
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT codigo, divisor FROM met_distribucion`);
  return Object.fromEntries(rows.map((r) => [r.codigo, Number(r.divisor)]));
}
async function cargarProceso(codigo: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT p.id, p.codigo, p.nombre, p.metodo, p.norma, p.laboratorio, m.codigo AS mag, m.nombre AS mag_nombre, m.unidad, m.decimales
       FROM met_proceso p JOIN met_magnitud m ON m.id = p.magnitud_id WHERE p.codigo = $1 AND p.activo`, codigo);
  if (!rows.length) throw new NotFoundException(`Proceso ${codigo} no encontrado`);
  const p = rows[0];
  const comps = await prisma.$queryRawUnsafe<any[]>(
    `SELECT c.simbolo, c.nombre, c.distribucion, c.fuente, c.orden
       FROM met_componente c JOIN met_proceso pr ON pr.magnitud_id = c.magnitud_id
      WHERE pr.codigo = $1 ORDER BY c.orden`, codigo);
  return { ...p, componentes: comps as Componente[] };
}

// ===========================================================================
@ApiTags("metrología")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("SAM")
@Controller("metrologia")
export class MetrologiaController {
  constructor(private readonly alcance: AlcanceService) {}

  /** Códigos de laboratorio de la sección visibles para el usuario (null = todos). */
  private async labsVisibles(req: any): Promise<Set<string> | null> {
    const filtro = await this.alcance.filtroUnidades(req);
    if (filtro === null) return null;
    const arbol = await this.alcance.arbol(req.user?.tenantId);
    const visibles = new Set(filtro);
    return new Set(LABS_SAM.filter((c) => {
      const n = arbol.porCodigo.get(c);
      return n && descendientes(arbol, n.id, true).some((id) => visibles.has(id));
    }));
  }

  /** Procesos con su magnitud, laboratorio, motor y componentes (solo los de los laboratorios del usuario). */
  @Get("procesos")
  @RequierePermiso("metrologia.ver")
  async procesos(@Req() req: any) {
    const procs = await prisma.$queryRawUnsafe<any[]>(
      `SELECT p.codigo, p.nombre, p.metodo, p.norma, p.laboratorio, p.acreditacion, m.codigo AS magnitud, m.nombre AS magnitud_nombre, m.unidad, m.decimales
         FROM met_proceso p JOIN met_magnitud m ON m.id = p.magnitud_id WHERE p.activo ORDER BY p.laboratorio NULLS LAST, m.codigo, p.codigo`);
    const comps = await prisma.$queryRawUnsafe<any[]>(
      `SELECT m.codigo AS magnitud, c.simbolo, c.nombre, c.distribucion, c.fuente, c.orden
         FROM met_componente c JOIN met_magnitud m ON m.id = c.magnitud_id ORDER BY m.codigo, c.orden`);
    const byMag: Record<string, any[]> = {};
    comps.forEach((c) => { (byMag[c.magnitud] ??= []).push(c); });
    const labs = await this.labsVisibles(req);
    return {
      data: procs
        .filter((p) => !labs || !p.laboratorio || labs.has(p.laboratorio))
        .map((p) => ({ ...p, motor: motorDeProceso(p.codigo)?.it ?? null, componentes: byMag[p.magnitud] ?? [] })),
      laboratorios: labs ? LABS_SAM.filter((c) => labs.has(c)) : LABS_SAM,
    };
  }

  /** Configuración editable: magnitudes, distribuciones, componentes, OIML, patrones. */
  @Get("config")
  @RequierePermiso("metrologia.ver")
  async config(@Req() req: any) {
    const t = tenantId(req);
    const [magnitudes, distribuciones, componentes, oiml, patrones] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(`SELECT id, codigo, nombre, unidad, decimales FROM met_magnitud ORDER BY codigo`),
      prisma.$queryRawUnsafe<any[]>(`SELECT codigo, divisor, uso FROM met_distribucion ORDER BY divisor`),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT c.id, m.codigo AS magnitud, c.simbolo, c.nombre, c.distribucion, c.fuente, c.orden
           FROM met_componente c JOIN met_magnitud m ON m.id = c.magnitud_id ORDER BY m.codigo, c.orden`),
      prisma.$queryRawUnsafe<any[]>(`SELECT nominal, clase, mpe_mg FROM met_tolerancia_oiml ORDER BY mpe_mg`),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT p.id, p.codigo, p.nombre, p.marca, p.modelo, p.serie, p.clase, p.u_expandida, p.deriva,
                p.n_certificado, p.vence, p.emisor, p.trazabilidad, m.codigo AS magnitud
           FROM met_patron p LEFT JOIN met_magnitud m ON m.id = p.magnitud_id
          WHERE p.tenant_id = $1::uuid AND p.deleted_at IS NULL ORDER BY m.codigo`, t),
    ]);
    return { magnitudes, distribuciones, componentes, oiml, patrones };
  }

  /** Editar la distribución de un componente (config del balance GUM). */
  @Put("componentes/:id")
  @RequierePermiso("metrologia.config")
  async editarComponente(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = z.object({ distribucion: z.string().min(1) }).parse(body);
    const dist = await prisma.$queryRawUnsafe<any[]>(`SELECT 1 FROM met_distribucion WHERE codigo = $1`, d.distribucion);
    if (!dist.length) throw new BadRequestException("Distribución no válida");
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE met_componente SET distribucion = $2 WHERE id = $1::uuid RETURNING *`, id, d.distribucion);
    if (!rows.length) throw new NotFoundException("Componente no encontrado");
    return rows[0];
  }

  /** Motores: IT, unidades, correcciones propuestas, casos de referencia y si está validado contra planilla. */
  @Get("motores")
  @RequierePermiso("metrologia.ver")
  motores() {
    const casos = [...CASOS_REFERENCIA, ...CASOS_LNF];
    return {
      data: Object.values(REGISTRO_MOTORES).map(({ calcular, resumen, ...m }) => ({
        ...m, validado: m.validado !== false,
        casos: casos.filter((c) => c.it === m.it).map((c) => ({ caso: c.caso, instrumento: c.instrumento })),
      })),
      procesosPorPuntos: PROCESOS_POR_PUNTOS,
    };
  }

  /** Evidencia de validación: recalcula los casos reales (16 del LMT + 1 del LNF) y los compara con las planillas. */
  @Get("motores/paridad")
  @RequierePermiso("metrologia.ver")
  paridad() {
    const lmt = verificarParidad(), lnf = verificarParidadLNF();
    return { casos: [...lmt.casos, ...lnf.casos], identicos: lmt.identicos + lnf.identicos, comparados: lmt.comparados + lnf.comparados };
  }

  /** Datos de entrada de un caso de referencia (sin los valores de la planilla), para formación. */
  @Get("motores/:it/ejemplo")
  @RequierePermiso("metrologia.ver")
  ejemplo(@Param("it") it: string, @Query("caso") caso?: string) {
    const m = motorDeProceso(it);
    if (!m) throw new NotFoundException(`No hay motor para ${it}`);
    const c = [...CASOS_REFERENCIA, ...CASOS_LNF].find((x) => x.it === m.it && (!caso || x.caso === caso));
    if (!c) throw new NotFoundException(`No hay caso de referencia para ${m.it}`);
    return { data: { caso: c.caso, instrumento: c.instrumento, datos: soloEntradas(c.datos) } };
  }

  /** Formulario vacío del motor: la estructura de su planilla sin ningún valor. */
  @Get("motores/:it/plantilla")
  @RequierePermiso("metrologia.ver")
  plantilla(@Param("it") it: string) {
    const m = motorDeProceso(it);
    if (!m) throw new NotFoundException(`No hay motor para ${it}`);
    const c = [...CASOS_REFERENCIA, ...CASOS_LNF].find((x) => x.it === m.it);
    return { data: { datos: c ? plantillaVacia(soloEntradas(c.datos)) : null } };
  }

  /** Vista previa: calcula sin guardar (el mismo motor que usa el guardado). */
  @Post("motores/:it/calcular")
  @RequierePermiso("metrologia.ver")
  calcular(@Param("it") it: string, @Body() body: unknown) {
    if (!motorDeProceso(it)) throw new NotFoundException(`No hay motor para ${it}`);
    const d = CalcularSchema.parse(body);
    return { data: ejecutarMotor(it, d.datos, d.opciones) };
  }

  @Get("patrones")
  @RequierePermiso("metrologia.ver")
  async patrones(@Req() req: any) {
    const data = await prisma.$queryRawUnsafe<any[]>(
      `SELECT p.*, m.codigo AS magnitud FROM met_patron p LEFT JOIN met_magnitud m ON m.id = p.magnitud_id
        WHERE p.tenant_id = $1::uuid AND p.deleted_at IS NULL ORDER BY m.codigo`, tenantId(req));
    return { data };
  }

  // ----- Calibraciones -------------------------------------------------------
  @Get("calibraciones")
  @RequierePermiso("metrologia.ver")
  async listar(@Req() req: any, @Query("limit") limit?: string, @Query("estado") estado?: string) {
    const t = tenantId(req);
    const l = Math.min(500, Math.max(1, parseInt(limit ?? "100") || 100));
    const filtro = await this.alcance.filtroUnidades(req);
    const params: any[] = [t, l];
    let where = `c.tenant_id = $1::uuid AND c.deleted_at IS NULL`;
    if (filtro) { params.push(filtro); where += ` AND c.unidad_id = ANY($${params.length}::uuid[])`; }
    if (estado) {
      const e = estado === "borrador" ? ["borrador", "calculada"] : [estado];
      params.push(e); where += ` AND c.estado = ANY($${params.length}::text[])`;
    }
    const data = await prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id, c.codigo, c.estado, c.u_max, c.u_cert, c.motor, c.conforme, c.created_at, c.emitido_at, c.fecha_calibracion,
              c.created_by, c.devuelto_motivo, (c.resumen IS NOT NULL OR c.u_max IS NOT NULL) AS calculada,
              pr.codigo AS proceso, pr.nombre AS proceso_nombre, m.unidad, un.codigo AS laboratorio,
              c.instrumento->>'item' AS instrumento, c.instrumento->>'cliente' AS cliente,
              ua.nombre_completo AS autor_nombre
         FROM met_calibracion c
         JOIN met_proceso pr ON pr.id = c.proceso_id
         JOIN met_magnitud m ON m.id = pr.magnitud_id
         LEFT JOIN unidad un ON un.id = c.unidad_id
         LEFT JOIN usuario ua ON ua.id = c.created_by
        WHERE ${where}
        ORDER BY c.created_at DESC LIMIT $2`, ...params);
    return {
      data: data.map(({ created_by, calculada, ...c }) => ({
        ...c,
        estado: estadoDe(c.estado),
        // En fuerza y par la incertidumbre es relativa (%), no en la unidad de la magnitud.
        unidad_u: c.motor === "PUNTOS" ? "" : (c.motor && REGISTRO_MOTORES[c.motor]?.unidadU) || c.unidad,
        es_mio: created_by === req.user?.sub,
        acciones: accionesDisponibles(this.contexto(req, { ...c, created_by, calculada })),
      })),
    };
  }

  @Get("calibraciones/:id")
  @RequierePermiso("metrologia.ver")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const t = tenantId(req);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*, pr.codigo AS proceso, pr.nombre AS proceso_nombre, pr.metodo, pr.norma, pr.acreditacion,
              m.codigo AS magnitud, m.unidad, m.decimales, un.codigo AS laboratorio, un.nombre AS laboratorio_nombre,
              ua.nombre_completo AS autor_nombre, ue.nombre_completo AS emisor_nombre
         FROM met_calibracion c JOIN met_proceso pr ON pr.id = c.proceso_id JOIN met_magnitud m ON m.id = pr.magnitud_id
         LEFT JOIN unidad un ON un.id = c.unidad_id
         LEFT JOIN usuario ua ON ua.id = c.created_by
         LEFT JOIN usuario ue ON ue.id = c.emitido_by
        WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid AND c.deleted_at IS NULL LIMIT 1`, id, t);
    if (!rows.length) throw new NotFoundException("Calibración no encontrada");
    const cal = rows[0];
    if (cal.unidad_id) await this.alcance.exigirUnidad(req, cal.unidad_id, "la calibración");
    const [puntos, eventos] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(`SELECT * FROM met_calibracion_punto WHERE calibracion_id = $1::uuid ORDER BY orden`, id),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT e.accion, e.estado_desde, e.estado_hasta, e.comentario, e.created_at, u.nombre_completo AS usuario
           FROM met_calibracion_evento e LEFT JOIN usuario u ON u.id = e.usuario_id
          WHERE e.calibracion_id = $1::uuid ORDER BY e.created_at`, id),
    ]);
    const calculada = cal.resumen != null || cal.u_max != null;
    return {
      ...cal, estado: estadoDe(cal.estado), calculada, puntos, eventos, es_mio: cal.created_by === req.user?.sub,
      acciones: accionesDisponibles(this.contexto(req, { ...cal, calculada })),
    };
  }

  /** Guarda una calibración nueva como BORRADOR, calculada en el servidor. */
  @Post("calibraciones")
  @RequierePermiso("metrologia.crear")
  async crear(@Body() body: unknown, @Req() req: any) {
    const t = tenantId(req);
    const d = CrearSchema.parse(body);
    const proc = await cargarProceso(d.procesoCodigo);
    const unidadId = await this.unidadDeCalibracion(req, t, proc, d.laboratorio);
    const calc = await this.calcularDto(proc, d);
    const fecha = fechaCalibracion(d.fecha);

    for (let intento = 0; ; intento++) {
      const codigo = await this.siguienteCodigo(t, fecha);
      try {
        const id = await prisma.$transaction(async (tx) => {
          const cal = await tx.$queryRawUnsafe<any[]>(
            `INSERT INTO met_calibracion
               (tenant_id, codigo, proceso_id, patron_id, unidad_id, fecha_calibracion, instrumento, patron_snap, ambiente, cond,
                u_max, u_cert, conforme, intervalo_meses, estado, created_by, motor, datos, opciones, resultado, resumen)
             VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,$6::date,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,
                     $11,$12,$13,$14,'borrador',$15::uuid,$16,$17::jsonb,$18::jsonb,$19::jsonb,$20::jsonb)
             RETURNING id`,
            t, codigo, proc.id, d.patronId ?? null, unidadId, fecha, JSON.stringify(d.instrumento), JSON.stringify(d.patronSnap),
            JSON.stringify(d.ambiente), JSON.stringify(calc.cond), calc.uMax, calc.uCert, calc.conforme, d.intervaloMeses,
            req?.user?.sub ?? null, calc.motor, calc.datos, calc.opciones, calc.resultado, calc.resumen);
          await this.guardarPuntos(tx, cal[0].id, calc.puntos);
          await this.evento(tx, cal[0].id, "CREADA", null, "borrador", req, null);
          return cal[0].id as string;
        });
        return { data: { id, codigo, estado: "borrador", fecha, motor: calc.motor, resumen: calc.resumenObj, uMax: calc.uMax, conforme: calc.conforme, puntos: calc.puntosGum } };
      } catch (e: any) {
        // Dos guardados simultáneos pueden tomar el mismo correlativo: se reintenta con el siguiente.
        if (intento < 4 && /unique|duplicate|23505/i.test(String(e?.message ?? e?.code ?? ""))) continue;
        throw e;
      }
    }
  }

  /** Corrige un borrador propio (por ejemplo, tras una devolución): recalcula y reemplaza los puntos. */
  @Put("calibraciones/:id")
  @RequierePermiso("metrologia.crear")
  async editar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const cal = await this.detalle(id, req);
    this.exigir("EDITAR", req, cal);
    const d = CrearSchema.parse(body);
    if (d.procesoCodigo !== cal.proceso) throw new BadRequestException("No se puede cambiar el proceso de una calibración guardada");
    const proc = await cargarProceso(d.procesoCodigo);
    const calc = await this.calcularDto(proc, d);
    const fecha = d.fecha ? fechaCalibracion(d.fecha) : null;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE met_calibracion SET patron_id = $2::uuid, instrumento = $3::jsonb, patron_snap = $4::jsonb, ambiente = $5::jsonb,
                cond = $6::jsonb, u_max = $7, u_cert = $8, conforme = $9, intervalo_meses = $10, motor = $11, datos = $12::jsonb,
                opciones = $13::jsonb, resultado = $14::jsonb, resumen = $15::jsonb, fecha_calibracion = COALESCE($16::date, fecha_calibracion),
                estado = 'borrador', updated_at = now()
          WHERE id = $1::uuid`,
        id, d.patronId ?? null, JSON.stringify(d.instrumento), JSON.stringify(d.patronSnap), JSON.stringify(d.ambiente),
        JSON.stringify(calc.cond), calc.uMax, calc.uCert, calc.conforme, d.intervaloMeses, calc.motor, calc.datos, calc.opciones,
        calc.resultado, calc.resumen, fecha);
      await tx.$executeRawUnsafe(`DELETE FROM met_calibracion_punto WHERE calibracion_id = $1::uuid`, id);
      await this.guardarPuntos(tx, id, calc.puntos);
      await this.evento(tx, id, "EDITADA", "borrador", "borrador", req, null);
    });
    return { data: { id, codigo: cal.codigo, estado: "borrador", resumen: calc.resumenObj, uMax: calc.uMax, conforme: calc.conforme } };
  }

  /** El metrólogo firma lo elaborado y lo envía a revisión del jefe del laboratorio. */
  @Post("calibraciones/:id/enviar")
  @RequierePermiso("metrologia.crear")
  async enviar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const cal = await this.detalle(id, req);
    this.exigir("ENVIAR", req, cal);
    await this.transicion(id, "ENVIAR", cal.estado, req, null,
      `enviado_at = now(), enviado_by = $4::uuid, devuelto_motivo = NULL`, []);
    return { data: { id, codigo: cal.codigo, estado: ESTADO_TRAS.ENVIAR } };
  }

  /** El revisor devuelve la calibración al metrólogo para corregirla (motivo obligatorio). */
  @Post("calibraciones/:id/devolver")
  @RequierePermiso("metrologia.emitir")
  async devolver(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const { motivo } = z.object({ motivo: z.string().trim().min(5, "Indique el motivo de la devolución (mínimo 5 caracteres)").max(2000) }).parse(body ?? {});
    const cal = await this.detalle(id, req);
    this.exigir("DEVOLVER", req, cal);
    await this.transicion(id, "DEVOLVER", cal.estado, req, motivo,
      `devuelto_at = now(), devuelto_by = $4::uuid, devuelto_motivo = $5`, [motivo]);
    return { data: { id, codigo: cal.codigo, estado: ESTADO_TRAS.DEVOLVER } };
  }

  /** Revisa, valida y emite el Certificado de Calibración: lo sella con SHA-256. */
  @Post("calibraciones/:id/emitir")
  @RequierePermiso("metrologia.emitir")
  async emitir(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const cal = await this.detalle(id, req);
    if (cal.estado === "emitida") return { data: { codigo: cal.codigo, hash: cal.certificado_hash, yaEmitido: true } };
    this.exigir("EMITIR", req, cal);
    const contenido = JSON.stringify({
      codigo: cal.codigo, proceso: cal.proceso, fecha: cal.fecha_calibracion, instrumento: cal.instrumento,
      puntos: cal.puntos, uMax: cal.u_max, resumen: cal.resumen, autor: cal.created_by, emisor: req.user?.sub,
    });
    const hash = createHash("sha256").update(contenido, "utf8").digest("hex");
    await this.transicion(id, "EMITIR", cal.estado, req, null,
      `certificado_hash = $5, emitido_at = now(), emitido_by = $4::uuid`, [hash]);
    return { data: { codigo: cal.codigo, estado: "emitida", hash, verificacion: hash.slice(0, 10).toUpperCase() } };
  }

  /** PDF del certificado (BORRADOR hasta que se emite; reutiliza el render de plantillas del sistema). */
  @Get("calibraciones/:id/pdf")
  @RequierePermiso("metrologia.ver")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const cal = await this.detalle(id, req);
    const cuerpo = certificadoHtml(cal);
    const hash = cal.certificado_hash ?? createHash("sha256").update(cuerpo, "utf8").digest("hex");
    const sello: Sello = {
      numero: cal.codigo.replace("CAL", "CERT-CAL"),
      codigoVerificacion: hash.slice(0, 10).toUpperCase(),
      hash,
      fecha: new Date(cal.emitido_at ?? Date.now()).toLocaleDateString("es-CL", { timeZone: "America/Santiago" }),
      urlVerificacion: "/saec/verificar",
      borrador: cal.estado !== "emitida",
    };
    const html = documentoCompleto(cuerpo, sello, "Certificado de Calibración " + cal.codigo);
    const buf = await generarPdf(html, sello, "Certificado de Calibración " + cal.codigo);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${cal.codigo}.pdf"`);
    res.end(buf);
  }

  // ---- helpers --------------------------------------------------------------
  private contexto(req: any, cal: any): ContextoCal {
    return {
      estado: cal.estado,
      esAutor: !!cal.created_by && cal.created_by === req.user?.sub,
      puedeCrear: tiene(req, "metrologia.crear"),
      puedeEmitir: tiene(req, "metrologia.emitir"),
      calculada: !!cal.calculada,
    };
  }

  private exigir(accion: AccionCal, req: any, cal: any) {
    const motivo = motivoRechazo(accion, this.contexto(req, cal));
    if (motivo) throw new ForbiddenException(motivo);
  }

  /**
   * Cambia el estado solo si sigue siendo el leído (evita dobles clics y carreras) y deja el evento.
   * En `set`: $4 = usuario actual, $5… = `extras`.
   */
  private async transicion(id: string, accion: AccionCal, desde: string, req: any, comentario: string | null, set: string, extras: unknown[]) {
    const hasta = ESTADO_TRAS[accion];
    const desdeDb = desde === "borrador" ? ["borrador", "calculada"] : [desde];
    await prisma.$transaction(async (tx) => {
      const n = await tx.$executeRawUnsafe(
        `UPDATE met_calibracion SET estado = $2, updated_at = now(), ${set}
          WHERE id = $1::uuid AND estado = ANY($3::text[])`,
        id, hasta, desdeDb, req.user?.sub ?? null, ...extras);
      if (!n) throw new ForbiddenException("La calibración cambió de estado mientras tanto; recargue la lista");
      const acc = { ENVIAR: "ENVIADA", DEVOLVER: "DEVUELTA", EMITIR: "EMITIDA", EDITAR: "EDITADA" }[accion];
      await this.evento(tx, id, acc, desde, hasta, req, comentario);
    });
  }

  private async evento(tx: any, id: string, accion: string, desde: string | null, hasta: string, req: any, comentario: string | null) {
    await tx.$executeRawUnsafe(
      `INSERT INTO met_calibracion_evento (calibracion_id, accion, estado_desde, estado_hasta, usuario_id, comentario)
       VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6)`, id, accion, desde, hasta, req.user?.sub ?? null, comentario);
  }

  /** Laboratorio de la calibración: el del proceso o, si el proceso no lo fija, el indicado; dentro del alcance del usuario. */
  private async unidadDeCalibracion(req: any, t: string, proc: any, laboratorio?: string | null): Promise<string | null> {
    const codigo = proc.laboratorio ?? laboratorio ?? null;
    if (!codigo) throw new BadRequestException(`Indique el laboratorio que realiza la calibración (${LABS_SAM.join(", ")})`);
    if (!LABS_SAM.includes(codigo)) throw new BadRequestException(`Laboratorio no válido: ${codigo}`);
    const u = await prisma.$queryRawUnsafe<any[]>(`SELECT id FROM unidad WHERE tenant_id = $1::uuid AND codigo = $2 LIMIT 1`, t, codigo);
    if (!u.length) return null; // instalación sin ese laboratorio en el organigrama: queda el control por permiso
    await this.alcance.exigirUnidad(req, u[0].id, `el proceso ${proc.codigo}`);
    return u[0].id;
  }

  /** Calcula en el servidor según el tipo de proceso y deja todo listo para persistir. */
  private async calcularDto(proc: any, d: CrearDto) {
    const motor = motorDeProceso(proc.codigo);
    if (motor) {
      if (!d.motor) throw new BadRequestException(`${proc.codigo} se calcula con su motor: envíe los datos del motor`);
      const { datos, opciones } = d.motor;
      const { resultado, resumen } = ejecutarMotor(proc.codigo, datos, opciones);
      return {
        motor: motor.it, cond: {}, datos: JSON.stringify(datos), opciones: JSON.stringify(opciones),
        resultado: JSON.stringify(resultado), resumen: JSON.stringify(resumen), resumenObj: resumen,
        uMax: resumen.uMax, uCert: resumen.uCert, conforme: resumen.conforme, puntosGum: undefined,
        puntos: resumen.puntos.map((p) => ({ nominal: p.nominal, error: p.error, uc: p.uc, u_exp: p.U, dentro: p.conforme })),
      };
    }
    if (!d.puntos.length) throw new BadRequestException("Debe registrar al menos un punto de calibración");
    const divs = await cargarDivisores();
    const puntos: Punto[] = d.puntos.map((p) => ({ nominal: p.nominal, correccion: p.correccion, uPatron: p.uPatron, deriva: p.deriva, lecturas: p.lecturas }));
    const calc = calcularCalibracion(proc.componentes, divs, d.cond, puntos);
    return {
      motor: null, cond: d.cond, datos: null, opciones: null, resultado: null, resumen: null, resumenObj: null,
      uMax: calc.uMax, uCert: null, conforme: calc.conforme, puntosGum: calc.puntos,
      puntos: calc.puntos.map((p) => ({
        nominal: p.nominal, correccion: p.correccion, u_patron: p.uPatron, deriva: p.deriva, lecturas: p.lecturas, media: p.media,
        repetibilidad: p.repetibilidad, referencia: p.referencia, error: p.error, uc: p.uc, u_exp: p.uExp, en_norm: p.en, dentro: p.dentro,
        componentes: p.componentes,
      })),
    };
  }

  private async guardarPuntos(tx: any, calId: string, puntos: any[]) {
    let orden = 0;
    for (const p of puntos) {
      await tx.$executeRawUnsafe(
        `INSERT INTO met_calibracion_punto
           (calibracion_id, orden, nominal, correccion, u_patron, deriva, lecturas, media, repetibilidad,
            referencia, error, uc, u_exp, en_norm, dentro, componentes)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
        calId, orden++, p.nominal ?? null, p.correccion ?? null, p.u_patron ?? null, p.deriva ?? null, JSON.stringify(p.lecturas ?? []),
        p.media ?? null, p.repetibilidad ?? null, p.referencia ?? null, p.error ?? null, p.uc ?? null, p.u_exp ?? null,
        p.en_norm ?? null, p.dentro ?? null, JSON.stringify(p.componentes ?? []));
    }
  }

  /** Siguiente correlativo del año de la fecha de calibración (CAL-AAAA-NNNN). */
  private async siguienteCodigo(t: string, fecha: string): Promise<string> {
    const prefijo = codigoCalibracion(fecha, 0).replace(/0+$/, "");
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(codigo,'^.*-',''),'')::int),0)+1 AS n
         FROM met_calibracion WHERE tenant_id = $1::uuid AND codigo LIKE $2`, t, prefijo + "%");
    return codigoCalibracion(fecha, Number(rows[0]?.n ?? 1));
  }
}

@Module({ controllers: [MetrologiaController] })
export class MetrologiaModule {}
