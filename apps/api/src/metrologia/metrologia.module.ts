import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Module, NotFoundException,
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
import { Public } from "../auth/public.decorator";
import { AmbitoUnidad } from "../rbac/ambito-unidad.guard";
import { AlcanceService } from "../rbac/alcance.service";
import { ancestroDeTipo, descendientes } from "../rbac/alcance";
import { RbacModule } from "../rbac/rbac.module";
import { FirmasMatrizService } from "../rbac/firmas-matriz.controller";
import { documentoCompleto, type Sello } from "../plantilla-render/plantilla-defecto";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import { calcularCalibracion, type Componente, type Divisores, type Punto } from "./metrologia.calc";
import {
  REGISTRO_MOTORES, calcularConMotor, motorDeProceso, motivoOpciones, opcionesPorDefecto, PROCESOS_POR_PUNTOS, type ResumenMotor,
} from "./motores";
import { CASOS_REFERENCIA, esClaveExcel, verificarParidad } from "./motores/paridad";
import { CASOS_LNF, verificarParidadLNF } from "./motores/paridad-lnf";
import { CASOS_1510, verificarParidad1510 } from "./motores/paridad-1510";
import { certificadoHtml, type ContextoCertificado, type FirmaCert } from "./metrologia.certificado";
import {
  ESTADO_TRAS, accionesDisponibles, clavePaso, codigoCalibracion, estadoDe, fechaCalibracion, motivoNoEnviable, motivoRechazo, ordenElabora,
  pasoPendiente, pasosSinResponsable,
  plantillaVacia, puedeFirmarPaso, type AccionCal, type ContextoCal, type FirmaHecha, type PasoFirmaCal,
} from "./metrologia.flujo";
import {
  avisosFechas, cmcPara, codigoVerificacionValido, convertir, estadoPatron, motivoHabilitacion, motivoNoEmiteMetrologo, nuevoCodigoVerificacion, numeroCertificado,
  revisarPatrones, uCertificada, type FilaCmc, type Firmante,
} from "./metrologia.reglas";

// ---------------------------------------------------------------------------
// Módulo Metrología (Sección SAM: LMT, LMTE, LNF). Cada proceso se calcula con
// su motor (14 validados contra los Excel del LMT + ITM03 e ITV05 desde los casos
// del 15-10, ISO 376 del LNF, formulario por puntos). Circuito según la matriz de
// firmas: borrador → en revisión → (jefe del laboratorio) en firma → (jefe de
// departamento) emitida; reemisión con reemplazo. Ver docs/FLUJO_METROLOGIA.md.
// Todo por SQL crudo (las tablas met_* no están en Prisma).
// ---------------------------------------------------------------------------
const prisma = new PrismaClient();

/** Laboratorios de la Sección Metrología a los que puede pertenecer una calibración. */
const LABS_SAM = ["LMT", "LMTE", "LNF", "LCAD"];
const TIPO_DOC = "CERTIFICADO_CALIBRACION";
/** Entradas que salen de un maestro (C5: CMC versionada) o son constantes del método: no se escriben en el formulario. */
const CAMPOS_MAESTRO: Record<string, string[]> = { ITM02: ["mcm"], ITV05: ["cmcTabla", "tan", "uEqW", "uEqA"], ITM03: ["rho0", "rhoAl"] };
/** Motores cuya U certificada es la ASIGNADA por clase (OIML R111), no la calculada. */
const U_ASIGNADA = new Set(["ITM01", "ITM03"]);
const URL_VERIFICACION = () => (process.env.URL_VERIFICACION ?? "https://verificar.idic.cl/c").replace(/\/+$/, "");

const PuntoSchema = z.object({
  nominal: z.coerce.number(),
  correccion: z.coerce.number().default(0),
  uPatron: z.coerce.number().default(0),
  deriva: z.coerce.number().default(0),
  lecturas: z.array(z.coerce.number()).default([]),
});
const texto = z.union([z.string(), z.number()]).transform((x) => String(x).slice(0, 300)).nullish();
const fechaTexto = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").nullish().or(z.literal(""));
/** Datos del instrumento, del cliente y de la OT que se imprimen en el certificado (lo desconocido se descarta). */
const InstrumentoSchema = z.object({
  item: texto, marca: texto, modelo: texto, serie: texto, idEspecial: texto, cap: texto, res: texto, rango: texto, unidad: texto, clase: texto,
  cliente: texto, solicitante: texto, contacto: texto, direccion: texto, ot: texto,
  fechaOt: fechaTexto, fechaRecepcion: fechaTexto,
  lugar: z.enum(["instalaciones", "cliente"]).nullish().or(z.literal("")),
  desviacion: texto,
}).strip();
const CrearSchema = z.object({
  procesoCodigo: z.string().min(2),
  patronId: z.string().uuid().nullish(),
  /** Patrones usados (máximo 3) del maestro: se bloquea si alguno está vencido a la fecha de calibración. */
  patronIds: z.array(z.string().uuid()).max(3).default([]),
  /** Laboratorio (LMT, LMTE, LNF, LCAD): obligatorio solo en procesos sin laboratorio fijo (PTS01). */
  laboratorio: z.string().max(10).nullish(),
  /** Fecha de calibración AAAA-MM-DD (por defecto, hoy). */
  fecha: z.string().max(10).nullish(),
  instrumento: InstrumentoSchema.default({}),
  /** Obsoleto: el patrón sale del maestro (patronIds); se ignora para no imprimir patrones sin control de vigencia. */
  patronSnap: z.record(z.any()).optional(),
  ambiente: z.record(z.union([z.string(), z.number()]).transform((x) => String(x).slice(0, 40))).default({}),
  cond: z.record(z.coerce.number()).default({}),
  intervaloMeses: z.coerce.number().int().min(0).max(120).default(12),
  puntos: z.array(PuntoSchema).default([]),
  /** Datos de entrada del motor de la IT y correcciones aplicadas (hallazgos). */
  motor: z.object({ datos: z.record(z.any()), opciones: z.record(z.boolean()).default({}) }).optional(),
});
type CrearDto = z.infer<typeof CrearSchema>;
const CalcularSchema = z.object({ datos: z.record(z.any()), opciones: z.record(z.boolean()).default({}) });
const MotivoSchema = z.object({ motivo: z.string().trim().min(5, "Indique el motivo (mínimo 5 caracteres)").max(2000) });

/** Quita los valores del Excel (x_, y_, z_, w_, x, xT) y las entradas que vienen de un maestro. */
function soloEntradas(v: any, it?: string): any {
  const quitar = new Set(it ? CAMPOS_MAESTRO[it] ?? [] : []);
  const rec = (x: any): any => {
    if (Array.isArray(x)) return x.map(rec);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).filter(([k]) => !esClaveExcel(k) && !quitar.has(k)).map(([k, y]) => [k, rec(y)]));
    return x;
  };
  return rec(v);
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
const hoyChile = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const fechaIso = (d: any): string => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));

