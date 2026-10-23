import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors, ParseUUIDPipe, BadRequestException } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { MAX_BYTES_ADJUNTO, cabecerasAdjunto, type ArchivoAdjunto } from "../common/adjuntos";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { z } from "zod";
import { CotizacionService } from "./cotizacion.service";
import { hoyEnChile } from "./validez";
import { CosteoService } from "./costeo.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { estadosValidos } from "../common/estados";
import { TIPOS_ACEPTACION } from "../ot/reglas-ot";
import { PERMISO_ACEPTAR, PERMISO_ANULAR } from "./permisos-cotizacion";
import { exigirCotizacionEnAlcance } from "./alcance-cotizacion";
import { AlcanceService } from "../rbac/alcance.service";
import { PrismaService } from "../common/prisma.service";
import { leerConfigCircuito } from "./circuito-config";

const CosteoSchema = z.object({
  lineas: z
    .array(
      z.object({
        tipo: z.enum([
          "viatico",
          "hora_hombre_civil",
          "hora_hombre_militar",
          "hora_maquina",
          "pasaje",
          "insumo",
          "otros",
        ]),
        descripcion: z.string().optional(),
        cantidad: z.number().nonnegative(),
        valorUnitario: z.number().nonnegative(),
      }),
    )
    .min(1),
  cfaPct: z.number().min(0).max(100).optional(),
  margenParticularPct: z.number().min(0).max(100).optional(),
  ivaPct: z.number().min(0).max(100).optional(),
  redondeoClp: z.number().min(0).optional(),
});

const TasaSchema = z.object({
  cifDivisa: z.number().positive(),
  paridad: z.number().positive(),
  divisa: z.string().optional(),
  tasaPct: z.number().min(0).max(100).optional(),
  ivaPct: z.number().min(0).max(100).optional(),
});

/**
 * Línea de cotización. R1: la línea es un ENSAYO del catálogo (código EN,
 * `catEnsayoId`) valorizado por su ficha de costos → `precioUnitario` es
 * opcional (lo pone el backend desde cat_ensayo.precio). Las líneas libres
 * (HH/HM/viático/…) se siguen aceptando por compatibilidad, aunque la UI ya
 * no las ofrece; 'extension' sigue en el enum solo por datos heredados.
 */
const LineaSchema = z
  .object({
    tipo: z.enum(["producto", "viatico", "pasaje", "hora_hombre", "hora_maquina", "otros", "extension"]).optional(),
    catEnsayoId: z.string().uuid().optional(),
    descripcion: z.string().max(2000).optional(),
    categoria: z.string().max(80).optional(),
    cantidad: z.number().int().positive().default(1),
    diasOHoras: z.number().optional(),
    precioUnitario: z.number().positive().optional(),
    tramo: z.string().max(200).optional(),
    // Compatibilidad: el descuento por línea ya no existe (R1); solo se admite 0.
    descuentoPct: z.number().min(0).max(0, "La cotización no admite descuento (decisión Comercial R1).").optional(),
  })
  .refine((l) => l.catEnsayoId || l.precioUnitario, {
    message: "Cada línea debe indicar el ensayo del catálogo (catEnsayoId) o un precioUnitario.",
  });

const fecha = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Fecha AAAA-MM-DD"), z.date()]);

