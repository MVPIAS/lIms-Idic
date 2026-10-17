import {
  BadRequestException,
  Body,
  ConflictException,
  ForbiddenException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService, DEV_TENANT } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";
import { generarNumeroOrdenInterna } from "../common/correlativo";
import { AlcanceService } from "../rbac/alcance.service";
import { LaboratorioOtService } from "../ot/laboratorio-ot.service";
import { motivoNoCapturable } from "../laboratorio/flujo-resultado";
import { conNombres, recalcularVeredictoMuestra } from "../laboratorio/laboratorio.module";
import { traducirFormula } from "../laboratorio/formula-legado";
import { planEdicion, tipoDatoDe, veredictoMuestra, type Especificacion, type TipoDato } from "../laboratorio/especificacion";
import { calcularCaptura, CapturaError } from "../laboratorio/captura-estandar";
import { veredictoNumerico } from "../laboratorio/veredicto";
import { erroresRegistro, proponerDesdeCotizacion, siguientesCodigos, type MetodoCatalogo } from "./registro-muestras";

/**
 * =============================================================================
 * FLUJO REAL · API sobre las estructuras del ANALISIS_FLUJO_REAL (D1/D2/D4/D5).
 *
 * DDL fuente: packages/db/align_flujo_real.sql (ya aplicado). Modelos Prisma:
 * SolicitudCosteo, OrdenInterna, FormatoInforme, DecisionConformidad y las
 * columnas nuevas de OrdenTrabajo (faseRegistro/estadoOt/…) y Cotizacion
 * (viaCosteo/utilidadPct/…). NO se toca la app viva.
 *
 * Rutas:
 *   solicitud-costeo/…            · CRUD costeo por laboratorio (D2)
 *   ordenes-internas/…           · CRUD órdenes internas + correlativo OI (D4)
 *   formatos-informe/…           · CRUD formatos + /sugerir (D5)
 *   flujo/ot/:id/…               · acciones de la OT dual (D1) + decisión (D5)
 *   costeo/cotizaciones/:id/consolidar · consolida el camino (b) del costeo (D2)
 *
 * Permisos RBAC reales (seed_rbac.sql / align_rbac.sql):
 *   · cotizacion.ver / cotizacion.crear  → costeo (no existe cotizacion.gestionar;
 *     cotizacion.crear es el permiso de escritura real del dominio cotización).
 *   · muestra.ver / catalogo.gestionar   → formatos de informe.
 *   · ot.crear                           → acciones de ciclo de vida de la OT.
 *   · certificado.emitir                 → decisión/atestación de conformidad.
 * =============================================================================
 */

/** Permisos RBAC reales usados por este módulo. */
const PERM = {
  costeoVer: "cotizacion.ver",
  costeoGestionar: "cotizacion.crear",
  formatoVer: "muestra.ver",
  formatoGestionar: "catalogo.gestionar",
  otGestionar: "ot.crear",
  decisionEmitir: "certificado.emitir",
} as const;

/** Exige al menos uno de los permisos (SUPERADMIN pasa siempre, como en PermisoGuard). */
function exigirAlguno(req: any, permisos: string[]) {
  const roles: string[] = req?.user?.roles ?? [];
  if (roles.includes("SUPERADMIN")) return;
  const tiene: string[] = req?.user?.permisos ?? [];
  if (!permisos.some((p) => tiene.includes(p)))
    throw new ForbiddenException(`Permiso insuficiente. Requiere uno de: ${permisos.join(", ")}`);
}

/** Extrae el tenant del usuario autenticado; en dev cae al tenant por defecto. */
function tenantDe(req: any): string {
  return req?.user?.tenantId ?? DEV_TENANT;
}

/* ============================ D2 · SOLICITUD DE COSTEO ============================ */

@Injectable()
export class SolicitudCosteoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "solicitudCosteo",
      search: ["glosa", "estado"],
      orderBy: { createdAt: "desc" },
      tenant: true,
      softDelete: true,
    });
  }
}
const SolicitudCosteoCreate = z.object({
  cotizacionId: z.string().uuid(),
  familiaId: z.string().uuid().optional(),
  catElementoId: z.string().uuid().optional(),
  catEnsayoId: z.string().uuid().optional(),
  glosa: z.string().optional(),
  horasHombre: z.number().nonnegative().default(0),
  costoDirecto: z.number().nonnegative().default(0),
  estado: z.enum(["solicitado", "estimado", "consolidado"]).default("solicitado"),
});
@ApiTags("solicitud-costeo")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("solicitud-costeo")
@RequierePermisoCrud({
  ver: PERM.costeoVer,
  crear: PERM.costeoGestionar,
  editar: PERM.costeoGestionar,
  eliminar: PERM.costeoGestionar,
})
export class SolicitudCosteoController extends BaseCrudController {
  protected createSchema = SolicitudCosteoCreate;
  protected updateSchema = SolicitudCosteoCreate.partial();
  constructor(protected svc: SolicitudCosteoService) {
    super();
  }
}

/* ============================ D4 · ORDEN INTERNA ============================ */

@Injectable()
export class OrdenInternaService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "ordenInterna",
      search: ["numero", "tipo", "estado", "detalle"],
      orderBy: { createdAt: "desc" },
      tenant: true,
      softDelete: true,
    });
  }

  /**
   * Al crear, si no viene `numero` lo genera atómico OI-AAAA-NNNN contra la
   * tabla orden_interna_correlativo (INSERT ON CONFLICT DO UPDATE RETURNING).
   */
  override async crear(data: any, tenantId?: string) {
    const tid = tenantId ?? DEV_TENANT;
    const numero = data?.numero ?? (await generarNumeroOrdenInterna(this.prisma, tid));
    return super.crear({ ...data, numero }, tenantId);
  }
}
const OrdenInternaCreate = z.object({
  otId: z.string().uuid(),
  tipo: z.enum(["interna", "generica_interna", "muestreo"]).default("interna"),
  numero: z.string().max(40).optional(),
  origenLab: z.string().uuid().optional(),
  destinoLab: z.string().uuid().optional(),
  estado: z.enum(["abierta", "recibida", "cerrada"]).default("abierta"),
  detalle: z.string().optional(),
});
@ApiTags("ordenes-internas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ordenes-internas")
@RequierePermisoCrud({
  ver: PERM.costeoVer,
  crear: PERM.otGestionar,
  editar: PERM.otGestionar,
  eliminar: PERM.otGestionar,
})
export class OrdenInternaController extends BaseCrudController {
  protected createSchema = OrdenInternaCreate;
  protected updateSchema = OrdenInternaCreate.partial();
  constructor(protected svc: OrdenInternaService) {
    super();
  }
}

