import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { NIVELES_TECNOLOGICOS, TIPOS_TRABAJO } from "./encargo/reglas-encargo";
import { sino, valoresCategoria } from "../common/parametros-r4d";
import { PrismaService } from "../common/prisma.service";
import { instanteFechaIngreso } from "../common/fecha-chile";
import { LaboratorioOtService, UnidadResumen } from "./laboratorio-ot.service";
import { filtroListaOt, paginacion, semaforoPedido } from "./lista-ot";
import { OtCierreService } from "./ot-cierre.controller";
import { DEV_TENANT } from "../common/base-crud.service";
import { FlujoService } from "../flujo/flujo.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { estadosValidos, validarTransicion } from "../common/estados";
import { generarCodigoOt } from "../common/codigo";
import { AlcanceService } from "../rbac/alcance.service";
import { AlcanceResultadoService } from "../rbac/alcance-resultado.service";
import { ORIGENES_OT, calcularOpiPendiente, resolverCobro, validarOrigenOt } from "./reglas-ot";

const PrioridadEnum = z.enum(["baja", "normal", "alta", "urgente"]);

/**
 * Referencia a un flujo: o bien una instancia YA existente (`flujoInstanciaId`),
 * o bien una definición/versión que el backend instancia por nosotros
 * (`flujoDefId` → su versión publicada, o `flujoVersionId` directo).
 * Son mutuamente excluyentes para no dejar instancias huérfanas.
 */
const FlujoRef = {
  flujoInstanciaId: z.string().uuid().optional(),
  flujoDefId: z.string().uuid().optional(),
  flujoVersionId: z.string().uuid().optional(),
};
const unSoloFlujo = (d: {
  flujoInstanciaId?: string;
  flujoDefId?: string;
  flujoVersionId?: string;
}) => [d.flujoInstanciaId, d.flujoDefId, d.flujoVersionId].filter(Boolean).length <= 1;
const MSG_UN_SOLO_FLUJO =
  "Use solo uno de: flujoInstanciaId, flujoDefId o flujoVersionId";

/**
 * Crear OT directamente (con o sin cotización de respaldo).
 * `fechaIngreso` se persiste en la columna real `fecha_recepcion`.
 * Flujo (opcional): `flujoInstanciaId` adjunta una instancia existente;
 * `flujoDefId`/`flujoVersionId` hacen que el backend INSTANCIE el flujo y lo asocie.
 */
const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");

/**
 * Comercial R2 · origen / cobro / OPI (ver reglas-ot.ts):
 *  · origenTrabajo: COTIZACION | INTERNACION | DISPOSICION | INTERLABORATORIO | OT_INTERNA.
 *  · DISPOSICION (IDIC-PG03 6.4 g) exige disposicionRef; con cobro y sin OPI → opi_pendiente.
 *  · INTERLABORATORIO (SPC2.2): sin cotización, sin cobro, lab solicitante ≠ ejecutor;
 *    clienteId opcional (se usa el cliente de tipo 'interlaboratorio').
 *  · horasHombre / costoEstimado: el costo se registra aunque la OT sea sin cobro.
 */
const OtCreate = z
  .object({
    clienteId: z.string().uuid().optional(),
    cotizacionId: z.string().uuid().optional(),
    prioridad: PrioridadEnum.optional(),
    notas: z.string().optional(),
    fechaIngreso: z.coerce.date().optional(),
    origenTrabajo: z.enum(ORIGENES_OT).optional(),
    conCobro: z.boolean().optional(),
    disposicionRef: z.string().max(120).optional(),
    disposicionFecha: fechaDia.optional(),
    opiNumero: z.string().max(60).optional(),
    opiFecha: fechaDia.optional(),
    resolucion: z.string().max(40).optional(),
    centroCostoId: z.string().uuid().optional(),
    labSolicitanteCcId: z.string().uuid().optional(),
    horasHombre: z.number().min(0).optional(),
    costoEstimado: z.number().min(0).optional(),
    // EP-01/02 0.5 y EP-00 5.1 (frente r4d): oficio de la OT institucional,
    // laboratorios que intervienen y clasificación del trabajo (ot_encargo).
    oficioNumero: z.string().trim().max(80).optional(),
    oficioFecha: fechaDia.optional(),
    laboratoriosIntervienen: z.array(z.string().uuid()).max(20).optional(),
    tipoTrabajo: z.enum(TIPOS_TRABAJO).optional(),
    nivelTecnologico: z.enum(NIVELES_TECNOLOGICOS).optional(),
    requiereMuestreo: z.boolean().optional(),
    descripcionTrabajo: z.string().max(4000).optional(),
    fechaCompromiso: fechaDia.optional(),
    /**
     * Laboratorio responsable (unidad). Si no se indica, se deduce del catálogo
     * (cotización, centro de costo ejecutor, elementos y métodos elegidos); si
     * no se puede deducir, la OT no se crea (400) y hay que elegirlo.
     */
    unidadPrincipalId: z.string().uuid().optional(),
    /** Pistas del catálogo para deducir el laboratorio (registro con elementos). */
    catElementoIds: z.array(z.string().uuid()).max(200).optional(),
    catMetodoIds: z.array(z.string().uuid()).max(500).optional(),
    ...FlujoRef,
  })
  .refine(unSoloFlujo, { message: MSG_UN_SOLO_FLUJO })
  .refine((d) => d.origenTrabajo === "INTERLABORATORIO" || Boolean(d.clienteId), {
    message: "clienteId es obligatorio (salvo en OT Interlaboratorio)",
    path: ["clienteId"],
  });

/** Body de POST /ot/:id/registrar-opi (SVT7). */
const OtRegistrarOpi = z.object({
  numero: z.string().trim().min(1, "Indique el número de OPI").max(60),
  fecha: fechaDia,
});