/** Campos editables de cabecera (crear y editar). */
const Cabecera = {
  plantaId: z.string().uuid().optional(),
  centroCostoId: z.string().uuid().nullable().optional(),
  // R1: solo NORMAL y PERSONALIZADO (F1–F4 quedan en el histórico).
  formato: z.enum(["NORMAL", "PERSONALIZADO"]),
  // R1: «Contado 30 días» / «Por adelantado» (códigos de parametro_sistema forma_pago).
  formaPago: z.string().max(80).nullable().optional(),
  medioEnvio: z.string().max(40).nullable().optional(),
  moneda: z.enum(["CLP", "USD"]).default("CLP"),
  dolarValor: z.number().positive().nullable().optional(),
  dolarFecha: fecha.nullable().optional(),
  dolarMotivo: z.string().max(500).nullable().optional(),
  referencia: z.string().max(300).nullable().optional(),
  descripcionTecnica: z.string().max(20000).nullable().optional(),
  condicionesAdicionales: z.string().max(2000, "Condiciones adicionales: máximo 2000 caracteres.").nullable().optional(),
  // Plazo de entrega comprometido (días corridos desde la recepción): fija la
  // fecha de compromiso de la OT que nace al aceptar (docs/FLUJO_FIRMA_CIERRE.md §4).
  plazoEntregaDias: z.number().int().min(1, "Plazo de entrega: mínimo 1 día.").max(730, "Plazo de entrega: máximo 730 días.").nullable().optional(),
  observacionesInternas: z.string().max(20000).nullable().optional(),
  notas: z.string().nullable().optional(),
  // GAP-CHECK SIS_COMERCIAL: la cotización del legacy es IVA EXENTO y sin gastos
  // administrativos (ADM/imprimir.php:337) → defaults 0.
  gastosAdminPct: z.number().min(0).max(100).default(0),
  ivaPct: z.number().min(0).max(100).default(0),
  // R1: SIN descuento. Se admite el campo (solo 0) para no romper llamadores.
  descuentoPct: z.number().min(0).max(0, "La cotización no admite descuento (decisión Comercial R1).").optional(),
  // La validez es AUTOMÁTICA (IT DCO-PG01-P01-IT02); `validezDias` se ignora.
  validezDias: z.number().int().positive().optional(),
  // EP-01/02 0.1 (BL-210): solicitante y documento con que el cliente pidió el servicio.
  solicitud: z
    .object({
      solicitanteContactoId: z.string().uuid().nullable().optional(),
      solicitanteNombre: z.string().trim().max(160).nullable().optional(),
      solicitudMedio: z.enum(["oficio", "correo"]).nullable().optional(),
      solicitudNumero: z.string().trim().max(80).nullable().optional(),
      solicitudFecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").nullable().optional(),
    })
    .optional(),
};

const CrearCotSchema = z
  .object({
    clienteId: z.string().uuid(),
    ...Cabecera,
    // EP-00 0.3 (BL-173): cotización creada desde una oportunidad del CRM.
    oportunidadId: z.string().uuid().optional(),
    fechaEmision: fecha.optional(),
    lineas: z.array(LineaSchema).min(1),
  })
  .refine((d) => d.moneda !== "USD" || (d.dolarValor ?? 0) > 0, {
    message: "Cotización en USD: indique el valor del dólar del día (dolarValor).",
    path: ["dolarValor"],
  });

// El estado ya no es texto libre: solo los estados reales del dominio
// (common/estados.ts). La transición concreta la valida el servicio, y la
// aceptación/anulación van por sus endpoints (exigen documento / motivo).
const ActualizarCotSchema = z.object({
  estado: z.enum(estadosValidos("cotizacion") as [string, ...string[]]).optional(),
  ...Cabecera,
  formato: Cabecera.formato.optional(),
  moneda: z.enum(["CLP", "USD"]).optional(),
  gastosAdminPct: z.number().min(0).max(100).optional(),
  ivaPct: z.number().min(0).max(100).optional(),
  lineas: z.array(LineaSchema).min(1).optional(),
});

/** SVT6 · documento de aceptación (IDIC-PG03 6.3 n / 6.4 g). */
const AceptarSchema = z.object({
  tipo: z.enum(TIPOS_ACEPTACION).optional(),
  numero: z.string().max(60).optional(),
  fecha: fecha.optional(),
  adjunto: z.string().max(300).optional(),
  conCobro: z.boolean().default(true),
  /** Laboratorio responsable de la OT (obligatorio si no se deduce del centro de costo / ensayos). */
  unidadPrincipalId: z.string().uuid().optional(),
  /** EP-00 4.2: monto de la O/C y discrepancia con la cotización. */
  montoOc: z.number().nonnegative().optional(),
  discrepancia: z.string().trim().max(2000).optional(),
  /** EP-00 4.1: documento de aceptación ya subido como adjunto. */
  adjuntoId: z.string().uuid().optional(),
});