async function cargarDivisores(): Promise<Divisores> {
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT codigo, divisor FROM met_distribucion`);
  return Object.fromEntries(rows.map((r) => [r.codigo, Number(r.divisor)]));
}
async function cargarProceso(codigo: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT p.id, p.codigo, p.nombre, p.metodo, p.norma, p.laboratorio, p.acreditacion, p.prefijo_certificado,
            m.codigo AS mag, m.nombre AS mag_nombre, m.unidad, m.decimales
       FROM met_proceso p JOIN met_magnitud m ON m.id = p.magnitud_id WHERE p.codigo = $1 AND p.activo`, codigo);
  if (!rows.length) throw new NotFoundException(`Proceso ${codigo} no encontrado`);
  const p = rows[0];
  const comps = await prisma.$queryRawUnsafe<any[]>(
    `SELECT c.simbolo, c.nombre, c.distribucion, c.fuente, c.orden
       FROM met_componente c JOIN met_proceso pr ON pr.magnitud_id = c.magnitud_id
      WHERE pr.codigo = $1 ORDER BY c.orden`, codigo);
  return { ...p, componentes: comps as Componente[] };
}
/** CMC del maestro (C5) de un proceso; todas sus versiones activas (la vigencia se filtra por fecha). */
async function cargarCmc(proceso: string): Promise<FilaCmc[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT proceso_codigo, acreditacion, version, vigente_desde, vigente_hasta, rango_min, rango_max, incluye_min, unidad_rango,
            resolucion, tipo, a, b, unidad_cmc, variante
       FROM met_cmc WHERE proceso_codigo = $1 AND activo ORDER BY rango_min`, proceso);
  return rows.map((r) => ({ ...r, vigente_desde: fechaIso(r.vigente_desde), vigente_hasta: r.vigente_hasta ? fechaIso(r.vigente_hasta) : null }));
}
const vigenteEn = (f: FilaCmc, fecha: string) => String(f.vigente_desde) <= fecha && (!f.vigente_hasta || String(f.vigente_hasta) >= fecha);

/**
 * Entradas del motor que vienen del maestro de CMC (C5) en vez de constantes:
 * ITM02 → tabla [desde g, hasta g, CMC mg]; ITV05 → tabla [desde mL, hasta mL, a].
 */
function inyectarCmc(it: string, datos: any, filas: FilaCmc[], fecha: string): any {
  const vig = filas.filter((f) => vigenteEn(f, fecha));
  if (it === "ITM02") {
    const t = vig.filter((f) => f.unidad_rango === "g" && f.unidad_cmc === "mg" && f.tipo === "valor").map((f) => [f.rango_min, f.rango_max, f.a]);
    return t.length ? { ...datos, mcm: t } : datos;
  }
  if (it === "ITV05") {
    const t = vig.filter((f) => f.tipo === "raiz").map((f) => [f.rango_min, f.rango_max, f.a]);
    return t.length ? { ...datos, cmcTabla: t } : datos;
  }
  return datos;
}

/**
 * U certificada por punto (C5 y C12): máx(U del motor, CMC del maestro) con dos cifras
 * significativas; en masas patrón, la U asignada por clase. Marca «*» los puntos fuera
 * del alcance acreditado cuando el proceso tiene CMC en el maestro.
 */
function aplicarCmc(resumen: ResumenMotor, filas: FilaCmc[], p: { proceso: string; motor: string; fecha: string; unidad: string; unidadU: string; resolucion: number | null; acreditado: boolean }) {
  if (p.motor === "LCPNF-IT01") return resumen;
  const vig = filas.filter((f) => vigenteEn(f, p.fecha));
  const versiones = new Set<string>();
  const puntos = resumen.puntos.map((x) => {
    const unidad = x.unidad || p.unidad;
    const evaluable = vig.some((f) => convertir(x.nominal, unidad, f.unidad_rango) != null);
    const c = evaluable ? cmcPara(vig, { proceso: p.proceso, fecha: p.fecha, nominal: x.nominal, unidad, unidadU: p.unidadU, resolucion: p.resolucion }) : null;
    if (c) versiones.add(c.fila.version);
    const base = x.Ucert ?? x.U;
    const uCertificado = U_ASIGNADA.has(p.motor) ? (c ? Math.max(base as number, c.cmc) : base) : uCertificada(base, c?.cmc ?? null);
    return { ...x, cmc: c?.cmc ?? null, uCertificado, fueraAlcance: p.acreditado && evaluable && !c };
  });
  const us = puntos.map((x) => x.uCertificado).filter((u): u is number => u != null && Number.isFinite(u));
  return { ...resumen, puntos, uCert: us.length ? Math.max(...us) : resumen.uCert, cmc: [...versiones] } as ResumenMotor;
}

/** Nombre del departamento que firma (parámetro; si no, el del organigrama). */
async function nombreDepartamento(alcance: AlcanceService, t: string, unidadId: string | null): Promise<{ nombre: string; origen: string }> {
  const p = await prisma.$queryRawUnsafe<any[]>(
    `SELECT etiqueta FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'certificado_calibracion' AND codigo = 'nombre_departamento' AND activo LIMIT 1`, t);
  if (p[0]?.etiqueta?.trim()) return { nombre: p[0].etiqueta.trim(), origen: "parametro" };
  const arbol = await alcance.arbol(t);
  const base = unidadId ?? arbol.porCodigo.get("SAM")?.id ?? null;
  const d = base ? ancestroDeTipo(arbol, base, "DEPARTAMENTO") : null;
  return { nombre: d?.nombre ?? "Departamento", origen: "organigrama" };
}

async function registroFirmas(t: string): Promise<(Firmante & { id: string })[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, iniciales, funcion, magnitudes, laboratorios, usuario_id, activo FROM met_firmante WHERE tenant_id = $1::uuid`, t);
  return rows.map((r) => ({ id: r.id, iniciales: r.iniciales, funcion: r.funcion, magnitudes: r.magnitudes ?? [], laboratorios: r.laboratorios ?? [], usuarioId: r.usuario_id, activo: r.activo }));
}

