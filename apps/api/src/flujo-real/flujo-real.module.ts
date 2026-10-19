import { Prisma } from "@prisma/client";
import {
  BadRequestException,
  Body,
  ConflictException,
  ForbiddenException,
  Controller,
  Delete,
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
import { OrdenInternaConsultaController, OrdenInternaController, OrdenInternaService } from "./orden-interna";
import { AlcanceService } from "../rbac/alcance.service";
import { LaboratorioOtService } from "../ot/laboratorio-ot.service";
import { motivoNoCapturable } from "../laboratorio/flujo-resultado";
import { conNombres, recalcularVeredictoMuestra } from "../laboratorio/laboratorio.module";
import { traducirFormula } from "../laboratorio/formula-legado";
import { planEdicion, tipoDatoDe, veredictoMuestra, type Especificacion, type TipoDato } from "../laboratorio/especificacion";
import { calcularCaptura, CapturaError, variablesDeCaptura } from "../laboratorio/captura-estandar";
import { veredictoNumerico } from "../laboratorio/veredicto";
import { erroresRegistro, proponerDesdeCotizacion, siguientesCodigos, type MetodoCatalogo } from "./registro-muestras";
import { enlaceOrdenesInternas, erroresRecepcion, normalizarRecepcion, recepcionIncompleta, selloRecepcion, type RecepcionNormalizada } from "./recepcion-muestra";
import { aplicarFactor, erroresFactor, expresionConFactor, factorDe } from "../laboratorio/factor";
import { planAjusteFactor } from "../laboratorio/ajuste-factor";
import { conTraza, exigeMotivoCorreccion, teniaValor } from "../laboratorio/traza";

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

/** Cliente con el que se escribe: el servicio o la transacción en curso. */
type Db = PrismaService | Prisma.TransactionClient;

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
// Servicio y controladores en ./orden-interna.ts (reglas en ./orden-interna.reglas.ts).
export { OrdenInternaController, OrdenInternaConsultaController, OrdenInternaService };

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
    /** Motivo de la corrección (obligatorio al cambiar un valor ya capturado). */
    motivo: z.string().trim().max(1000).optional(),
  });