const AnularOrdenSchema = z.object({
  numero: z.string().trim().min(1, "Indique el Nº de la orden del cliente.").max(60),
  montoOc: z.number().nonnegative().optional(),
  motivo: z.string().trim().min(5, "Indique el motivo (mínimo 5 caracteres).").max(2000),
});

const AnularSchema = z.object({
  motivo: z.string().trim().min(3, "Indique el motivo de la anulación.").max(1000),
});

@ApiTags("cotizaciones")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("cotizaciones")
export class CotizacionController {
  constructor(
    private readonly svc: CotizacionService,
    private readonly costeo: CosteoService,
    private readonly alcance: AlcanceService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Escrituras sobre una cotización existente (frente L · C2): la cotización
   * tiene que estar en el alcance de un rol que conceda el permiso de la ruta
   * (alcance-cotizacion.ts). 404 si no existe en el tenant.
   */
  private async exigirCotizacion(req: any, id: string) {
    await exigirCotizacionEnAlcance(this.prisma, this.alcance, req, id);
  }

  /**
   * Costeo Ejército: CDT → CFA → CT → 3 precios. No persiste; sirve al simulador.
   * Exige `cotizacion.crear` (no `.ver`): es la herramienta de quien cotiza, y un
   * rol de solo lectura no tiene por qué ejecutar el costeo.
   */
  @Post("costeo")
  @RequierePermiso("cotizacion.crear")
  async calcularCosteo(@Body() body: unknown, @Req() req: any) {
    const { lineas, ...params } = CosteoSchema.parse(body);
    // Sin porcentajes en la petición rigen los de Administración › Parámetros (fórmula oficial 2026).
    const cfg = await leerConfigCircuito(this.prisma, req?.user?.tenantId);
    return this.costeo.calcular(lineas, { cfaPct: cfg.cfaPct, margenParticularPct: cfg.margenParticularPct, ivaPct: cfg.ivaPct, ...params });
  }

  /** Tasa de internación 1,5% (servicios ligados a importación). */
  @Post("tasa-internacion")
  @RequierePermiso("cotizacion.crear")
  calcularTasa(@Body() body: unknown) {
    const { cifDivisa, paridad, ...opts } = TasaSchema.parse(body);
    return this.costeo.tasaInternacion(cifDivisa, paridad, opts);
  }

  /**
   * Configuración del formulario de cotización: combos activos (tipo de cliente,
   * forma de pago, formato, moneda, medio de envío, documento de aceptación…),
   * centros de costo agrupados («Laboratorios» / «Sucursales y Delegación BPCH»)
   * con su texto base y validez propia, y los parámetros de validez.
   */
  @Get("config")
  @RequierePermiso("cotizacion.ver")
  @ApiOperation({ summary: "Combos y centros de costo del formulario de cotización" })
  config(@Req() req: any) {
    return this.svc.config(req?.user?.tenantId);
  }

  /** Vista previa de la validez automática (IT DCO-PG01-P01-IT02). */
  @Get("validez")
  @RequierePermiso("cotizacion.ver")
  @ApiOperation({ summary: "Calcula 'válida hasta' para ?clienteId=&centroCostoId=&fecha=" })
  async validez(
    @Query("clienteId") clienteId: string,
    @Query("centroCostoId") centroCostoId: string | undefined,
    @Query("fecha") fechaQ: string | undefined,
    @Req() req: any,
  ) {
    const uuid = z.string().uuid();
    if (!uuid.safeParse(clienteId).success) throw new BadRequestException("clienteId (uuid) es obligatorio");
    if (centroCostoId && !uuid.safeParse(centroCostoId).success) throw new BadRequestException("centroCostoId inválido");
    if (fechaQ && !/^\d{4}-\d{2}-\d{2}$/.test(fechaQ)) throw new BadRequestException("fecha debe ser AAAA-MM-DD");
    const tenantId = req?.user?.tenantId;
    return this.svc.calcularValidezPara(tenantId, clienteId, centroCostoId || null, fechaQ || hoyEnChile());
  }

  /**
   * Precio de cada ensayo para el cliente según la lista de precios vigente
   * (neto para un particular) o la ficha de costos: vista previa del formulario.
   * ?clienteId=&ids=uuid,uuid&fecha=AAAA-MM-DD
   */
  @Get("precios-ensayo")
  @RequierePermiso("cotizacion.ver")
  @ApiOperation({ summary: "Precio de los ensayos para un cliente: lista de precios vigente o ficha" })
  async preciosEnsayo(
    @Query("clienteId") clienteId: string,
    @Query("ids") idsQ: string | undefined,
    @Query("fecha") fechaQ: string | undefined,
    @Req() req: any,
  ) {
    const uuid = z.string().uuid();
    if (!uuid.safeParse(clienteId).success) throw new BadRequestException("clienteId (uuid) es obligatorio");
    const ids = [...new Set(String(idsQ ?? "").split(",").map((x) => x.trim()).filter(Boolean))];
    if (ids.length > 200) throw new BadRequestException("Máximo 200 ensayos por consulta.");
    if (ids.some((x) => !uuid.safeParse(x).success)) throw new BadRequestException("ids: lista de uuid separados por coma");
    if (fechaQ && !/^\d{4}-\d{2}-\d{2}$/.test(fechaQ)) throw new BadRequestException("fecha debe ser AAAA-MM-DD");
    return this.svc.preciosEnsayo(req?.user?.tenantId, clienteId, ids, fechaQ || undefined);
  }

  /**
   * Lista paginada con búsqueda en el servidor → `{ data, meta, conteos }`.
   * q (N°, cliente o referencia) · estado (o `historico`) · sinOt=1 · porVencer=1 · page · limit.
   */
  @Get()
  @RequierePermiso("cotizacion.ver")
  listar(@Query() query: Record<string, string>, @Req() req: any) {
    return this.svc.listar(req?.user?.tenantId, query ?? {});
  }

  @Get(":id")
  @RequierePermiso("cotizacion.ver")
  detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(id, req?.user?.tenantId);
  }