/** Datos de quien firma (nombre, grado y cargo) para el certificado. */
async function firmanteDe(usuarioId: string): Promise<{ nombre: string; grado: string | null; cargo: string | null }> {
  const r = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.nombre_completo, COALESCE(NULLIF(u.grado, ''), g.nombre) AS grado, u.cargo
       FROM usuario u LEFT JOIN grado_militar g ON g.id = u.grado_id WHERE u.id = $1::uuid`, usuarioId);
  return { nombre: r[0]?.nombre_completo ?? "—", grado: r[0]?.grado ?? null, cargo: r[0]?.cargo ?? null };
}

interface Circuito {
  pasos: PasoFirmaCal[] | null; firmas: any[]; actual: PasoFirmaCal | null; ultimo: boolean; jefes: PasoFirmaCal[]; elabora: PasoFirmaCal | null;
  /** Motivo si la matriz no se pudo resolver o no devolvió pasos (entonces nadie firma ni se envía). */
  errorMatriz: string | null;
}

// ===========================================================================
@ApiTags("metrología")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("SAM")
@Controller("metrologia")
export class MetrologiaController {
  constructor(private readonly alcance: AlcanceService, private readonly matriz: FirmasMatrizService) {}

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

  /** Procesos con su magnitud, laboratorio, acreditación, motor y componentes (solo los de los laboratorios del usuario). */
  @Get("procesos")
  @RequierePermiso("metrologia.ver")
  async procesos(@Req() req: any) {
    const procs = await prisma.$queryRawUnsafe<any[]>(
      `SELECT p.codigo, p.nombre, p.metodo, p.norma, p.revision, p.laboratorio, p.acreditacion, p.prefijo_certificado,
              m.codigo AS magnitud, m.nombre AS magnitud_nombre, m.unidad, m.decimales
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
    const [magnitudes, distribuciones, componentes, oiml] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(`SELECT id, codigo, nombre, unidad, decimales FROM met_magnitud ORDER BY codigo`),
      prisma.$queryRawUnsafe<any[]>(`SELECT codigo, divisor, uso FROM met_distribucion ORDER BY divisor`),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT c.id, m.codigo AS magnitud, c.simbolo, c.nombre, c.distribucion, c.fuente, c.orden
           FROM met_componente c JOIN met_magnitud m ON m.id = c.magnitud_id ORDER BY m.codigo, c.orden`),
      prisma.$queryRawUnsafe<any[]>(`SELECT nominal, clase, mpe_mg FROM met_tolerancia_oiml ORDER BY mpe_mg`),
    ]);
    const patrones = (await this.patrones(req, undefined)).data;
    void t;
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

  /** Motores: IT, unidades, correcciones (con la decisión del laboratorio), casos de referencia y si está validado. */
  @Get("motores")
  @RequierePermiso("metrologia.ver")
  motores() {
    const casos = [...CASOS_REFERENCIA, ...CASOS_LNF, ...CASOS_1510];
    return {
      data: Object.values(REGISTRO_MOTORES).map(({ calcular, resumen, ...m }) => ({
        ...m, validado: m.validado !== false, opcionesPorDefecto: opcionesPorDefecto(REGISTRO_MOTORES[m.it]),
        casos: casos.filter((c) => c.it === m.it).map((c) => ({ caso: c.caso, instrumento: c.instrumento })),
      })),
      procesosPorPuntos: PROCESOS_POR_PUNTOS,
    };
  }

  /** Evidencia de validación: recalcula los casos reales (16 + 2 del LMT, 1 del LNF) y los compara con las planillas. */
  @Get("motores/paridad")
  @RequierePermiso("metrologia.ver")
  paridad() {
    const lmt = verificarParidad(), lnf = verificarParidadLNF(), l1510 = verificarParidad1510();
    return {
      casos: [...lmt.casos, ...l1510.casos.map(({ fallos, ...c }) => c), ...lnf.casos],
      identicos: lmt.identicos + lnf.identicos + l1510.identicos, comparados: lmt.comparados + lnf.comparados + l1510.comparados,
    };
  }

  /** Datos de entrada de un caso de referencia (sin los valores de la planilla), para formación. */
  @Get("motores/:it/ejemplo")
  @RequierePermiso("metrologia.ver")
  ejemplo(@Param("it") it: string, @Query("caso") caso?: string) {
    const m = motorDeProceso(it);
    if (!m) throw new NotFoundException(`No hay motor para ${it}`);
    const c = [...CASOS_REFERENCIA, ...CASOS_LNF, ...CASOS_1510].find((x) => x.it === m.it && (!caso || x.caso === caso));
    if (!c) throw new NotFoundException(`No hay caso de referencia para ${m.it}`);
    return { data: { caso: c.caso, instrumento: c.instrumento, datos: soloEntradas(c.datos, m.it), control: (c as any).control ?? null } };
  }

  /** Formulario vacío del motor: la estructura de su planilla sin ningún valor. */
  @Get("motores/:it/plantilla")
  @RequierePermiso("metrologia.ver")
  plantilla(@Param("it") it: string) {
    const m = motorDeProceso(it);
    if (!m) throw new NotFoundException(`No hay motor para ${it}`);
    const c = [...CASOS_REFERENCIA, ...CASOS_LNF, ...CASOS_1510].find((x) => x.it === m.it);
    return { data: { datos: c ? plantillaVacia(soloEntradas(c.datos, m.it)) : null, opciones: opcionesPorDefecto(m) } };
  }

  /** Vista previa: calcula sin guardar (el mismo motor, CMC del maestro y reglas que el guardado). */
  @Post("motores/:it/calcular")
  @RequierePermiso("metrologia.ver")
  async calcular(@Param("it") it: string, @Body() body: unknown, @Query("fecha") fecha?: string) {
    const m = motorDeProceso(it);
    if (!m) throw new NotFoundException(`No hay motor para ${it}`);
    const d = CalcularSchema.parse(body);
    const mot = motivoOpciones(m, d.opciones);
    if (mot) throw new BadRequestException(mot);
    const f = fechaCalibracion(fecha);
    const filas = await cargarCmc(it);
    const out = ejecutarMotor(it, inyectarCmc(m.it, d.datos, filas, f), d.opciones);
    const proc = await prisma.$queryRawUnsafe<any[]>(`SELECT acreditacion FROM met_proceso WHERE codigo = $1`, it);
    const resumen = aplicarCmc(out.resumen, filas, { proceso: it, motor: m.it, fecha: f, unidad: m.unidad, unidadU: m.unidadU, resolucion: numero(d.datos.res), acreditado: !!proc[0]?.acreditacion });
    return { data: { ...out, resumen } };
  }

  // ----- Maestros: patrones, CMC, registro de firmas, numeración, parámetros -----
  /** Patrones y equipos auxiliares con su estado a la fecha (por defecto, hoy). */
  @Get("patrones")
  @RequierePermiso("metrologia.ver")
  async patrones(@Req() req: any, @Query("fecha") fecha?: string) {
    const f = fechaCalibracion(fecha);
    const data = await prisma.$queryRawUnsafe<any[]>(
      `SELECT p.id, p.codigo, p.tipo, p.nombre, p.marca, p.modelo, p.serie, p.rango, p.clase, p.norma_referencia, p.puesta_marcha,
              p.emisor, p.n_certificado, p.ultima_calibracion, p.intervalo_meses, p.vence, p.trazabilidad, p.u_expandida, p.deriva,
              p.laboratorio, p.fuente, p.observacion, p.activo, m.codigo AS magnitud
         FROM met_patron p LEFT JOIN met_magnitud m ON m.id = p.magnitud_id
        WHERE p.tenant_id = $1::uuid AND p.deleted_at IS NULL ORDER BY m.codigo, p.codigo`, tenantId(req));
    return { data: data.map((p) => ({ ...p, estado: estadoPatron(p.vence, f) })), fecha: f };
  }

  @Post("patrones")
  @RequierePermiso("metrologia.config")
  async crearPatron(@Body() body: unknown, @Req() req: any) {
    const d = PatronSchema.extend({ codigo: z.string().trim().min(2).max(40), nombre: z.string().trim().min(2).max(160), magnitud: z.string().max(20) }).parse(body);
    const t = tenantId(req);
    const dup = await prisma.$queryRawUnsafe<any[]>(`SELECT 1 FROM met_patron WHERE tenant_id = $1::uuid AND codigo = $2 AND deleted_at IS NULL`, t, d.codigo);
    if (dup.length) throw new ConflictException(`Ya existe un patrón con el código ${d.codigo}`);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO met_patron (tenant_id, magnitud_id, codigo, nombre, tipo, marca, modelo, serie, rango, clase, emisor, n_certificado,
                               ultima_calibracion, intervalo_meses, vence, trazabilidad, u_expandida, deriva, laboratorio, activo, fuente)
       SELECT $1::uuid, m.id, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::date, $14, $15::date, $16, $17, $18, $19, COALESCE($20, TRUE), 'Registro manual'
         FROM met_magnitud m WHERE m.codigo = $2 RETURNING id`,
      t, d.magnitud, d.codigo, d.nombre, d.tipo ?? "patron", d.marca ?? null, d.modelo ?? null, d.serie ?? null, d.rango ?? null, d.clase ?? null,
      d.emisor ?? null, d.n_certificado ?? null, d.ultima_calibracion || null, d.intervalo_meses ?? null, d.vence || null, d.trazabilidad ?? null,
      d.u_expandida ?? null, d.deriva ?? null, d.laboratorio ?? "LMT", d.activo ?? null);
    if (!rows.length) throw new BadRequestException(`Magnitud desconocida: ${d.magnitud}`);
    return { data: { id: rows[0].id } };
  }

  /** Actualiza un patrón (nuevo certificado, fechas, vencimiento, baja). */
  @Put("patrones/:id")
  @RequierePermiso("metrologia.config")
  async editarPatron(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const d = PatronSchema.parse(body);
    const campos: [string, any, string?][] = [
      ["nombre", d.nombre], ["tipo", d.tipo], ["marca", d.marca], ["modelo", d.modelo], ["serie", d.serie], ["rango", d.rango], ["clase", d.clase],
      ["emisor", d.emisor], ["n_certificado", d.n_certificado], ["ultima_calibracion", d.ultima_calibracion === "" ? null : d.ultima_calibracion, "date"],
      ["intervalo_meses", d.intervalo_meses], ["vence", d.vence === "" ? null : d.vence, "date"], ["trazabilidad", d.trazabilidad],
      ["u_expandida", d.u_expandida], ["deriva", d.deriva], ["activo", d.activo], ["observacion", d.observacion],
    ];
    const set: string[] = [], vals: any[] = [id, tenantId(req)];
    for (const [c, val, tipo] of campos) {
      if (val === undefined) continue;
      vals.push(val);
      set.push(`${c} = $${vals.length}${tipo ? "::" + tipo : ""}`);
    }
    if (!set.length) throw new BadRequestException("No hay cambios");
    const n = await prisma.$executeRawUnsafe(`UPDATE met_patron SET ${set.join(", ")} WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`, ...vals);
    if (!n) throw new NotFoundException("Patrón no encontrado");
    return { data: { id } };
  }

  /** Capacidades de medición y calibración (CMC) vigentes por proceso, con su versión del alcance. */
  @Get("cmc")
  @RequierePermiso("metrologia.ver")
  async cmc(@Query("proceso") proceso?: string) {
    const data = await prisma.$queryRawUnsafe<any[]>(
      `SELECT clave, acreditacion, version, vigente_desde, vigente_hasta, proceso_codigo, servicio, variante, rango_min, rango_max, incluye_min,
              unidad_rango, resolucion, tipo, a, b, unidad_cmc, patron, activo
         FROM met_cmc WHERE ($1::text IS NULL OR proceso_codigo = $1) ORDER BY proceso_codigo, servicio, rango_min, resolucion NULLS FIRST`, proceso ?? null);
    return { data };
  }

  /** Registro de firmas autorizadas por magnitud (LMT-PG01 Anexo 11), con el usuario vinculado. */
  @Get("firmantes")
  @RequierePermiso("metrologia.ver")
  async firmantes(@Req() req: any) {
    const data = await prisma.$queryRawUnsafe<any[]>(
      `SELECT f.id, f.iniciales, f.funcion, f.cargo, f.magnitudes, f.laboratorios, f.usuario_id, f.documento, f.activo,
              u.nombre_completo AS usuario_nombre, u.username
         FROM met_firmante f LEFT JOIN usuario u ON u.id = f.usuario_id
        WHERE f.tenant_id = $1::uuid ORDER BY f.funcion DESC, f.iniciales`, tenantId(req));
    return { data };
  }

  /** Usuarios de la Sección Metrología que se pueden vincular al registro de firmas. */
  @Get("firmantes/candidatos")
  @RequierePermiso("metrologia.config")
  async candidatos(@Req() req: any) {
    const t = tenantId(req);
    const arbol = await this.alcance.arbol(t);
    const sam = arbol.porCodigo.get("SAM");
    const ids = sam ? descendientes(arbol, sam.id, true) : [];
    const dsa = sam ? ancestroDeTipo(arbol, sam.id, "DEPARTAMENTO") : null;
    const sem = arbol.porCodigo.get("SEM");
    const unidades = [...ids, ...(dsa ? [dsa.id] : []), ...(sem ? [sem.id] : [])];
    const data = await prisma.$queryRawUnsafe<any[]>(
      `SELECT DISTINCT u.id, u.nombre_completo AS nombre, u.username
         FROM usuario u JOIN usuario_rol ur ON ur.usuario_id = u.id
        WHERE u.tenant_id = $1::uuid AND u.deleted_at IS NULL AND u.estado = 'activo' AND ur.unidad_id = ANY($2::uuid[])
        ORDER BY 2`, t, unidades);
    return { data };
  }

  @Put("firmantes/:id")
  @RequierePermiso("metrologia.config")
  async editarFirmante(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const d = z.object({
      usuarioId: z.string().uuid().nullable().optional(),
      magnitudes: z.array(z.string().max(20)).max(12).optional(),
      activo: z.boolean().optional(),
    }).parse(body);
    const t = tenantId(req);
    if (d.usuarioId) {
      const u = await prisma.$queryRawUnsafe<any[]>(`SELECT 1 FROM usuario WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL AND estado = 'activo'`, d.usuarioId, t);
      if (!u.length) throw new BadRequestException("El usuario no existe o no está activo");
    }
    if (d.magnitudes) {
      const m = await prisma.$queryRawUnsafe<any[]>(`SELECT codigo FROM met_magnitud WHERE codigo = ANY($1::text[])`, d.magnitudes);
      if (m.length !== new Set(d.magnitudes).size) throw new BadRequestException("Hay magnitudes desconocidas");
    }
    const n = await prisma.$executeRawUnsafe(
      `UPDATE met_firmante SET usuario_id = CASE WHEN $3 THEN $4::uuid ELSE usuario_id END,
              magnitudes = COALESCE($5::text[], magnitudes), activo = COALESCE($6, activo), updated_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      id, t, d.usuarioId !== undefined, d.usuarioId ?? null, d.magnitudes ?? null, d.activo ?? null);
    if (!n) throw new NotFoundException("Registro no encontrado");
    return { data: { id } };
  }

  /** Numeración de certificados por magnitud (último número emitido de cada prefijo). */
  @Get("numeracion")
  @RequierePermiso("metrologia.ver")
  async numeracion(@Req() req: any) {
    const data = await prisma.$queryRawUnsafe<any[]>(`SELECT prefijo, ultimo, relleno, updated_at FROM met_numeracion WHERE tenant_id = $1::uuid ORDER BY prefijo`, tenantId(req));
    return { data };
  }

  /** Fija el último número de un prefijo (puesta en marcha): no puede quedar por debajo de lo ya emitido en el LIMS. */
  @Put("numeracion/:prefijo")
  @RequierePermiso("metrologia.config")
  async fijarNumeracion(@Param("prefijo") prefijo: string, @Body() body: unknown, @Req() req: any) {
    const d = z.object({ ultimo: z.coerce.number().int().min(0).max(9_999_999) }).parse(body);
    const t = tenantId(req);
    if (!/^[A-Z]{1,6}$/.test(prefijo)) throw new BadRequestException("Prefijo no válido");
    const max = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(numero_certificado, '^[A-Z]+-', ''), '')::int), 0) AS n
         FROM met_calibracion WHERE tenant_id = $1::uuid AND numero_certificado ~ ('^' || $2 || '-[0-9]+$')`, t, prefijo);
    if (d.ultimo < Number(max[0]?.n ?? 0)) throw new ConflictException(`Ya se emitió el ${prefijo}-${max[0].n} en el LIMS: el último número no puede ser menor`);
    const n = await prisma.$executeRawUnsafe(`UPDATE met_numeracion SET ultimo = $3, updated_at = now() WHERE tenant_id = $1::uuid AND prefijo = $2`, t, prefijo, d.ultimo);
    if (!n) throw new NotFoundException(`Prefijo ${prefijo} no configurado`);
    return { data: { prefijo, ultimo: d.ultimo } };
  }

  /** Parámetros del certificado: nombre del departamento (y de dónde sale). */
  @Get("parametros")
  @RequierePermiso("metrologia.ver")
  async parametros(@Req() req: any) {
    const d = await nombreDepartamento(this.alcance, tenantId(req), null);
    return { data: { nombreDepartamento: d.nombre, origen: d.origen } };
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
      const e = estado === "borrador" ? ["borrador", "calculada"] : estado === "en_revision" ? ["en_revision", "en_firma"] : [estado];
      params.push(e); where += ` AND c.estado = ANY($${params.length}::text[])`;
    }
    const data = await prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id, c.codigo, c.numero_certificado, c.estado, c.u_max, c.u_cert, c.motor, c.created_at, c.emitido_at, c.fecha_calibracion,
              c.created_by, c.devuelto_motivo, c.unidad_id, (c.resumen IS NOT NULL OR c.u_max IS NOT NULL) AS calculada,
              pr.codigo AS proceso, pr.nombre AS proceso_nombre, m.codigo AS magnitud, m.unidad, un.codigo AS laboratorio,
              c.instrumento->>'item' AS instrumento, c.instrumento->>'cliente' AS cliente,
              ua.nombre_completo AS autor_nombre, r.numero_certificado AS reemplaza_numero,
              EXISTS (SELECT 1 FROM met_calibracion x WHERE x.reemplaza_id = c.id AND x.deleted_at IS NULL AND x.estado <> 'reemplazada') AS reemision_en_curso
         FROM met_calibracion c
         JOIN met_proceso pr ON pr.id = c.proceso_id
         JOIN met_magnitud m ON m.id = pr.magnitud_id
         LEFT JOIN unidad un ON un.id = c.unidad_id
         LEFT JOIN usuario ua ON ua.id = c.created_by
         LEFT JOIN met_calibracion r ON r.id = c.reemplaza_id
        WHERE ${where}
        ORDER BY c.created_at DESC LIMIT $2`, ...params);
    const ctxs = await this.contextos(req, data);
    return {
      data: data.map(({ created_by, calculada, unidad_id, ...c }, i) => ({
        ...c,
        estado: estadoDe(c.estado),
        // En fuerza y par la incertidumbre es relativa (%), no en la unidad de la magnitud.
        unidad_u: c.motor === "PUNTOS" ? "" : (c.motor && REGISTRO_MOTORES[c.motor]?.unidadU) || c.unidad,
        es_mio: created_by === req.user?.sub,
        paso_pendiente: ctxs[i].pendiente,
        acciones: accionesDisponibles(ctxs[i].ctx),
      })),
    };
  }

  private async cargar(id: string, req: any) {
    const t = tenantId(req);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*, pr.codigo AS proceso, pr.nombre AS proceso_nombre, pr.metodo, pr.norma, pr.revision, pr.acreditacion, pr.prefijo_certificado,
              m.codigo AS magnitud, m.nombre AS magnitud_nombre, m.unidad, m.decimales, un.codigo AS laboratorio, un.nombre AS laboratorio_nombre,
              ua.nombre_completo AS autor_nombre, ue.nombre_completo AS emisor_nombre, r.numero_certificado AS reemplaza_numero,
              (SELECT x.numero_certificado FROM met_calibracion x WHERE x.reemplaza_id = c.id AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) AS reemplazada_por,
              EXISTS (SELECT 1 FROM met_calibracion x WHERE x.reemplaza_id = c.id AND x.deleted_at IS NULL AND x.estado <> 'reemplazada') AS reemision_en_curso
         FROM met_calibracion c JOIN met_proceso pr ON pr.id = c.proceso_id JOIN met_magnitud m ON m.id = pr.magnitud_id
         LEFT JOIN unidad un ON un.id = c.unidad_id
         LEFT JOIN usuario ua ON ua.id = c.created_by
         LEFT JOIN usuario ue ON ue.id = c.emitido_by
         LEFT JOIN met_calibracion r ON r.id = c.reemplaza_id
        WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid AND c.deleted_at IS NULL LIMIT 1`, id, t);
    if (!rows.length) throw new NotFoundException("Calibración no encontrada");
    const cal = rows[0];
    if (cal.unidad_id) await this.alcance.exigirUnidad(req, cal.unidad_id, "la calibración");
    return cal;
  }

  @Get("calibraciones/:id")
  @RequierePermiso("metrologia.ver")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const { __ctx, ...d } = await this.detalleCtx(id, req);
    return d;
  }

  /** Detalle con el contexto de reglas (para exigir cada acción con su motivo exacto). */
  private async detalleCtx(id: string, req: any) {
    const cal = await this.cargar(id, req);
    const [puntos, eventos] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(`SELECT * FROM met_calibracion_punto WHERE calibracion_id = $1::uuid ORDER BY orden`, id),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT e.accion, e.estado_desde, e.estado_hasta, e.comentario, e.created_at, u.nombre_completo AS usuario
           FROM met_calibracion_evento e LEFT JOIN usuario u ON u.id = e.usuario_id
          WHERE e.calibracion_id = $1::uuid ORDER BY e.created_at`, id),
    ]);
    const calculada = cal.resumen != null || cal.u_max != null;
    const [cx] = await this.contextos(req, [{ ...cal, calculada }]);
    const { documento_html, ...resto } = cal;
    return {
      ...resto, estado: estadoDe(cal.estado), calculada, puntos, eventos, es_mio: cal.created_by === req.user?.sub,
      firmas: cx.firmas, paso_pendiente: cx.pendiente, pasos_sin_responsable: cx.sinResponsable,
      avisos: avisosFechas({ fechaOt: cal.instrumento?.fechaOt, fechaRecepcion: cal.instrumento?.fechaRecepcion, fechaCalibracion: fechaIso(cal.fecha_calibracion) }),
      acciones: accionesDisponibles(cx.ctx), __ctx: cx.ctx,
    };
  }

  /** Circuito de firma de la calibración: pasos de la matriz, quién firmó y quién debe firmar. */
  @Get("calibraciones/:id/circuito")
  @RequierePermiso("metrologia.ver")
  async circuitoDe(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const cal = await this.cargar(id, req);
    const c = await this.circuito(tenantId(req), cal);
    return {
      data: {
        pasos: (c.pasos ?? []).map((p) => ({
          ...p,
          firma: c.firmas.find((f) => clavePaso(f) === clavePaso(p)) ?? null,
          pendiente: !!c.actual && clavePaso(c.actual) === clavePaso(p),
        })),
        sinMatriz: !c.pasos, sinResponsable: c.pasos ? pasosSinResponsable(c.pasos) : [], errorMatriz: c.errorMatriz,
      },
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
    const fecha = fechaCalibracion(d.fecha);
    const pat = await this.patronesDe(t, d, fecha);
    const calc = await this.calcularDto(proc, d, fecha);

    for (let intento = 0; ; intento++) {
      const codigo = await this.siguienteCodigo(t, fecha);
      try {
        const id = await prisma.$transaction(async (tx) => {
          const cal = await tx.$queryRawUnsafe<any[]>(
            `INSERT INTO met_calibracion
               (tenant_id, codigo, proceso_id, patron_id, unidad_id, fecha_calibracion, instrumento, patron_snap, ambiente, cond,
                u_max, u_cert, conforme, intervalo_meses, estado, created_by, motor, datos, opciones, resultado, resumen, patrones)
             VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,$6::date,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,
                     $11,$12,$13,$14,'borrador',$15::uuid,$16,$17::jsonb,$18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb)
             RETURNING id`,
            t, codigo, proc.id, pat.patronId, unidadId, fecha, JSON.stringify(d.instrumento), "{}",
            JSON.stringify(d.ambiente), JSON.stringify(calc.cond), calc.uMax, calc.uCert, calc.conforme, d.intervaloMeses,
            req?.user?.sub ?? null, calc.motor, calc.datos, calc.opciones, calc.resultado, calc.resumen, JSON.stringify(pat.snapshot));
          await this.guardarPuntos(tx, cal[0].id, calc.puntos);
          await this.evento(tx, cal[0].id, "CREADA", null, "borrador", req, null);
          return cal[0].id as string;
        });
        return {
          data: {
            id, codigo, estado: "borrador", fecha, motor: calc.motor, resumen: calc.resumenObj, uMax: calc.uMax, conforme: calc.conforme, puntos: calc.puntosGum,
            avisos: [...avisosFechas({ ...d.instrumento, fechaCalibracion: fecha }), ...pat.avisos],
          },
        };
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
    const t = tenantId(req);
    const cal = await this.detalleCtx(id, req);
    this.exigir("EDITAR", cal);
    const d = CrearSchema.parse(body);
    if (d.procesoCodigo !== cal.proceso) throw new BadRequestException("No se puede cambiar el proceso de una calibración guardada");
    const proc = await cargarProceso(d.procesoCodigo);
    const fecha = d.fecha ? fechaCalibracion(d.fecha) : fechaIso(cal.fecha_calibracion);
    const pat = await this.patronesDe(t, d, fecha);
    const calc = await this.calcularDto(proc, d, fecha);
    await prisma.$transaction(async (tx) => {
      const n = await tx.$executeRawUnsafe(
        `UPDATE met_calibracion SET patron_id = $2::uuid, instrumento = $3::jsonb, patron_snap = $4::jsonb, ambiente = $5::jsonb,
                cond = $6::jsonb, u_max = $7, u_cert = $8, conforme = $9, intervalo_meses = $10, motor = $11, datos = $12::jsonb,
                opciones = $13::jsonb, resultado = $14::jsonb, resumen = $15::jsonb, fecha_calibracion = $16::date, patrones = $17::jsonb,
                estado = 'borrador', updated_at = now()
          WHERE id = $1::uuid AND estado IN ('borrador', 'calculada')`,
        id, pat.patronId, JSON.stringify(d.instrumento), "{}", JSON.stringify(d.ambiente),
        JSON.stringify(calc.cond), calc.uMax, calc.uCert, calc.conforme, d.intervaloMeses, calc.motor, calc.datos, calc.opciones,
        calc.resultado, calc.resumen, fecha, JSON.stringify(pat.snapshot));
      if (!n) throw new ForbiddenException("La calibración cambió de estado mientras tanto; recargue la lista");
      await tx.$executeRawUnsafe(`DELETE FROM met_calibracion_punto WHERE calibracion_id = $1::uuid`, id);
      await this.guardarPuntos(tx, id, calc.puntos);
      await this.evento(tx, id, "EDITADA", "borrador", "borrador", req, null);
    });
    return {
      data: {
        id, codigo: cal.codigo, estado: "borrador", resumen: calc.resumenObj, uMax: calc.uMax, conforme: calc.conforme,
        avisos: [...avisosFechas({ ...d.instrumento, fechaCalibracion: fecha }), ...pat.avisos],
      },
    };
  }

  /** El metrólogo firma lo elaborado (ELABORA) y lo envía al jefe del laboratorio. */
  @Post("calibraciones/:id/enviar")
  @RequierePermiso("metrologia.crear")
  async enviar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const t = tenantId(req);
    const cal = await this.detalleCtx(id, req);
    this.exigir("ENVIAR", cal);
    const c = await this.circuito(t, cal);
    const noEnviable = motivoNoEnviable(c.pasos, c.errorMatriz);
    if (noEnviable) throw new ConflictException(noEnviable);
    const yo = await firmanteDe(req.user.sub);
    await this.transicion(id, "ENVIAR", cal.estado, req, null, `enviado_at = now(), enviado_by = $4::uuid, devuelto_motivo = NULL`, [], async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM met_calibracion_firma WHERE calibracion_id = $1::uuid`, id);
      await tx.$executeRawUnsafe(
        `INSERT INTO met_calibracion_firma (calibracion_id, orden, accion, rol_codigo, rol_nombre, unidad_codigo, usuario_id, nombre, grado, cargo, via)
         VALUES ($1::uuid, $2, 'ELABORA', $3, $4, $5, $6::uuid, $7, $8, $9, 'registro')`,
        id, ordenElabora(c.elabora), c.elabora?.rol.codigo ?? "METROLOGO", c.elabora?.rol.nombre ?? "Metrólogo", cal.laboratorio ?? null,
        req.user.sub, yo.nombre, yo.grado, yo.cargo ?? "Metrólogo");
    });
    return { data: { id, codigo: cal.codigo, estado: ESTADO_TRAS.ENVIAR } };
  }

  /** Un responsable del paso pendiente devuelve la calibración al metrólogo (motivo obligatorio). */
  @Post("calibraciones/:id/devolver")
  @RequierePermiso("metrologia.ver")
  async devolver(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const { motivo } = MotivoSchema.parse(body ?? {});
    const cal = await this.detalleCtx(id, req);
    this.exigir("DEVOLVER", cal);
    await this.transicion(id, "DEVOLVER", cal.estado, req, motivo, `devuelto_at = now(), devuelto_by = $4::uuid, devuelto_motivo = $5`, [motivo], async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM met_calibracion_firma WHERE calibracion_id = $1::uuid`, id);
    });
    return { data: { id, codigo: cal.codigo, estado: ESTADO_TRAS.DEVOLVER } };
  }

  /**
   * Firma el paso pendiente de la matriz. Si es el último, EMITE: número del certificado por
   * magnitud (C3), código de verificación (C7), documento sellado con SHA-256 y, si reemite
   * otro, deja el anterior «reemplazado». La autorización es la matriz (como en los informes).
   */
  @Post("calibraciones/:id/firmar")
  @RequierePermiso("metrologia.ver")
  async firmar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    try {
      return await this.firmarPaso(id, req);
    } catch (e: any) {
      // Dos firmas simultáneas del mismo paso: la segunda choca con UNIQUE (calibracion_id, orden).
      if (/unique|duplicate|23505/i.test(String(e?.message ?? e?.code ?? ""))) throw new ConflictException("El paso ya fue firmado por otra persona; recargue la lista");
      throw e;
    }
  }

  private async firmarPaso(id: string, req: any) {
    const t = tenantId(req);
    const cal = await this.detalleCtx(id, req);
    if (cal.estado === "emitida") return { data: { codigo: cal.codigo, numero: cal.numero_certificado, hash: cal.certificado_hash, yaEmitido: true } };
    const ultimo = (cal.acciones as AccionCal[]).includes("EMITIR");
    this.exigir(ultimo ? "EMITIR" : "FIRMAR", cal);
    const c = await this.circuito(t, cal);
    const yo = await firmanteDe(req.user.sub);
    const paso = c.actual;
    const via = paso?.responsables.find((r) => r.usuarioId === req.user.sub)?.via ?? "permiso";
    // Firma como responsable alternativo (metrólogo habilitado que emite): queda con su rol, no con el del jefe.
    const rolFirma = via === "alternativo" && paso?.alternativo ? paso.alternativo.rol : paso?.rol;
    const registrarFirma = async (tx: any) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO met_calibracion_firma (calibracion_id, orden, accion, rol_codigo, rol_nombre, unidad_codigo, usuario_id, nombre, grado, cargo, via)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8, $9, $10, $11)`,
        id, paso?.orden ?? 99, paso?.accion ?? "FIRMA", rolFirma?.codigo ?? "JEFE_LAB", rolFirma?.nombre ?? "Jefe de laboratorio",
        paso?.unidad?.codigo ?? cal.laboratorio ?? null, req.user.sub, yo.nombre, yo.grado, yo.cargo, via);
    };
    if (!ultimo) {
      await this.transicion(id, "FIRMAR", cal.estado, req, paso?.descripcion ?? null, `devuelto_motivo = NULL, enviado_by = COALESCE(enviado_by, $4::uuid)`, [], registrarFirma);
      return { data: { id, codigo: cal.codigo, estado: ESTADO_TRAS.FIRMAR } };
    }
    // Emisión: número, código de verificación y documento sellado, en una transacción.
    const ctxBase = await this.contextoCertificado(t, cal, c);
    const resultado = await prisma.$transaction(async (tx) => {
      await registrarFirma(tx);
      let numero = cal.codigo as string;
      if (cal.prefijo_certificado) {
        const r = await tx.$queryRawUnsafe<any[]>(
          `UPDATE met_numeracion SET ultimo = ultimo + 1, updated_at = now() WHERE tenant_id = $1::uuid AND prefijo = $2 RETURNING ultimo, relleno`,
          t, cal.prefijo_certificado);
        if (r.length) numero = numeroCertificado(cal.prefijo_certificado, Number(r[0].ultimo), Number(r[0].relleno));
      }
      const codigoVer = nuevoCodigoVerificacion();
      const emitidoAt = new Date();
      const firmaEmisor: FirmaCert = { accion: paso?.accion ?? "FIRMA", rol: paso?.rol.nombre ?? "Jefe", nombre: yo.nombre, grado: yo.grado, cargo: yo.cargo, fecha: emitidoAt, pendiente: false, via };
      const ctx: ContextoCertificado = { ...ctxBase, jefeDepto: c.jefes.length > 1 ? firmaEmisor : ctxBase.jefeDepto, jefeLab: c.jefes.length > 1 ? ctxBase.jefeLab : firmaEmisor };
      const html = certificadoHtml({ ...cal, numero_certificado: numero, emitido_at: emitidoAt }, ctx);
      const hash = createHash("sha256").update(html, "utf8").digest("hex");
      const n = await tx.$executeRawUnsafe(
        `UPDATE met_calibracion SET estado = 'emitida', updated_at = now(), emitido_at = $3, emitido_by = $4::uuid, numero_certificado = $5,
                codigo_verificacion = $6, documento_html = $7, certificado_hash = $8
          WHERE id = $1::uuid AND estado = ANY($2::text[])`,
        id, [cal.estado], emitidoAt, req.user.sub, numero, codigoVer, html, hash);
      if (!n) throw new ForbiddenException("La calibración cambió de estado mientras tanto; recargue la lista");
      await this.evento(tx, id, "EMITIDA", cal.estado, "emitida", req, numero);
      if (cal.reemplaza_id) {
        await tx.$executeRawUnsafe(`UPDATE met_calibracion SET estado = 'reemplazada', reemplazada_at = now(), updated_at = now() WHERE id = $1::uuid AND estado = 'emitida'`, cal.reemplaza_id);
        await this.evento(tx, cal.reemplaza_id, "REEMPLAZADA", "emitida", "reemplazada", req, `Reemplazado por el certificado N° ${numero}`);
      }
      return { numero, codigoVer, hash };
    });
    return { data: { codigo: cal.codigo, estado: "emitida", numero: resultado.numero, hash: resultado.hash, verificacion: resultado.codigoVer } };
  }

  /** Alias del paso final (compatibilidad con la pantalla anterior): firma el paso pendiente. */
  @Post("calibraciones/:id/emitir")
  @RequierePermiso("metrologia.ver")
  emitir(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.firmar(id, req);
  }

  /** Reemite un certificado emitido: crea un borrador nuevo que, al emitirse, lo reemplaza (C3). */
  @Post("calibraciones/:id/reemitir")
  @RequierePermiso("metrologia.emitir")
  async reemitir(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const { motivo } = MotivoSchema.parse(body ?? {});
    const t = tenantId(req);
    const cal = await this.detalleCtx(id, req);
    if (cal.estado === "emitida" && cal.reemision_en_curso) throw new ConflictException("Ya hay una reemisión en curso de este certificado");
    this.exigir("REEMITIR", cal);
    const fecha = fechaIso(cal.fecha_calibracion);
    for (let intento = 0; ; intento++) {
      const codigo = await this.siguienteCodigo(t, fecha);
      try {
        const nuevo = await prisma.$transaction(async (tx) => {
          // Se bloquea la fila de la calibración ORIGINAL: un SELECT … FOR UPDATE sobre las
          // reemisiones no bloquea nada si aún no hay ninguna, y dos peticiones simultáneas
          // crearían dos borradores que reemplazarían al mismo certificado (revisión r3, hallazgo 6).
          const original = await tx.$queryRawUnsafe<{ estado: string }[]>(
            `SELECT estado FROM met_calibracion WHERE id = $1::uuid FOR UPDATE`, id);
          if (original[0]?.estado !== "emitida") throw new ConflictException("Solo se reemite un certificado emitido");
          const curso = await tx.$queryRawUnsafe<any[]>(
            `SELECT 1 FROM met_calibracion WHERE reemplaza_id = $1::uuid AND deleted_at IS NULL AND estado <> 'reemplazada' FOR UPDATE`, id);
          if (curso.length) throw new ConflictException("Ya hay una reemisión en curso de este certificado");
          const r = await tx.$queryRawUnsafe<any[]>(
            `INSERT INTO met_calibracion
               (tenant_id, codigo, proceso_id, patron_id, unidad_id, fecha_calibracion, instrumento, patron_snap, ambiente, cond, u_max, u_cert, conforme,
                intervalo_meses, estado, created_by, motor, datos, opciones, resultado, resumen, patrones, reemplaza_id, motivo_reemision)
             SELECT tenant_id, $2, proceso_id, patron_id, unidad_id, fecha_calibracion, instrumento, patron_snap, ambiente, cond, u_max, u_cert, conforme,
                    intervalo_meses, 'borrador', $3::uuid, motor, datos, opciones, resultado, resumen, patrones, id, $4
               FROM met_calibracion WHERE id = $1::uuid RETURNING id`,
            id, codigo, req.user.sub, motivo);
          const nid = r[0].id as string;
          await tx.$executeRawUnsafe(
            `INSERT INTO met_calibracion_punto (calibracion_id, orden, nominal, correccion, u_patron, deriva, lecturas, media, repetibilidad, referencia, error, uc, u_exp, en_norm, dentro, componentes)
             SELECT $2::uuid, orden, nominal, correccion, u_patron, deriva, lecturas, media, repetibilidad, referencia, error, uc, u_exp, en_norm, dentro, componentes
               FROM met_calibracion_punto WHERE calibracion_id = $1::uuid`, id, nid);
          await this.evento(tx, nid, "REEMISION", null, "borrador", req, `Reemite el certificado N° ${cal.numero_certificado ?? cal.codigo}: ${motivo}`);
          await this.evento(tx, id, "REEMISION", "emitida", "emitida", req, `Reemisión en curso (${codigo}): ${motivo}`);
          return nid;
        });
        return { data: { id: nuevo, codigo, estado: "borrador", reemplaza: cal.numero_certificado ?? cal.codigo } };
      } catch (e: any) {
        if (intento < 4 && /unique|duplicate|23505/i.test(String(e?.message ?? e?.code ?? ""))) continue;
        throw e;
      }
    }
  }

  /** Cuerpo HTML del certificado (el sellado si está emitido): vista previa en pantalla. */
  @Get("calibraciones/:id/html")
  @RequierePermiso("metrologia.ver")
  async html(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const t = tenantId(req);
    const cal = await this.cargar(id, req);
    if ((cal.estado === "emitida" || cal.estado === "reemplazada") && cal.documento_html) return { data: { html: cal.documento_html, sellado: true } };
    const c = await this.circuito(t, cal);
    return { data: { html: certificadoHtml(cal, await this.contextoCertificado(t, cal, c)), sellado: false } };
  }

  /** PDF del certificado: el documento sellado si está emitido; si no, BORRADOR con las firmas pendientes. */
  @Get("calibraciones/:id/pdf")
  @RequierePermiso("metrologia.ver")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const t = tenantId(req);
    const cal = await this.cargar(id, req);
    const sellado = (cal.estado === "emitida" || cal.estado === "reemplazada") && cal.documento_html;
    let cuerpo: string;
    if (sellado) cuerpo = cal.documento_html;
    else {
      const c = await this.circuito(t, cal);
      cuerpo = certificadoHtml(cal, await this.contextoCertificado(t, cal, c));
    }
    const hash = sellado ? cal.certificado_hash : createHash("sha256").update(cuerpo, "utf8").digest("hex");
    const numero = cal.numero_certificado ?? `BORRADOR ${cal.codigo}`;
    const sello: Sello = {
      numero,
      codigoVerificacion: cal.codigo_verificacion ?? "SIN EMITIR",
      hash,
      fecha: new Date(cal.emitido_at ?? Date.now()).toLocaleDateString("es-CL", { timeZone: "America/Santiago" }),
      urlVerificacion: cal.codigo_verificacion ? `${URL_VERIFICACION()}/${cal.codigo_verificacion}` : URL_VERIFICACION(),
      borrador: !sellado,
      ...(cal.estado === "reemplazada" ? { estadoDocumento: "anulado", motivoEstado: `Reemplazado por el certificado N° ${cal.reemplazada_por ?? ""}` } : {}),
    };
    const html = documentoCompleto(cuerpo, sello, `Certificado de Calibración ${numero}`);
    const buf = await generarPdf(html, sello, `Certificado de Calibración ${numero}`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${numero.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`);
    res.end(buf);
  }

  // ---- helpers --------------------------------------------------------------
  /** Pasos de la matriz para la unidad de la calibración y las firmas ya hechas. */
  private async circuito(t: string, cal: any, cache?: Map<string, PasoFirmaCal[] | null>): Promise<Circuito> {
    let pasos: PasoFirmaCal[] | null = null;
    let errorMatriz: string | null = null;
    if (cal.unidad_id) {
      if (cache?.has(cal.unidad_id)) pasos = cache.get(cal.unidad_id)!;
      else {
        try {
          const r = await this.matriz.resolver(TIPO_DOC, cal.unidad_id, t);
          pasos = r.origen === "SIN_REGLAS" || !r.pasos.length ? null : (r.pasos as any[]).map((p) => ({
            orden: p.orden, accion: p.accion, obligatorio: p.obligatorio, descripcion: p.descripcion,
            rol: { codigo: p.rol.codigo, nombre: p.rol.nombre }, unidad: p.unidad ? { codigo: p.unidad.codigo } : null,
            responsables: (p.responsables ?? []).map((x: any) => ({ usuarioId: x.usuarioId, nombre: x.nombre, via: x.via })),
            alternativo: p.alternativo ? { rol: { codigo: p.alternativo.rol.codigo, nombre: p.alternativo.rol.nombre } } : null,
          }));
        } catch (e: any) {
          // Si la matriz no se puede resolver, nadie firma (no se cae al modo sin matriz) y no se envía.
          pasos = [];
          errorMatriz = String(e?.message ?? e).slice(0, 200);
        }
        cache?.set(cal.unidad_id, pasos);
      }
    }
    const firmas = cal.__firmas ?? await prisma.$queryRawUnsafe<any[]>(
      `SELECT orden, accion, rol_codigo, rol_nombre, unidad_codigo, usuario_id, nombre, grado, cargo, via, firmado_at
         FROM met_calibracion_firma WHERE calibracion_id = $1::uuid ORDER BY orden`, cal.id);
    const hechas: FirmaHecha[] = firmas.map((f: any) => ({ orden: f.orden, usuarioId: f.usuario_id, accion: f.accion }));
    const p = pasos ? pasoPendiente(pasos, hechas) : { elabora: null, jefes: [], actual: null, ultimo: true };
    if (pasos && !pasos.length && !errorMatriz) errorMatriz = "la matriz no devolvió pasos";
    return { pasos, firmas, actual: p.actual, ultimo: p.ultimo, jefes: p.jefes, elabora: p.elabora, errorMatriz };
  }

  /** Contexto de reglas de varias calibraciones (matriz por unidad en caché, firmas y registro en una consulta). */
  private async contextos(req: any, cals: any[]) {
    const t = tenantId(req), yo = req.user?.sub;
    const cache = new Map<string, PasoFirmaCal[] | null>();
    // El registro de firmas: para enviar (borrador) y para emitir como metrólogo (en circuito).
    const registro = cals.some((c) => ["borrador", "en_revision", "en_firma"].includes(estadoDe(c.estado))) ? await registroFirmas(t) : [];
    const ids = cals.map((c) => c.id);
    const firmas = ids.length ? await prisma.$queryRawUnsafe<any[]>(
      `SELECT calibracion_id, orden, accion, rol_codigo, rol_nombre, unidad_codigo, usuario_id, nombre, grado, cargo, via, firmado_at
         FROM met_calibracion_firma WHERE calibracion_id = ANY($1::uuid[]) ORDER BY orden`, ids) : [];
    const out = [];
    for (const cal of cals) {
      const e = estadoDe(cal.estado);
      const propias = firmas.filter((f) => f.calibracion_id === cal.id).map(({ calibracion_id, ...f }) => f);
      const c = await this.circuito(t, { ...cal, __firmas: propias }, cache);
      const enCircuito = e === "en_revision" || e === "en_firma";
      const hechas: FirmaHecha[] = propias.map((f: any) => ({ orden: f.orden, usuarioId: f.usuario_id, accion: f.accion }));
      // ¿El usuario es responsable del paso pendiente solo como alternativo (metrólogo que emite)?
      const mias = c.actual?.responsables.filter((r) => r.usuarioId === yo) ?? [];
      const esAlternativo = mias.length > 0 && mias.every((r) => r.via === "alternativo");
      const habAlt = esAlternativo ? motivoNoEmiteMetrologo(registro, yo, cal.laboratorio ?? null, cal.magnitud) : null;
      const ctx: ContextoCal = {
        estado: cal.estado,
        esAutor: !!cal.created_by && cal.created_by === yo,
        puedeCrear: tiene(req, "metrologia.crear"),
        puedeEmitir: tiene(req, "metrologia.emitir"),
        calculada: !!cal.calculada,
        responsablePaso: !enCircuito ? false : c.pasos ? puedeFirmarPaso(c.actual, yo, hechas, habAlt) : tiene(req, "metrologia.emitir"),
        motivoPaso: enCircuito && esAlternativo && habAlt ? habAlt : null,
        ultimoPaso: c.pasos ? c.ultimo : true,
        habilitacion: e === "borrador" && yo ? motivoHabilitacion(registro, yo, cal.laboratorio ?? null, cal.magnitud) : null,
        reemisionEnCurso: !!cal.reemision_en_curso,
      };
      out.push({
        ctx, firmas: propias,
        sinResponsable: c.pasos && e !== "emitida" ? pasosSinResponsable(c.pasos) : [],
        pendiente: enCircuito && c.actual ? { orden: c.actual.orden, descripcion: c.actual.descripcion ?? c.actual.rol.nombre, rol: c.actual.rol.nombre, responsables: c.actual.responsables.map((r) => r.nombre), emite: c.ultimo } : null,
      });
    }
    return out;
  }

  /** Firmas por papel para imprimir en el certificado (hechas o pendientes con sus responsables). */
  private async contextoCertificado(t: string, cal: any, c: Circuito): Promise<ContextoCertificado> {
    const dep = await nombreDepartamento(this.alcance, t, cal.unidad_id ?? null);
    // Firma de un paso por (orden, acción): la del metrólogo nunca se toma por la de un jefe.
    const hecha = (orden: number | undefined, accion?: string): FirmaCert | null => {
      const f = c.firmas.find((x: any) => (orden == null || x.orden === orden) && (accion == null || x.accion === accion));
      return f ? { accion: f.accion, rol: f.rol_nombre ?? "", nombre: f.nombre, grado: f.grado, cargo: f.cargo, fecha: f.firmado_at, pendiente: false, via: f.via } : null;
    };
    const pendiente = (p: PasoFirmaCal | undefined): FirmaCert | null =>
      p ? { accion: p.accion, rol: p.rol.nombre, nombre: p.responsables.map((r) => r.nombre).join(" / ") || "Sin responsable", pendiente: true } : null;
    const jl = c.jefes[0], jd = c.jefes.length > 1 ? c.jefes[c.jefes.length - 1] : undefined;
    return {
      departamento: dep.nombre,
      metrologo: hecha(undefined, "ELABORA") ?? { accion: "ELABORA", rol: "Metrólogo", nombre: cal.autor_nombre ?? "", pendiente: true, cargo: "Metrólogo" },
      jefeLab: (jl && hecha(jl.orden, jl.accion)) ?? pendiente(jl) ?? (cal.emisor_nombre ? { accion: "FIRMA", rol: "Jefe", nombre: cal.emisor_nombre, fecha: cal.emitido_at, pendiente: false } : null),
      jefeDepto: (jd && hecha(jd.orden, jd.accion)) ?? pendiente(jd),
      reemplazaNumero: cal.reemplaza_numero ?? null,
    };
  }

  private exigir(accion: AccionCal, cal: any) {
    if (!(cal.acciones as AccionCal[]).includes(accion)) {
      const motivo = cal.__ctx ? motivoRechazo(accion, cal.__ctx) : null;
      throw new ForbiddenException(motivo ?? this.motivoDesde(accion, cal));
    }
  }
  /** Mensaje cuando la acción no figura entre las disponibles (se recalcula sin contexto completo). */
  private motivoDesde(accion: AccionCal, cal: any): string {
    const e = estadoDe(cal.estado);
    if (accion === "ENVIAR" && e === "borrador" && cal.es_mio && cal.calculada)
      return "No figura en el registro de firmas autorizadas del laboratorio para esta magnitud (LMT-PG01 Anexo 11): no puede firmarla como metrólogo.";
    if ((accion === "FIRMAR" || accion === "EMITIR" || accion === "DEVOLVER") && (e === "en_revision" || e === "en_firma"))
      return cal.paso_pendiente
        ? `No le corresponde firmar: el paso pendiente es «${cal.paso_pendiente.descripcion}» (${cal.paso_pendiente.responsables.join(" / ") || "sin responsable"})`
        : "No le corresponde firmar el paso pendiente según la matriz de firmas";
    return motivoRechazo(accion, { estado: cal.estado, esAutor: !!cal.es_mio, puedeCrear: false, puedeEmitir: false, calculada: !!cal.calculada }) ?? "Acción no permitida";
  }

  /**
   * Cambia el estado solo si sigue siendo el leído (evita dobles clics y carreras), ejecuta
   * `extra` en la misma transacción y deja el evento. En `set`: $4 = usuario actual, $5… = `extras`.
   */
  private async transicion(id: string, accion: Exclude<AccionCal, "REEMITIR" | "EDITAR">, desde: string, req: any, comentario: string | null, set: string, extras: unknown[], extra?: (tx: any) => Promise<void>) {
    const hasta = ESTADO_TRAS[accion];
    const desdeDb = desde === "borrador" ? ["borrador", "calculada"] : [desde];
    await prisma.$transaction(async (tx) => {
      const n = await tx.$executeRawUnsafe(
        `UPDATE met_calibracion SET estado = $2, updated_at = now()${set ? ", " + set : ""}
          WHERE id = $1::uuid AND estado = ANY($3::text[])`,
        id, hasta, desdeDb, req.user?.sub ?? null, ...extras);
      if (!n) throw new ForbiddenException("La calibración cambió de estado mientras tanto; recargue la lista");
      if (extra) await extra(tx);
      const acc = { ENVIAR: "ENVIADA", DEVOLVER: "DEVUELTA", FIRMAR: "FIRMADA", EMITIR: "EMITIDA" }[accion];
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

  /** Patrones del maestro usados en la calibración: bloqueo si vencidos a la fecha, aviso si vencen pronto. */
  private async patronesDe(t: string, d: CrearDto, fecha: string) {
    const ids = d.patronIds.length ? d.patronIds : d.patronId ? [d.patronId] : [];
    if (!ids.length) return { patronId: null, snapshot: [], avisos: [] as string[] };
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, nombre, rango, marca, modelo, serie, clase, n_certificado, vence, emisor, trazabilidad, activo
         FROM met_patron WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND id = ANY($2::uuid[])`, t, ids);
    const r = revisarPatrones(rows.map((x) => ({ ...x, vence: x.vence ? fechaIso(x.vence) : null })), ids, fecha);
    if (r.errores.length) throw new BadRequestException(r.errores.join(" "));
    const snapshot = ids.map((id) => rows.find((x) => x.id === id)).map((x) => ({
      id: x.id, codigo: x.codigo, nombre: x.rango ? `${x.nombre} (${x.rango})` : x.nombre, marca: x.marca, modelo: x.modelo, serie: x.serie, clase: x.clase,
      n_certificado: x.n_certificado, vence: x.vence ? fechaIso(x.vence) : null, emisor: x.emisor, trazabilidad: x.trazabilidad,
    }));
    return { patronId: ids[0], snapshot, avisos: r.avisos };
  }

  /** Calcula en el servidor según el tipo de proceso y deja todo listo para persistir. */
  private async calcularDto(proc: any, d: CrearDto, fecha: string) {
    const motor = motorDeProceso(proc.codigo);
    if (motor) {
      if (!d.motor) throw new BadRequestException(`${proc.codigo} se calcula con su motor: envíe los datos del motor`);
      const { datos, opciones } = d.motor;
      const mot = motivoOpciones(motor, opciones);
      if (mot) throw new BadRequestException(mot);
      const filas = await cargarCmc(proc.codigo);
      const { resultado, resumen: base } = ejecutarMotor(proc.codigo, inyectarCmc(motor.it, datos, filas, fecha), opciones);
      const resumen = aplicarCmc(base, filas, {
        proceso: proc.codigo, motor: motor.it, fecha, unidad: motor.unidad, unidadU: motor.unidadU, resolucion: numero(datos.res), acreditado: !!proc.acreditacion,
      });
      return {
        motor: motor.it, cond: {}, datos: JSON.stringify(soloEntradas(datos, motor.it)), opciones: JSON.stringify(opciones),
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
      uMax: calc.uMax, uCert: null, conforme: null, puntosGum: calc.puntos,
      puntos: calc.puntos.map((p) => ({
        nominal: p.nominal, correccion: p.correccion, u_patron: p.uPatron, deriva: p.deriva, lecturas: p.lecturas, media: p.media,
        repetibilidad: p.repetibilidad, referencia: p.referencia, error: p.error, uc: p.uc, u_exp: p.uExp, en_norm: p.en, dentro: null,
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

  /** Siguiente código interno del año de la fecha de calibración (CAL-AAAA-NNNN). */
  private async siguienteCodigo(t: string, fecha: string): Promise<string> {
    const prefijo = codigoCalibracion(fecha, 0).replace(/0+$/, "");
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(codigo,'^.*-',''),'')::int),0)+1 AS n
         FROM met_calibracion WHERE tenant_id = $1::uuid AND codigo LIKE $2`, t, prefijo + "%");
    return codigoCalibracion(fecha, Number(rows[0]?.n ?? 1));
  }
}

const numero = (x: any): number | null => {
  const n = typeof x === "number" ? x : parseFloat(String(x ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const PatronSchema = z.object({
  nombre: z.string().trim().min(2).max(160).optional(),
  tipo: z.enum(["patron", "auxiliar"]).optional(),
  marca: z.string().max(80).nullish(), modelo: z.string().max(80).nullish(), serie: z.string().max(80).nullish(),
  rango: z.string().max(80).nullish(), clase: z.string().max(40).nullish(), emisor: z.string().max(120).nullish(),
  n_certificado: z.string().max(60).nullish(), trazabilidad: z.string().max(120).nullish(), observacion: z.string().max(500).nullish(),
  ultima_calibracion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  vence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  intervalo_meses: z.coerce.number().int().min(1).max(240).nullish(),
  u_expandida: z.coerce.number().nullish(), deriva: z.coerce.number().nullish(),
  laboratorio: z.string().max(10).nullish(),
  activo: z.boolean().optional(),
});

/**
 * Verificación pública del certificado de calibración (C7). Controlador aparte y
 * `@Public()`: quien recibe el certificado en papel no tiene usuario en el LIMS. Solo
 * devuelve lo que ya está impreso (número, fecha, proceso, estado y hash): sin cliente
 * ni resultados. El limitador global de peticiones sigue aplicando.
 */
@ApiTags("metrología")
@Controller("metrologia")
export class VerificacionMetrologiaController {
  @Get("verificar/:codigo")
  @Public()
  async verificar(@Param("codigo") codigo: string) {
    const c = String(codigo ?? "").trim().toUpperCase();
    if (!codigoVerificacionValido(c)) return { valido: false, motivo: "Código con formato no válido" };
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT c.numero_certificado, c.estado, c.emitido_at, c.documento_html, c.certificado_hash, pr.nombre AS proceso,
              (SELECT x.numero_certificado FROM met_calibracion x WHERE x.reemplaza_id = c.id AND x.estado = 'emitida' AND x.deleted_at IS NULL LIMIT 1) AS reemplazado_por
         FROM met_calibracion c JOIN met_proceso pr ON pr.id = c.proceso_id
        WHERE c.codigo_verificacion = $1 AND c.deleted_at IS NULL LIMIT 1`, c);
    if (!rows.length) return { valido: false, motivo: "No existe un certificado de calibración con ese código" };
    const r = rows[0];
    const integro = !!r.documento_html && createHash("sha256").update(r.documento_html, "utf8").digest("hex") === r.certificado_hash;
    const base = {
      numero: r.numero_certificado, proceso: r.proceso, estado: r.estado, hash: r.certificado_hash,
      fecha: r.emitido_at ? new Date(r.emitido_at).toLocaleDateString("es-CL", { timeZone: "America/Santiago" }) : null,
    };
    if (r.estado === "reemplazada") return { ...base, valido: false, motivo: `El certificado fue reemplazado por el N° ${r.reemplazado_por ?? "(en emisión)"}` };
    if (r.estado !== "emitida") return { ...base, valido: false, motivo: "El certificado no está emitido" };
    return { ...base, valido: integro, ...(integro ? {} : { motivo: "El sello de integridad del documento no coincide" }) };
  }
}

@Module({ imports: [RbacModule], controllers: [MetrologiaController, VerificacionMetrologiaController] })
export class MetrologiaModule {}