// `estado` deja de ser texto libre: solo los estados reales de la OT
// (common/estados.ts). La transición la valida `actualizar()`.
const OtUpdate = z
  .object({
    estado: z.enum(estadosValidos("ot") as [string, ...string[]]).optional(),
    prioridad: PrioridadEnum.optional(),
    notas: z.string().optional(),
    // Costo por horas (también en OT sin cobro / interlaboratorio).
    horasHombre: z.number().min(0).optional(),
    costoEstimado: z.number().min(0).optional(),
    /** Fecha comprometida con el cliente (plazos: OT vencidas / por vencer). null la borra. */
    fechaCompromiso: fechaDia.nullable().optional(),
    ...FlujoRef,
  })
  .refine(unSoloFlujo, { message: MSG_UN_SOLO_FLUJO });

/** Body de PATCH /ot/:id/laboratorio. */
const OtCambiarLaboratorio = z.object({
  unidadPrincipalId: z.string().uuid(),
  motivo: z.string().trim().max(500).optional(),
});

/** Body de PUT /ot/:id/analistas: la lista COMPLETA de analistas de la OT. */
const OtAnalistas = z.object({
  usuarioIds: z.array(z.string().uuid()).max(50),
});

/** Body de POST /ot/:id/asignar-ensayos: un analista para muestras o ensayos concretos. */
const OtAsignarEnsayos = z
  .object({
    /** null = quitar la asignación concreta (queda para cualquiera de los asignados a la OT). */
    usuarioId: z.string().uuid().nullable(),
    muestraIds: z.array(z.string().uuid()).max(500).optional(),
    resultadoIds: z.array(z.string().uuid()).max(2000).optional(),
  })
  .refine((d) => (d.muestraIds?.length ?? 0) + (d.resultadoIds?.length ?? 0) > 0, {
    message: "Indique al menos una muestra o un ensayo.",
  });

/** Query de GET /ot/laboratorio-sugerido. */
const csvUuids = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []))
  .pipe(z.array(z.string().uuid()).max(500));
const QuerySugerido = z.object({
  cotizacionId: z.string().uuid().optional(),
  centroCostoId: z.string().uuid().optional(),
  elementoIds: csvUuids,
  metodoIds: csvUuids,
  ensayoIds: csvUuids,
});

/** Body de POST /ot/:id/flujo · adjunta/instancia un flujo en una OT existente. */
const OtAdjuntarFlujo = z
  .object({
    flujoDefId: z.string().uuid().optional(),
    flujoVersionId: z.string().uuid().optional(),
  })
  .refine((d) => Boolean(d.flujoDefId) !== Boolean(d.flujoVersionId), {
    message: "Se requiere exactamente uno de: flujoDefId o flujoVersionId",
  });

/** Usuario de la OT tal como se devuelve a la pantalla. */
type AnalistaOt = { id: string; nombre: string; username?: string; asignadoAt: Date | null; asignadoPor: string | null };

const SELECT_UNIDAD = { select: { id: true, codigo: true, nombre: true, tipo: true } } as const;

@ApiTags("ot")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ot")
export class OtController {
  // FlujoService llega vía OtModule → imports: [FlujoModule] (que lo exporta).
  // AlcanceService llega por AlcanceModule (@Global): acota la OT a las unidades
  // (laboratorios) visibles del usuario según sus asignaciones de rol vigentes.
  // LaboratorioOtService (@Global, LaboratorioOtModule): laboratorio responsable.
  constructor(
    private readonly prisma: PrismaService,
    private readonly flujos: FlujoService,
    private readonly alcance: AlcanceService,
    private readonly labs: LaboratorioOtService,
    private readonly cierre: OtCierreService,
    private readonly alcanceResultado: AlcanceResultadoService,
  ) {}