  @Post()
  @RequierePermiso("cotizacion.crear")
  crear(@Body() body: unknown, @Req() req: any) {
    const data = CrearCotSchema.parse(body);
    return this.svc.crear(data as any, req?.user?.tenantId, req?.user?.sub);
  }

  /** Editar: el contenido solo mientras la cotización está Abierta. */
  @Patch(":id")
  @RequierePermiso("cotizacion.crear")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigirCotizacion(req, id);
    const data = ActualizarCotSchema.parse(body);
    return this.svc.actualizar(id, data as any, req?.user?.tenantId);
  }

  /**
   * "Eliminar" = anular (estado 'anulada'); no hay borrado físico (referenciada por OT).
   * Alias de POST /:id/anular (sin motivo) por compatibilidad: mismo permiso,
   * `cotizacion.anular` (Sección Ventas + quienes tenían cotizacion.aprobar).
   */
  @Delete(":id")
  @RequierePermiso(PERMISO_ANULAR)
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.exigirCotizacion(req, id);
    return this.svc.anular(id, req?.user?.tenantId);
  }

  /**
   * R1 · Abierta → Anulada, con motivo obligatorio. La registra la Sección Ventas
   * (el cliente desiste, error de emisión…) → `cotizacion.anular`.
   */
  @Post(":id/anular")
  @RequierePermiso(PERMISO_ANULAR)
  async anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigirCotizacion(req, id);
    const { motivo } = AnularSchema.parse(body ?? {});
    return this.svc.anular(id, req?.user?.tenantId, motivo);
  }

  /** Histórico: borrador → enviada (las nuevas nacen Abiertas y no pasan por aquí). */
  @Post(":id/enviar")
  @RequierePermiso("cotizacion.crear")
  async enviar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.exigirCotizacion(req, id);
    return this.svc.cambiarEstado(id, "enviada", req?.user?.tenantId);
  }

  /**
   * Registrar aceptación (docs/COMERCIAL_RONDA2.md): la Sección Ventas registra el
   * documento con que el cliente acepta (OC, OPI/resolución, correo, pago
   * adelantado, disposición del Director) y con ello nace la OT →
   * `cotizacion.aceptar` (separado de `cotizacion.aprobar`, que el rol COMERCIAL
   * no tiene). Una cotización fuera de validez → 409 «venció el …».
   * Body: { tipo, numero?, fecha?, adjunto?, conCobro } (SVT6). Con
   * DISPOSICION_DIRECTOR y conCobro=true la OT queda con OPI pendiente (SVT7).
   */
  @Post(":id/aceptar")
  @RequierePermiso(PERMISO_ACEPTAR)
  async aceptar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigirCotizacion(req, id);
    const doc = AceptarSchema.parse(body ?? {});
    return this.svc.aceptar(id, req?.user?.tenantId, doc, req?.user?.sub);
  }

  /** «Anular orden del cliente» (EP-00 4.2): la O/C no corresponde; la cotización sigue Abierta. */
  @Post(":id/anular-orden-cliente")
  @RequierePermiso(PERMISO_ACEPTAR)
  async anularOrdenCliente(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigirCotizacion(req, id);
    return this.svc.anularOrdenCliente(id, req?.user?.tenantId, AnularOrdenSchema.parse(body ?? {}), req?.user?.sub);
  }

  /**
   * Adjunto de la cotización (PDF, PNG o JPEG, máx. 5 MB): «solicitud» (oficio o
   * correo del cliente) exige cotizacion.crear; «aceptacion» (OPI, O/C, correo…)
   * exige cotizacion.aceptar. Multipart: archivo + clase.
   */
  @Post(":id/adjuntos")
  @RequierePermiso("cotizacion.ver")
  @UseInterceptors(FileInterceptor("archivo", { limits: { fileSize: MAX_BYTES_ADJUNTO, files: 1, fields: 2 } }))
  async adjuntar(@Param("id", ParseUUIDPipe) id: string, @UploadedFile() archivo: ArchivoAdjunto | undefined, @Body() body: any, @Req() req: any) {
    const clase = String(body?.clase ?? "");
    const permiso = clase === "aceptacion" ? PERMISO_ACEPTAR : "cotizacion.crear";
    const permisos: string[] = req?.user?.permisos ?? [];
    if (!(req?.user?.roles ?? []).includes("SUPERADMIN") && !permisos.includes(permiso))
      throw new ForbiddenException(`Adjuntar el documento de ${clase === "aceptacion" ? "aceptación" : "solicitud"} exige el permiso «${permiso}».`);
    await exigirCotizacionEnAlcance(this.prisma, this.alcance, req, id, permiso);
    return this.svc.adjuntar(id, req?.user?.tenantId, clase, archivo, req?.user?.sub);
  }

  @Get(":id/adjuntos/:adjuntoId")
  @RequierePermiso("cotizacion.ver")
  async adjunto(@Param("id", ParseUUIDPipe) id: string, @Param("adjuntoId", ParseUUIDPipe) adjuntoId: string, @Req() req: any, @Res() res: Response) {
    await exigirCotizacionEnAlcance(this.prisma, this.alcance, req, id, "cotizacion.ver");
    const a = await this.svc.adjunto(id, req?.user?.tenantId, adjuntoId);
    res.set(cabecerasAdjunto(a));
    res.end(a.datos);
  }

  /** Rechazo de una cotización histórica ('enviada'): mismo permiso que anular. */
  @Post(":id/rechazar")
  @RequierePermiso(PERMISO_ANULAR)
  async rechazar(@Param("id", ParseUUIDPipe) id: string, @Body() body: { motivo: string }, @Req() req: any) {
    await this.exigirCotizacion(req, id);
    return this.svc.rechazar(id, body.motivo, req?.user?.tenantId);
  }
}