/* ============================ D5 · FORMATOS DE INFORME ============================ */

@Injectable()
export class FormatoInformeService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "formatoInforme",
      search: ["codigo", "descripcion"],
      orderBy: { codigo: "asc" },
      tenant: true,
      softDelete: true,
    });
  }

  /**
   * Devuelve el/los formato(s) que casan con veredicto × organismo × destino.
   * Filtra solo por los campos presentes: si `destino` viene vacío se ignora
   * (no exige destino NULL), de modo que casa cualquier formato de ese
   * veredicto/organismo. Devuelve un ARRAY.
   */
  async sugerir(
    tenantId: string,
    veredicto?: string,
    organismo?: string,
    destino?: string,
  ) {
    return this.prisma.formatoInforme.findMany({
      where: {
        tenantId,
        deletedAt: null,
        activo: true,
        ...(veredicto ? { veredicto } : {}),
        ...(organismo ? { organismo } : {}),
        ...(destino ? { destino } : {}),
      },
      orderBy: { codigo: "asc" },
    });
  }
}

const FormatoInformeCreate = z.object({
  codigo: z.string().min(1).max(20),
  descripcion: z.string().min(1).max(200),
  veredicto: z.enum(["cumple", "no_cumple", "inspeccion"]).optional(),
  organismo: z.enum(["OCC", "OI"]).optional(),
  destino: z.enum(["cliente", "DGMN"]).optional(),
  activo: z.boolean().default(true),
});

/**
 * `formatos-informe/sugerir` va en un controlador PROPIO declarado ANTES del
 * CRUD en el array de controllers, para que su ruta estática se registre antes
 * que el `@Get(":id")` heredado del BaseCrudController (si no, ParseUUIDPipe
 * intentaría parsear "sugerir" como UUID y respondería 400).
 */
@ApiTags("formatos-informe")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("formatos-informe")
export class FormatoInformeSugerirController {
  constructor(private readonly svc: FormatoInformeService) {}

  @Get("sugerir")
  @RequierePermiso(PERM.formatoVer)
  @ApiOperation({ summary: "Formatos que casan con veredicto/organismo/destino (array)" })
  sugerir(
    @Query("veredicto") veredicto: string | undefined,
    @Query("organismo") organismo: string | undefined,
    @Query("destino") destino: string | undefined,
    @Req() req: any,
  ) {
    return this.svc.sugerir(tenantDe(req), veredicto, organismo, destino);
  }
}

@ApiTags("formatos-informe")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("formatos-informe")
@RequierePermisoCrud({
  ver: PERM.formatoVer,
  crear: PERM.formatoGestionar,
  editar: PERM.formatoGestionar,
  eliminar: PERM.formatoGestionar,
})
export class FormatoInformeController extends BaseCrudController {
  protected createSchema = FormatoInformeCreate;
  protected updateSchema = FormatoInformeCreate.partial();
  constructor(protected svc: FormatoInformeService) {
    super();
  }
}

/* ============================ D1 · ACCIONES DE LA OT DUAL ============================ */

/**
 * Máquina de estados REAL de la OT (columna estado_ot), independiente del
 * `estado` legacy (que valida common/estados.ts). Vocabulario del align:
 *   en_espera → registrado → activo → (cumple | no_cumple) → cerrada
 */
const TRANSICIONES_ESTADO_OT: Record<string, readonly string[]> = {
  en_espera: ["registrado"],
  registrado: ["activo"],
  activo: ["cumple", "no_cumple"],
  cumple: ["cerrada"],
  no_cumple: ["cerrada"],
  cerrada: [],
};
const ESTADOS_OT = Object.keys(TRANSICIONES_ESTADO_OT);

const RegistrarDefinitivoBody = z.object({
  catElementoId: z.string().uuid().optional(),
  elementoGenerico: z.string().max(240).optional(),
});
const TransicionBody = z.object({
  estadoOt: z.enum(["en_espera", "registrado", "activo", "cumple", "no_cumple", "cerrada"]),
});
const DecisionBody = z.object({
  veredicto: z.enum(["cumple", "no_cumple", "inspeccion"]),
  organismo: z.enum(["OCC", "OI"]),
  destino: z.enum(["cliente", "DGMN"]).optional(),
  atestadoPor: z.string().max(120).optional(),
  observaciones: z.string().optional(),
});

@Injectable()
export class FlujoOtService {
  constructor(private readonly prisma: PrismaService) {}