  /**
   * Lista paginada con búsqueda y filtros en el servidor → `{ data, meta }`.
   *   q / search      · código OT, Nº cotización, resolución, OC, cliente o código del laboratorio
   *   estado          · estado exacto, o `abiertas` (no cerradas/anuladas/finalizadas/informadas)
   *   unidad          · laboratorio (código, p. ej. LQC, o id)
   *   sinLaboratorio  · 1 = solo OT sin laboratorio responsable
   *   mias            · 1 = OT asignadas al usuario (como analista de la OT o de un ensayo)
   *   sinAsignar      · 1 = OT sin ningún analista asignado
   *   semaforo        · plazo contra fecha_compromiso: vencida | por_vencer (hoy a +3 días) |
   *                     en_plazo | sin_fecha (OT no cerradas ni anuladas; «hoy» en Chile; mismos
   *                     cortes que Mi bandeja). `vencidas=1` / `porVencer=1` son alias.
   *   listasCierre    · 1 = documentos oficiales y entregados, resultados aprobados: falta cerrar
   *   sinFactura      · 1 = OT cerradas con cobro sin factura viva (Finanzas)
   *   derivadas       · 1 = suma las OT de otros laboratorios con ensayos derivados por orden
   *                     interna a los suyos (buscador de «Captura y revisión por OT», D02-25)
   *   page / limit    · paginación (limit máx. 200, por defecto 20)
   * Alcance por laboratorio (AlcanceService): un usuario acotado solo ve las OT
   * de sus unidades visibles; global (SUPERADMIN/ADMIN/DIRECTOR…) sin filtro.
   */
  @Get()
  @RequierePermiso("ot.ver")
  async listar(@Query() query: Record<string, string>, @Req() req: any) {
    const tenantId = req?.user?.tenantId;
    const unidadesVisibles = await this.alcance.filtroUnidades(req);
    const { page, limit, skip } = paginacion(query.page, query.limit);
    const si = (v?: string) => v === "1" || v === "true";

    let unidadId: string | null = null;
    if (query.unidad) {
      const esUuid = /^[0-9a-f-]{36}$/i.test(query.unidad);
      const u = await this.prisma.unidad.findFirst({
        where: { ...(tenantId ? { tenantId } : {}), ...(esUuid ? { id: query.unidad } : { codigo: query.unidad }) },
        select: { id: true },
      });
      // Unidad inexistente → lista vacía (no se ignora el filtro en silencio).
      unidadId = u?.id ?? "00000000-0000-0000-0000-000000000000";
    }

    const idsMias = si(query.mias) ? await this.idsOtAsignadas(req?.user?.sub, tenantId) : null;
    const idsConAnalista = si(query.sinAsignar)
      ? (await this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT DISTINCT ot_id AS id FROM ot_analista`)).map((f) => f.id)
      : null;

    const idsListasCierre = si(query.listasCierre) ? await this.cierre.idsListasParaCerrar(tenantId) : null;
    const idsSinFactura = si(query.sinFactura) ? await this.cierre.idsCerradasSinFactura(tenantId) : null;

    // ?derivadas=1 (buscador de la captura): también las OT de otros laboratorios
    // con ensayos derivados por orden interna a los suyos (D02-25). Solo esas
    // OT; dentro, la captura muestra solo los ensayos derivados (alcanceEnOt).
    const idsDerivadas =
      si(query.derivadas) && unidadesVisibles ? await this.alcanceResultado.otsConDerivadosA(unidadesVisibles, tenantId) : null;

    const where = filtroListaOt(
      {
        q: query.q,
        search: query.search,
        estado: query.estado,
        unidadId,
        sinLaboratorio: si(query.sinLaboratorio),
        semaforo: (query.semaforo as any) || null,
        vencidas: si(query.vencidas),
        porVencer: si(query.porVencer),
        idsMias,
        idsConAnalista,
        idsListasCierre,
        idsSinFactura,
      },
      { tenantId, unidadesVisibles, idsDerivadas, hoy: new Date() },
    ) as Prisma.OrdenTrabajoWhereInput;

    const [ots, total] = await Promise.all([
      this.prisma.ordenTrabajo.findMany({
        where,
        skip,
        take: limit,
        // Con filtro de plazo, primero la que vence antes (como la lista de plazos).
        orderBy: semaforoPedido({ semaforo: query.semaforo as any, vencidas: si(query.vencidas), porVencer: si(query.porVencer) })
          ? [{ fechaCompromiso: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }]
          : { createdAt: "desc" },
        include: { cliente: true, unidad: SELECT_UNIDAD },
      }),
      this.prisma.ordenTrabajo.count({ where }),
    ]);

    const ids = ots.map((o) => o.id);
    const [porOtAnalistas, porIdFlujo, situaciones] = await Promise.all([
      this.analistasDe(ids),
      this.flujosDe(ots, tenantId),
      this.situacionesDe(ids),
    ]);

    return {
      data: ots.map((o) => ({
        ...o,
        // Dónde está la OT en su ruta (el estado de la tabla casi no se mueve: D02-21).
        situacion: ["cerrada", "anulada"].includes(o.estado) ? null : situaciones.get(o.id) ?? null,
        analistas: porOtAnalistas.get(o.id) ?? [],
        flujo: o.flujoInstanciaId ? porIdFlujo.get(o.flujoInstanciaId) ?? null : null,
      })),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /**
   * Situación de cada OT abierta de la página según lo que ya tiene (recorrido
   * MP-02, D02-21: la lista decía «recepcionada» con la OT lista para cerrar).
   * Misma secuencia que la Ruta de la OT, resumida en una consulta.
   */
  private async situacionesDe(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const filas = await this.prisma.$queryRawUnsafe<{ id: string; situacion: string }[]>(
      `SELECT o.id,
              CASE
                WHEN NOT EXISTS (SELECT 1 FROM muestra m WHERE m.ot_id = o.id AND m.deleted_at IS NULL) THEN 'por_recepcionar'
                WHEN r.total = 0 THEN 'por_recepcionar'
                WHEN r.por_capturar > 0 THEN 'en_analisis'
                WHEN r.capturados > 0 THEN 'por_revisar'
                WHEN r.revisados > 0 THEN 'por_aprobar'
                WHEN NOT EXISTS (SELECT 1 FROM certificado c WHERE c.ot_id = o.id AND c.deleted_at IS NULL AND c.estado NOT IN ('anulado')) THEN 'por_emitir'
                WHEN EXISTS (SELECT 1 FROM certificado c WHERE c.ot_id = o.id AND c.deleted_at IS NULL AND c.estado IN ('en_firma','devuelto')) THEN 'en_firma'
                WHEN EXISTS (SELECT 1 FROM certificado c WHERE c.ot_id = o.id AND c.deleted_at IS NULL AND c.estado IN ('oficial','emitido') AND c.entregado_at IS NULL) THEN 'por_entregar'
                ELSE 'lista_para_cerrar'
              END AS situacion
         FROM orden_trabajo o
         CROSS JOIN LATERAL (
           SELECT count(*) AS total,
                  count(*) FILTER (WHERE r.estado IN ('pendiente','devuelto','rechazado')) AS por_capturar,
                  count(*) FILTER (WHERE r.estado = 'capturado') AS capturados,
                  count(*) FILTER (WHERE r.estado = 'revisado_n1') AS revisados
             FROM resultado r WHERE r.ot_id = o.id AND r.deleted_at IS NULL) r
        WHERE o.id = ANY($1::uuid[])`,
      ids,
    );
    return new Map(filas.map((f) => [f.id, f.situacion]));
  }

  /** OT donde el usuario figura como analista (de la OT o de un ensayo concreto). */
  private async idsOtAsignadas(usuarioId: string | undefined, tenantId?: string): Promise<string[]> {
    if (!usuarioId) return [];
    const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT oa.ot_id AS id FROM ot_analista oa
         JOIN orden_trabajo o ON o.id = oa.ot_id
        WHERE oa.usuario_id = $1::uuid AND ($2::uuid IS NULL OR o.tenant_id = $2::uuid)
       UNION
       SELECT r.ot_id AS id FROM resultado r
         JOIN orden_trabajo o ON o.id = r.ot_id
        WHERE r.asignado_a = $1::uuid AND r.deleted_at IS NULL AND ($2::uuid IS NULL OR o.tenant_id = $2::uuid)`,
      usuarioId,
      tenantId ?? null,
    );
    return filas.map((f) => f.id);
  }

