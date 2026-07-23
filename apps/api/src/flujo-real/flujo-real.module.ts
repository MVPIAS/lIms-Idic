import {
  Body,
  ConflictException,
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
const CapturarValorBody = z.object({
  valor: z.union([z.number().finite(), z.string().min(1).max(120)]),
});

/** Parsea un texto de límite a número; NULL si no es numérico ('cumple', ''…). */
function aNumero(v?: string | null): number | null {
  if (v == null) return null;
  const s = String(v).trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Tolerancia numérica para las comparaciones de cota (evita falsos no_cumple por
 * ruido de coma flotante en valores como 3600.0000001). */
const TOL_NUMERICA = 1e-9;

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
  constructor(private readonly prisma: PrismaService) {}

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
  ) {
    // La OT debe existir en el tenant.
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id: otId, tenantId } });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    const muestra = await this.muestraDeOt(otId, body.muestraId, tenantId);

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

      const limiteInf = espec?.limiteInf ?? a.rangoMin ?? null;
      const nominal = espec?.nominal ?? a.rangoNominal ?? null;
      const limiteSup = espec?.limiteSup ?? a.rangoMax ?? null;
      const unidad = espec?.unidad ?? a.unidad ?? null;

      await this.prisma.resultado.create({
        data: {
          otId,
          muestraId: muestra.id,
          analitoId: null, // resultado del PUENTE: usa cat_analito_id
          catMetodoId: a.metodoId,
          catAnalitoId: a.id,
          unidad,
          formula: a.formula ?? null,
          limiteInf,
          nominal,
          limiteSup,
          veredicto: "pendiente",
        },
      });
      existentes.add(a.id);
      creados++;
    }

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
  async capturarValor(id: string, valor: number | string, tenantId: string) {
    const resultado = await this.prisma.resultado.findFirst({
      where: { id, deletedAt: null, muestra: { tenantId } },
      include: { muestra: { select: { tenantId: true } } },
    });
    if (!resultado) throw new NotFoundException(`Resultado ${id} no encontrado`);

    const valorNum = typeof valor === "number" ? valor : aNumero(valor);
    const inf = aNumero(resultado.limiteInf);
    const sup = aNumero(resultado.limiteSup);

    let veredicto: "cumple" | "no_cumple" | "pendiente";
    if (valorNum != null && (inf != null || sup != null)) {
      // --- Rama NUMÉRICA: una o dos cotas numéricas. ---
      const bajoMinimo = inf != null && valorNum < inf - TOL_NUMERICA;
      const sobreMaximo = sup != null && valorNum > sup + TOL_NUMERICA;
      veredicto = bajoMinimo || sobreMaximo ? "no_cumple" : "cumple";
    } else {
      // --- Rama CUALITATIVA: referencia textual esperada vs valor textual. ---
      const esperado =
        refCualitativa(resultado.nominal) ??
        refCualitativa(resultado.limiteInf) ??
        refCualitativa(resultado.limiteSup);
      const valorTxt = String(valor).trim().toLowerCase();
      if (esperado != null && valorTxt !== "") {
        veredicto = esperado === valorTxt ? "cumple" : "no_cumple";
      } else {
        // Sin cota numérica y sin referencia textual comparable -> manual.
        veredicto = "pendiente";
      }
    }

    return this.prisma.resultado.update({
      where: { id },
      data: {
        valorNumerico: valorNum,
        valorTexto: String(valor),
        veredicto,
      },
      include: { catAnalito: true, catMetodo: true },
    });
  }

  /**
   * Resultados de todas las muestras de una OT, con analito/método/
   * especificación/valor/veredicto, más un resumen (cumple/no_cumple/pendiente)
   * para el expediente/informe.
   */
  async resultadosDeOt(otId: string, tenantId: string) {
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id: otId, tenantId } });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);

    const muestras = await this.prisma.muestra.findMany({
      where: { otId, tenantId, deletedAt: null },
      select: { id: true },
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
          orderBy: { fecha: "desc" },
        })
      : [];

    const resumen = { total: resultados.length, cumple: 0, no_cumple: 0, pendiente: 0 };
    for (const r of resultados) {
      if (r.veredicto === "cumple") resumen.cumple++;
      else if (r.veredicto === "no_cumple") resumen.no_cumple++;
      else resumen.pendiente++;
    }

    return { otId, muestras: muestraIds.length, resumen, resultados };
  }
}

@ApiTags("flujo-puente")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("flujo/ot")
export class PuenteOtController {
  constructor(private readonly svc: PuenteAnalisisService) {}

  @Post(":id/generar-analisis")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "Materializa los métodos del panel (cat_metodo) como resultados por analizar" })
  generarAnalisis(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.generarAnalisis(id, GenerarAnalisisBody.parse(body), tenantDe(req));
  }

  @Get(":id/resultados")
  @RequierePermiso("resultado.ver")
  @ApiOperation({ summary: "Resultados de las muestras de la OT + resumen de veredictos" })
  resultados(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.resultadosDeOt(id, tenantDe(req));
  }
}

@ApiTags("flujo-puente")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("flujo/resultado")
export class PuenteResultadoController {
  constructor(private readonly svc: PuenteAnalisisService) {}

  @Post(":id/valor")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "Captura el valor de un resultado del puente y calcula su veredicto" })
  capturarValor(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const { valor } = CapturarValorBody.parse(body);
    return this.svc.capturarValor(id, valor, tenantDe(req));
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
  ],
  providers: [
    SolicitudCosteoService,
    OrdenInternaService,
    FormatoInformeService,
    FlujoOtService,
    CosteoService,
    PuenteAnalisisService,
  ],
})
export class FlujoRealModule {}
