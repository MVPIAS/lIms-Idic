import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { ResultadoService } from "../laboratorio/laboratorio.module";
import {
  ACCIONES_PNC,
  CLASES_NC,
  FORMULARIO_PG12,
  ensayosAReejecutar,
  erroresPnc,
  modoDevolucion,
  CRITICIDADES_NC,
  ESTADOS_NC,
  ESTADOS_NC_ABIERTOS,
  TIPOS_NC,
  erroresTransicionNc,
  ncVencida,
  puedeEditarAnalisis,
  siguienteCodigoNc,
} from "./no-conformidad.reglas";
import { anioChile } from "../common/fecha-chile";

/**
 * No conformidades (tabla `no_conformidad`, ISO/IEC 17025 §7.10 / §8.7).
 *   · nc.ver       → listar y ver (acotado por unidad: las de sus unidades y las transversales).
 *   · nc.crear     → levantar una NC (cualquier persona del laboratorio).
 *   · nc.gestionar → analizar, asignar responsable/plazo, cambiar estado, cerrar y reabrir.
 * El responsable asignado también puede registrar el análisis (causa/acciones).
 * Ligada opcionalmente a una OT, un resultado o un equipo; la unidad se deduce
 * de la OT (unidad principal) o del equipo si no se indica.
 */
const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const texto = (max: number) => z.string().trim().max(max).nullable().optional();

const CrearNcSchema = z.object({
  titulo: z.string().trim().min(3, "Indique un título breve.").max(200),
  descripcion: z.string().trim().min(5, "Describa la no conformidad.").max(5000),
  tipo: z.enum(TIPOS_NC).default("ensayo"),
  criticidad: z.enum(CRITICIDADES_NC).default("media"),
  unidadId: z.string().uuid().nullable().optional(),
  otId: z.string().uuid().nullable().optional(),
  resultadoId: z.string().uuid().nullable().optional(),
  equipoId: z.string().uuid().nullable().optional(),
  responsableId: z.string().uuid().nullable().optional(),
  plazoCierre: fechaDia.nullable().optional(),
  // PNC/TNC IDIC-PG12 (BL-165)
  clase: z.enum(CLASES_NC).optional(),
  accion: z.enum(ACCIONES_PNC).nullable().optional(),
  muestraId: z.string().uuid().nullable().optional(),
  calibracionId: z.string().uuid().nullable().optional(),
  certificadoId: z.string().uuid().nullable().optional(),
  resultadoIds: z.array(z.string().uuid()).max(200).optional(),
  costoNoCalidad: z.number().nonnegative().max(1e12).nullable().optional(),
});

const EscalarSchema = z.object({ motivo: z.string().trim().min(5, "Indique por qué se escala (mínimo 5 caracteres).").max(2000) });

const EditarNcSchema = z.object({
  titulo: z.string().trim().min(3).max(200).optional(),
  descripcion: z.string().trim().min(5).max(5000).optional(),
  tipo: z.enum(TIPOS_NC).optional(),
  criticidad: z.enum(CRITICIDADES_NC).optional(),
  responsableId: z.string().uuid().nullable().optional(),
  plazoCierre: fechaDia.nullable().optional(),
  causaRaiz: texto(5000),
  costoNoCalidad: z.number().nonnegative().max(1e12).nullable().optional(),
  accionCorrectiva: texto(5000),
  accionPreventiva: texto(5000),
  verificacion: texto(5000),
});

const EstadoNcSchema = z.object({
  estado: z.enum(ESTADOS_NC),
  comentario: z.string().trim().max(2000).optional(),
});