  private async otDelTenant(id: string, tenantId: string) {
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id, tenantId } });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${id} no encontrada`);
    return ot;
  }

  /** Genérico/En Espera → Definitivo/Registrado (registro técnico). */
  async registrarDefinitivo(
    id: string,
    body: z.infer<typeof RegistrarDefinitivoBody>,
    tenantId: string,
  ) {
    const ot = await this.otDelTenant(id, tenantId);
    if (ot.estadoOt !== "en_espera") {
      throw new ConflictException(
        `La OT no está 'en_espera' (estado actual: '${ot.estadoOt}'); no se puede registrar como definitiva.`,
      );
    }
    return this.prisma.ordenTrabajo.update({
      where: { id },
      data: {
        faseRegistro: "definitivo",
        estadoOt: "registrado",
        registradoAt: new Date(),
        ...(body.catElementoId !== undefined ? { catElementoId: body.catElementoId } : {}),
        ...(body.elementoGenerico !== undefined ? { elementoGenerico: body.elementoGenerico } : {}),
      },
    });
  }

  /** Transición validada contra la máquina real de estado_ot. */
  async transicion(id: string, nuevo: string, tenantId: string) {
    const ot = await this.otDelTenant(id, tenantId);
    if (!ESTADOS_OT.includes(nuevo)) {
      throw new ConflictException(
        `Estado '${nuevo}' no válido. Estados: ${ESTADOS_OT.join(", ")}.`,
      );
    }
    const actual = ot.estadoOt;
    if (actual === nuevo) return ot; // no-op
    const permitidos = TRANSICIONES_ESTADO_OT[actual] ?? [];
    if (!permitidos.includes(nuevo)) {
      throw new ConflictException(
        `Transición inválida de estado_ot: '${actual}' → '${nuevo}'. ` +
          (permitidos.length
            ? `Desde '${actual}' solo se permite: ${permitidos.join(", ")}.`
            : `'${actual}' es un estado final.`),
      );
    }
    return this.prisma.ordenTrabajo.update({
      where: { id },
      data: {
        estadoOt: nuevo,
        ...(nuevo === "registrado" ? { registradoAt: new Date() } : {}),
        ...(nuevo === "cerrada" ? { fechaCierre: new Date() } : {}),
      },
    });
  }

  /** Decisión/Atestación de conformidad (D5): elige el formato que casa. */
  async decision(id: string, body: z.infer<typeof DecisionBody>, tenantId: string) {
    await this.otDelTenant(id, tenantId);
    // Resuelve el formato por veredicto × organismo × destino (si se indica).
    const formato = await this.prisma.formatoInforme.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        activo: true,
        veredicto: body.veredicto,
        organismo: body.organismo,
        ...(body.destino ? { destino: body.destino } : {}),
      },
      orderBy: { codigo: "asc" },
    });
    const decision = await this.prisma.decisionConformidad.create({
      data: {
        tenantId,
        otId: id,
        veredicto: body.veredicto,
        organismo: body.organismo,
        destino: body.destino ?? null,
        formatoId: formato?.id ?? null,
        atestadoPor: body.atestadoPor ?? null,
        atestadoAt: new Date(),
        observaciones: body.observaciones ?? null,
      },
    });
    return { ...decision, formato };
  }
}

@ApiTags("flujo-ot")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("flujo/ot")
export class FlujoOtController {
  constructor(private readonly svc: FlujoOtService) {}

  @Patch(":id/registrar-definitivo")
  @RequierePermiso(PERM.otGestionar)
  @ApiOperation({ summary: "OT Genérico/En Espera → Definitivo/Registrado" })
  registrarDefinitivo(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    return this.svc.registrarDefinitivo(id, RegistrarDefinitivoBody.parse(body), tenantDe(req));
  }

  @Patch(":id/transicion")
  @RequierePermiso(PERM.otGestionar)
  @ApiOperation({ summary: "Transición de estado_ot (máquina real, rechaza saltos)" })
  transicion(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const { estadoOt } = TransicionBody.parse(body);
    return this.svc.transicion(id, estadoOt, tenantDe(req));
  }

  @Post(":id/decision")
  @RequierePermiso(PERM.decisionEmitir)
  @ApiOperation({ summary: "Decisión/Atestación de conformidad (elige formato)" })
  decision(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.decision(id, DecisionBody.parse(body), tenantDe(req));
  }
}

/* ============================ D2 · CONSOLIDACIÓN DE COSTEO ============================ */

@Injectable()
export class CosteoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Consolida el camino (b): Σ costoDirecto de las solicitud_costeo → costos
   * directos; %Admin (gastosAdminPct) → subtotal admin; %Utilidad (utilidadPct)
   * → utilidadMonto; escribe total y via_costeo='estimacion' en la cotización.
   */
  async consolidar(cotizacionId: string, tenantId: string) {
    const cot = await this.prisma.cotizacion.findFirst({
      where: { id: cotizacionId, tenantId },
    });
    if (!cot) throw new NotFoundException(`Cotización ${cotizacionId} no encontrada`);

    const solicitudes = await this.prisma.solicitudCosteo.findMany({
      where: { cotizacionId, tenantId, deletedAt: null },
      select: { costoDirecto: true },
    });

    const costosDirectos = solicitudes.reduce((s, r) => s + Number(r.costoDirecto), 0);
    const adminPct = Number(cot.gastosAdminPct);
    const utilidadPct = Number(cot.utilidadPct);
    const admin = costosDirectos * (adminPct / 100);
    const subtotalAdmin = costosDirectos + admin;
    const utilidad = subtotalAdmin * (utilidadPct / 100);
    const total = subtotalAdmin + utilidad;

    const round2 = (n: number) => Math.round(n * 100) / 100;

    await this.prisma.$transaction([
      this.prisma.cotizacion.update({
        where: { id: cotizacionId },
        data: {
          viaCosteo: "estimacion",
          costosDirectosTotal: round2(costosDirectos),
          gastosAdminMonto: round2(admin),
          utilidadMonto: round2(utilidad),
          total: round2(total),
        },
      }),
      this.prisma.solicitudCosteo.updateMany({
        where: { cotizacionId, tenantId, deletedAt: null },
        data: { estado: "consolidado" },
      }),
    ]);

    return {
      costosDirectos: round2(costosDirectos),
      admin: round2(admin),
      utilidad: round2(utilidad),
      total: round2(total),
    };
  }
}

@ApiTags("costeo")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("costeo/cotizaciones")
export class CosteoController {
  constructor(private readonly svc: CosteoService) {}

  @Post(":id/consolidar")
  @RequierePermiso(PERM.costeoGestionar)
  @ApiOperation({ summary: "Consolida costeo (b): ΣcostoDirecto + %Admin + %Utilidad" })
  consolidar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.consolidar(id, tenantDe(req));
  }
}

/* ============================ PUENTE · CATÁLOGO v2 -> FLUJO OPERATIVO ============================ */

/**
 * Puente entre el catálogo v2 (cascada: cat_metodo -> cat_analito ->
 * cat_especificacion) y la captura operativa (`resultado`). Materializa los
 * MÉTODOS elegidos del panel de una muestra como filas `resultado` por analizar
 * —una por cada analito del método— arrastrando ESPECIFICACIÓN (Mín/Nominal/Máx)
 * y FÓRMULA como copia congelada del catálogo, y habilita captura -> veredicto.
 *
 * Columnas físicas: packages/db/align_puente_catalogo.sql (resultado.cat_*,
 * limite_*, formula; muestra.cat_elemento_id). Los resultados del puente dejan
 * `analito_id` (legacy) en NULL y usan `cat_analito_id`.
 */
const GenerarAnalisisBody = z.object({
  muestraId: z.string().uuid(),
  metodoIds: z.array(z.string().uuid()).min(1),
});
/**
 * Captura estándar de un ensayo (ver laboratorio/captura-estandar.ts): valor
 * directo, réplicas o lecturas con los campos del método; en atributos,
 * Cumple / No cumple con observación.
 */
const celda = z.union([z.number().finite(), z.string().max(40), z.null()]);
const CapturarValorBody = z
  .object({
    valor: z.union([z.number().finite(), z.string().max(120)]).optional(),
    replicas: z.array(z.number().finite()).max(100).optional(),
    replicasTexto: z.string().max(4000).optional(),
    lecturas: z.array(z.record(z.string().regex(/^[Cc]\d{1,2}$/), celda)).max(100).optional(),
    variables: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.number().finite()).optional(),
    atributo: z.enum(["cumple", "no_cumple"]).optional(),
    observacion: z.string().max(2000).optional(),
  });

/** Especificación de la orden (lo que el catálogo no trae, o lo que cambia la jefatura). */
const texto120 = z.string().max(120).nullable().optional();
const EspecificacionBody = z.object({
  limiteInf: texto120,
  nominal: texto120,
  limiteSup: texto120,
  unidad: z.string().max(30).nullable().optional(),
  requisito: z.string().max(2000).nullable().optional(),
  tipoDato: z.enum(["numerico", "atributo"]).optional(),
  formula: z.string().max(500).nullable().optional(),
});

/** Parsea un texto de límite a número; NULL si no es numérico ('cumple', ''…). */
function aNumero(v?: string | null): number | null {
  if (v == null) return null;
  const s = String(v).trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lee el valor capturado: número (admite coma decimal chilena «12,4») o texto
 * cualitativo («Cumple», «Ausente»). Un texto que PARECE número pero no se
 * entiende («1.234,5», «12,4,5») se rechaza en vez de guardarse como texto y
 * quedar «pendiente» sin aviso.
 */
export function leerValorCaptura(valor: number | string): number | string {
  if (typeof valor === "number") return valor;
  const s = valor.trim();
  if (/^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/.test(s)) return Number(s.replace(",", "."));
  if (/^[\d\s.,+-]+$/.test(s))
    throw new BadRequestException(
      `No se entiende «${s}» como número: use un solo separador decimal (coma o punto) y sin separador de miles.`,
    );
  return s;
}

/**
 * Referencia CUALITATIVA normalizada de un límite/nominal: devuelve el texto en
 * minúsculas y sin espacios sobrantes SOLO si NO es numérico (p.ej. 'Cumple',
 * 'Declarado', 'Ausente'). Si es numérico o vacío, devuelve NULL (no sirve como
 * referencia cualitativa). */
function refCualitativa(v?: string | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  if (aNumero(s) != null) return null; // es numérico -> no es referencia textual
  return s.toLowerCase();
}

@Injectable()
export class PuenteAnalisisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly labs: LaboratorioOtService,
  ) {}

  /** OT del tenant y dentro del alcance del usuario (404 / 403). */
  private async otEnAlcance(otId: string, tenantId: string, req: any) {
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id: otId, tenantId } });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    return ot;
  }

  private async muestraDeOt(otId: string, muestraId: string, tenantId: string) {
    const muestra = await this.prisma.muestra.findFirst({
      where: { id: muestraId, tenantId, deletedAt: null },
    });
    if (!muestra) throw new NotFoundException(`Muestra ${muestraId} no encontrada`);
    if (muestra.otId !== otId)
      throw new ConflictException(
        `La muestra ${muestraId} no pertenece a la OT ${otId} (pertenece a ${muestra.otId ?? "ninguna"}).`,
      );
    return muestra;
  }

  /**
   * Genera los resultados por analizar de una muestra a partir de los métodos
   * (cat_metodo) elegidos del panel. Idempotente: no duplica un resultado ya
   * existente para el par (muestra, cat_analito). Devuelve nº creados/omitidos.
   */
  async generarAnalisis(
    otId: string,
    body: z.infer<typeof GenerarAnalisisBody>,
    tenantId: string,
    req?: any,
  ) {
    // La OT debe existir en el tenant y estar en el alcance del usuario.
    const ot = await this.otEnAlcance(otId, tenantId, req);
    const muestra = await this.muestraDeOt(otId, body.muestraId, tenantId);

    // Una OT que aún no tiene laboratorio (p. ej. creada antes de esta
    // versión) lo toma de los métodos pedidos, si todos apuntan al mismo.
    if (!ot.unidadPrincipal) {
      const d = await this.labs.deducir(tenantId, { catMetodoIds: body.metodoIds });
      if (d.unidad)
        await this.labs.fijar(this.prisma, {
          tenantId,
          otId,
          unidad: d.unidad,
          usuarioId: req?.user?.sub,
          origen: "metodos_de_la_muestra",
        });
    }

    // Analitos de los métodos pedidos (validando que son del tenant).
    const analitos = await this.prisma.catAnalito.findMany({
      where: {
        tenantId,
        deletedAt: null,
        activo: true,
        metodoId: { in: body.metodoIds },
      },
    });

    // Resultados del puente ya existentes para esta muestra (idempotencia).
    const yaExisten = await this.prisma.resultado.findMany({
      where: { muestraId: muestra.id, deletedAt: null, catAnalitoId: { not: null } },
      select: { catAnalitoId: true },
    });
    const existentes = new Set(yaExisten.map((r) => r.catAnalitoId));

    let creados = 0;
    let omitidos = 0;
    for (const a of analitos) {
      if (existentes.has(a.id)) {
        omitidos++;
        continue;
      }
      // Especificación: preferimos la 'estandar'; si no, cualquiera; si no hay,
      // caemos a los rangos del propio analito (cat_analito.rango_*).
      const espec =
        (await this.prisma.catEspecificacion.findFirst({
          where: { analitoId: a.id, tenantId, deletedAt: null, activo: true, ambito: "estandar" },
        })) ??
        (await this.prisma.catEspecificacion.findFirst({
          where: { analitoId: a.id, tenantId, deletedAt: null, activo: true },
          orderBy: { createdAt: "asc" },
        }));

      const primero = (...vs: (string | null | undefined)[]) => {
        for (const v of vs) if (v != null && String(v).trim() !== "") return String(v).trim();
        return null;
      };
      const limiteInf = primero(espec?.limiteInf, a.rangoMin);
      const nominal = primero(espec?.nominal, a.rangoNominal);
      const limiteSup = primero(espec?.limiteSup, a.rangoMax);
      const unidad = primero(espec?.unidad, a.unidad);
      // Requisito de texto («Tafetán», «Grado 4/5 mín.») + su norma («Nch 1597»).
      const requisito = primero(espec?.requisitos)
        ? `${espec!.requisitos!.trim()}${primero(espec?.texto) ? ` (${espec!.texto!.trim()})` : ""}`
        : null;
      const tipoDato = tipoDatoDe({ limiteInf, nominal, limiteSup, requisito });
      // La fórmula se guarda ya en la sintaxis del motor (traducida del LIMS
      // antiguo cuando se puede); la original queda en la copia del catálogo.
      const trad = traducirFormula(a.formula);

      await this.prisma.resultado.create({
        data: {
          otId,
          muestraId: muestra.id,
          analitoId: null, // resultado del PUENTE: usa cat_analito_id
          catMetodoId: a.metodoId,
          catAnalitoId: a.id,
          unidad,
          formula: trad.expr,
          limiteInf,
          nominal,
          limiteSup,
          requisito,
          tipoDato,
          especOrigen: "catalogo",
          especCatalogo: {
            limiteInf, nominal, limiteSup, unidad, requisito, tipoDato,
            formula: trad.expr,
            ...(a.formula && !trad.expr ? { formulaLegado: a.formula, formulaMotivo: trad.motivo ?? null } : {}),
          },
          veredicto: "pendiente",
          // Pedido pero aún sin valor: no cuenta como «por revisar».
          estado: "pendiente",
        },
      });
      existentes.add(a.id);
      creados++;
    }

    await recalcularVeredictoMuestra(this.prisma, muestra.id);
    return {
      otId,
      muestraId: muestra.id,
      metodosSolicitados: body.metodoIds.length,
      analitosEncontrados: analitos.length,
      creados,
      omitidos,
    };
  }

  /**
   * Captura el valor de un resultado del puente y calcula el veredicto.
   * Reglas (aditivas, compatibles con el comportamiento anterior):
   *   NUMÉRICO (valor numérico + al menos una cota numérica):
   *     · [inf, sup]  -> cumple si inf <= valor <= sup (doble cota, como antes).
   *     · solo inf    -> cumple si valor >= inf; si no, no_cumple.
   *     · solo sup    -> cumple si valor <= sup; si no, no_cumple.
   *     (con tolerancia TOL_NUMERICA para evitar falsos no_cumple por redondeo).
   *   CUALITATIVO (la referencia nominal/límite es texto no numérico y el valor
   *     también es texto, p.ej. 'Cumple', 'Declarado', 'Ausente'):
   *     · cumple si el valor coincide (case-insensitive, trim) con la referencia
   *       esperada (nominal > limite_inf > limite_sup); si no, no_cumple.
   *   PENDIENTE (revisión manual): cuando no hay forma de decidir —ni cota
   *     numérica comparable ni referencia textual comparable—.
   */
  /** Resultado del puente, del tenant y del alcance del usuario. */
  private async resultadoEnAlcance(id: string, tenantId: string, req: any) {
    const resultado = await this.prisma.resultado.findFirst({
      where: { id, deletedAt: null, muestra: { tenantId } },
      include: { muestra: { select: { tenantId: true, otId: true } } },
    });
    if (!resultado) throw new NotFoundException(`Resultado ${id} no encontrado`);
    const otId = resultado.otId ?? resultado.muestra.otId;
    const ot = otId
      ? await this.prisma.ordenTrabajo.findFirst({ where: { id: otId }, select: { codigo: true, unidadPrincipal: true } })
      : null;
    await this.alcance.exigirUnidad(req, ot?.unidadPrincipal ?? null, ot ? `el resultado de la OT ${ot.codigo}` : "el resultado");
    return { resultado, otId };
  }

  /**
   * Formulario de captura estándar (laboratorio/captura-estandar.ts): valor,
   * réplicas o lecturas con los campos del método (fórmula), o Cumple / No
   * cumple en los atributos. Lo revisado o aprobado no se sobrescribe. Deja al
   * usuario como analista (segregación) y recalcula el veredicto de la muestra.
   */
  async capturarValor(id: string, entrada: z.infer<typeof CapturarValorBody>, tenantId: string, req?: any) {
    const { resultado, otId } = await this.resultadoEnAlcance(id, tenantId, req);

    const bloqueo = motivoNoCapturable(resultado.estado);
    if (bloqueo) throw new ConflictException(bloqueo);

    const tipoDato: TipoDato =
      (resultado.tipoDato as TipoDato) ??
      tipoDatoDe({ limiteInf: resultado.limiteInf, nominal: resultado.nominal, limiteSup: resultado.limiteSup, requisito: resultado.requisito });
    let calc;
    try {
      calc = calcularCaptura(
        { tipoDato, limiteInf: resultado.limiteInf, nominal: resultado.nominal, limiteSup: resultado.limiteSup, formula: resultado.formula },
        entrada,
      );
    } catch (e) {
      if (e instanceof CapturaError) throw new BadRequestException(e.message);
      throw e;
    }

    const actualizado = await this.prisma.resultado.update({
      where: { id },
      data: {
        valorNumerico: calc.valorNumerico,
        valorTexto: calc.valorTexto,
        replicas: calc.replicas,
        promedio: calc.promedio,
        desviacion: calc.desviacion,
        cv: calc.cv,
        resultadoFinal: calc.resultadoFinal,
        formulaAplicada: calc.formulaAplicada,
        lecturas: calc.lecturas ?? undefined,
        observacion: calc.observacion,
        veredicto: calc.veredicto,
        tipoDato,
        // Quien captura queda como analista (segregación: no podrá revisarlo).
        analistaId: req?.user?.sub ?? resultado.analistaId ?? null,
        estado: "capturado",
        fecha: new Date(),
        otId: otId ?? null,
      },
      include: { catAnalito: true, catMetodo: true },
    });
    const veredictoDeLaMuestra = await recalcularVeredictoMuestra(this.prisma, resultado.muestraId);
    return { ...actualizado, veredictoMuestra: veredictoDeLaMuestra };
  }

  /**
   * Especificación de la ORDEN: completa lo que el catálogo no trae (Mín / Nom
   * / Máx, unidad, requisito, tipo de dato) o, si es la jefatura, cambia lo que
   * vino del catálogo y la fórmula. Se guarda en el resultado de esta OT —el
   * catálogo no se toca— marcado como «especificación de la orden», con quién
   * y cuándo. Si el ensayo ya tiene valor, se recalcula su veredicto.
   */
  async editarEspecificacion(id: string, pedido: z.infer<typeof EspecificacionBody>, tenantId: string, req: any) {
    const { resultado } = await this.resultadoEnAlcance(id, tenantId, req);
    const bloqueo = motivoNoCapturable(resultado.estado);
    if (bloqueo) throw new ConflictException(bloqueo.replace("corregirlo", "cambiar su especificación"));

    const actual: Especificacion = {
      limiteInf: resultado.limiteInf, nominal: resultado.nominal, limiteSup: resultado.limiteSup,
      unidad: resultado.unidad, requisito: resultado.requisito, formula: resultado.formula,
      tipoDato: resultado.tipoDato ?? tipoDatoDe({ ...resultado }),
    };
    const catalogo = (resultado.especCatalogo ?? {}) as Especificacion;
    const plan = planEdicion(actual, catalogo, pedido as Especificacion);
    if (!plan.campos.length) return resultado;

    const roles: string[] = req?.user?.roles ?? [];
    const permisos: string[] = req?.user?.permisos ?? [];
    if (plan.requiereJefatura && !roles.includes("SUPERADMIN") && !permisos.includes("resultado.aprobar"))
      throw new ForbiddenException(
        "Cambiar un valor que vino del catálogo, el tipo de dato o la fórmula lo hace la jefatura del laboratorio. Usted puede completar los campos que el catálogo dejó vacíos.",
      );
    if (plan.cambios.formula) {
      const t = traducirFormula(plan.cambios.formula);
      if (t.origen !== "motor")
        throw new BadRequestException(
          "Fórmula no válida. Use los campos del método (C1, C2…), las réplicas (RN, PROMEDIO, DE, CV, N), números y funciones (RAIZ, PROMEDIO, ABS…). Ejemplo: (C1 - C2) / C3 * 100.",
        );
    }
    const nueva = { ...actual, ...plan.cambios };

    // Veredicto con la nueva especificación (si ya hay valor numérico).
    let veredicto = resultado.veredicto;
    if (nueva.tipoDato === "atributo" && actual.tipoDato !== "atributo" && resultado.estado !== "pendiente") veredicto = "pendiente";
    else if (nueva.tipoDato !== "atributo" && resultado.valorNumerico != null) {
      const n = (v?: string | null) => (v != null && /^\s*[+-]?(\d+([.,]\d+)?|[.,]\d+)\s*$/.test(v) ? Number(v.replace(",", ".")) : null);
      veredicto = veredictoNumerico(Number(resultado.valorNumerico), n(nueva.limiteInf), n(nueva.limiteSup));
    }

    const actualizado = await this.prisma.resultado.update({
      where: { id },
      data: {
        ...("limiteInf" in plan.cambios ? { limiteInf: plan.cambios.limiteInf } : {}),
        ...("nominal" in plan.cambios ? { nominal: plan.cambios.nominal } : {}),
        ...("limiteSup" in plan.cambios ? { limiteSup: plan.cambios.limiteSup } : {}),
        ...("unidad" in plan.cambios ? { unidad: plan.cambios.unidad } : {}),
        ...("requisito" in plan.cambios ? { requisito: plan.cambios.requisito } : {}),
        ...("tipoDato" in plan.cambios ? { tipoDato: plan.cambios.tipoDato } : {}),
        ...("formula" in plan.cambios ? { formula: plan.cambios.formula } : {}),
        // Copia del catálogo: se fija la primera vez (resultados anteriores a esta versión).
        ...(resultado.especCatalogo ? {} : { especCatalogo: actual as any }),
        especOrigen: "orden",
        especEditadaPor: req?.user?.sub ?? null,
        especEditadaAt: new Date(),
        veredicto,
      },
      include: { catAnalito: true, catMetodo: true },
    });
    const veredictoDeLaMuestra = await recalcularVeredictoMuestra(this.prisma, resultado.muestraId);
    return { ...actualizado, camposEditados: plan.campos, veredictoMuestra: veredictoDeLaMuestra };
  }

  /**
   * Resultados de todas las muestras de una OT, con analito/método/
   * especificación/valor/veredicto, más un resumen (cumple/no_cumple/pendiente)
   * para el expediente/informe.
   */
  async resultadosDeOt(otId: string, tenantId: string, req?: any) {
    const ot = await this.otEnAlcance(otId, tenantId, req);

    const muestras = await this.prisma.muestra.findMany({
      where: { otId, tenantId, deletedAt: null },
      select: { id: true, codigo: true, nombre: true },
      orderBy: { codigo: "asc" },
    });
    const muestraIds = muestras.map((m) => m.id);

    const resultados = muestraIds.length
      ? await this.prisma.resultado.findMany({
          where: { muestraId: { in: muestraIds }, deletedAt: null },
          include: {
            muestra: { select: { id: true, codigo: true, nombre: true } },
            catAnalito: { select: { id: true, codigo: true, nombre: true, unidad: true } },
            catMetodo: { select: { id: true, codigo: true, nombre: true, norma: true } },
            analito: { select: { id: true, codigo: true, nombre: true } },
          },
          orderBy: [{ muestraId: "asc" }, { fecha: "asc" }],
        })
      : [];

    // Veredictos: cumple / no_cumple / informativo / pendiente (sin valor o sin
    // decidir). Estados: el ciclo de revisión (pendiente → … → aprobado).
    const resumen = { total: resultados.length, cumple: 0, no_cumple: 0, informativo: 0, pendiente: 0 };
    const porEstado: Record<string, number> = {};
    for (const r of resultados) {
      if (r.veredicto === "cumple") resumen.cumple++;
      else if (r.veredicto === "no_cumple") resumen.no_cumple++;
      else if (r.veredicto === "informativo") resumen.informativo++;
      else resumen.pendiente++;
      porEstado[r.estado] = (porEstado[r.estado] ?? 0) + 1;
    }

    // Campos de captura de cada método (paso_metodo): son las variables C1..Cn
    // de las fórmulas por lectura, con su nombre y unidad.
    const metodoIds = [...new Set(resultados.map((r) => r.catMetodoId).filter((x): x is string => Boolean(x)))];
    const pasos = metodoIds.length
      ? await this.prisma.$queryRawUnsafe<{ cat_metodo_id: string; nombre: string; unidad: string | null; tipo_dato: string }[]>(
          `SELECT cat_metodo_id, nombre, unidad, tipo_dato FROM paso_metodo
            WHERE cat_metodo_id = ANY($1::uuid[]) AND activo AND deleted_at IS NULL
            ORDER BY cat_metodo_id, orden, created_at`,
          metodoIds,
        )
      : [];
    const camposPorMetodo: Record<string, { nombre: string; unidad: string | null }[]> = {};
    for (const p of pasos) (camposPorMetodo[p.cat_metodo_id] ??= []).push({ nombre: p.nombre, unidad: p.unidad });

    // Veredicto de cada muestra (lote) y de la OT, con la misma regla.
    const porMuestra = muestras.map((m) => ({
      ...m,
      veredicto: veredictoMuestra(resultados.filter((r) => r.muestraId === m.id).map((r) => r.veredicto)),
    }));

    const conNombre = await conNombres(this.prisma, resultados);
    return {
      otId,
      ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado, unidadPrincipal: ot.unidadPrincipal },
      muestras: muestraIds.length,
      veredictoOt: veredictoMuestra(porMuestra.filter((m) => resultados.some((r) => r.muestraId === m.id)).map((m) => m.veredicto)),
      veredictosMuestra: porMuestra,
      camposPorMetodo,
      resumen,
      porEstado,
      resultados: conNombre.map((r) => {
        const t = traducirFormula(r.formula);
        const cat = (r.especCatalogo ?? {}) as Record<string, any>;
        return {
          ...r,
          tipoDato: r.tipoDato ?? tipoDatoDe({ ...r }),
          formulaAplicable: t.expr,
          nCampos: t.nCampos,
          formulaLegado: cat.formulaLegado ?? null,
          formulaMotivo: cat.formulaMotivo ?? (r.formula && !t.expr ? t.motivo ?? null : null),
          campos: r.catMetodoId ? camposPorMetodo[r.catMetodoId] ?? [] : [],
        };
      }),
    };
  }
}

@ApiTags("flujo-puente")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("flujo/ot")
export class PuenteOtController {
  constructor(private readonly svc: PuenteAnalisisService) {}

  /**
   * Registrar los análisis pedidos de una muestra es parte del registro de la
   * OT (lo hace quien registra las muestras) o de la captura: basta
   * `muestra.crear` O `resultado.crear`. Por eso no lleva @RequierePermiso
   * (que exige TODOS los listados) y se comprueba aquí.
   */
  @Post(":id/generar-analisis")
  @ApiOperation({ summary: "Materializa los métodos del panel (cat_metodo) como resultados por analizar" })
  generarAnalisis(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    exigirAlguno(req, ["muestra.crear", "resultado.crear"]);
    return this.svc.generarAnalisis(id, GenerarAnalisisBody.parse(body), tenantDe(req), req);
  }

  @Get(":id/resultados")
  @RequierePermiso("resultado.ver")
  @ApiOperation({ summary: "Resultados de las muestras de la OT + resumen de veredictos y estados" })
  resultados(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.resultadosDeOt(id, tenantDe(req), req);
  }
}

@ApiTags("flujo-puente")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("flujo/resultado")
export class PuenteResultadoController {
  constructor(private readonly svc: PuenteAnalisisService) {}

  /**
   * Especificación de la orden: rellenar lo vacío lo hace quien captura;
   * cambiar lo del catálogo, el tipo o la fórmula, la jefatura
   * (resultado.aprobar, se comprueba en el servicio).
   */
  @Patch(":id/especificacion")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "Especificación de la orden (Mín/Nom/Máx, unidad, requisito, tipo, fórmula) de un ensayo" })
  especificacion(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editarEspecificacion(id, EspecificacionBody.parse(body ?? {}), tenantDe(req), req);
  }

  @Post(":id/valor")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "Captura el valor de un resultado del puente y calcula su veredicto" })
  capturarValor(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.capturarValor(id, CapturarValorBody.parse(body ?? {}), tenantDe(req), req);
  }
}

/* ============================ REGISTRO DE MUESTRAS DESDE EL EXPEDIENTE ============================ */

/**
 * Cuerpo de POST /flujo/ot/:id/muestras: las muestras recibidas y los métodos
 * (cat_metodo) que se les aplican. Cada muestra puede llevar sus métodos.
 */
const RegistrarMuestrasBody = z.object({
  muestras: z
    .array(
      z.object({
        nombre: z.string().trim().max(200),
        metodoIds: z.array(z.string().uuid()).max(200),
        catElementoId: z.string().uuid().optional(),
      }),
    )
    .min(1, "Indique al menos una muestra.")
    .max(50, "Registre como máximo 50 muestras de una vez."),
});

/**
 * Registro de las muestras recibidas de una OT ya creada (p. ej. la que nace
 * al aceptar una cotización) con sus ensayos por analizar. Lo hace quien
 * registra muestras (`muestra.crear`: Recepción, Planificación, jefaturas…)
 * desde el expediente de la OT. Reglas: registro-muestras.ts.
 */
@Injectable()
export class RegistroMuestrasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly puente: PuenteAnalisisService,
  ) {}

  private async otEnAlcance(otId: string, tenantId: string, req: any) {
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id: otId, tenantId } });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    return ot;
  }

  /** Métodos del catálogo con su nº de analitos activos. */
  private async metodos(tenantId: string, where: { ids?: string[]; ensayoIds?: string[] }): Promise<MetodoCatalogo[]> {
    if (!where.ids?.length && !where.ensayoIds?.length) return [];
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.codigo, m.nombre, m.norma, m.ensayo_id AS "ensayoId",
              (SELECT count(*) FROM cat_analito a WHERE a.metodo_id = m.id AND a.deleted_at IS NULL AND a.activo)::int AS analitos
         FROM cat_metodo m
        WHERE m.tenant_id = $1::uuid AND m.deleted_at IS NULL AND m.activo
          AND (m.id = ANY($2::uuid[]) OR m.ensayo_id = ANY($3::uuid[]))
        ORDER BY m.codigo`,
      tenantId,
      where.ids ?? [],
      where.ensayoIds ?? [],
    );
    return filas.map((f) => ({ ...f, analitos: Number(f.analitos) }));
  }

  /**
   * Lo que necesita la pantalla: la OT, sus muestras (con cuántos ensayos
   * tiene cada una) y la propuesta de métodos desde la cotización aceptada.
   */
  async propuesta(otId: string, tenantId: string, req: any) {
    const ot = await this.otEnAlcance(otId, tenantId, req);
    const muestras = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.codigo, m.nombre, m.estado, m.veredicto,
              (SELECT count(*) FROM resultado r WHERE r.muestra_id = m.id AND r.deleted_at IS NULL)::int AS ensayos,
              COALESCE((SELECT array_agg(DISTINCT cm.codigo) FROM resultado r JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
                         WHERE r.muestra_id = m.id AND r.deleted_at IS NULL), '{}') AS metodos
         FROM muestra m
        WHERE m.ot_id = $1::uuid AND m.deleted_at IS NULL
        ORDER BY m.created_at, m.codigo`,
      otId,
    );
    const cot = ot.cotizacionId
      ? await this.prisma.cotizacion.findFirst({
          where: { id: ot.cotizacionId, tenantId },
          select: { id: true, codigo: true, estado: true, referencia: true, lineas: { orderBy: { orden: "asc" } } },
        })
      : null;
    const lineas = cot?.lineas ?? [];
    const ensayoIds = [...new Set(lineas.map((l) => l.catEnsayoId).filter((x): x is string => !!x))];
    const ensayos = ensayoIds.length
      ? await this.prisma.catEnsayo.findMany({ where: { id: { in: ensayoIds } }, select: { id: true, nombre: true } })
      : [];
    const nombreEnsayo = new Map(ensayos.map((e) => [e.id, e.nombre]));
    const metodos = await this.metodos(tenantId, { ensayoIds });
    const porEnsayo = new Map<string, MetodoCatalogo[]>();
    for (const m of metodos) if (m.ensayoId) (porEnsayo.get(m.ensayoId) ?? porEnsayo.set(m.ensayoId, []).get(m.ensayoId)!).push(m);
    return {
      ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado, unidadPrincipal: ot.unidadPrincipal, clienteId: ot.clienteId },
      cotizacion: cot ? { id: cot.id, codigo: cot.codigo, estado: cot.estado, referencia: cot.referencia } : null,
      muestras: muestras.map((m) => ({ ...m, ensayos: Number(m.ensayos) })),
      lineas: proponerDesdeCotizacion(
        lineas.map((l) => ({
          id: l.id,
          descripcion: l.descripcion,
          cantidad: l.cantidad,
          catEnsayoId: l.catEnsayoId,
          ensayoCodigo: l.ensayoCodigo,
          ensayoNombre: l.catEnsayoId ? nombreEnsayo.get(l.catEnsayoId) ?? null : null,
        })),
        porEnsayo,
      ),
    };
  }

  /** Crea las muestras y genera sus ensayos por analizar (puente catálogo → resultado). */
  async registrar(otId: string, body: z.infer<typeof RegistrarMuestrasBody>, tenantId: string, req: any) {
    const ot = await this.otEnAlcance(otId, tenantId, req);
    const ids = [...new Set(body.muestras.flatMap((m) => m.metodoIds))];
    const catalogo = new Map((await this.metodos(tenantId, { ids })).map((m) => [m.id, m]));
    const errores = erroresRegistro(ot.estado, body.muestras, catalogo);
    if (errores.length) throw new BadRequestException(errores.join(" "));

    const existentes = await this.prisma.muestra.findMany({
      where: { tenantId, codigo: { startsWith: ot.codigo } },
      select: { codigo: true },
    });
    const codigos = siguientesCodigos(ot.codigo, existentes.map((e) => e.codigo), body.muestras.length);

    const creadas: { id: string; codigo: string; nombre: string; ensayos: number; metodos: string[] }[] = [];
    for (let i = 0; i < body.muestras.length; i++) {
      const m = body.muestras[i];
      const muestra = await this.prisma.muestra.create({
        data: {
          tenantId,
          otId,
          codigo: codigos[i],
          nombre: m.nombre.trim(),
          clienteId: ot.clienteId,
          estado: "recibida",
          catElementoId: m.catElementoId ?? ot.catElementoId ?? null,
        },
      });
      const g = await this.puente.generarAnalisis(otId, { muestraId: muestra.id, metodoIds: m.metodoIds }, tenantId, req);
      creadas.push({
        id: muestra.id,
        codigo: muestra.codigo,
        nombre: muestra.nombre ?? "",
        ensayos: g.creados,
        metodos: m.metodoIds.map((id) => catalogo.get(id)?.codigo ?? id),
      });
    }

    // La OT recibe sus muestras: si aún no tenía fecha de recepción, es hoy.
    if (!ot.fechaRecepcion)
      await this.prisma.ordenTrabajo.update({ where: { id: otId }, data: { fechaRecepcion: new Date() } });

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id)
       VALUES ($1::uuid, $2::uuid, 'registro_muestras', $3::jsonb, $4::uuid)`,
      tenantId,
      otId,
      JSON.stringify({ muestras: creadas.map((c) => ({ codigo: c.codigo, nombre: c.nombre, ensayos: c.ensayos, metodos: c.metodos })) }),
      req?.user?.sub ?? null,
    );
    return { otId, muestras: creadas, ensayos: creadas.reduce((s, c) => s + c.ensayos, 0) };
  }
}