  /** Analistas asignados por OT (una sola consulta para toda la página). */
  private async analistasDe(otIds: string[]): Promise<Map<string, AnalistaOt[]>> {
    const m = new Map<string, AnalistaOt[]>();
    if (!otIds.length) return m;
    const filas = await this.prisma.$queryRawUnsafe<
      { ot_id: string; id: string; nombre: string; username: string; asignado_at: Date | null; asignado_por: string | null }[]
    >(
      `SELECT oa.ot_id, u.id, u.nombre_completo AS nombre, u.username::text AS username,
              oa.asignado_at, ap.nombre_completo AS asignado_por
         FROM ot_analista oa
         JOIN usuario u ON u.id = oa.usuario_id
         LEFT JOIN usuario ap ON ap.id = oa.asignado_por
        WHERE oa.ot_id = ANY($1::uuid[])
        ORDER BY u.nombre_completo`,
      otIds,
    );
    for (const f of filas) {
      const arr = m.get(f.ot_id) ?? [];
      arr.push({ id: f.id, nombre: f.nombre, username: f.username, asignadoAt: f.asignado_at, asignadoPor: f.asignado_por });
      m.set(f.ot_id, arr);
    }
    return m;
  }

  /**
   * Resumen del flujo activo por OT (estado + paso actual) para pintarlo en la
   * lista sin una llamada por fila. `flujo_instancia_id` es una columna suelta
   * (no hay relación Prisma), así que se resuelve en una segunda consulta,
   * acotada al tenant para no filtrar instancias ajenas.
   */
  private async flujosDe(ots: { flujoInstanciaId: string | null }[], tenantId?: string) {
    const instanciaIds = ots.map((o) => o.flujoInstanciaId).filter((x): x is string => Boolean(x));
    if (!instanciaIds.length) return new Map<string, any>();
    const instancias = await this.prisma.flujoInstancia.findMany({
      where: { id: { in: instanciaIds }, ...(tenantId ? { tenantId } : {}) },
      select: {
        id: true,
        estado: true,
        pasoActual: { select: { numero: true, actividad: true, tipo: true } },
      },
    });
    return new Map<string, any>(instancias.map((i) => [i.id, i]));
  }

  /** Unidades que pueden ser responsables de una OT (selector «Laboratorio responsable»). */
  @Get("laboratorios")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Laboratorios, secciones técnicas, sucursales y delegaciones elegibles como responsables de una OT" })
  laboratorios(@Req() req: any) {
    return this.labs.laboratorios(req?.user?.tenantId);
  }

  /**
   * Laboratorio que el sistema propone para una OT a partir del catálogo:
   * cotización (centro de costo y ensayos), centro de costo ejecutor,
   * elementos o métodos elegidos. `unidad: null` + `motivo` cuando hay que
   * elegirlo a mano (sin pistas, o pistas de laboratorios distintos).
   */
  @Get("laboratorio-sugerido")
  @RequierePermiso("ot.ver")
  async laboratorioSugerido(@Query() query: unknown, @Req() req: any) {
    const q = QuerySugerido.parse(query ?? {});
    const tenantId = req.user?.tenantId ?? DEV_TENANT;
    const d = await this.labs.deducir(tenantId, {
      cotizacionId: q.cotizacionId,
      centroCostoId: q.centroCostoId,
      catElementoIds: q.elementoIds,
      catMetodoIds: q.metodoIds,
      catEnsayoIds: q.ensayoIds,
    });
    return { unidad: d.unidad, motivo: d.motivo, candidatos: d.candidatos, fuentes: d.fuentes };
  }

