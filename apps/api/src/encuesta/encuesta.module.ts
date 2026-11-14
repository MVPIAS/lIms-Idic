import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { numeroChile } from "../common/numero-chile";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { paginacion } from "../ot/lista-ot";
import { EncuestaInformeController, EncuestaInformeService, leerTiposEncuesta } from "./encuesta-informe.controller";
import {
  ETIQUETA_ESTADO,
  MEDIOS,
  erroresPregunta,
  motivoNoRegistrable,
  reportePorLaboratorio,
  validarRespuestas,
  type Pregunta,
} from "./encuesta.reglas";

/**
 * Encuestas de satisfacción (EP-00 9.1, decisión del 20-10-2026): toda OT que
 * se cierra genera una encuesta pendiente (trigger SQL); Comercial la registra
 * a mano. Pantalla /encuestas: pendientes, registradas, reporte y preguntas.
 *
 * Alcance: la encuesta es del laboratorio de la OT. Quien tiene el
 * Departamento Comercial en su alcance (o es global) las ve todas; una jefatura
 * técnica, las de sus laboratorios.
 */
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const codigoTipo = z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{1,20}$/, "Formulario de encuesta no válido.");
const RegistrarSchema = z.object({
  tipo: codigoTipo.optional(),
  respuestas: z.array(z.object({ codigo: z.string().max(20), valor: z.number().int().nullable().optional() })).max(30),
  comentario: z.string().trim().max(4000).nullable().optional(),
  // EP-00 9.1 pide el CARGO de quien responde; el nombre es un dato personal y queda
  // opcional (recorrido MP-02, D02-14).
  nombreRespondente: z.string().trim().max(200).optional().nullable().transform((v) => (v ? v : null)),
  cargoRespondente: z.string().trim().min(2, "Indique el cargo de quien respondió.").max(200),
  medio: z.enum(MEDIOS),
  fechaRespuesta: fecha,
});
const SinRespuestaSchema = z.object({ motivo: z.string().trim().min(5, "Indique el motivo (al menos 5 caracteres).").max(1000) });
const PreguntasSchema = z.object({
  preguntas: z
    .array(
      z.object({
        codigo: z.string().trim().max(20),
        texto: z.string().trim().max(300),
        escala: z.array(z.number().int().min(0).max(100)).max(11),
        orden: z.number().int().min(0).max(999).default(0),
        obligatoria: z.boolean().default(true),
        activo: z.boolean().default(true),
        tipoCodigo: codigoTipo.nullable().optional(),
        comentarioSiMenor: z.number().min(0).max(100).nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
});
const CrearSchema = z.object({
  tipo: codigoTipo,
  unidadId: z.string().uuid("Elija el laboratorio o la sucursal."),
  referencia: z.string().trim().min(1, "Indique el N° de OT, PIA, cotización u OT interna.").max(60),
  clienteId: z.string().uuid().nullable().optional(),
  clienteTexto: z.string().trim().max(200).nullable().optional(),
  fechaServicio: fecha,
});
const TiposSchema = z.object({
  tipos: z
    .array(
      z.object({
        codigo: codigoTipo,
        nombre: z.string().trim().min(3).max(200),
        formulario: z.string().trim().min(3).max(60),
        formularioRevision: z.string().trim().max(10).nullable().optional(),
        anexoNumero: z.string().trim().max(4).nullable().optional(),
        anexoRevision: z.string().trim().max(10).nullable().optional(),
        anexoEmision: z.string().trim().max(10).nullable().optional(),
        tituloInforme: z.string().trim().min(3).max(300),
        objetoInforme: z.string().trim().min(3).max(300),
        agruparPor: z.enum(["laboratorio", "sucursal"]),
        umbralPct: z.number().min(0).max(100),
        origenes: z.string().trim().max(500).nullable().optional(),
        tiposCliente: z.string().trim().max(500).nullable().optional(),
        reglaCliente: z.enum(["EJERCITO", "PARTICULAR"]).nullable().optional(),
        porDefecto: z.boolean().default(false),
        distribucion: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
        orden: z.number().int().min(0).max(999).default(0),
        activo: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(20),
});

const SQL_BASE = `
  FROM encuesta_satisfaccion e
  LEFT JOIN orden_trabajo o ON o.id = e.ot_id
  LEFT JOIN cliente cl ON cl.id = e.cliente_id
  LEFT JOIN unidad u ON u.id = e.unidad_id
  LEFT JOIN cotizacion c ON c.id = e.cotizacion_id
  LEFT JOIN usuario ur ON ur.id = e.registrada_por
  LEFT JOIN encuesta_tipo et ON et.tenant_id = e.tenant_id AND et.codigo = e.tipo_codigo
 WHERE e.tenant_id = $1::uuid AND ($2::uuid[] IS NULL OR e.unidad_id = ANY($2::uuid[]))`;

const COLUMNAS = `
  e.id, e.codigo, e.estado, e.promedio::float8 AS promedio, e.created_at AS "createdAt", e.fecha_envio AS "fechaApertura",
  e.fecha_respuesta AS "fechaRespuesta", e.registrada_at AS "registradaAt", ur.nombre_completo AS "registradaPorNombre",
  e.canal_envio AS medio, e.nombre_respondente AS "nombreRespondente", e.cargo_respondente AS "cargoRespondente",
  e.comentario_libre AS comentario, e.respuestas, e.motivo_sin_respuesta AS "motivoSinRespuesta",
  o.id AS "otId", o.codigo AS "otCodigo", o.fecha_cierre AS "otFechaCierre", o.origen_trabajo AS "origen",
  cl.id AS "clienteId", cl.razon_social AS cliente, u.id AS "unidadId", u.codigo AS "unidadCodigo", u.nombre AS "unidadNombre",
  c.codigo AS "cotizacionCodigo", e.tipo_codigo AS tipo, et.nombre AS "tipoNombre", et.formulario,
  e.referencia, e.cliente_texto AS "clienteTexto"`;

@Injectable()
export class EncuestaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  private tenant(req: any): string {
    const t = req?.user?.tenantId;
    if (!t) throw new ForbiddenException("Tenant no resuelto en el token");
    return t;
  }

  /** Unidades visibles para el permiso de la ruta; null = todas (global o con el Depto. Comercial en el alcance). */
  private async unidades(req: any, permiso?: string): Promise<string[] | null> {
    const v = await this.alcance.filtroUnidades(req, permiso ?? null);
    if (v === null) return null;
    const dco = (await this.alcance.arbol(this.tenant(req))).porCodigo.get("DCO")?.id;
    return dco && v.includes(dco) ? null : v;
  }

  /** Preguntas; con `tipo`, solo las de ese formulario (`null` = las que no tienen formulario). */
  async preguntas(
    tenantId: string,
    soloActivas = true,
    tipo?: string | null,
  ): Promise<(Pregunta & { id: string; orden: number; activo: boolean; tipoCodigo: string | null })[]> {
    return this.prisma.$queryRawUnsafe(
      `SELECT id, codigo, texto, escala, orden, obligatoria, activo, tipo_codigo AS "tipoCodigo",
              comentario_si_menor::float8 AS "comentarioSiMenor"
         FROM encuesta_pregunta
        WHERE tenant_id = $1::uuid AND ($2::boolean = FALSE OR activo)
          AND ($3::boolean = FALSE OR tipo_codigo IS NOT DISTINCT FROM $4::text)
        ORDER BY tipo_codigo NULLS LAST, orden, codigo`,
      tenantId,
      soloActivas,
      tipo !== undefined,
      tipo ?? null,
    );
  }

  tipos(tenantId: string, soloActivos = true) {
    return leerTiposEncuesta(this.prisma, tenantId, soloActivos);
  }

  /** Configuración completa de los formularios (pantalla «Formularios»). */
  async tiposConfig(tenantId: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT codigo, nombre, formulario, formulario_revision AS "formularioRevision", anexo_numero AS "anexoNumero",
              anexo_revision AS "anexoRevision", anexo_emision AS "anexoEmision", titulo_informe AS "tituloInforme",
              objeto_informe AS "objetoInforme", agrupar_por AS "agruparPor", umbral_pct::float8 AS "umbralPct", origenes,
              tipos_cliente AS "tiposCliente", regla_cliente AS "reglaCliente", por_defecto AS "porDefecto",
              string_to_array(COALESCE(distribucion, ''), '|') AS distribucion, orden, activo
         FROM encuesta_tipo WHERE tenant_id = $1::uuid ORDER BY orden, codigo`,
      tenantId,
    );
  }

  async guardarTipos(req: any, b: z.infer<typeof TiposSchema>) {
    const tenantId = this.tenant(req);
    const codigos = b.tipos.map((t) => t.codigo);
    if (new Set(codigos).size !== codigos.length) throw new BadRequestException("Hay códigos de formulario repetidos.");
    if (b.tipos.filter((t) => t.porDefecto && t.activo).length > 1) throw new BadRequestException("Marque un solo formulario «por defecto».");
    await this.prisma.$transaction(
      b.tipos.map((t) =>
        this.prisma.$executeRawUnsafe(
          `INSERT INTO encuesta_tipo (tenant_id, codigo, nombre, formulario, formulario_revision, anexo_numero, anexo_revision, anexo_emision,
                                      titulo_informe, objeto_informe, agrupar_por, umbral_pct, origenes, tipos_cliente, regla_cliente,
                                      por_defecto, distribucion, orden, activo)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
           ON CONFLICT (tenant_id, codigo) DO UPDATE
             SET nombre = EXCLUDED.nombre, formulario = EXCLUDED.formulario, formulario_revision = EXCLUDED.formulario_revision,
                 anexo_numero = EXCLUDED.anexo_numero, anexo_revision = EXCLUDED.anexo_revision, anexo_emision = EXCLUDED.anexo_emision,
                 titulo_informe = EXCLUDED.titulo_informe, objeto_informe = EXCLUDED.objeto_informe, agrupar_por = EXCLUDED.agrupar_por,
                 umbral_pct = EXCLUDED.umbral_pct, origenes = EXCLUDED.origenes, tipos_cliente = EXCLUDED.tipos_cliente,
                 regla_cliente = EXCLUDED.regla_cliente, por_defecto = EXCLUDED.por_defecto, distribucion = EXCLUDED.distribucion,
                 orden = EXCLUDED.orden, activo = EXCLUDED.activo, updated_at = now()`,
          tenantId,
          t.codigo,
          t.nombre,
          t.formulario,
          t.formularioRevision || null,
          t.anexoNumero || null,
          t.anexoRevision || null,
          t.anexoEmision || null,
          t.tituloInforme,
          t.objetoInforme,
          t.agruparPor,
          t.umbralPct,
          t.origenes || null,
          t.tiposCliente || null,
          t.reglaCliente ?? null,
          t.porDefecto,
          t.distribucion.join("|") || null,
          t.orden,
          t.activo,
        ),
      ),
    );
    return { ok: true, tipos: await this.tiposConfig(tenantId), mensaje: "Formularios guardados." };
  }

  /** Alta manual (cotización vencida, asistencia técnica, inspección o cliente interno): nace pendiente. */
  async crear(req: any, b: z.infer<typeof CrearSchema>) {
    const tenantId = this.tenant(req);
    const tipos = await this.tipos(tenantId);
    if (!tipos.some((t) => t.codigo === b.tipo)) throw new BadRequestException(`El formulario ${b.tipo} no existe o está desactivado.`);
    const unidades = await this.unidades(req, "encuesta.registrar");
    if (unidades !== null && !unidades.includes(b.unidadId))
      throw new ForbiddenException("Fuera de su alcance: elija un laboratorio o sucursal que usted tenga asignado.");
    const codigo = `ENC-${b.tipo}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`.toUpperCase().slice(0, 30);
    const r = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO encuesta_satisfaccion (tenant_id, codigo, tipo_codigo, unidad_id, referencia, cliente_id, cliente_texto,
                                          estado, fecha_envio, creada_por)
       SELECT $1::uuid, $2, $3, u.id, $5, $6::uuid, $7, 'pendiente', $8::date, $9::uuid
         FROM unidad u WHERE u.id = $4::uuid AND u.tenant_id = $1::uuid
       RETURNING id`,
      tenantId,
      codigo,
      b.tipo,
      b.unidadId,
      b.referencia,
      b.clienteId ?? null,
      b.clienteTexto?.trim() || null,
      b.fechaServicio,
      req?.user?.sub ?? null,
    );
    if (!r[0]) throw new BadRequestException("El laboratorio o sucursal elegido no existe.");
    return { ok: true, id: r[0].id, mensaje: `Encuesta ${b.referencia} creada: queda pendiente de registrar.` };
  }

  async listar(req: any, f: { estado?: string; q?: string; unidad?: string; tipo?: string; desde?: string; hasta?: string; page?: string; limit?: string }) {
    const tenantId = this.tenant(req);
    const unidades = await this.unidades(req);
    const { page, limit, skip } = paginacion(f.page, f.limit);
    const args: unknown[] = [tenantId, unidades];
    const filtros: string[] = [];
    if (f.estado && ETIQUETA_ESTADO[f.estado]) {
      args.push(f.estado);
      filtros.push(`AND e.estado = $${args.length}`);
    }
    if (f.q?.trim()) {
      args.push(`%${f.q.trim()}%`);
      filtros.push(
        `AND (o.codigo ILIKE $${args.length} OR cl.razon_social ILIKE $${args.length} OR e.codigo ILIKE $${args.length} OR e.referencia ILIKE $${args.length} OR e.cliente_texto ILIKE $${args.length})`,
      );
    }
    if (f.tipo && /^[A-Z0-9_]{1,20}$/i.test(f.tipo)) {
      args.push(f.tipo.toUpperCase());
      filtros.push(`AND e.tipo_codigo = $${args.length}`);
    }
    if (f.unidad && /^[0-9a-f-]{36}$/i.test(f.unidad)) {
      args.push(f.unidad);
      filtros.push(`AND e.unidad_id = $${args.length}::uuid`);
    }
    if (f.desde && /^\d{4}-\d{2}-\d{2}$/.test(f.desde)) {
      args.push(f.desde);
      filtros.push(`AND e.created_at >= $${args.length}::date`);
    }
    if (f.hasta && /^\d{4}-\d{2}-\d{2}$/.test(f.hasta)) {
      args.push(f.hasta);
      filtros.push(`AND e.created_at < $${args.length}::date + 1`);
    }
    const where = `${SQL_BASE} ${filtros.join(" ")}`;
    const [data, total, conteos] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT ${COLUMNAS} ${where} ORDER BY e.created_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        ...args,
        limit,
        skip,
      ),
      this.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n ${where}`, ...args),
      this.prisma.$queryRawUnsafe<{ estado: string; n: number }[]>(`SELECT e.estado, count(*)::int AS n ${SQL_BASE} GROUP BY e.estado`, tenantId, unidades),
    ]);
    const n = Number(total[0]?.n ?? 0);
    return {
      data: data.map((d) => ({ ...d, etiquetaEstado: ETIQUETA_ESTADO[d.estado] ?? d.estado })),
      meta: { page, limit, total: n, totalPages: Math.max(1, Math.ceil(n / limit)) },
      conteos: Object.fromEntries(conteos.map((c) => [c.estado, c.n])),
    };
  }

  async detalle(req: any, id: string) {
    const tenantId = this.tenant(req);
    const unidades = await this.unidades(req);
    const f = await this.prisma.$queryRawUnsafe<any[]>(`SELECT ${COLUMNAS} ${SQL_BASE} AND e.id = $3::uuid`, tenantId, unidades, id);
    if (!f[0]) {
      const existe = await this.prisma.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM encuesta_satisfaccion WHERE id = $1::uuid AND tenant_id = $2::uuid`, id, tenantId);
      if (existe.length) throw new ForbiddenException("Fuera de su alcance: la encuesta es de un laboratorio que usted no tiene asignado.");
      throw new NotFoundException("Encuesta no encontrada");
    }
    return {
      ...f[0],
      etiquetaEstado: ETIQUETA_ESTADO[f[0].estado] ?? f[0].estado,
      preguntas: await this.preguntas(tenantId, true, f[0].tipo ?? null),
      tipos: (await this.tipos(tenantId)).map((t) => ({ codigo: t.codigo, nombre: t.nombre, formulario: t.formulario })),
    };
  }

  async registrar(req: any, id: string, b: z.infer<typeof RegistrarSchema>) {
    const tenantId = this.tenant(req);
    const e = await this.detalle(req, id);
    const no = motivoNoRegistrable(e.estado);
    if (no) throw new ConflictException(no);
    const tipo = b.tipo ?? e.tipo ?? null;
    if (tipo && !(await this.tipos(tenantId)).some((t) => t.codigo === tipo))
      throw new BadRequestException(`El formulario ${tipo} no existe o está desactivado.`);
    const preguntas = await this.preguntas(tenantId, true, tipo);
    if (!preguntas.length) throw new ConflictException("Este formulario no tiene preguntas activas: configúrelas en la pestaña «Preguntas».");
    const r = validarRespuestas(preguntas, b.respuestas, b.comentario ?? "");
    if (r.errores.length) throw new BadRequestException(r.errores.join(" "));
    await this.prisma.$executeRawUnsafe(
      `UPDATE encuesta_satisfaccion
          SET estado = 'registrada', respuestas = $2::jsonb, promedio = $3, comentario_libre = $4,
              nombre_respondente = $5, cargo_respondente = $6, canal_envio = $7, fecha_respuesta = $8::date,
              registrada_por = $9::uuid, registrada_at = now(), updated_at = now(), tipo_codigo = $10
        WHERE id = $1::uuid AND estado = 'pendiente'`,
      id,
      JSON.stringify(r.guardadas),
      r.promedio,
      b.comentario?.trim() || null,
      b.nombreRespondente,
      b.cargoRespondente,
      b.medio,
      b.fechaRespuesta,
      req?.user?.sub ?? null,
      tipo,
    );
    return { ok: true, promedio: r.promedio, mensaje: `Encuesta ${e.otCodigo ? `de la OT ${e.otCodigo}` : e.referencia ?? e.codigo} registrada${r.promedio !== null ? ` (promedio ${numeroChile(r.promedio)})` : ""}.` };
  }

  async sinRespuesta(req: any, id: string, motivo: string) {
    const e = await this.detalle(req, id);
    const no = motivoNoRegistrable(e.estado);
    if (no) throw new ConflictException(no);
    await this.prisma.$executeRawUnsafe(
      `UPDATE encuesta_satisfaccion SET estado = 'sin_respuesta', motivo_sin_respuesta = $2, registrada_por = $3::uuid,
              registrada_at = now(), updated_at = now() WHERE id = $1::uuid AND estado = 'pendiente'`,
      id,
      motivo,
      req?.user?.sub ?? null,
    );
    return { ok: true, mensaje: `Encuesta ${e.otCodigo ?? e.referencia ?? ""} cerrada sin respuesta.` };
  }

  async reporte(req: any, f: { desde?: string; hasta?: string; tipo?: string }) {
    const tenantId = this.tenant(req);
    const unidades = await this.unidades(req);
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT u.codigo AS unidad, e.estado, e.promedio::float8 AS promedio, e.respuestas ${SQL_BASE}
         AND ($3::date IS NULL OR e.created_at >= $3::date) AND ($4::date IS NULL OR e.created_at < $4::date + 1)
         AND ($5::text IS NULL OR e.tipo_codigo = $5)`,
      tenantId,
      unidades,
      f.desde && /^\d{4}-\d{2}-\d{2}$/.test(f.desde) ? f.desde : null,
      f.hasta && /^\d{4}-\d{2}-\d{2}$/.test(f.hasta) ? f.hasta : null,
      f.tipo && /^[A-Z0-9_]{1,20}$/i.test(f.tipo) ? f.tipo.toUpperCase() : null,
    );
    return reportePorLaboratorio(filas);
  }

  async guardarPreguntas(req: any, b: z.infer<typeof PreguntasSchema>) {
    const tenantId = this.tenant(req);
    const errores = b.preguntas.flatMap((p) => erroresPregunta(p));
    const codigos = b.preguntas.map((p) => p.codigo);
    if (new Set(codigos).size !== codigos.length) errores.push("Hay códigos de pregunta repetidos.");
    if (!b.preguntas.some((p) => p.activo)) errores.push("Deje al menos una pregunta activa.");
    const tipos = new Set((await this.tipos(tenantId, false)).map((t) => t.codigo));
    for (const p of b.preguntas) if (p.tipoCodigo && !tipos.has(p.tipoCodigo)) errores.push(`La pregunta ${p.codigo} apunta a un formulario que no existe (${p.tipoCodigo}).`);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.prisma.$transaction(
      b.preguntas.map((p) =>
        this.prisma.$executeRawUnsafe(
          `INSERT INTO encuesta_pregunta (tenant_id, codigo, texto, escala, orden, obligatoria, activo, tipo_codigo, comentario_si_menor)
           VALUES ($1::uuid, $2, $3, $4::int[], $5, $6, $7, $8, $9)
           ON CONFLICT (tenant_id, codigo) DO UPDATE
             SET texto = EXCLUDED.texto, escala = EXCLUDED.escala, orden = EXCLUDED.orden,
                 obligatoria = EXCLUDED.obligatoria, activo = EXCLUDED.activo, tipo_codigo = EXCLUDED.tipo_codigo,
                 comentario_si_menor = EXCLUDED.comentario_si_menor, updated_at = now()`,
          tenantId,
          p.codigo,
          p.texto,
          p.escala,
          p.orden,
          p.obligatoria,
          p.activo,
          p.tipoCodigo ?? null,
          p.comentarioSiMenor ?? null,
        ),
      ),
    );
    return { ok: true, preguntas: await this.preguntas(tenantId, false), mensaje: "Preguntas guardadas. Las encuestas ya registradas conservan las preguntas con que se respondieron." };
  }
}

@ApiTags("encuestas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("encuestas")
export class EncuestaController {
  constructor(private readonly svc: EncuestaService) {}

  @Get()
  @RequierePermiso("encuesta.ver")
  @ApiOperation({ summary: "Encuestas: ?estado=pendiente|registrada|sin_respuesta&q=&unidad=&desde=&hasta=&page=" })
  listar(@Query() q: Record<string, string>, @Req() req: any) {
    return this.svc.listar(req, q ?? {});
  }

  @Get("reporte")
  @RequierePermiso("encuesta.ver")
  reporte(@Query("desde") desde: string | undefined, @Query("hasta") hasta: string | undefined, @Query("tipo") tipo: string | undefined, @Req() req: any) {
    return this.svc.reporte(req, { desde, hasta, tipo });
  }

  @Get("tipos")
  @RequierePermiso("encuesta.ver")
  @ApiOperation({ summary: "Formularios de encuesta (FORM01–FORM05, cliente interno) con su configuración" })
  tipos(@Req() req: any) {
    return this.svc.tiposConfig(req?.user?.tenantId);
  }

  @Put("tipos")
  @RequierePermiso("encuesta.configurar")
  guardarTipos(@Body() body: unknown, @Req() req: any) {
    return this.svc.guardarTipos(req, TiposSchema.parse(body ?? {}));
  }

  @Post()
  @RequierePermiso("encuesta.registrar")
  @ApiOperation({ summary: "Alta manual de una encuesta (cotización vencida, asistencia técnica, inspección, cliente interno)" })
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crear(req, CrearSchema.parse(body ?? {}));
  }

  @Get("preguntas")
  @RequierePermiso("encuesta.ver")
  async preguntas(@Req() req: any) {
    return this.svc.preguntas(req?.user?.tenantId, false);
  }

  @Put("preguntas")
  @RequierePermiso("encuesta.configurar")
  guardarPreguntas(@Body() body: unknown, @Req() req: any) {
    return this.svc.guardarPreguntas(req, PreguntasSchema.parse(body ?? {}));
  }

  @Get(":id")
  @RequierePermiso("encuesta.ver")
  detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(req, id);
  }

  @Post(":id/registrar")
  @RequierePermiso("encuesta.registrar")
  registrar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.registrar(req, id, RegistrarSchema.parse(body ?? {}));
  }

  @Post(":id/sin-respuesta")
  @RequierePermiso("encuesta.registrar")
  sinRespuesta(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.sinRespuesta(req, id, SinRespuestaSchema.parse(body ?? {}).motivo);
  }
}

@Module({
  // El informe va primero: «informe-trimestral» no debe caer en la ruta «:id».
  controllers: [EncuestaInformeController, EncuestaController],
  providers: [EncuestaService, EncuestaInformeService],
})
export class EncuestaModule {}