const ListaSchema = z.object({
  estado: z.string().max(40).optional(), // un estado, o 'abiertas'
  unidadId: z.string().uuid().optional(),
  otId: z.string().uuid().optional(),
  equipoId: z.string().uuid().optional(),
  resultadoId: z.string().uuid().optional(),
  q: z.string().trim().max(80).optional(),
  vencidas: z.enum(["1", "true"]).optional(),
  mias: z.enum(["1", "true"]).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

const SELECT_NC = `
  SELECT nc.id, nc.codigo, nc.titulo, nc.tipo, nc.criticidad, nc.descripcion, nc.estado,
         nc.unidad_id AS "unidadId", un.codigo AS "unidadCodigo", un.nombre AS "unidadNombre",
         nc.ot_id AS "otId", o.codigo AS "otCodigo",
         nc.resultado_id AS "resultadoId",
         nc.equipo_id AS "equipoId", e.codigo AS "equipoCodigo", e.nombre AS "equipoNombre",
         nc.origen_entidad_tipo AS "origenTipo", nc.origen_entidad_id AS "origenId",
         nc.detectado_por AS "detectadoPorId", ud.nombre_completo AS "detectadoPor", nc.detectado_at AS "detectadoAt",
         nc.responsable_id AS "responsableId", ur.nombre_completo AS "responsable",
         to_char(nc.plazo_cierre, 'YYYY-MM-DD') AS "plazoCierre",
         nc.causa_raiz AS "causaRaiz", nc.accion_correctiva AS "accionCorrectiva",
         nc.accion_preventiva AS "accionPreventiva", nc.verificacion,
         nc.cerrado_at AS "cerradoAt", nc.cerrado_por AS "cerradoPorId", uc.nombre_completo AS "cerradoPor",
         nc.cierre_comentario AS "cierreComentario", nc.updated_at AS "updatedAt",
         nc.clase, nc.formulario, nc.accion, nc.muestra_id AS "muestraId", mu.codigo AS "muestraCodigo",
         nc.calibracion_id AS "calibracionId", cal.codigo AS "calibracionCodigo",
         nc.certificado_id AS "certificadoId", ce.numero AS "certificadoNumero", nc.resultado_ids AS "resultadoIds",
         nc.costo_no_calidad::float8 AS "costoNoCalidad", nc.accion_ejecutada_at AS "accionEjecutadaAt", uae.nombre_completo AS "accionEjecutadaPor",
         nc.escalada_at AS "escaladaAt", ues.nombre_completo AS "escaladaPor", nc.escalada_motivo AS "escaladaMotivo",
         nc.cliente_id AS "clienteId", cli.razon_social AS "cliente", to_char(nc.reclamo_fecha, 'YYYY-MM-DD') AS "reclamoFecha",
         nc.responsable_rol AS "responsableRol", nc.respuesta, nc.respondido_at AS "respondidoAt", urs.nombre_completo AS "respondidoPor"
    FROM no_conformidad nc
    LEFT JOIN muestra mu        ON mu.id = nc.muestra_id
    LEFT JOIN met_calibracion cal ON cal.id = nc.calibracion_id
    LEFT JOIN certificado ce    ON ce.id = nc.certificado_id
    LEFT JOIN usuario uae       ON uae.id = nc.accion_ejecutada_por
    LEFT JOIN usuario ues       ON ues.id = nc.escalada_por
    LEFT JOIN usuario urs       ON urs.id = nc.respondido_por
    LEFT JOIN cliente cli       ON cli.id = nc.cliente_id
    LEFT JOIN unidad un        ON un.id = nc.unidad_id
    LEFT JOIN orden_trabajo o  ON o.id = nc.ot_id
    LEFT JOIN equipo e         ON e.id = nc.equipo_id
    LEFT JOIN usuario ud       ON ud.id = nc.detectado_por
    LEFT JOIN usuario ur       ON ur.id = nc.responsable_id
    LEFT JOIN usuario uc       ON uc.id = nc.cerrado_por`;

@ApiTags("no-conformidades")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("no-conformidades")
export class NoConformidadController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly resultados: ResultadoService,
  ) {}

  @Get()
  @RequierePermiso("nc.ver")
  async listar(@Query() query: unknown, @Req() req: any) {
    const q = ListaSchema.parse(query ?? {});
    const unidades = await this.alcance.filtroUnidades(req);
    const estados =
      q.estado === "abiertas" ? [...ESTADOS_NC_ABIERTOS] : q.estado ? q.estado.split(",").filter(Boolean) : null;
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT_NC}
       WHERE nc.tenant_id = COALESCE($1::uuid, nc.tenant_id)
         AND ($2::uuid[] IS NULL OR nc.unidad_id IS NULL OR nc.unidad_id = ANY($2::uuid[]))
         AND ($3::text[] IS NULL OR nc.estado = ANY($3::text[]))
         AND ($4::uuid IS NULL OR nc.unidad_id = $4::uuid)
         AND ($5::uuid IS NULL OR nc.ot_id = $5::uuid)
         AND ($6::uuid IS NULL OR nc.equipo_id = $6::uuid)
         AND ($7::uuid IS NULL OR nc.resultado_id = $7::uuid)
         AND ($8::text IS NULL OR nc.codigo ILIKE '%' || $8 || '%' OR nc.titulo ILIKE '%' || $8 || '%'
              OR nc.descripcion ILIKE '%' || $8 || '%' OR o.codigo ILIKE '%' || $8 || '%')
         AND ($9::boolean IS NOT TRUE OR (nc.estado <> 'cerrada' AND nc.plazo_cierre < (now() AT TIME ZONE 'America/Santiago')::date))
         AND ($10::uuid IS NULL OR nc.responsable_id = $10::uuid OR nc.detectado_por = $10::uuid)
       ORDER BY (nc.estado = 'cerrada'), nc.plazo_cierre NULLS LAST, nc.detectado_at DESC
       LIMIT $11`,
      req?.user?.tenantId ?? null,
      unidades,
      estados,
      q.unidadId ?? null,
      q.otId ?? null,
      q.equipoId ?? null,
      q.resultadoId ?? null,
      q.q || null,
      !!q.vencidas,
      q.mias ? req?.user?.sub ?? null : null,
      q.limit,
    );
    const hoy = new Date();
    const data = filas.map((f) => ({ ...f, vencida: ncVencida(f, hoy) }));
    const resumen = {
      abiertas: data.filter((f) => (ESTADOS_NC_ABIERTOS as readonly string[]).includes(f.estado)).length,
      vencidas: data.filter((f) => f.vencida).length,
      cerradas: data.filter((f) => f.estado === "cerrada").length,
    };
    return { data, meta: { total: data.length, limit: q.limit, resumen } };
  }

  @Get(":id")
  @RequierePermiso("nc.ver")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const nc = await this.cargar(id, req);
    const permisos: string[] = req?.user?.permisos ?? [];
    const gestiona = this.gestiona(req);
    return {
      ...nc,
      vencida: ncVencida(nc, new Date()),
      puede: {
        editarAnalisis: puedeEditarAnalisis({ gestiona, usuarioId: req?.user?.sub, responsableId: nc.responsableId }),
        gestionar: gestiona,
        crear: gestiona || permisos.includes("nc.crear"),
      },
    };
  }

  @Post()
  @RequierePermiso("nc.crear")
  async crear(@Body() body: unknown, @Req() req: any) {
    const d = CrearNcSchema.parse(body ?? {});
    const tenantId: string | undefined = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException("Sin tenant en la sesión");
    // PNC/TNC (BL-165): la calibración o el documento fijan la OT; los ensayos deben ser de ella.
    if (d.calibracionId && !d.otId) {
      const c = await this.prisma.$queryRawUnsafe<{ ot_id: string | null }[]>(`SELECT ot_id FROM met_calibracion WHERE id = $1::uuid AND tenant_id = $2::uuid`, d.calibracionId, tenantId);
      if (!c.length) throw new BadRequestException("La calibración indicada no existe.");
      d.otId = c[0].ot_id ?? null;
    }
    if (d.certificadoId && !d.otId) {
      const c = await this.prisma.$queryRawUnsafe<{ ot_id: string | null }[]>(`SELECT ot_id FROM certificado WHERE id = $1::uuid AND tenant_id = $2::uuid`, d.certificadoId, tenantId);
      if (!c.length) throw new BadRequestException("El documento indicado no existe.");
      d.otId = c[0].ot_id ?? null;
    }
    const ePnc = erroresPnc(d);
    if (ePnc.length) throw new BadRequestException(ePnc.join(" "));
    const ensayos = ensayosAReejecutar({ resultadoIds: d.resultadoIds, resultadoId: d.resultadoId });
    if (ensayos.length && d.otId) {
      const n = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM resultado r JOIN muestra m ON m.id = r.muestra_id
          WHERE r.id = ANY($1::uuid[]) AND COALESCE(r.ot_id, m.ot_id) = $2::uuid AND r.deleted_at IS NULL`,
        ensayos,
        d.otId,
      );
      if (Number(n[0]?.n) !== ensayos.length) throw new BadRequestException("Algún ensayo indicado no es de la OT.");
    }
    if (d.muestraId && d.otId) {
      const m = await this.prisma.$queryRawUnsafe<any[]>(`SELECT 1 FROM muestra WHERE id = $1::uuid AND ot_id = $2::uuid`, d.muestraId, d.otId);
      if (!m.length) throw new BadRequestException("La muestra indicada no es de la OT.");
    }

    // Unidad: la indicada, o la de la OT, o la del equipo. Debe estar en el alcance.
    let unidadId = d.unidadId ?? null;
    if (d.otId) {
      const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id: d.otId, tenantId }, select: { id: true } });
      if (!ot) throw new BadRequestException("La OT indicada no existe.");
      const u = await this.prisma.$queryRawUnsafe<{ unidad_principal: string | null }[]>(
        `SELECT unidad_principal FROM orden_trabajo WHERE id = $1::uuid`,
        d.otId,
      );
      unidadId = unidadId ?? u[0]?.unidad_principal ?? null;
    }
    if (d.equipoId) {
      const e = await this.prisma.$queryRawUnsafe<{ unidad_id: string | null }[]>(
        `SELECT unidad_id FROM equipo WHERE id = $1::uuid`,
        d.equipoId,
      );
      if (!e.length) throw new BadRequestException("El equipo indicado no existe.");
      unidadId = unidadId ?? e[0].unidad_id ?? null;
    }
    if (unidadId) await this.alcance.exigirUnidad(req, unidadId, "la no conformidad");
    if (d.responsableId) await this.exigirUsuario(d.responsableId, tenantId);

    const origen = d.calibracionId ? ["calibracion", d.calibracionId] : d.certificadoId ? ["certificado", d.certificadoId] : d.resultadoId ? ["resultado", d.resultadoId] : d.equipoId ? ["equipo", d.equipoId] : d.otId ? ["orden_trabajo", d.otId] : [null, null];
    for (let intento = 0; intento < 3; intento++) {
      const ultimo = await this.prisma.$queryRawUnsafe<{ codigo: string }[]>(
        `SELECT codigo FROM no_conformidad WHERE tenant_id = $1::uuid AND codigo LIKE $2 ORDER BY codigo DESC LIMIT 1`,
        tenantId,
        `NC-${anioChile()}-%`,
      );
      const codigo = siguienteCodigoNc(ultimo[0]?.codigo, anioChile());
      try {
        const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO no_conformidad
             (tenant_id, codigo, titulo, tipo, criticidad, descripcion, unidad_id, ot_id, resultado_id, equipo_id,
              origen_entidad_tipo, origen_entidad_id, detectado_por, responsable_id, plazo_cierre, estado,
              clase, formulario, accion, muestra_id, calibracion_id, certificado_id, resultado_ids, costo_no_calidad)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8::uuid, $9::uuid, $10::uuid, $11, $12::uuid, $13::uuid, $14::uuid, $15::date, 'abierta',
                   $16, $17, $18, $19::uuid, $20::uuid, $21::uuid, $22::uuid[], $23)
           RETURNING id`,
          tenantId,
          codigo,
          d.titulo,
          d.tipo,
          d.criticidad,
          d.descripcion,
          unidadId,
          d.otId ?? null,
          d.resultadoId ?? null,
          d.equipoId ?? null,
          origen[0],
          origen[1],
          req?.user?.sub ?? null,
          d.responsableId ?? null,
          d.plazoCierre ?? null,
          d.clase ?? "NC",
          d.clase === "PNC" || d.clase === "TNC" ? FORMULARIO_PG12 : null,
          d.accion ?? null,
          d.muestraId ?? null,
          d.calibracionId ?? null,
          d.certificadoId ?? null,
          ensayos,
          d.costoNoCalidad ?? null,
        );
        return this.cargar(filas[0].id, req);
      } catch (e: any) {
        if (String(e?.message ?? "").includes("no_conformidad_tenant_id_codigo_key") && intento < 2) continue;
        throw e;
      }
    }
    throw new ConflictException("No se pudo asignar un código a la no conformidad; reintente.");
  }

  /** Datos y análisis (causa raíz, acciones, verificación). No cambia el estado. */
  @Patch(":id")
  @RequierePermiso("nc.ver")
  async editar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const d = EditarNcSchema.parse(body ?? {});
    const nc = await this.cargar(id, req);
    const gestiona = this.gestiona(req);
    if (!puedeEditarAnalisis({ gestiona, usuarioId: req?.user?.sub, responsableId: nc.responsableId })) {
      throw new ForbiddenException("Solo Calidad/jefatura (nc.gestionar) o el responsable asignado pueden editar esta no conformidad.");
    }
    // Responsable, plazo, tipo y criticidad los define quien gestiona.
    const soloGestion = ["responsableId", "plazoCierre", "tipo", "criticidad", "titulo", "descripcion"] as const;
    if (!gestiona && soloGestion.some((k) => d[k] !== undefined)) {
      throw new ForbiddenException("Como responsable puede registrar la causa, las acciones y la verificación; el resto lo define Calidad o la jefatura.");
    }
    if (nc.estado === "cerrada") throw new ConflictException("La no conformidad está cerrada: reábrala para modificarla.");
    if (d.responsableId) await this.exigirUsuario(d.responsableId, req?.user?.tenantId);

    const cols: Record<string, [string, string]> = {
      titulo: ["titulo", ""],
      descripcion: ["descripcion", ""],
      tipo: ["tipo", ""],
      criticidad: ["criticidad", ""],
      responsableId: ["responsable_id", "::uuid"],
      plazoCierre: ["plazo_cierre", "::date"],
      causaRaiz: ["causa_raiz", ""],
      accionCorrectiva: ["accion_correctiva", ""],
      accionPreventiva: ["accion_preventiva", ""],
      verificacion: ["verificacion", ""],
      costoNoCalidad: ["costo_no_calidad", "::numeric"],
    };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, [col, cast]] of Object.entries(cols)) {
      const v = (d as any)[k];
      if (v === undefined) continue;
      vals.push(v === "" ? null : v);
      sets.push(`${col} = $${vals.length}${cast}`);
    }
    if (sets.length) {
      vals.push(id);
      await this.prisma.$executeRawUnsafe(
        `UPDATE no_conformidad SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}::uuid`,
        ...vals,
      );
    }
    return this.cargar(id, req);
  }

  /** Cambio de estado (iniciar tratamiento, verificación, cierre, reapertura). */
  @Post(":id/estado")
  @RequierePermiso("nc.gestionar")
  async cambiarEstado(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const { estado, comentario } = EstadoNcSchema.parse(body ?? {});
    const nc = await this.cargar(id, req);
    const errores = erroresTransicionNc(nc, estado, comentario);
    if (errores.length) throw new BadRequestException({ statusCode: 400, message: errores.join(" "), errores });
    if (estado === "cerrada") {
      await this.prisma.$executeRawUnsafe(
        `UPDATE no_conformidad SET estado = 'cerrada', cerrado_at = now(), cerrado_por = $2::uuid,
                cierre_comentario = COALESCE($3, cierre_comentario), updated_at = now()
          WHERE id = $1::uuid`,
        id,
        req?.user?.sub ?? null,
        comentario || null,
      );
    } else {
      await this.prisma.$executeRawUnsafe(
        `UPDATE no_conformidad SET estado = $2,
                cerrado_at = CASE WHEN $2 = 'reabierta' THEN NULL ELSE cerrado_at END,
                cerrado_por = CASE WHEN $2 = 'reabierta' THEN NULL ELSE cerrado_por END,
                cierre_comentario = CASE WHEN $2 = 'reabierta' THEN 'Reabierta: ' || $3 ELSE cierre_comentario END,
                updated_at = now()
          WHERE id = $1::uuid`,
        id,
        estado,
        comentario || null,
      );
    }
    return this.cargar(id, req);
  }

  /**
   * Ejecuta la acción del PNC/TNC (BL-165): «reejecutar» devuelve cada ensayo
   * afectado a la captura (los aprobados se reabren con el motivo, anulando los
   * documentos vigentes; los capturados o revisados se devuelven al analista);
   * «corregir_informe» y «volver_elaboracion» quedan registradas para que el
   * laboratorio siga en su pantalla. Una sola vez por PNC/TNC.
   */
  @Post(":id/ejecutar-accion")
  @RequierePermiso("nc.gestionar")
  async ejecutarAccion(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const nc = await this.cargar(id, req);
    if (!nc.clase || nc.clase === "NC" || !nc.accion) throw new BadRequestException("Esta no conformidad no es un PNC/TNC con acción.");
    if (nc.accionEjecutadaAt) throw new ConflictException("La acción de este PNC/TNC ya se ejecutó.");
    if (nc.estado === "cerrada") throw new ConflictException("La no conformidad está cerrada.");
    const motivo = `${nc.clase} ${nc.codigo} (${FORMULARIO_PG12}): ${nc.titulo ?? nc.descripcion}`.slice(0, 900);
    const hechos: { id: string; modo: string }[] = [];
    if (nc.accion === "reejecutar") {
      const permisos: string[] = req?.user?.permisos ?? [];
      const ids = ensayosAReejecutar(nc);
      const filas = await this.prisma.$queryRawUnsafe<{ id: string; estado: string }[]>(`SELECT id, estado FROM resultado WHERE id = ANY($1::uuid[])`, ids);
      for (const r of filas) {
        const modo = modoDevolucion(r.estado);
        if (modo === "reabrir") {
          if (!permisos.includes("resultado.reabrir") && !(req?.user?.roles ?? []).includes("SUPERADMIN"))
            throw new ForbiddenException("Reejecutar un ensayo aprobado exige el permiso «resultado.reabrir» (jefatura).");
          await this.resultados.reabrir(r.id, motivo, req?.user?.sub, req?.user?.tenantId);
        } else if (modo === "devolver") {
          await this.resultados.devolver(r.id, motivo, req?.user?.sub);
        }
        hechos.push({ id: r.id, modo });
      }
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE no_conformidad SET accion_ejecutada_at = now(), accion_ejecutada_por = $2::uuid,
              estado = CASE WHEN estado = 'abierta' AND responsable_id IS NOT NULL AND plazo_cierre IS NOT NULL THEN 'en_proceso' ELSE estado END,
              updated_at = now()
        WHERE id = $1::uuid`,
      id,
      req?.user?.sub ?? null,
    );
    if (nc.otId)
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'pnc', $3::jsonb, $4::uuid)`,
        req?.user?.tenantId,
        nc.otId,
        JSON.stringify({ codigo: nc.codigo, clase: nc.clase, accion: nc.accion, ensayos: hechos }),
        req?.user?.sub ?? null,
      );
    const devueltos = hechos.filter((h) => h.modo !== "nada").length;
    return {
      ...(await this.cargar(id, req)),
      mensaje:
        nc.accion === "reejecutar"
          ? `${devueltos} ensayo(s) devuelto(s) a la captura${hechos.length > devueltos ? `; ${hechos.length - devueltos} ya estaban por capturar` : ""}.`
          : nc.accion === "corregir_informe"
            ? "Acción registrada: corrija el informe (Informes) y vuelva a emitirlo."
            : "Acción registrada: la calibración vuelve a su elaboración.",
    };
  }

  /** Escala el PNC/TNC al Jefe de Sección (EP-04 P6.3, EP-01 4.2). */
  @Post(":id/escalar")
  @RequierePermiso("nc.gestionar")
  async escalar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const { motivo } = EscalarSchema.parse(body ?? {});
    const nc = await this.cargar(id, req);
    if (nc.estado === "cerrada") throw new ConflictException("La no conformidad está cerrada.");
    if (nc.escaladaAt) throw new ConflictException("Ya se escaló al Jefe de Sección.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE no_conformidad SET escalada_at = now(), escalada_por = $2::uuid, escalada_motivo = $3, updated_at = now() WHERE id = $1::uuid`,
      id,
      req?.user?.sub ?? null,
      motivo,
    );
    return this.cargar(id, req);
  }

  // --------------------------------------------------------------------------

  private gestiona(req: any): boolean {
    const roles: string[] = req?.user?.roles ?? [];
    return roles.includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes("nc.gestionar");
  }

  private async exigirUsuario(id: string, tenantId?: string) {
    const u = await this.prisma.usuario.findFirst({
      where: { id, deletedAt: null, estado: "activo", ...(tenantId ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!u) throw new BadRequestException("El responsable indicado no existe o está inactivo.");
  }

  /** Carga una NC del tenant y verifica que esté en el alcance del usuario (404/403). */
  private async cargar(id: string, req: any): Promise<any> {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT_NC} WHERE nc.id = $1::uuid AND nc.tenant_id = COALESCE($2::uuid, nc.tenant_id)`,
      id,
      req?.user?.tenantId ?? null,
    );
    if (!filas.length) throw new NotFoundException("No conformidad no encontrada");
    const nc = filas[0];
    if (nc.unidadId) await this.alcance.exigirUnidad(req, nc.unidadId, "la no conformidad");
    return nc;
  }
}