  /**
   * Estado del flujo de una OT: la instancia (con historial y paso actual) y sus
   * tareas actuales. Reutiliza el motor (`estadoInstancia` + `bandejaDeInstancia`),
   * no lo duplica. Devuelve `{ instancia: null, tareas: [] }` si la OT no tiene
   * flujo, para que la UI ofrezca iniciar uno.
   */
  @Get(":id/flujo")
  @RequierePermiso("ot.ver")
  async flujoDeOt(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId;
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, flujoInstanciaId: true, unidadPrincipal: true },
    });
    if (!ot) throw new NotFoundException(`OT ${id} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${id}`);
    if (!ot.flujoInstanciaId) return { instancia: null, tareas: [] };
    const [instancia, tareas] = await Promise.all([
      this.flujos.estadoInstancia(ot.flujoInstanciaId, tenantId),
      this.flujos.bandejaDeInstancia(ot.flujoInstanciaId, tenantId),
    ]);
    return { instancia, tareas };
  }

  /** Historial de la OT: cambios de laboratorio y asignaciones (quién y cuándo). */
  @Get(":id/historial")
  @RequierePermiso("ot.ver")
  async historial(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.otEnAlcance(id, req);
    return this.prisma.$queryRawUnsafe(
      `SELECT h.id, h.tipo, h.detalle, h.created_at AS "createdAt",
              u.id AS "usuarioId", u.nombre_completo AS "usuarioNombre"
         FROM ot_historial h LEFT JOIN usuario u ON u.id = h.usuario_id
        WHERE h.ot_id = $1::uuid
        ORDER BY h.created_at DESC
        LIMIT 200`,
      id,
    );
  }

  @Get(":id")
  @RequierePermiso("ot.ver")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    // findFirst con tenant compuesto: si la OT es de otro tenant, no se revela (null).
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id, ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}) },
      include: { cliente: true, unidad: SELECT_UNIDAD },
    });
    if (!ot) return ot;
    // Fuera del alcance por unidad → 403 (la OT existe pero no es de sus laboratorios).
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    const [analistas, asignador] = await Promise.all([
      this.analistasDe([ot.id]),
      ot.unidadAsignadaPor
        ? this.prisma.usuario.findUnique({ where: { id: ot.unidadAsignadaPor }, select: { id: true, nombreCompleto: true } })
        : null,
    ]);
    return {
      ...ot,
      analistas: analistas.get(ot.id) ?? [],
      unidadAsignadaPorNombre: asignador?.nombreCompleto ?? null,
    };
  }

  @Post()
  @RequierePermiso("ot.crear")
  async crear(@Body() body: unknown, @Req() req: any) {
    const dto = OtCreate.parse(body);
    const tenantId = req.user?.tenantId ?? DEV_TENANT;

    // Reglas de origen (Comercial R2): datos obligatorios por origen y cobro.
    const origen = dto.origenTrabajo ?? (dto.cotizacionId ? "COTIZACION" : undefined);
    const exigeOficio = sino((await valoresCategoria(this.prisma, tenantId, "ot_institucional")).exige_oficio, true);
    const errores = validarOrigenOt({ ...dto, origen, exigeOficio });
    const cobro = resolverCobro(origen, dto.conCobro);
    if (cobro.error) errores.push(cobro.error);
    if (errores.length) throw new BadRequestException(errores.join(" "));

    // Interlaboratorio sin cliente → el cliente interno de tipo 'interlaboratorio'.
    let clienteId = dto.clienteId;
    if (!clienteId && origen === "INTERLABORATORIO") {
      const interno = await this.prisma.cliente.findFirst({
        where: { tenantId, tipo: "interlaboratorio", deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!interno)
        throw new BadRequestException(
          "No hay un cliente de tipo «Interlaboratorio». Registre el cliente interno (p. ej. IDIC) con ese tipo o indique clienteId.",
        );
      clienteId = interno.id;
    }

    // El cliente debe pertenecer al tenant del solicitante (evita adjuntar clientes de otro tenant).
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId!, tenantId },
      select: { id: true },
    });
    if (!cliente) throw new BadRequestException("clienteId no existe o no pertenece al tenant");

    // Si viene cotización, debe ser del mismo tenant.
    if (dto.cotizacionId) {
      const cot = await this.prisma.cotizacion.findFirst({
        where: { id: dto.cotizacionId, tenantId },
        select: { id: true },
      });
      if (!cot) throw new BadRequestException("cotizacionId no existe o no pertenece al tenant");
    }

    // Centros de costo (lab ejecutor / solicitante) del mismo tenant.
    for (const ccId of [dto.centroCostoId, dto.labSolicitanteCcId]) {
      if (!ccId) continue;
      const cc = await this.prisma.centroCosto.findFirst({ where: { id: ccId, tenantId }, select: { id: true } });
      if (!cc) throw new BadRequestException(`Centro de costo ${ccId} no existe o no pertenece al tenant`);
    }

    // Laboratorio responsable: el indicado o el deducido del catálogo. Sin él
    // la OT no la vería ningún laboratorio → 400 pidiendo elegirlo.
    const unidad = await this.labs.resolverParaAlta(tenantId, dto.unidadPrincipalId, {
      cotizacionId: dto.cotizacionId,
      centroCostoId: dto.centroCostoId,
      catElementoIds: dto.catElementoIds,
      catMetodoIds: dto.catMetodoIds,
    });
    // Quien registra OT con alcance acotado (p. ej. un planificador de un solo
    // laboratorio) no la crea para un laboratorio ajeno: 403. Los perfiles
    // globales (Comercial, Planificación y Control) no cambian.
    await this.alcance.exigirUnidad(req, unidad.id, `el laboratorio ${unidad.codigo}`);

    // Si se adjunta una instancia YA existente, debe ser del mismo tenant
    // (si no, se estaría enganchando el flujo de otro tenant a esta OT).
    if (dto.flujoInstanciaId) await this.validarInstancia(dto.flujoInstanciaId, tenantId);

    // Toda la validación del flujo (tenant, def existe, versión publicada) se
    // resuelve ANTES de crear la OT: si algo falla, no queda una OT a medias.
    const versionId =
      dto.flujoDefId || dto.flujoVersionId
        ? await this.flujos.resolverVersionId(dto, tenantId)
        : null;

    const codigo = await this.generarCodigo(tenantId);
    const opiNumero = dto.opiNumero?.trim() || null;

    const ot = await this.prisma.$transaction(async (tx) => {
      const creada = await tx.ordenTrabajo.create({
        data: {
          tenantId,
          codigo,
          clienteId: cliente.id,
          cotizacionId: dto.cotizacionId ?? null,
          flujoInstanciaId: dto.flujoInstanciaId ?? null,
          prioridad: dto.prioridad ?? "normal",
          estado: "recepcionada",
          fechaRecepcion: instanteFechaIngreso(dto.fechaIngreso) ?? new Date(),
          fechaCompromiso: dto.fechaCompromiso ? new Date(`${dto.fechaCompromiso}T00:00:00Z`) : null,
          notas: dto.notas ?? null,
          descripcionTrabajo: dto.descripcionTrabajo ?? null,
          origenTrabajo: origen ?? null,
          conCobro: cobro.conCobro,
          opiPendiente: calcularOpiPendiente({ origen, conCobro: cobro.conCobro, opiNumero }),
          disposicionRef: dto.disposicionRef?.trim() || null,
          disposicionFecha: dto.disposicionFecha ? new Date(`${dto.disposicionFecha}T00:00:00Z`) : null,
          ...(opiNumero
            ? { opiNumero, opiFecha: dto.opiFecha ? new Date(`${dto.opiFecha}T00:00:00Z`) : null, opiRegistradaAt: new Date() }
            : {}),
          numeroLey: dto.resolucion?.trim() || null,
          centroCostoId: dto.centroCostoId ?? null,
          labSolicitanteCcId: dto.labSolicitanteCcId ?? null,
          horasHombre: dto.horasHombre ?? 0,
          costoEstimado: dto.costoEstimado ?? 0,
          tipoTrabajo: dto.tipoTrabajo ?? null,
        },
      });
      // Datos del encargo que se conocen al registrar (frente r4d, ot_encargo).
      if (dto.oficioNumero || dto.oficioFecha || dto.laboratoriosIntervienen?.length || dto.nivelTecnologico || dto.requiereMuestreo !== undefined)
        await tx.$executeRawUnsafe(
          `INSERT INTO ot_encargo (ot_id, tenant_id, oficio_numero, oficio_fecha, laboratorios, nivel_tecnologico, requiere_muestreo, actualizado_por)
           VALUES ($1::uuid, $2::uuid, $3, $4::date, $5::uuid[], $6, $7, $8::uuid)`,
          creada.id,
          tenantId,
          dto.oficioNumero?.trim() || null,
          dto.oficioFecha ?? null,
          dto.laboratoriosIntervienen ?? [],
          dto.nivelTecnologico ?? null,
          dto.requiereMuestreo ?? null,
          req?.user?.sub ?? null,
        );
      await this.labs.fijar(tx, {
        tenantId,
        otId: creada.id,
        unidad,
        usuarioId: req.user?.sub,
        origen: dto.unidadPrincipalId ? "alta_indicado" : "alta_deducido",
      });
      return creada;
    });

    if (!versionId) return this.otConCliente(ot.id);

    // La OT ya existe → se instancia el flujo con su otId y se cierra el enlace
    // inverso (orden_trabajo.flujo_instancia_id). Ambos extremos quedan ligados.
    return this.instanciarYEnlazar(ot.id, versionId, tenantId, req);
  }

  private otConCliente(id: string) {
    return this.prisma.ordenTrabajo.findUnique({
      where: { id },
      include: { cliente: true, unidad: SELECT_UNIDAD },
    });
  }

  /** OT del tenant y dentro del alcance del usuario (404 / 403). */
  private async otEnAlcance(id: string, req: any) {
    const tenantId = req.user?.tenantId;
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, codigo: true, tenantId: true, estado: true, unidadPrincipal: true },
    });
    if (!ot) throw new NotFoundException(`OT ${id} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    return ot;
  }

  /**
   * Fija o cambia el laboratorio responsable (jefatura, planificación,
   * administración: `ot.cambiar_laboratorio`). Quien lo hace debe ver la OT
   * en su alcance. Cambiarlo exige motivo y deja constancia en el historial.
   * Las asignaciones de analistas del laboratorio anterior se retiran: ese
   * personal ya no ve la OT.
   */
  @Patch(":id/laboratorio")
  @RequierePermiso("ot.cambiar_laboratorio")
  async cambiarLaboratorio(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = OtCambiarLaboratorio.parse(body ?? {});
    const ot = await this.otEnAlcance(id, req);
    if (["cerrada", "anulada"].includes(ot.estado))
      throw new BadRequestException(`La OT está ${ot.estado}: no se puede cambiar su laboratorio.`);
    const destino = await this.labs.validarUnidad(ot.tenantId, dto.unidadPrincipalId);
    if (ot.unidadPrincipal === destino.id)
      throw new BadRequestException(`La OT ya es responsabilidad de ${destino.codigo}.`);
    const anterior: UnidadResumen | null = ot.unidadPrincipal
      ? await this.prisma.unidad.findUnique({ where: { id: ot.unidadPrincipal }, ...SELECT_UNIDAD })
      : null;
    if (anterior && (dto.motivo ?? "").length < 5)
      throw new BadRequestException("Indique el motivo del cambio de laboratorio (mínimo 5 caracteres).");

    await this.prisma.$transaction(async (tx) => {
      const quitados = anterior
        ? await tx.$queryRawUnsafe<{ usuario_id: string }[]>(`DELETE FROM ot_analista WHERE ot_id = $1::uuid RETURNING usuario_id`, id)
        : [];
      if (anterior)
        await tx.$executeRawUnsafe(`UPDATE resultado SET asignado_a = NULL WHERE ot_id = $1::uuid AND asignado_a IS NOT NULL`, id);
      await this.labs.fijar(tx, {
        tenantId: ot.tenantId,
        otId: id,
        unidad: destino,
        anterior,
        usuarioId: req.user?.sub,
        motivo: dto.motivo ?? null,
        origen: anterior ? "cambio" : "asignacion_inicial",
      });
      if (quitados.length)
        await this.labs.anotar(tx, {
          tenantId: ot.tenantId,
          otId: id,
          tipo: "desasignacion",
          usuarioId: req.user?.sub,
          detalle: { motivo: "cambio de laboratorio", usuarios: quitados.map((q) => q.usuario_id) },
        });
    });
    // Quien la movió puede quedarse sin verla (otro laboratorio): se devuelve
    // el resumen sin volver a exigir alcance.
    return this.otConCliente(id);
  }

  /**
   * Asignación de la OT: analistas asignados, personal del laboratorio que se
   * puede asignar, y muestras con sus ensayos (y a quién está cada uno).
   */
  @Get(":id/asignacion")
  @RequierePermiso("ot.ver")
  async asignacion(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const ot = await this.otEnAlcance(id, req);
    const [analistas, personal, muestras, resultados] = await Promise.all([
      this.analistasDe([id]),
      ot.unidadPrincipal ? this.labs.personalDeUnidad(ot.unidadPrincipal) : Promise.resolve([]),
      this.prisma.muestra.findMany({
        where: { otId: id, deletedAt: null },
        select: { id: true, codigo: true, nombre: true, estado: true },
        orderBy: { codigo: "asc" },
      }),
      this.prisma.resultado.findMany({
        where: { otId: id, deletedAt: null },
        select: {
          id: true,
          muestraId: true,
          estado: true,
          asignadoA: true,
          catAnalito: { select: { codigo: true, nombre: true } },
          catMetodo: { select: { codigo: true, nombre: true } },
          analito: { select: { codigo: true, nombre: true } },
        },
        orderBy: { fecha: "asc" },
      }),
    ]);
    const asignados = analistas.get(id) ?? [];
    const nombres = new Map<string, string>([
      ...personal.map((p) => [p.id, p.nombre] as [string, string]),
      ...asignados.map((a) => [a.id, a.nombre] as [string, string]),
    ]);
    const permisos: string[] = req.user?.permisos ?? [];
    const roles: string[] = req.user?.roles ?? [];
    return {
      ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado, unidadPrincipal: ot.unidadPrincipal },
      puedeAsignar: roles.includes("SUPERADMIN") || permisos.includes("ot.asignar"),
      analistas: asignados,
      personal,
      muestras: muestras.map((m) => ({
        ...m,
        ensayos: resultados
          .filter((r) => r.muestraId === m.id)
          .map((r) => ({
            resultadoId: r.id,
            estado: r.estado,
            analito: r.catAnalito?.nombre ?? r.analito?.nombre ?? r.catAnalito?.codigo ?? r.analito?.codigo ?? "—",
            metodo: r.catMetodo?.nombre ?? r.catMetodo?.codigo ?? null,
            asignadoA: r.asignadoA,
            asignadoNombre: r.asignadoA ? nombres.get(r.asignadoA) ?? null : null,
          })),
      })),
    };
  }

  /**
   * Fija la lista COMPLETA de analistas de la OT (añade y quita). Solo personal
   * con rol vigente en el laboratorio responsable. Quitar a alguien libera los
   * ensayos que tenía asignados en esta OT.
   */
  @Put(":id/analistas")
  @RequierePermiso("ot.asignar")
  async fijarAnalistas(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = OtAnalistas.parse(body ?? {});
    const ot = await this.otEnAlcance(id, req);
    if (!ot.unidadPrincipal)
      throw new BadRequestException("La OT no tiene laboratorio responsable: fíjelo antes de asignar analistas.");
    if (["cerrada", "anulada"].includes(ot.estado)) throw new BadRequestException(`La OT está ${ot.estado}.`);

    const pedidos = [...new Set(dto.usuarioIds)];
    const personal = await this.labs.personalDeUnidad(ot.unidadPrincipal);
    const delLab = new Set(personal.map((p) => p.id));
    if (pedidos.some((u) => !delLab.has(u)))
      throw new BadRequestException(
        "Solo se puede asignar personal con rol vigente en el laboratorio responsable de la OT (analista, técnico, metrólogo, inspector, revisor o jefe).",
      );

    const actuales = (await this.analistasDe([id])).get(id)?.map((a) => a.id) ?? [];
    const agregar = pedidos.filter((u) => !actuales.includes(u));
    const quitar = actuales.filter((u) => !pedidos.includes(u));
    const yo = req.user?.sub ?? null;

    await this.prisma.$transaction(async (tx) => {
      for (const u of agregar)
        await tx.$executeRawUnsafe(
          `INSERT INTO ot_analista (tenant_id, ot_id, usuario_id, asignado_por, asignado_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, now()) ON CONFLICT (ot_id, usuario_id) DO NOTHING`,
          ot.tenantId, id, u, yo,
        );
      if (quitar.length) {
        await tx.$executeRawUnsafe(`DELETE FROM ot_analista WHERE ot_id = $1::uuid AND usuario_id = ANY($2::uuid[])`, id, quitar);
        await tx.$executeRawUnsafe(
          `UPDATE resultado SET asignado_a = NULL WHERE ot_id = $1::uuid AND asignado_a = ANY($2::uuid[])`,
          id, quitar,
        );
      }
      if (agregar.length)
        await this.labs.anotar(tx, { tenantId: ot.tenantId, otId: id, tipo: "asignacion", usuarioId: yo, detalle: { usuarios: agregar } });
      if (quitar.length)
        await this.labs.anotar(tx, { tenantId: ot.tenantId, otId: id, tipo: "desasignacion", usuarioId: yo, detalle: { usuarios: quitar } });
    });
    return this.asignacion(id, req);
  }

  /**
   * Asigna muestras completas o ensayos concretos a un analista (o lo quita con
   * `usuarioId: null`). El analista queda además asignado a la OT, para que la
   * vea en «Mis OT». Los ensayos ya aprobados no se reasignan.
   */
  @Post(":id/asignar-ensayos")
  @RequierePermiso("ot.asignar")
  async asignarEnsayos(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = OtAsignarEnsayos.parse(body ?? {});
    const ot = await this.otEnAlcance(id, req);
    if (!ot.unidadPrincipal)
      throw new BadRequestException("La OT no tiene laboratorio responsable: fíjelo antes de asignar.");
    if (dto.usuarioId) {
      const personal = await this.labs.personalDeUnidad(ot.unidadPrincipal);
      if (!personal.some((p) => p.id === dto.usuarioId))
        throw new BadRequestException("La persona elegida no tiene rol vigente en el laboratorio responsable de la OT.");
    }
    const yo = req.user?.sub ?? null;
    const actualizados = await this.prisma.$transaction(async (tx) => {
      const n = await tx.$executeRawUnsafe(
        `UPDATE resultado SET asignado_a = $2::uuid
          WHERE ot_id = $1::uuid AND deleted_at IS NULL AND estado <> 'aprobado'
            AND (muestra_id = ANY($3::uuid[]) OR id = ANY($4::uuid[]))`,
        id, dto.usuarioId, dto.muestraIds ?? [], dto.resultadoIds ?? [],
      );
      if (dto.usuarioId)
        await tx.$executeRawUnsafe(
          `INSERT INTO ot_analista (tenant_id, ot_id, usuario_id, asignado_por, asignado_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, now()) ON CONFLICT (ot_id, usuario_id) DO NOTHING`,
          ot.tenantId, id, dto.usuarioId, yo,
        );
      await this.labs.anotar(tx, {
        tenantId: ot.tenantId,
        otId: id,
        tipo: "asignacion_ensayo",
        usuarioId: yo,
        detalle: { usuario: dto.usuarioId, muestras: dto.muestraIds ?? [], ensayos: dto.resultadoIds ?? [], actualizados: n },
      });
      return n;
    });
    return { actualizados, ...(await this.asignacion(id, req)) };
  }

  /**
   * SVT7 · registra la OPI de una OT creada por disposición del Director:
   * guarda número y fecha y LIMPIA `opi_pendiente`. Se permite también en una
   * OT que no la tenía pendiente (corrección / registro tardío).
   */
  @Post(":id/registrar-opi")
  @RequierePermiso("ot.crear")
  async registrarOpi(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = OtRegistrarOpi.parse(body ?? {});
    const tenantId = req.user?.tenantId ?? DEV_TENANT;
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id, tenantId }, select: { id: true, estado: true } });
    if (!ot) throw new NotFoundException(`OT ${id} no encontrada`);
    if (ot.estado === "anulada") throw new BadRequestException("La OT está anulada.");
    return this.prisma.ordenTrabajo.update({
      where: { id },
      data: {
        opiNumero: dto.numero,
        opiFecha: new Date(`${dto.fecha}T00:00:00Z`),
        opiRegistradaAt: new Date(),
        opiPendiente: false,
        updatedAt: new Date(),
      },
      include: { cliente: true, unidad: SELECT_UNIDAD },
    });
  }

  /**
   * Adjunta un flujo a una OT existente: instancia la versión (publicada, del
   * mismo tenant) y la asocia a la OT.
   */
  @Post(":id/flujo")
  @RequierePermiso("ot.crear")
  async adjuntarFlujo(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const dto = OtAdjuntarFlujo.parse(body);
    const tenantId = req.user?.tenantId ?? DEV_TENANT;

    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id, tenantId },
      select: { id: true, flujoInstanciaId: true, unidadPrincipal: true },
    });
    if (!ot) throw new NotFoundException(`OT ${id} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${id}`);
    // No se pisa un flujo en curso: dejaría la instancia anterior huérfana.
    if (ot.flujoInstanciaId)
      throw new BadRequestException("La OT ya tiene un flujo asociado");

    const versionId = await this.flujos.resolverVersionId(dto, tenantId);
    return this.instanciarYEnlazar(ot.id, versionId, tenantId, req);
  }

  /** Instancia `versionId` para `otId` y enlaza la instancia en la OT. */
  private async instanciarYEnlazar(otId: string, versionId: string, tenantId: string, req: any) {
    const instancia = await this.flujos.instanciar(
      versionId,
      { otId, usuarioId: req.user?.sub },
      tenantId,
    );
    return this.prisma.ordenTrabajo.update({
      where: { id: otId },
      data: { flujoInstanciaId: instancia.id },
      include: { cliente: true, unidad: SELECT_UNIDAD },
    });
  }

  /** La instancia debe existir y pertenecer al tenant del solicitante. */
  private async validarInstancia(instanciaId: string, tenantId: string) {
    const ins = await this.prisma.flujoInstancia.findFirst({
      where: { id: instanciaId, tenantId },
      select: { id: true },
    });
    if (!ins)
      throw new BadRequestException("flujoInstanciaId no existe o no pertenece al tenant");
  }

  /**
   * `ot.crear` cubre la edición. El cierre de la OT es un acto distinto y más
   * restrictivo: si el PATCH lleva `estado: 'cerrada'` se exige además
   * `ot.cerrar` (SUPERADMIN, ADMIN, DIRECTOR). Es la separación de deberes que
   * pide la 17025 y la razón de que ese permiso exista en el RBAC sembrado.
   * El laboratorio responsable NO se cambia aquí: PATCH /ot/:id/laboratorio.
   */
  @Patch(":id")
  @RequierePermiso("ot.crear")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = OtUpdate.parse(body);
    const tenantId = req.user?.tenantId;
    // Verifica existencia + pertenencia al tenant antes de actualizar.
    const actual = await this.prisma.ordenTrabajo.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, flujoInstanciaId: true, estado: true, unidadPrincipal: true },
    });
    if (!actual) throw new NotFoundException(`OT ${id} no encontrada`);
    await this.alcance.exigirUnidad(req, actual.unidadPrincipal, `la OT ${id}`);

    if (dto.estado !== undefined) {
      if (dto.estado === "cerrada") {
        this.exigeCerrar(req);
        // El cierre exige documentos oficiales y entregados y genera la factura:
        // va por POST /ot/:id/cerrar (ot-cierre.controller.ts), no por el PATCH.
        throw new BadRequestException("Para cerrar la OT use «Cerrar OT» (POST /ot/:id/cerrar).");
      }
      validarTransicion("ot", actual.estado, dto.estado);
    }

    // Los campos de flujo no son columnas: se separan de los datos escalares.
    const { flujoInstanciaId, flujoDefId, flujoVersionId, fechaCompromiso, ...campos } = dto;
    const pideFlujo = Boolean(flujoDefId || flujoVersionId);

    if (pideFlujo && actual.flujoInstanciaId)
      throw new BadRequestException("La OT ya tiene un flujo asociado");
    if (flujoInstanciaId) await this.validarInstancia(flujoInstanciaId, tenantId ?? DEV_TENANT);

    // Se valida el flujo antes de tocar la OT (mismo criterio que en crear).
    const versionId = pideFlujo
      ? await this.flujos.resolverVersionId({ flujoDefId, flujoVersionId }, tenantId)
      : null;

    const ot = await this.prisma.ordenTrabajo.update({
      where: { id },
      data: {
        ...campos,
        ...(fechaCompromiso !== undefined
          ? { fechaCompromiso: fechaCompromiso ? new Date(`${fechaCompromiso}T00:00:00Z`) : null }
          : {}),
        ...(flujoInstanciaId ? { flujoInstanciaId } : {}),
        updatedAt: new Date(),
      },
      include: { cliente: true, unidad: SELECT_UNIDAD },
    });

    if (!versionId) return ot;
    return this.instanciarYEnlazar(id, versionId, tenantId ?? DEV_TENANT, req);
  }

  /**
   * Cerrar una OT exige `ot.cerrar` además del `ot.crear` de la ruta.
   * SUPERADMIN mantiene el bypass, igual que en PermisoGuard.
   */
  private exigeCerrar(req: any) {
    const roles: string[] = req.user?.roles ?? [];
    if (roles.includes("SUPERADMIN")) return;
    const permisos: string[] = req.user?.permisos ?? [];
    if (!permisos.includes("ot.cerrar")) {
      throw new ForbiddenException("Permiso insuficiente. Requiere: ot.cerrar");
    }
  }

  /**
   * Genera 'OT-2026-NNNN' con secuencia por tenant y año (UNIQUE(tenant_id, codigo)).
   * La lógica vive ahora en `common/codigo.ts` para que `POST /cotizaciones/:id/aceptar`
   * cree la OT con el mismo correlativo. Se conserva el método como envoltorio.
   */
  private async generarCodigo(tenantId: string): Promise<string> {
    return generarCodigoOt(this.prisma, tenantId);
  }
}
