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
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { DEV_TENANT } from "../common/base-crud.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";

/**
 * =============================================================================
 * CONTROL DE CALIDAD (QC) · flujo real · contrato 4.2.3 / 4.2.4 / 4.3.7 / 4.3.8
 * -----------------------------------------------------------------------------
 * Blancos, estándares, curvas de calibración y duplicados registrados contra la
 * ORDEN DE TRABAJO y el método de catálogo v2 (`cat_metodo`) — NO contra el
 * `corrida`/`qc_corrida` legacy. Al registrar un control se EVALÚA de forma
 * automática (aprobado/rechazado) según su tipo; también puede revalidarse a
 * mano (PATCH, con aprobado_por → no repudio).
 *
 * El estado global de una OT (`estadoOt`) lo consume además el GATE de emisión
 * de informe (plantilla-render.service.emitir): una OT no puede emitir mientras
 * un método presente en sus muestras con `qc_requerido=true` no tenga al menos
 * un `qc_control` con resultado 'aprobado'.
 *
 * DDL: packages/db/align_qc.sql. Permisos RBAC reales del dominio laboratorio:
 *   · resultado.ver   → lectura del QC.
 *   · resultado.crear → registrar/aprobar/rechazar controles.
 * =============================================================================
 */

const PERM = { ver: "resultado.ver", gestionar: "resultado.crear" } as const;

/** Umbrales por defecto cuando el control no aporta `criterio` explícito. */
const R2_UMBRAL_DEFECTO = 0.995; // curva de calibración
const CV_UMBRAL_DEFECTO = 10; // %CV duplicados
const RECUP_MIN_DEFECTO = 80; // %recuperación estándar
const RECUP_MAX_DEFECTO = 120;

function tenantDe(req: any): string {
  return req?.user?.tenantId ?? DEV_TENANT;
}
function usuarioDe(req: any): string | undefined {
  return req?.user?.username ?? req?.user?.sub ?? req?.user?.id ?? undefined;
}

/** Número o null (admite coma decimal). */
function aNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parsea `criterio` a {min,max}. Acepta:
 *   · rango  "80-120" | "80..120" | "80,120" (con signo) → {min,max}
 *   · umbral simple "0.995" | "10"                        → {max}
 * Devuelve null si no hay nada numérico.
 */