/** Factor de la fórmula del ensayo en esta OT (resultado.factor). valor NULL = quitarlo. */
const FactorBody = z.object({
  valor: z.number().finite().nullable(),
  operacion: z.enum(["multiplicar", "dividir"]).nullable().optional(),
  descripcion: z.string().trim().max(120).nullable().optional(),
  motivo: z.string().trim().min(5, "Indique el motivo del ajuste del factor (mínimo 5 caracteres).").max(1000),
  /** Aplicar a todos los ensayos de la OT con el mismo método (que aún se puedan corregir). */
  todoElMetodo: z.boolean().optional(),
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
  /** Motivo (obligatorio cuando la jefatura cambia lo que vino del catálogo o la fórmula). */
  motivo: z.string().trim().max(1000).optional(),
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

  private async muestraDeOt(otId: string, muestraId: string, tenantId: string, db: Db = this.prisma) {
    const muestra = await db.muestra.findFirst({
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
    /** Transacción en curso (registro de muestras o de lotes BPCH): todo o nada. */
    db: Db = this.prisma,
  ) {
    // La OT debe existir en el tenant y estar en el alcance del usuario.
    const ot = await this.otEnAlcance(otId, tenantId, req);
    const muestra = await this.muestraDeOt(otId, body.muestraId, tenantId, db);

    // Una OT que aún no tiene laboratorio (p. ej. creada antes de esta
    // versión) lo toma de los métodos pedidos, si todos apuntan al mismo.
    if (!ot.unidadPrincipal) {
      const d = await this.labs.deducir(tenantId, { catMetodoIds: body.metodoIds });
      if (d.unidad)
        await this.labs.fijar(db as PrismaService, {
          tenantId,
          otId,
          unidad: d.unidad,
          usuarioId: req?.user?.sub,
          origen: "metodos_de_la_muestra",
        });
    }

    // Analitos de los métodos pedidos (validando que son del tenant).
    const analitos = await db.catAnalito.findMany({
      where: {
        tenantId,
        deletedAt: null,
        activo: true,
        metodoId: { in: body.metodoIds },
      },
    });

    // Resultados del puente ya existentes para esta muestra (idempotencia).
    const yaExisten = await db.resultado.findMany({
      where: { muestraId: muestra.id, deletedAt: null, catAnalitoId: { not: null } },
      select: { catAnalitoId: true },
    });
    const existentes = new Set(yaExisten.map((r) => r.catAnalitoId));

    // Factor por defecto de cada método: se copia al ensayo (ajustable en la OT).
    const metodosFactor = await db.catMetodo.findMany({
      where: { id: { in: body.metodoIds }, tenantId },
      select: { id: true, factorValor: true, factorOperacion: true, factorDescripcion: true },
    });
    const factorMetodo = new Map(metodosFactor.map((m) => [m.id, factorDe(m.factorValor, m.factorOperacion, m.factorDescripcion)]));

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
        (await db.catEspecificacion.findFirst({
          where: { analitoId: a.id, tenantId, deletedAt: null, activo: true, ambito: "estandar" },
        })) ??
        (await db.catEspecificacion.findFirst({
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
      const factor = factorMetodo.get(a.metodoId) ?? null;

      await conTraza(db, { usuarioId: req?.user?.sub, origen: "registro" }, (tx) => tx.resultado.create({
        data: {
          ...(factor
            ? { factorValor: factor.valor, factorOperacion: factor.operacion, factorDescripcion: factor.descripcion ?? null, factorOrigen: "metodo" }
            : {}),
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
      }));
      existentes.add(a.id);
      creados++;
    }

    await recalcularVeredictoMuestra(db as PrismaService, muestra.id);
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
    // Corregir un valor ya capturado (aún sin revisar) exige motivo: queda en el historial.
    const corrige = teniaValor(resultado);
    const motivo = entrada.motivo?.trim() || null;
    if (exigeMotivoCorreccion(resultado.estado, corrige) && (!motivo || motivo.length < 5))
      throw new BadRequestException(
        "Este ensayo ya tiene un valor capturado: indique el motivo de la corrección (mínimo 5 caracteres). Queda en el historial del resultado.",
      );

    let calc;
    try {
      calc = calcularCaptura(
        {
          tipoDato, limiteInf: resultado.limiteInf, nominal: resultado.nominal, limiteSup: resultado.limiteSup, formula: resultado.formula,
          factor: factorDe(resultado.factorValor, resultado.factorOperacion, resultado.factorDescripcion),
        },
        entrada,
      );
    } catch (e) {
      if (e instanceof CapturaError) throw new BadRequestException(e.message);
      throw e;
    }

    const actualizado = await conTraza(
      this.prisma,
      { usuarioId: req?.user?.sub, motivo: motivo ?? (resultado.estado === "devuelto" ? resultado.motivoDevolucion : null), origen: corrige ? "correccion" : "captura" },
      (tx) => tx.resultado.update({
      where: { id },
      data: {
        valorSinFactor: calc.valorSinFactor,
        // Lo de ESTA captura: variables y lecturas que no vengan se vacían (no quedan las de una captura anterior).
        variables: variablesDeCaptura(entrada.variables) ?? Prisma.DbNull,
        valorNumerico: calc.valorNumerico,
        valorTexto: calc.valorTexto,
        replicas: calc.replicas,
        promedio: calc.promedio,
        desviacion: calc.desviacion,
        cv: calc.cv,
        resultadoFinal: calc.resultadoFinal,
        formulaAplicada: calc.formulaAplicada,
        lecturas: calc.lecturas ?? Prisma.DbNull,
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
    }));
    const veredictoDeLaMuestra = await recalcularVeredictoMuestra(this.prisma, resultado.muestraId);
    return { ...actualizado, veredictoMuestra: veredictoDeLaMuestra };
  }

  /**
   * Ajusta el factor de la fórmula del ensayo en esta OT (permiso
   * resultado.factor; motivo obligatorio). Si el ensayo ya tiene un valor
   * calculado, se recalcula desde el valor sin factor y se vuelve a evaluar el
   * veredicto. Con `todoElMetodo`, a todos los ensayos de la OT con el mismo
   * método que aún se pueden corregir. Lo revisado o aprobado no se toca.
   */
  async ajustarFactor(id: string, body: z.infer<typeof FactorBody>, tenantId: string, req: any) {
    const { resultado, otId } = await this.resultadoEnAlcance(id, tenantId, req);
    const operacion = body.valor == null ? null : body.operacion ?? null;
    const errores = erroresFactor({ valor: body.valor, operacion });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const nuevo = body.valor == null ? null : factorDe(body.valor, operacion, body.descripcion ?? null);

    const objetivo =
      body.todoElMetodo && resultado.catMetodoId && otId
        ? await this.prisma.resultado.findMany({ where: { otId, catMetodoId: resultado.catMetodoId, deletedAt: null } })
        : [resultado];
    const bloqueo = motivoNoCapturable(resultado.estado);
    if (bloqueo) throw new ConflictException(bloqueo.replace("corregirlo", "cambiar su factor"));

    const ahora = new Date();
    const hechos: string[] = [];
    const omitidos: { id: string; motivo: string }[] = [];
    await conTraza(this.prisma, { usuarioId: req?.user?.sub, motivo: body.motivo, origen: "factor" }, async (tx) => {
      for (const r of objetivo) {
        const b = motivoNoCapturable(r.estado);
        if (b) { omitidos.push({ id: r.id, motivo: b }); continue; }
        // Nunca queda un factor que no se aplicó: se recalcula desde las lecturas o
        // réplicas guardadas; un valor ingresado directo no lleva factor (omitido).
        const plan = planAjusteFactor(r, nuevo);
        if (plan.accion === "omitir") { omitidos.push({ id: r.id, motivo: plan.motivo }); continue; }
        const data: Record<string, unknown> = {
          factorValor: nuevo?.valor ?? null,
          factorOperacion: nuevo?.operacion ?? null,
          factorDescripcion: nuevo ? body.descripcion ?? r.factorDescripcion ?? null : null,
          factorOrigen: "orden",
          factorEditadoPor: req?.user?.sub ?? null,
          factorEditadoAt: ahora,
          factorMotivo: body.motivo,
          ...(plan.accion === "recalcular" ? plan.datos : {}),
        };
        await tx.resultado.update({ where: { id: r.id }, data });
        hechos.push(r.id);
      }
    });
    const muestras = [...new Set(objetivo.filter((r) => hechos.includes(r.id)).map((r) => r.muestraId))];
    for (const m of muestras) await recalcularVeredictoMuestra(this.prisma, m);
    const actualizado = await this.prisma.resultado.findFirst({ where: { id }, include: { catAnalito: true, catMetodo: true } });
    return { ...actualizado, actualizados: hechos.length, omitidos };
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
    const motivo = pedido.motivo?.trim() || null;
    if (plan.requiereJefatura && (!motivo || motivo.length < 5))
      throw new BadRequestException(
        "Indique el motivo del cambio (mínimo 5 caracteres): se cambia lo que vino del catálogo o la fórmula, y queda en el historial del resultado.",
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

    const actualizado = await conTraza(this.prisma, { usuarioId: req?.user?.sub, motivo, origen: "especificacion" }, (tx) => tx.resultado.update({
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
    }));
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

  /**
   * Factor de la fórmula del ensayo en esta OT. Por defecto lo ajusta la
   * jefatura (resultado.factor); el IDIC puede dar el permiso al analista.
   */
  @Patch(":id/factor")
  @RequierePermiso("resultado.factor")
  @ApiOperation({ summary: "Ajusta el factor (multiplicar/dividir) de la fórmula de un ensayo en la OT, con motivo" })
  factor(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.ajustarFactor(id, FactorBody.parse(body ?? {}), tenantDe(req), req);
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
/** Recepción e identificación de la muestra (recepcion-muestra.ts). */
const RecepcionBody = z.object({
  tomaMuestra: z.string().trim().max(60).nullable().optional(),
  condicionRecepcion: z.enum(["cumple", "no_cumple"]).nullable().optional(),
  condicionObservacion: z.string().max(2000).nullable().optional(),
  selloNumero: z.string().max(40).nullable().optional(),
  identificacionCliente: z.string().max(300).nullable().optional(),
  requiereOtrosLabs: z.boolean().optional(),
  otrosLabs: z.array(z.string().uuid()).max(20).optional(),
  otrosLabsDetalle: z.string().max(2000).nullable().optional(),
});

const RegistrarMuestrasBody = z.object({
  muestras: z
    .array(
      z.object({
        nombre: z.string().trim().max(200),
        metodoIds: z.array(z.string().uuid()).max(200),
        catElementoId: z.string().uuid().optional(),
        /** Datos de recepción (la pantalla los envía siempre; la API los admite opcionales). */
        recepcion: RecepcionBody.optional(),
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
    private readonly labs: LaboratorioOtService,
  ) {}

  private async otEnAlcance(otId: string, tenantId: string, req: any) {
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id: otId, tenantId } });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    return ot;
  }

  /** Opciones vigentes de «Toma de muestra» (Catálogo › Parámetros, categoría toma_muestra). */
  private opcionesToma(tenantId: string) {
    return this.prisma.$queryRawUnsafe<{ codigo: string; etiqueta: string }[]>(
      `SELECT codigo, etiqueta FROM parametro_sistema
        WHERE tenant_id = $1::uuid AND categoria = 'toma_muestra' AND activo
        ORDER BY orden, etiqueta`,
      tenantId,
    );
  }

  /** Normaliza y valida la recepción; los laboratorios deben existir y ser operativos. */
  private async validarRecepcion(
    tenantId: string,
    r: z.infer<typeof RecepcionBody>,
    labPrincipal: string | null,
    prefijo: string,
    opciones: string[],
  ) {
    const n = normalizarRecepcion(r);
    const errores = erroresRecepcion(n, opciones, labPrincipal, prefijo);
    for (const u of n.otrosLabs) {
      try {
        await this.labs.validarUnidad(tenantId, u);
      } catch (e: any) {
        errores.push(`${prefijo}${e?.message ?? "laboratorio no válido"}`);
      }
    }
    return { n, errores };
  }

  /**
   * Campos de la recepción. `previo` = quién/cuándo ya registrado: si la muestra
   * ya tenía recepción, se conserva y la corrección queda aparte
   * (recepcion_corregida_por/_at); ver selloRecepcion.
   */
  private datosRecepcion(
    n: RecepcionNormalizada,
    usuarioId: string | null,
    previo: { recepcionadaAt: Date | null; recepcionadaPor: string | null; recepcionCorregidaAt: Date | null; recepcionCorregidaPor: string | null } | null = null,
  ) {
    return {
      tomaMuestra: n.tomaMuestra,
      condicionRecepcion: n.condicionRecepcion,
      condicionObservacion: n.condicionObservacion,
      selloNumero: n.selloNumero,
      identificacionCliente: n.identificacionCliente,
      requiereOtrosLabs: n.requiereOtrosLabs,
      otrosLabs: n.otrosLabs,
      otrosLabsDetalle: n.otrosLabsDetalle,
      ...selloRecepcion(previo, usuarioId, new Date()),
    };
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
              m.toma_muestra AS "tomaMuestra", m.condicion_recepcion AS "condicionRecepcion",
              m.condicion_observacion AS "condicionObservacion", m.sello_numero AS "selloNumero",
              m.identificacion_cliente AS "identificacionCliente", m.requiere_otros_labs AS "requiereOtrosLabs",
              m.otros_labs AS "otrosLabs", m.otros_labs_detalle AS "otrosLabsDetalle",
              m.recepcionada_at AS "recepcionadaAt", u.nombre_completo AS "recepcionadaPorNombre",
              m.recepcion_corregida_at AS "recepcionCorregidaAt", uc.nombre_completo AS "recepcionCorregidaPorNombre",
              (SELECT count(*) FROM resultado r WHERE r.muestra_id = m.id AND r.deleted_at IS NULL)::int AS ensayos,
              COALESCE((SELECT array_agg(DISTINCT cm.codigo) FROM resultado r JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
                         WHERE r.muestra_id = m.id AND r.deleted_at IS NULL), '{}') AS metodos
         FROM muestra m
         LEFT JOIN usuario u ON u.id = m.recepcionada_por
         LEFT JOIN usuario uc ON uc.id = m.recepcion_corregida_por
        WHERE m.ot_id = $1::uuid AND m.deleted_at IS NULL
        ORDER BY m.created_at, m.codigo`,
      otId,
    );
    // Órdenes internas de la OT: se enlazan con los «otros laboratorios» de cada
    // muestra. Su destino es un laboratorio del catálogo (cat_familia); se pasa a
    // la unidad del organigrama por el código CODSUCDEL.
    const ordenes = await this.prisma.$queryRawUnsafe<{ id: string; numero: string; destinoLab: string | null; estado: string }[]>(
      `SELECT oi.id, oi.numero, oi.estado, u.id AS "destinoLab"
         FROM orden_interna oi
         LEFT JOIN cat_familia f ON f.id = oi.destino_lab
         LEFT JOIN unidad u ON u.tenant_id = oi.tenant_id AND u.codsucdel = f.codsucdel
        WHERE oi.ot_id = $1::uuid AND oi.tenant_id = $2::uuid AND oi.deleted_at IS NULL AND oi.estado <> 'anulada'
        ORDER BY oi.created_at`,
      otId,
      tenantId,
    );
    const labIds = [...new Set(muestras.flatMap((m) => (m.otrosLabs ?? []) as string[]))];
    const labs = labIds.length
      ? await this.prisma.unidad.findMany({ where: { id: { in: labIds } }, select: { id: true, codigo: true, nombre: true } })
      : [];
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
      muestras: muestras.map((m) => ({
        ...m,
        ensayos: Number(m.ensayos),
        recepcionIncompleta: recepcionIncompleta(m),
        otrosLabsEnlace: enlaceOrdenesInternas(m.otrosLabs ?? [], ordenes).map((e) => ({
          ...e,
          unidad: labs.find((l) => l.id === e.unidadId) ?? null,
        })),
      })),
      opcionesToma: await this.opcionesToma(tenantId),
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

  /**
   * Crea las muestras y genera sus ensayos por analizar (puente catálogo →
   * resultado). Todo o nada: dentro de `db` si viene de otra operación (lotes
   * BPCH) o en una transacción propia; si una muestra falla, no queda ninguna.
   */
  async registrar(otId: string, body: z.infer<typeof RegistrarMuestrasBody>, tenantId: string, req: any, db?: Db) {
    if (db) return this.registrarEn(db, otId, body, tenantId, req);
    return this.prisma.$transaction((tx) => this.registrarEn(tx, otId, body, tenantId, req), { maxWait: 15_000, timeout: 120_000 });
  }

  private async registrarEn(db: Db, otId: string, body: z.infer<typeof RegistrarMuestrasBody>, tenantId: string, req: any) {
    const ot = await this.otEnAlcance(otId, tenantId, req);
    const ids = [...new Set(body.muestras.flatMap((m) => m.metodoIds))];
    const catalogo = new Map((await this.metodos(tenantId, { ids })).map((m) => [m.id, m]));
    const errores = erroresRegistro(ot.estado, body.muestras, catalogo);
    // Recepción de cada muestra (si se envía): toma de muestra, condición, sello…
    const opciones = (await this.opcionesToma(tenantId)).map((o) => o.codigo);
    const recepciones: (RecepcionNormalizada | null)[] = [];
    for (let i = 0; i < body.muestras.length; i++) {
      const r = body.muestras[i].recepcion;
      if (!r) {
        recepciones.push(null);
        continue;
      }
      const prefijo = body.muestras.length > 1 ? `Muestra ${i + 1}: ` : "";
      const v = await this.validarRecepcion(tenantId, r, ot.unidadPrincipal, prefijo, opciones);
      errores.push(...v.errores);
      recepciones.push(v.n);
    }
    if (errores.length) throw new BadRequestException(errores.join(" "));

    const existentes = await db.muestra.findMany({
      where: { tenantId, codigo: { startsWith: ot.codigo } },
      select: { codigo: true },
    });
    const codigos = siguientesCodigos(ot.codigo, existentes.map((e) => e.codigo), body.muestras.length);

    const creadas: { id: string; codigo: string; nombre: string; ensayos: number; metodos: string[] }[] = [];
    for (let i = 0; i < body.muestras.length; i++) {
      const m = body.muestras[i];
      const muestra = await db.muestra.create({
        data: {
          tenantId,
          otId,
          codigo: codigos[i],
          nombre: m.nombre.trim(),
          clienteId: ot.clienteId,
          estado: "recibida",
          catElementoId: m.catElementoId ?? ot.catElementoId ?? null,
          ...(recepciones[i] ? this.datosRecepcion(recepciones[i]!, req?.user?.sub ?? null) : {}),
        },
      });
      const g = await this.puente.generarAnalisis(otId, { muestraId: muestra.id, metodoIds: m.metodoIds }, tenantId, req, db);
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
      await db.ordenTrabajo.update({ where: { id: otId }, data: { fechaRecepcion: new Date() } });

    await db.$executeRawUnsafe(
      `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id)
       VALUES ($1::uuid, $2::uuid, 'registro_muestras', $3::jsonb, $4::uuid)`,
      tenantId,
      otId,
      JSON.stringify({ muestras: creadas.map((c) => ({ codigo: c.codigo, nombre: c.nombre, ensayos: c.ensayos, metodos: c.metodos })) }),
      req?.user?.sub ?? null,
    );
    return { otId, muestras: creadas, ensayos: creadas.reduce((s, c) => s + c.ensayos, 0) };
  }

  /**
   * Completa o corrige la recepción de una muestra ya registrada (toma de
   * muestra, condición, sello, identificación del cliente, otros laboratorios).
   * Queda en el historial de la OT con lo anterior y lo nuevo.
   */
  async actualizarRecepcion(muestraId: string, body: z.infer<typeof RecepcionBody>, tenantId: string, req: any) {
    const m = await this.prisma.muestra.findFirst({ where: { id: muestraId, tenantId, deletedAt: null } });
    if (!m || !m.otId) throw new NotFoundException(`Muestra ${muestraId} no encontrada`);
    const ot = await this.otEnAlcance(m.otId, tenantId, req);
    if (["cerrada", "anulada"].includes(ot.estado))
      throw new ConflictException(`La OT está ${ot.estado}: no se modifica la recepción de sus muestras.`);
    const opciones = (await this.opcionesToma(tenantId)).map((o) => o.codigo);
    const { n, errores } = await this.validarRecepcion(tenantId, body, ot.unidadPrincipal, "", opciones);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    // El historial guarda la recepción anterior COMPLETA, con quién y cuándo se
    // recibió y la corrección previa si la hubo.
    const anterior = {
      tomaMuestra: m.tomaMuestra,
      condicionRecepcion: m.condicionRecepcion,
      condicionObservacion: m.condicionObservacion,
      selloNumero: m.selloNumero,
      identificacionCliente: m.identificacionCliente,
      requiereOtrosLabs: m.requiereOtrosLabs,
      otrosLabs: m.otrosLabs,
      otrosLabsDetalle: m.otrosLabsDetalle,
      recepcionadaAt: m.recepcionadaAt,
      recepcionadaPor: m.recepcionadaPor,
      recepcionCorregidaAt: m.recepcionCorregidaAt,
      recepcionCorregidaPor: m.recepcionCorregidaPor,
    };
    const datos = this.datosRecepcion(n, req?.user?.sub ?? null, m);
    const actualizada = await this.prisma.$transaction(async (tx) => {
      const u = await tx.muestra.update({ where: { id: muestraId }, data: datos });
      await tx.$executeRawUnsafe(
        `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id)
         VALUES ($1::uuid, $2::uuid, 'recepcion_muestra', $3::jsonb, $4::uuid)`,
        tenantId,
        ot.id,
        JSON.stringify({ muestra: m.codigo, anterior, nuevo: { ...n, ...datos } }),
        req?.user?.sub ?? null,
      );
      return u;
    });
    return actualizada;
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

@ApiTags("flujo-puente")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("flujo/muestras")
export class RecepcionMuestraController {
  constructor(private readonly svc: RegistroMuestrasService) {}

  @Patch(":id/recepcion")
  @RequierePermiso("muestra.crear")
  @ApiOperation({ summary: "Completa o corrige la recepción de una muestra (toma, condición, sello, identificación, otros laboratorios)" })
  recepcion(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.actualizarRecepcion(id, RecepcionBody.parse(body ?? {}), tenantDe(req), req);
  }
}

/* ============================ MÓDULO ============================ */

@Module({
  controllers: [
    SolicitudCosteoController,
    // Las rutas estáticas de órdenes internas (destinos, ot/:otId) van ANTES que el CRUD.
    OrdenInternaConsultaController,
    OrdenInternaController,
    // El controlador de /sugerir va ANTES que el CRUD para ganar a `@Get(":id")`.
    FormatoInformeSugerirController,
    FormatoInformeController,
    FlujoOtController,
    CosteoController,
    PuenteOtController,
    PuenteResultadoController,
    RegistroMuestrasController,
    RecepcionMuestraController,
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