@ApiTags("flujo-puente")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("flujo/ot")
export class RegistroMuestrasController {
  constructor(private readonly svc: RegistroMuestrasService) {}

  @Get(":id/registro-muestras")
  @RequierePermiso("muestra.ver")
  @ApiOperation({ summary: "Muestras de la OT y métodos propuestos desde la cotización aceptada" })
  propuesta(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.propuesta(id, tenantDe(req), req);
  }

  @Post(":id/muestras")
  @RequierePermiso("muestra.crear")
  @ApiOperation({ summary: "Registra las muestras recibidas de la OT y genera sus ensayos por analizar" })
  registrar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.registrar(id, RegistrarMuestrasBody.parse(body ?? {}), tenantDe(req), req);
  }
}

/* ============================ MÓDULO ============================ */

@Module({
  controllers: [
    SolicitudCosteoController,
    OrdenInternaController,
    // El controlador de /sugerir va ANTES que el CRUD para ganar a `@Get(":id")`.
    FormatoInformeSugerirController,
    FormatoInformeController,
    FlujoOtController,
    CosteoController,
    PuenteOtController,
    PuenteResultadoController,
    RegistroMuestrasController,
  ],
  providers: [
    SolicitudCosteoService,
    OrdenInternaService,
    FormatoInformeService,
    FlujoOtService,
    CosteoService,
    PuenteAnalisisService,
    RegistroMuestrasService,
  ],
  // BPCH (internación / reinspección) registra cada lote como muestra de la OT
  // con el mismo servicio que la pestaña «Muestras» del expediente.
  exports: [RegistroMuestrasService],
})
export class FlujoRealModule {}