function parseCriterio(criterio?: string | null): { min?: number; max?: number } | null {
  if (!criterio) return null;
  const s = String(criterio).trim();
  // Los criterios de QC (LD, %recuperación, R², %CV) son NO negativos, así que un
  // guion "80-120" es SIEMPRE separador de rango, nunca un signo. Por eso NO se
  // admite el menos delante del número: si lo admitiéramos, "80-120" se leería
  // como [80, -120] y el rango saldría invertido.
  const nums = s.match(/\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length === 0) return null;
  if (nums.length >= 2) {
    const a = aNumero(nums[0]);
    const b = aNumero(nums[1]);
    if (a === null || b === null) return null;
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const only = aNumero(nums[0]);
  return only === null ? null : { max: only };
}

/** Cuerpo de registro de un control (con métricas ya calculadas opcionales). */
const RegistrarControlSchema = z.object({
  catMetodoId: z.string().uuid(),
  tipo: z.enum(["blanco", "estandar", "curva", "duplicado"]),
  valorEsperado: z.number().finite().optional(),
  valorObtenido: z.number().finite().optional(),
  criterio: z.string().max(200).optional(),
  rCuadrado: z.number().finite().optional(),
  cvPct: z.number().finite().optional(),
  recuperacionPct: z.number().finite().optional(),
  observaciones: z.string().max(1000).optional(),
});
type RegistrarControl = z.infer<typeof RegistrarControlSchema>;

const RevisarControlSchema = z.object({
  resultado: z.enum(["aprobado", "rechazado", "pendiente"]),
  aprobadoPor: z.string().max(120).optional(),
  observaciones: z.string().max(1000).optional(),
});

/** Resultado de la evaluación automática de un control. */
interface Evaluacion {
  resultado: "aprobado" | "rechazado" | "pendiente";
  rCuadrado: number | null;
  recuperacionPct: number | null;
  cvPct: number | null;
}

@Injectable()
export class QcService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evalúa un control según su tipo y devuelve el veredicto + métricas derivadas.
   *   blanco    → aprobado si |valor_obtenido| <= criterio(LD).
   *   estandar  → %recuperación = obtenido/esperado*100 dentro del rango criterio
   *               (por defecto 80–120%).
   *   curva     → R² >= umbral criterio (por defecto 0.995).
   *   duplicado → %CV <= umbral criterio (por defecto 10%). Si no se aporta cvPct
   *               y hay esperado+obtenido, se calcula el CV de las dos réplicas.
   * Si faltan datos para decidir, queda 'pendiente' (revisión manual por PATCH).
   */
  evaluar(b: RegistrarControl): Evaluacion {
    const esperado = b.valorEsperado ?? null;
    const obtenido = b.valorObtenido ?? null;
    const crit = parseCriterio(b.criterio);
    let rCuadrado: number | null = b.rCuadrado ?? null;
    let recuperacionPct: number | null = b.recuperacionPct ?? null;
    let cvPct: number | null = b.cvPct ?? null;

    let resultado: Evaluacion["resultado"] = "pendiente";

    switch (b.tipo) {
      case "blanco": {
        // Límite de detección: el blanco no debe superar el criterio (LD).
        const ld = crit?.max ?? crit?.min ?? null;
        if (obtenido !== null && ld !== null) {
          resultado = Math.abs(obtenido) <= ld ? "aprobado" : "rechazado";
        }
        break;
      }
      case "estandar": {
        if (recuperacionPct === null && esperado !== null && esperado !== 0 && obtenido !== null) {
          recuperacionPct = (obtenido / esperado) * 100;
        }
        if (recuperacionPct !== null) {
          const min = crit?.min ?? RECUP_MIN_DEFECTO;
          const max = crit?.max ?? RECUP_MAX_DEFECTO;
          resultado = recuperacionPct >= min && recuperacionPct <= max ? "aprobado" : "rechazado";
        }
        break;
      }
      case "curva": {
        // El R² puede venir en rCuadrado o, por comodidad, en valorObtenido.
        if (rCuadrado === null && obtenido !== null) rCuadrado = obtenido;
        if (rCuadrado !== null) {
          const umbral = crit?.max ?? crit?.min ?? R2_UMBRAL_DEFECTO;
          resultado = rCuadrado >= umbral ? "aprobado" : "rechazado";
        }
        break;
      }
      case "duplicado": {
        if (cvPct === null && esperado !== null && obtenido !== null) {
          const media = (esperado + obtenido) / 2;
          if (media !== 0) {
            // Desviación estándar muestral de dos réplicas = |a-b|/√2.
            const desv = Math.abs(esperado - obtenido) / Math.SQRT2;
            cvPct = (desv / Math.abs(media)) * 100;
          }
        }
        if (cvPct !== null) {
          const umbral = crit?.max ?? crit?.min ?? CV_UMBRAL_DEFECTO;
          resultado = cvPct <= umbral ? "aprobado" : "rechazado";
        }
        break;
      }
    }

    return { resultado, rCuadrado, recuperacionPct, cvPct };
  }

  private async otDelTenant(otId: string, tenantId: string) {
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id: otId, tenantId } });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    return ot;
  }

  /** Registra un control con su evaluación automática. */
  async registrar(otId: string, body: RegistrarControl, tenantId: string) {
    await this.otDelTenant(otId, tenantId);
    const metodo = await this.prisma.catMetodo.findFirst({
      where: { id: body.catMetodoId, tenantId, deletedAt: null },
    });
    if (!metodo) throw new NotFoundException(`Método de catálogo ${body.catMetodoId} no encontrado`);

    const ev = this.evaluar(body);

    return this.prisma.qcControl.create({
      data: {
        tenantId,
        otId,
        catMetodoId: body.catMetodoId,
        tipo: body.tipo,
        valorEsperado: body.valorEsperado ?? null,
        valorObtenido: body.valorObtenido ?? null,
        criterio: body.criterio ?? null,
        resultado: ev.resultado,
        rCuadrado: ev.rCuadrado,
        recuperacionPct: ev.recuperacionPct,
        cvPct: ev.cvPct,
        observaciones: body.observaciones ?? null,
      },
      include: { catMetodo: { select: { id: true, codigo: true, nombre: true } } },
    });
  }

  /** Aprobación/rechazo manual (deja aprobado_por/aprobado_at para no repudio). */
  async revisar(
    controlId: string,
    body: z.infer<typeof RevisarControlSchema>,
    tenantId: string,
    usuario?: string,
  ) {
    const control = await this.prisma.qcControl.findFirst({
      where: { id: controlId, tenantId, deletedAt: null },
    });
    if (!control) throw new NotFoundException(`Control de calidad ${controlId} no encontrado`);

    const aprobadoPor = body.aprobadoPor ?? usuario ?? null;
    return this.prisma.qcControl.update({
      where: { id: controlId },
      data: {
        resultado: body.resultado,
        aprobadoPor: body.resultado === "pendiente" ? null : aprobadoPor,
        aprobadoAt: body.resultado === "pendiente" ? null : new Date(),
        ...(body.observaciones !== undefined ? { observaciones: body.observaciones } : {}),
      },
      include: { catMetodo: { select: { id: true, codigo: true, nombre: true } } },
    });
  }

  /**
   * Métodos con `qc_requerido=true` presentes en las muestras de la OT (vía los
   * resultados materializados por el puente) y si cada uno tiene ya un control
   * 'aprobado' para esta OT. Base del estado global y del GATE de emisión.
   */
  async metodosQcRequerido(otId: string, tenantId: string) {
    // Métodos con QC exigido presentes en la OT (distinct a través de resultado).
    const resultados = await this.prisma.resultado.findMany({
      where: {
        deletedAt: null,
        catMetodoId: { not: null },
        catMetodo: { qcRequerido: true, deletedAt: null },
        muestra: { otId, tenantId, deletedAt: null },
      },
      select: { catMetodo: { select: { id: true, codigo: true, nombre: true } } },
    });

    const porId = new Map<string, { id: string; codigo: string; nombre: string }>();
    for (const r of resultados) if (r.catMetodo) porId.set(r.catMetodo.id, r.catMetodo);
    const metodoIds = [...porId.keys()];

    // Métodos con al menos un control aprobado para esta OT.
    const aprobados = metodoIds.length
      ? await this.prisma.qcControl.findMany({
          where: {
            otId,
            tenantId,
            deletedAt: null,
            resultado: "aprobado",
            catMetodoId: { in: metodoIds },
          },
          select: { catMetodoId: true },
        })
      : [];
    const aprobadoSet = new Set(aprobados.map((a) => a.catMetodoId));

    return [...porId.values()].map((m) => ({ ...m, aprobado: aprobadoSet.has(m.id) }));
  }

  /** Estado global del QC de la OT: {aprobado, faltantes[]} + métodos + controles. */
  async estadoOt(otId: string, tenantId: string) {
    await this.otDelTenant(otId, tenantId);
    const metodos = await this.metodosQcRequerido(otId, tenantId);
    const faltantes = metodos.filter((m) => !m.aprobado).map(({ id, codigo, nombre }) => ({ id, codigo, nombre }));

    const controles = await this.prisma.qcControl.findMany({
      where: { otId, tenantId, deletedAt: null },
      include: { catMetodo: { select: { id: true, codigo: true, nombre: true } } },
      orderBy: { createdAt: "desc" },
    });

    return {
      otId,
      estado: { aprobado: faltantes.length === 0, faltantes },
      metodos,
      controles,
    };
  }

  /**
   * GATE de emisión: lanza si algún método con qc_requerido presente en la OT no
   * tiene control aprobado. Devuelve void si todo el QC exigido está aprobado.
   */
  async verificarGate(otId: string, tenantId: string): Promise<void> {
    const metodos = await this.metodosQcRequerido(otId, tenantId);
    const faltantes = metodos.filter((m) => !m.aprobado);
    if (faltantes.length) {
      const lista = faltantes.map((m) => `${m.codigo} · ${m.nombre}`).join("; ");
      throw new ConflictException(
        `No se puede emitir: control de calidad pendiente para el método ${lista}.`,
      );
    }
  }
}

@ApiTags("qc")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("qc")
export class QcController {
  constructor(private readonly svc: QcService) {}

  @Get("ot/:otId")
  @RequierePermiso(PERM.ver)
  @ApiOperation({ summary: "Controles de QC de la OT + estado global {aprobado, faltantes}" })
  estado(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.estadoOt(otId, tenantDe(req));
  }

  @Post("ot/:otId/control")
  @RequierePermiso(PERM.gestionar)
  @ApiOperation({ summary: "Registra un control (blanco/estandar/curva/duplicado) con evaluación automática" })
  registrar(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.registrar(otId, RegistrarControlSchema.parse(body), tenantDe(req));
  }

  @Patch("control/:id")
  @RequierePermiso(PERM.gestionar)
  @ApiOperation({ summary: "Aprobación/rechazo manual del control (registra aprobado_por)" })
  revisar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.revisar(id, RevisarControlSchema.parse(body), tenantDe(req), usuarioDe(req));
  }
}

@Module({
  controllers: [QcController],
  providers: [QcService],
  exports: [QcService],
})
export class QcModule {}
