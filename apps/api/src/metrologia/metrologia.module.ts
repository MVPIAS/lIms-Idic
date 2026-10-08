import {
  BadRequestException, Body, Controller, Get, Module, NotFoundException,
  Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { documentoCompleto, type Sello } from "../plantilla-render/plantilla-defecto";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import { calcularCalibracion, type Componente, type Divisores, type Punto } from "./metrologia.calc";
import { MOTORES, calcularConMotor, motorDeProceso, type ResumenMotor } from "./motores";
import { CASOS_REFERENCIA, esClaveExcel, verificarParidad } from "./motores/paridad";

// ---------------------------------------------------------------------------
// Módulo Metrología (LMT). Las instrucciones de trabajo con caso real usan su
// motor validado (./motores, idéntico al Excel del LMT); las que aún no tienen
// caso real (ITM03, ITV05) usan el motor GUM parametrizado (metrologia.calc).
// Todo por SQL crudo (las tablas met_* no están en Prisma).
// ---------------------------------------------------------------------------
const prisma = new PrismaClient();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

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
  instrumento: z.record(z.any()).default({}),
  patronSnap: z.record(z.any()).default({}),
  ambiente: z.record(z.any()).default({}),
  cond: z.record(z.coerce.number()).default({}),
  intervaloMeses: z.coerce.number().default(12),
  puntos: z.array(PuntoSchema).default([]),
  /** Datos de entrada del motor validado de la IT y correcciones aplicadas (hallazgos). */
  motor: z.object({ datos: z.record(z.any()), opciones: z.record(z.boolean()).default({}) }).optional(),
});
const CalcularSchema = z.object({ datos: z.record(z.any()), opciones: z.record(z.boolean()).default({}) });

/** Código de acreditación del LMT por magnitud. */
const ACREDITACION: Record<string, string> = {
  masa: "LC 001", longitud: "LC 004", fuerza: "LC 005", presion: "LC 022", volumen: "LC 023", par: "LC 108", temperatura: "LC 155",
};

/** Quita los valores del Excel (x_, y_, z_, w_, x, xT) y deja solo las entradas. */
function soloEntradas(v: any): any {
  if (Array.isArray(v)) return v.map(soloEntradas);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !esClaveExcel(k)).map(([k, x]) => [k, soloEntradas(x)]));
  return v;
}

