import {
  Controller,
  Get,
  Injectable,
  Module,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../common/prisma.service";
import { DEV_TENANT } from "../common/base-crud.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";

/**
 * =============================================================================
 * SPC · CONTROL ESTADÍSTICO DE PROCESOS (requisitos contrato 4.2.2 / 4.3.6).
 *
 * SOLO LECTURA. Agrega los resultados históricos numéricos que ya viven en la
 * tabla `resultado` (columna `valor_numerico`, materializada por el puente del
 * catálogo v2, ver flujo-real.module.ts) y calcula los estadísticos necesarios
 * para dibujar en el frontend:
 *   · Gráfico de control X̄ (Shewhart): media (LC) ± 3σ (LSC/LIC).
 *   · Gráfico de amplitud (R): rango móvil |xi − xi−1| y su límite (D4·MR̄).
 *   · Histograma: la propia serie de valores.
 *   · Cp/Cpk: si el histórico arrastra una especificación (limite_inf/sup).
 *
 * NO crea tablas ni columnas nuevas. NO toca schema.prisma ni el módulo qc.
 *
 * Rutas:
 *   GET /spc/analitos                       · analitos con ≥ N resultados numéricos
 *   GET /spc/series?catAnalitoId&catMetodoId&desde&hasta · serie + estadísticos
 *
 * Permiso RBAC: `resultado.ver` (el mismo que usa el puente para leer resultados).
 *
 * El tenant se resuelve por la muestra (resultado no tiene tenant_id propio;
 * cuelga de muestra.tenant_id). La ordenación temporal usa `resultado.fecha`.
 * =============================================================================
 */

/** Permiso RBAC real de lectura de resultados. */
const PERM_VER = "resultado.ver";

/** Mínimo de resultados numéricos para que un analito aparezca en el selector. */
const MIN_RESULTADOS = 2;

/** Constante D4 de la carta de rangos móviles (subgrupo n=2). LCL_R = 0. */
const D4_MR = 3.267;
/** Constante d2 de la carta de rangos móviles (subgrupo n=2): σ̂ = MR̄ / d2. */
const D2_MR = 1.128;

/** Extrae el tenant del usuario autenticado; en dev cae al tenant por defecto. */
function tenantDe(req: any): string {
  return req?.user?.tenantId ?? DEV_TENANT;
}

/** Parsea un texto de límite (posible coma decimal) a número; NULL si no numérico. */
function aNumero(v?: string | number | null): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Redondeo a `d` decimales estable para JSON. */
function round(n: number, d = 6): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export interface SpcPunto {
  fecha: string;
  valor: number;
  otCodigo?: string | null;
  muestraCodigo?: string | null;
}

export interface SpcEstadisticos {
  n: number;
  media: number | null;
  desviacion: number | null; // muestral (n-1)
  min: number | null;
  max: number | null;
  // Carta X̄ (Shewhart, ±3σ)
  lc: number | null;
  lsc: number | null;
  lic: number | null;
  // Carta de rango móvil (R)
  rangoMovilMedio: number | null;
  lscR: number | null;
  licR: number | null;
  sigmaEstimadaR: number | null; // σ̂ = MR̄ / d2 (variabilidad de corto plazo)
  // Fuera de control (índices de la serie X̄, base 0)
  fueraDeControl: number[];
  // Especificación arrastrada del catálogo (si el histórico la trae)
  especInf: number | null;
  especSup: number | null;
  // Capacidad (solo si hay al menos una especificación numérica y σ > 0)
  cp: number | null;
  cpk: number | null;
}

export interface SpcSeriesResponse {
  catAnalitoId: string;
  catMetodoId: string | null;
  analito: { id: string; codigo: string; nombre: string; unidad: string | null } | null;
  metodo: { id: string; codigo: string; nombre: string } | null;
  desde: string | null;
  hasta: string | null;
  puntos: SpcPunto[];
  estadisticos: SpcEstadisticos;
}

@Injectable()
export class SpcService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Analitos (cat_analito) que tienen ≥ MIN_RESULTADOS resultados numéricos
   * en el tenant, con su conteo y su método, para poblar el selector.
   * Agrupa por (cat_analito, cat_metodo): un mismo analito puede haberse
   * medido por distintos métodos, y la serie SPC se pide por ese par.
   */
  async analitos(tenantId: string) {
    const grupos = await this.prisma.resultado.groupBy({
      by: ["catAnalitoId", "catMetodoId"],
      where: {
        deletedAt: null,
        catAnalitoId: { not: null },
        valorNumerico: { not: null },
        muestra: { tenantId, deletedAt: null },
      },
      _count: { _all: true },
    });

    const utiles = grupos.filter((g) => g.catAnalitoId && g._count._all >= MIN_RESULTADOS);
    if (utiles.length === 0) return [];

    const analitoIds = Array.from(new Set(utiles.map((g) => g.catAnalitoId!).filter(Boolean)));
    const metodoIds = Array.from(new Set(utiles.map((g) => g.catMetodoId).filter((x): x is string => !!x)));

    const [analitos, metodos] = await Promise.all([
      this.prisma.catAnalito.findMany({
        where: { id: { in: analitoIds }, tenantId },
        select: { id: true, codigo: true, nombre: true, unidad: true, metodoId: true },
      }),
      metodoIds.length
        ? this.prisma.catMetodo.findMany({
            where: { id: { in: metodoIds }, tenantId },
            select: { id: true, codigo: true, nombre: true },
          })
        : Promise.resolve([] as { id: string; codigo: string; nombre: string }[]),
    ]);

    const aById = new Map(analitos.map((a) => [a.id, a]));
    const mById = new Map(metodos.map((m) => [m.id, m]));

    return utiles
      .map((g) => {
        const a = aById.get(g.catAnalitoId!);
        const m = g.catMetodoId ? mById.get(g.catMetodoId) : null;
        return {
          catAnalitoId: g.catAnalitoId!,
          catMetodoId: g.catMetodoId,
          n: g._count._all,
          codigo: a?.codigo ?? "—",
          nombre: a?.nombre ?? "(analito sin catálogo)",
          unidad: a?.unidad ?? null,
          metodo: m ? { id: m.id, codigo: m.codigo, nombre: m.nombre } : null,
        };
      })
      .filter((x) => x.nombre) // descarta huérfanos sin analito de catálogo
      .sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre));
  }

  /**
   * Serie temporal de `valor_numerico` (no nulos) para un analito/método, con
   * los estadísticos de las cartas X̄ y R e (si procede) Cp/Cpk.
   */
  async series(
    tenantId: string,
    catAnalitoId: string,
    catMetodoId?: string,
    desde?: string,
    hasta?: string,
  ): Promise<SpcSeriesResponse> {
    const fechaDesde = desde ? new Date(desde) : null;
    const fechaHasta = hasta ? new Date(hasta) : null;
    const desdeOk = fechaDesde && !isNaN(fechaDesde.getTime()) ? fechaDesde : null;
    const hastaOk = fechaHasta && !isNaN(fechaHasta.getTime()) ? fechaHasta : null;

    const rows = await this.prisma.resultado.findMany({
      where: {
        deletedAt: null,
        catAnalitoId,
        ...(catMetodoId ? { catMetodoId } : {}),
        valorNumerico: { not: null },
        muestra: { tenantId, deletedAt: null },
        ...(desdeOk || hastaOk
          ? { fecha: { ...(desdeOk ? { gte: desdeOk } : {}), ...(hastaOk ? { lte: hastaOk } : {}) } }
          : {}),
      },
      select: {
        otId: true,
        fecha: true,
        valorNumerico: true,
        limiteInf: true,
        limiteSup: true,
        muestra: { select: { codigo: true } },
      },
      orderBy: { fecha: "asc" },
    });

    // Códigos de OT (resultado.ot_id no tiene relación Prisma directa aquí).
    const otIds = Array.from(new Set(rows.map((r) => r.otId).filter((x): x is string => !!x)));
    const ots = otIds.length
      ? await this.prisma.ordenTrabajo.findMany({
          where: { id: { in: otIds }, tenantId },
          select: { id: true, codigo: true },
        })
      : [];
    const otCodigo = new Map(ots.map((o) => [o.id, o.codigo]));

    const puntos: SpcPunto[] = rows.map((r) => ({
      fecha: r.fecha.toISOString(),
      valor: round(Number(r.valorNumerico)),
      otCodigo: r.otId ? otCodigo.get(r.otId) ?? null : null,
      muestraCodigo: r.muestra?.codigo ?? null,
    }));

    // Especificación arrastrada: la más reciente que traiga cotas numéricas.
    let especInf: number | null = null;
    let especSup: number | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const inf = aNumero(rows[i].limiteInf);
      const sup = aNumero(rows[i].limiteSup);
      if (inf != null || sup != null) {
        especInf = inf;
        especSup = sup;
        break;
      }
    }

    const [analito, metodo] = await Promise.all([
      this.prisma.catAnalito.findFirst({
        where: { id: catAnalitoId, tenantId },
        select: { id: true, codigo: true, nombre: true, unidad: true },
      }),
      catMetodoId
        ? this.prisma.catMetodo.findFirst({
            where: { id: catMetodoId, tenantId },
            select: { id: true, codigo: true, nombre: true },
          })
        : Promise.resolve(null),
    ]);

    const estadisticos = this.calcular(
      puntos.map((p) => p.valor),
      especInf,
      especSup,
    );

    return {
      catAnalitoId,
      catMetodoId: catMetodoId ?? null,
      analito,
      metodo,
      desde: desdeOk ? desdeOk.toISOString() : null,
      hasta: hastaOk ? hastaOk.toISOString() : null,
      puntos,
      estadisticos,
    };
  }

  /** Núcleo estadístico: X̄±3σ, rango móvil (R), fuera de control y Cp/Cpk. */
  private calcular(valores: number[], especInf: number | null, especSup: number | null): SpcEstadisticos {
    const n = valores.length;
    const base: SpcEstadisticos = {
      n,
      media: null,
      desviacion: null,
      min: null,
      max: null,
      lc: null,
      lsc: null,
      lic: null,
      rangoMovilMedio: null,
      lscR: null,
      licR: null,
      sigmaEstimadaR: null,
      fueraDeControl: [],
      especInf,
      especSup,
      cp: null,
      cpk: null,
    };
    if (n === 0) return base;

    const media = valores.reduce((s, v) => s + v, 0) / n;
    const min = Math.min(...valores);
    const max = Math.max(...valores);

    // Desviación muestral (n-1). Con n=1 no está definida.
    let desviacion: number | null = null;
    if (n > 1) {
      const ss = valores.reduce((s, v) => s + (v - media) ** 2, 0);
      desviacion = Math.sqrt(ss / (n - 1));
    }

    // Rango móvil |xi − xi−1|.
    const rangos: number[] = [];
    for (let i = 1; i < n; i++) rangos.push(Math.abs(valores[i] - valores[i - 1]));
    const mrBar = rangos.length ? rangos.reduce((s, v) => s + v, 0) / rangos.length : null;
    const sigmaR = mrBar != null ? mrBar / D2_MR : null;

    // Fuera de control en la carta X̄ (respecto a media ± 3σ muestral).
    const lsc = desviacion != null ? media + 3 * desviacion : null;
    const lic = desviacion != null ? media - 3 * desviacion : null;
    const fueraDeControl: number[] = [];
    if (lsc != null && lic != null) {
      valores.forEach((v, i) => {
        if (v > lsc || v < lic) fueraDeControl.push(i);
      });
    }

    // Capacidad: necesita σ > 0 y al menos una especificación numérica.
    let cp: number | null = null;
    let cpk: number | null = null;
    if (desviacion != null && desviacion > 0) {
      if (especInf != null && especSup != null) {
        cp = (especSup - especInf) / (6 * desviacion);
      }
      const cpks: number[] = [];
      if (especSup != null) cpks.push((especSup - media) / (3 * desviacion));
      if (especInf != null) cpks.push((media - especInf) / (3 * desviacion));
      if (cpks.length) cpk = Math.min(...cpks);
    }

    return {
      n,
      media: round(media),
      desviacion: desviacion != null ? round(desviacion) : null,
      min: round(min),
      max: round(max),
      lc: round(media),
      lsc: lsc != null ? round(lsc) : null,
      lic: lic != null ? round(lic) : null,
      rangoMovilMedio: mrBar != null ? round(mrBar) : null,
      lscR: mrBar != null ? round(D4_MR * mrBar) : null,
      licR: mrBar != null ? 0 : null,
      sigmaEstimadaR: sigmaR != null ? round(sigmaR) : null,
      fueraDeControl,
      especInf,
      especSup,
      cp: cp != null ? round(cp, 3) : null,
      cpk: cpk != null ? round(cpk, 3) : null,
    };
  }
}

@ApiTags("spc")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("spc")
export class SpcController {
  constructor(private readonly svc: SpcService) {}

  @Get("analitos")
  @RequierePermiso(PERM_VER)
  @ApiOperation({ summary: "Analitos con ≥N resultados numéricos (selector SPC)" })
  analitos(@Req() req: any) {
    return this.svc.analitos(tenantDe(req));
  }

  @Get("series")
  @RequierePermiso(PERM_VER)
  @ApiOperation({ summary: "Serie temporal + estadísticos SPC (X̄, R, Cp/Cpk) de un analito/método" })
  series(
    @Query("catAnalitoId") catAnalitoId: string,
    @Query("catMetodoId") catMetodoId: string | undefined,
    @Query("desde") desde: string | undefined,
    @Query("hasta") hasta: string | undefined,
    @Req() req: any,
  ) {
    return this.svc.series(tenantDe(req), catAnalitoId, catMetodoId, desde, hasta);
  }
}

@Module({
  controllers: [SpcController],
  providers: [SpcService],
})
export class SpcModule {}