/** Calcula con el motor y rechaza datos incompletos (el motor devolvería NaN). */
function ejecutarMotor(it: string, datos: Record<string, any>, opciones: Record<string, boolean>) {
  let out: ReturnType<typeof calcularConMotor>;
  try {
    out = calcularConMotor(it, datos, opciones);
  } catch {
    throw new BadRequestException(`Datos incompletos para ${it}: faltan entradas o alguna no es válida`);
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

async function cargarDivisores(): Promise<Divisores> {
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT codigo, divisor FROM met_distribucion`);
  return Object.fromEntries(rows.map((r) => [r.codigo, Number(r.divisor)]));
}
async function cargarProceso(codigo: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT p.id, p.codigo, p.nombre, p.metodo, p.norma, m.codigo AS mag, m.nombre AS mag_nombre, m.unidad, m.decimales
       FROM met_proceso p JOIN met_magnitud m ON m.id = p.magnitud_id WHERE p.codigo = $1`, codigo);
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
@Controller("metrologia")
export class MetrologiaController {
  /** Los 12 procesos con su magnitud y componentes. */
  @Get("procesos")
  @RequierePermiso("metrologia.ver")
  async procesos() {
    const procs = await prisma.$queryRawUnsafe<any[]>(
      `SELECT p.codigo, p.nombre, p.metodo, p.norma, m.codigo AS magnitud, m.unidad, m.decimales
         FROM met_proceso p JOIN met_magnitud m ON m.id = p.magnitud_id WHERE p.activo ORDER BY m.codigo, p.codigo`);
    const comps = await prisma.$queryRawUnsafe<any[]>(
      `SELECT m.codigo AS magnitud, c.simbolo, c.nombre, c.distribucion, c.fuente, c.orden
         FROM met_componente c JOIN met_magnitud m ON m.id = c.magnitud_id ORDER BY m.codigo, c.orden`);
    const byMag: Record<string, any[]> = {};
    comps.forEach((c) => { (byMag[c.magnitud] ??= []).push(c); });
    return { data: procs.map((p) => ({ ...p, componentes: byMag[p.magnitud] ?? [] })) };
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

  /** Motores validados: IT, unidades, correcciones propuestas y casos de referencia. */
  @Get("motores")
  @RequierePermiso("metrologia.ver")
  motores() {
    return {
      data: Object.values(MOTORES).map(({ calcular, resumen, ...m }) => ({
        ...m, casos: CASOS_REFERENCIA.filter((c) => c.it === m.it).map((c) => ({ caso: c.caso, instrumento: c.instrumento })),
      })),
    };
  }

  /** Evidencia de validación: recalcula los 16 casos reales y los compara con los Excel. */
  @Get("motores/paridad")
  @RequierePermiso("metrologia.ver")
  paridad() {
    return verificarParidad();
  }

  /** Datos de entrada de un caso de referencia (sin los valores del Excel). */
  @Get("motores/:it/ejemplo")
  @RequierePermiso("metrologia.ver")
  ejemplo(@Param("it") it: string, @Query("caso") caso?: string) {
    const m = motorDeProceso(it);
    if (!m) throw new NotFoundException(`No hay motor validado para ${it}`);
    const c = CASOS_REFERENCIA.find((x) => x.it === m.it && (!caso || x.caso === caso));
    if (!c) throw new NotFoundException(`Caso ${caso} no encontrado para ${m.it}`);
    return { data: { caso: c.caso, instrumento: c.instrumento, datos: soloEntradas(c.datos) } };
  }

  /** Vista previa: calcula sin guardar (el mismo motor que usa el guardado). */
  @Post("motores/:it/calcular")
  @RequierePermiso("metrologia.ver")
  calcular(@Param("it") it: string, @Body() body: unknown) {
    if (!motorDeProceso(it)) throw new NotFoundException(`No hay motor validado para ${it}`);
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
  async listar(@Query("limit") limit?: string, @Req() req?: any) {
    const t = tenantId(req);
    const l = Math.min(200, Math.max(1, parseInt(limit ?? "50") || 50));
    const data = await prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id, c.codigo, c.estado, c.u_max, c.u_cert, c.motor, c.conforme, c.created_at, c.emitido_at,
              pr.codigo AS proceso, pr.nombre AS proceso_nombre, m.unidad,
              c.instrumento->>'item' AS instrumento, c.instrumento->>'cliente' AS cliente
         FROM met_calibracion c
         JOIN met_proceso pr ON pr.id = c.proceso_id
         JOIN met_magnitud m ON m.id = pr.magnitud_id
        WHERE c.tenant_id = $1::uuid AND c.deleted_at IS NULL
        ORDER BY c.created_at DESC LIMIT $2`, t, l);
    // En fuerza y par la incertidumbre es relativa (%), no en la unidad de la magnitud.
    return { data: data.map((c) => ({ ...c, unidad_u: (c.motor && MOTORES[c.motor]?.unidadU) || c.unidad })) };
  }

  @Get("calibraciones/:id")
  @RequierePermiso("metrologia.ver")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const t = tenantId(req);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*, pr.codigo AS proceso, pr.nombre AS proceso_nombre, pr.metodo, pr.norma,
              m.codigo AS magnitud, m.unidad, m.decimales
         FROM met_calibracion c JOIN met_proceso pr ON pr.id = c.proceso_id JOIN met_magnitud m ON m.id = pr.magnitud_id
        WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid AND c.deleted_at IS NULL LIMIT 1`, id, t);
    if (!rows.length) throw new NotFoundException("Calibración no encontrada");
    const puntos = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM met_calibracion_punto WHERE calibracion_id = $1::uuid ORDER BY orden`, id);
    return { ...rows[0], puntos };
  }

  /** Crea y CALCULA una calibración (motor GUM en el servidor). */
  @Post("calibraciones")
  @RequierePermiso("metrologia.crear")
  async crear(@Body() body: unknown, @Req() req: any) {
    const t = tenantId(req);
    const d = CrearSchema.parse(body);
    const proc = await cargarProceso(d.procesoCodigo);
    const motor = motorDeProceso(proc.codigo);
    if (motor) {
      if (!d.motor) throw new BadRequestException(`${proc.codigo} se calcula con su motor validado: envíe los datos del motor`);
      return this.crearConMotor(t, proc, motor.it, d, req);
    }
    if (!d.puntos.length) throw new BadRequestException("Debe registrar al menos un punto de calibración");
    const divs = await cargarDivisores();
    const puntos: Punto[] = d.puntos.map((p) => ({
      nominal: p.nominal, correccion: p.correccion, uPatron: p.uPatron, deriva: p.deriva, lecturas: p.lecturas,
    }));
    const calc = calcularCalibracion(proc.componentes, divs, d.cond, puntos);

    const codigo = await this.siguienteCodigo(t);
    const cal = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO met_calibracion
         (tenant_id, codigo, proceso_id, patron_id, instrumento, patron_snap, ambiente, cond,
          u_max, conforme, intervalo_meses, estado, created_by)
       VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,'calculada',$12::uuid)
       RETURNING id, codigo`,
      t, codigo, proc.id, d.patronId ?? null, JSON.stringify(d.instrumento), JSON.stringify(d.patronSnap),
      JSON.stringify(d.ambiente), JSON.stringify(d.cond), calc.uMax, calc.conforme, d.intervaloMeses,
      req?.user?.sub ?? null);
    const calId = cal[0].id;
    let orden = 0;
    for (const p of calc.puntos) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO met_calibracion_punto
           (calibracion_id, orden, nominal, correccion, u_patron, deriva, lecturas, media, repetibilidad,
            referencia, error, uc, u_exp, en_norm, dentro, componentes)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
        calId, orden++, p.nominal, p.correccion, p.uPatron, p.deriva, JSON.stringify(p.lecturas),
        p.media, p.repetibilidad, p.referencia, p.error, p.uc, p.uExp, p.en, p.dentro, JSON.stringify(p.componentes));
    }
    return { data: { id: calId, codigo, uMax: calc.uMax, enMax: calc.enMax, conforme: calc.conforme, puntos: calc.puntos } };
  }

  /** Emite el Certificado de Calibración: sella con SHA-256 y correlativo. */
  @Post("calibraciones/:id/emitir")
  @RequierePermiso("metrologia.emitir")
  async emitir(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const cal = await this.detalle(id, req);
    if (cal.estado === "emitida") return { data: { codigo: cal.codigo, hash: cal.certificado_hash, yaEmitido: true } };
    const contenido = JSON.stringify({ codigo: cal.codigo, proceso: cal.proceso, instrumento: cal.instrumento, puntos: cal.puntos, uMax: cal.u_max });
    const hash = createHash("sha256").update(contenido, "utf8").digest("hex");
    await prisma.$executeRawUnsafe(
      `UPDATE met_calibracion SET estado = 'emitida', certificado_hash = $2, emitido_at = now() WHERE id = $1::uuid`, id, hash);
    return { data: { codigo: cal.codigo, hash, verificacion: hash.slice(0, 10).toUpperCase() } };
  }

  /** PDF sellado del certificado (reutiliza el render de plantillas del sistema). */
  @Get("calibraciones/:id/pdf")
  @RequierePermiso("metrologia.ver")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const cal = await this.detalle(id, req);
    const cuerpo = this.certificadoHtml(cal);
    const hash = cal.certificado_hash ?? createHash("sha256").update(cuerpo, "utf8").digest("hex");
    const sello: Sello = {
      numero: cal.codigo.replace("CAL", "CERT-CAL"),
      codigoVerificacion: hash.slice(0, 10).toUpperCase(),
      hash,
      fecha: new Date().toLocaleDateString("es-CL"),
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
  /** Guarda una calibración calculada con el motor validado de su IT. */
  private async crearConMotor(t: string, proc: any, it: string, d: z.infer<typeof CrearSchema>, req: any) {
    const { datos, opciones } = d.motor!;
    const { resultado, resumen } = ejecutarMotor(it, datos, opciones);
    const codigo = await this.siguienteCodigo(t);
    const cal = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO met_calibracion
         (tenant_id, codigo, proceso_id, patron_id, instrumento, patron_snap, ambiente, cond,
          u_max, u_cert, conforme, intervalo_meses, estado, created_by, motor, datos, opciones, resultado, resumen)
       VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5::jsonb,$6::jsonb,$7::jsonb,'{}'::jsonb,$8,$9,$10,$11,'calculada',$12::uuid,
               $13,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb)
       RETURNING id, codigo`,
      t, codigo, proc.id, d.patronId ?? null, JSON.stringify(d.instrumento), JSON.stringify(d.patronSnap), JSON.stringify(d.ambiente),
      resumen.uMax, resumen.uCert, resumen.conforme, d.intervaloMeses, req?.user?.sub ?? null,
      it, JSON.stringify(datos), JSON.stringify(opciones), JSON.stringify(resultado), JSON.stringify(resumen));
    const calId = cal[0].id;
    let orden = 0;
    for (const p of resumen.puntos) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO met_calibracion_punto (calibracion_id, orden, nominal, error, uc, u_exp, dentro)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7)`,
        calId, orden++, p.nominal, p.error, p.uc, p.U, p.conforme);
    }
    return { data: { id: calId, codigo, motor: it, resumen } };
  }

  private async siguienteCodigo(t: string): Promise<string> {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(codigo,'^.*-',''),'')::int),0)+1 AS n
         FROM met_calibracion WHERE tenant_id = $1::uuid AND codigo LIKE 'CAL-2026-%'`, t);
    return `CAL-2026-${String(Number(rows[0]?.n ?? 1)).padStart(4, "0")}`;
  }

  private certificadoHtml(cal: any): string {
    if (cal.motor && cal.resumen) return certificadoMotor(cal);
    const u = cal.unidad, dec = cal.decimales ?? 3;
    const f = (x: any, d = dec) => (x == null || isNaN(Number(x))) ? "—" : Number(x).toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d });
    const ins = cal.instrumento ?? {}, pat = cal.patron_snap ?? {}, amb = cal.ambiente ?? {};
    const filas = (cal.puntos ?? []).map((p: any) =>
      `<tr><td style="text-align:right">${f(p.nominal, dec > 3 ? 2 : 1)}</td><td style="text-align:right">${f(p.referencia)}</td>
       <td style="text-align:right">${f(p.media)}</td><td style="text-align:right">${f(p.error)}</td>
       <td style="text-align:right">± ${f(p.u_exp ?? p.uExp)}</td><td>${p.dentro ? "Cumple" : "No cumple"}</td></tr>`).join("");
    return `
      <h2>CERTIFICADO DE CALIBRACIÓN ${cal.codigo}</h2>
      <p><b>Laboratorio de Metrología · IDIC · Acreditación ${ACREDITACION[cal.magnitud] ?? "—"}</b><br>Método ${cal.proceso} — ${cal.metodo ?? ""} · Norma ${cal.norma ?? ""}</p>
      <h3>Instrumento</h3><p>${ins.item ?? "—"} · ${ins.marca ?? ""} · N° serie ${ins.serie ?? "—"} · Cap. ${ins.cap ?? "—"} ${u} · Res. ${ins.res ?? "—"} ${u}<br>Cliente: ${ins.cliente ?? "—"}</p>
      <h3>Condiciones</h3><p>Temperatura (${amb.temp ?? "—"} ± ${amb.tempU ?? "—"}) °C · Humedad (${amb.hum ?? "—"} ± ${amb.humU ?? "—"}) %HR</p>
      <h3>Patrón</h3><p>${pat.nombre ?? "—"} · Clase ${pat.clase ?? "—"} · Cert. ${pat.cert ?? "—"} · Trazabilidad ${pat.trazab ?? "SI"}</p>
      <h3>Resultados de la calibración</h3>
      <table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:11px">
        <thead><tr><th>Nominal ${u}</th><th>Ind. patrón</th><th>Ind. instrumento</th><th>Error</th><th>U (k=2)</th><th>Estado</th></tr></thead>
        <tbody>${filas}</tbody></table>
      <p style="margin-top:10px"><b>Síntesis:</b> la mayor incertidumbre expandida es ± ${f(cal.u_max)} ${u} para un nivel de confianza del 95 % (k = 2).</p>`;
  }
}

/** Certificado de una calibración calculada con motor validado. */
function certificadoMotor(cal: any): string {
  const m = MOTORES[cal.motor], r: ResumenMotor = cal.resumen;
  const f = (x: any, d = 4) => (x == null || isNaN(Number(x))) ? "—" : Number(x).toLocaleString("es-CL", { maximumFractionDigits: d });
  const ins = cal.instrumento ?? {}, pat = cal.patron_snap ?? {}, amb = cal.ambiente ?? {};
  const corr = Object.entries(cal.opciones ?? {}).filter(([, v]) => v).map(([k]) => m.opciones.find((o) => o.clave === k)?.hallazgo ?? k);
  const filas = r.puntos.map((p) =>
    `<tr><td style="text-align:right">${f(p.nominal)}</td><td style="text-align:right">${f(p.error, 6)}</td>
     <td style="text-align:right">± ${f(p.Ucert ?? p.U, 6)}</td><td>${p.conforme == null ? "—" : p.conforme ? "Cumple" : "No cumple"}</td></tr>`).join("");
  return `
    <h2>CERTIFICADO DE CALIBRACIÓN ${cal.codigo}</h2>
    <p><b>Laboratorio de Metrología · IDIC · Acreditación ${ACREDITACION[cal.magnitud] ?? "—"}</b><br>Método ${cal.proceso} — ${cal.metodo ?? ""}${cal.norma ? " · " + cal.norma : ""}</p>
    <h3>Instrumento</h3><p>${ins.item ?? "—"} · ${ins.marca ?? ""} · N° serie ${ins.serie ?? "—"}<br>Cliente: ${ins.cliente ?? "—"}</p>
    <h3>Condiciones</h3><p>Temperatura (${amb.temp ?? "—"} ± ${amb.tempU ?? "—"}) °C · Humedad (${amb.hum ?? "—"} ± ${amb.humU ?? "—"}) %HR</p>
    <h3>Patrón</h3><p>${pat.nombre ?? "—"} · Clase ${pat.clase ?? "—"} · Cert. ${pat.cert ?? "—"} · Trazabilidad ${pat.trazab ?? "SI"}</p>
    <h3>Resultados de la calibración</h3>
    <table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:11px">
      <thead><tr><th>Nominal ${m.unidad}</th><th>Error ${m.unidadU === "%" ? "%" : m.unidad}</th><th>U (k=2) ${m.unidadU}</th><th>Estado</th></tr></thead>
      <tbody>${filas}</tbody></table>
    <p style="margin-top:10px"><b>Síntesis:</b> la mayor incertidumbre expandida informada es ± ${f(r.uCert ?? r.uMax, 6)} ${m.unidadU} para un nivel de confianza del 95 % (k = 2).</p>
    <p style="font-size:10px;color:#555">Cálculo según ${m.it} con el motor validado contra el libro de trabajo del laboratorio${corr.length ? ` · correcciones aplicadas: ${corr.join(", ")}` : ""}.</p>`;
}

@Module({ controllers: [MetrologiaController] })
export class MetrologiaModule {}
