import { SinAlcanceDeEscritura } from "../rbac/alcance-catalogo.guard";
import { errorMotivoVeredicto } from "./veredicto-decidido";
import { emitirEvento } from "../common/eventos";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { variablesDeCaptura } from "./captura-estandar";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService, DEV_TENANT } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";
import { validarTransicion } from "../common/estados";
import { evaluarFormula, validarFormula, FormulaError, NOMBRES_FUNCION } from "../common/formula";
// RF-D04.2 · BLOQUEO por calibración vencida. Se IMPORTA EquiposModule (que
// exporta EquiposService) para reutilizar su verificarApto() desde la captura de
// resultados. El módulo de equipos NO se toca: sólo se consume.
import { EquiposModule, EquiposService } from "../equipos/equipos.module";
import { AlcanceService } from "../rbac/alcance.service";
import { AlcanceResultadoService } from "../rbac/alcance-resultado.service";
import { decidirAccionResultado, motivoMismoRevisor, type AccionResultado } from "../rbac/alcance-resultado";
import { ETIQUETA_VEREDICTO, normalizarVeredicto, veredictoNumerico } from "./veredicto";
import { leerReplicas } from "./replicas";
import { AccionRevision, clasificarParaAccion, motivoEdicionManual, motivoNoCapturable, motivoSinVeredicto, planReapertura } from "./flujo-resultado";
import { veredictoMuestra } from "./especificacion";
import { conTraza, exigeMotivoCorreccion, teniaValor } from "./traza";
import { CostosRealesController, CostosRealesService, PlanillaCalculosController, PlanillaCalculosService } from "./planillas-ot";

/**
 * Recalcula y guarda el veredicto de la muestra (lote) a partir de sus
 * ensayos: no_cumple si alguno no cumple, pendiente si falta alguno, cumple si
 * todos cumplen (regla en especificacion.ts). Lo usan las dos capturas.
 */
export async function recalcularVeredictoMuestra(prisma: PrismaService, muestraId: string) {
  const rs = await prisma.resultado.findMany({ where: { muestraId, deletedAt: null }, select: { veredicto: true } });
  const v = veredictoMuestra(rs.map((r) => r.veredicto));
  await prisma.muestra.update({ where: { id: muestraId }, data: { veredicto: v, veredictoAt: new Date() } });
  return v;
}

/* ===================== TIPOS DE MUESTRA (árbol) ===================== */
@Injectable()
export class TipoMuestraService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    // orderBy EXPLÍCITO. El de BaseCrudService es `{ createdAt: "desc" }`, y el
    // modelo Prisma TipoMuestra no declara `createdAt`: Prisma valida contra el
    // cliente generado (DMMF), no contra la BD, así que emitía
    // PrismaClientValidationError y `GET /tipos-muestra` respondía HTTP 500.
    // Se ordena por código (igual que GranGrupo/Grupo, y es lo natural en una
    // taxonomía). No se toca el modelo Prisma: añadir ahí `createdAt` obligaría
    // a regenerar el cliente para que el arreglo surtiese efecto.
    super(prisma, {
      model: "tipoMuestra",
      search: ["codigo", "nombre"],
      include: { hijos: true, parent: true },
      orderBy: { codigo: "asc" },
    });
  }
}
const TipoMuestraCreate = z.object({
  parentId: z.string().uuid().optional(),
  codigo: z.string().min(1).max(60),
  nombre: z.string().min(1).max(200),
  activo: z.boolean().default(true),
});
// La taxonomía de tipos de muestra es catálogo: se lee con `muestra.ver` y se
// gestiona con `catalogo.gestionar` (el permiso sembrado cubre expresamente
// "grupos, familias, tipos de muestra, analitos").
@ApiTags("tipos-muestra") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("tipos-muestra")
@RequierePermisoCrud({
  ver: "muestra.ver",
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
})
export class TipoMuestraController extends BaseCrudController {
  protected createSchema = TipoMuestraCreate;
  protected updateSchema = TipoMuestraCreate.partial();
  constructor(protected svc: TipoMuestraService) { super(); }
}

/* ===================== MUESTRAS ===================== */
@Injectable()
export class MuestraService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "muestra", search: ["codigo", "nombre", "codigoBarras"], include: { tipoMuestra: true, grupo: true } });
  }
}
const MuestraCreate = z.object({
  otId: z.string().uuid().optional(),
  codigo: z.string().min(1).max(30),
  nombre: z.string().max(200).optional(),
  tipoMuestraId: z.string().uuid().optional(),
  granGrupoId: z.string().uuid().optional(),
  grupoId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
  codigoBarras: z.string().max(60).optional(),
  ubicacion: z.string().max(80).optional(),
  estado: z.enum(["recibida", "en_analisis", "finalizada"]).default("recibida"),
});
@ApiTags("muestras") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("muestras")
@RequierePermisoCrud({
  ver: "muestra.ver",
  crear: "muestra.crear",
  editar: "muestra.crear", // no existe `muestra.editar` en el RBAC sembrado
  eliminar: "muestra.crear",
})
export class MuestraController extends BaseCrudController {
  protected createSchema = MuestraCreate;
  protected updateSchema = MuestraCreate.partial();
  constructor(
    protected svc: MuestraService,
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) { super(); }

  /**
   * Listado acotado por alcance de unidad: un usuario no global solo ve las
   * muestras de OT cuya unidad_principal está entre sus unidades visibles.
   * (Se re-declara @Get porque al sobrescribir el método se pierde la ruta heredada.)
   */
  @Get()
  async listar(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("search") search?: string,
    @Query("otId") otId?: string,
    @Req() req?: any,
  ) {
    const filtro = await this.alcance.filtroUnidades(req);
    let where: any;
    if (filtro) {
      const ots = await this.prisma.ordenTrabajo.findMany({
        where: { unidadPrincipal: { in: filtro } },
        select: { id: true },
      });
      where = { otId: { in: ots.map((o) => o.id) } };
    }
    // ?otId= · muestras de una OT (el expediente ya no trae 200 y filtra en el navegador).
    if (otId) {
      if (!/^[0-9a-f-]{36}$/i.test(otId)) throw new BadRequestException("otId inválido");
      where = { AND: [where ?? {}, { otId }] };
    }
    return this.svc.listar({ page: parseInt(page), limit: parseInt(limit), search, where }, req?.user?.tenantId);
  }

  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const m = await this.svc.detalle(id, req?.user?.tenantId);
    const otId: string | null = (m as any)?.otId ?? null;
    const ot = otId
      ? await this.prisma.ordenTrabajo.findFirst({ where: { id: otId }, select: { unidadPrincipal: true } })
      : null;
    await this.alcance.exigirUnidad(req, ot?.unidadPrincipal ?? null, "la muestra");
    return m;
  }
}

/* ===================== MÉTODOS ===================== */
@Injectable()
export class MetodoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "metodo", search: ["codigo", "nombre", "norma"], include: { analitos: true } });
  }
}
const MetodoCreate = z.object({
  codigo: z.string().min(1).max(60),
  nombre: z.string().min(1).max(300),
  norma: z.string().max(120).optional(),
  version: z.string().max(20).default("v1"),
  area: z.string().max(60).optional(),
  estado: z.enum(["vigente", "obsoleto", "en_validacion"]).default("vigente"),
});
// `metodo.crear` (SUPERADMIN/ADMIN/JEFE_LAB) es más restrictivo que
// `metodo.aprobar` (+DIRECTOR/CALIDAD), así que gobierna la edición y el borrado.
@ApiTags("metodos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("metodos")
@RequierePermisoCrud({
  ver: "metodo.ver",
  crear: "metodo.crear",
  editar: "metodo.crear",
  eliminar: "metodo.crear",
})
export class MetodoController extends BaseCrudController {
  protected createSchema = MetodoCreate;
  protected updateSchema = MetodoCreate.partial();
  constructor(protected svc: MetodoService) { super(); }
}

/* ===================== ANALITOS ===================== */
@Injectable()
export class AnalitoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    // Analito NO tiene columna tenant_id (cuelga de metodo); tenant:false para no filtrar por tenant.
    super(prisma, { model: "analito", search: ["codigo", "nombre"], include: { limites: true, metodo: true }, tenant: false });
  }
}
/**
 * La fórmula se valida SINTÁCTICAMENTE al guardar el analito (RF-A06). Guardar
 * una fórmula rota no da error en el catálogo pero revienta meses después, en
 * plena captura y a un analista que no la escribió: se rechaza aquí, que es
 * donde está la persona que puede arreglarla.
 *
 * NO se validan los NOMBRES de variable: dependen del contexto del ensayo
 * (masa, volumen, factor…), que no se conoce hasta la captura. Se comprueba
 * sintaxis, funciones y límites. Cadena vacía = sin fórmula (comportamiento
 * heredado: el campo es opcional y hay 3.118 analitos sin fórmula).
 */
const FormulaOpcional = z
  .string()
  .optional()
  .refine((f) => {
    if (f === undefined || f.trim() === "") return true;
    return validarFormula(f).ok;
  }, (f) => ({ message: `Fórmula no válida: ${validarFormula(f ?? "").error}` }));

const AnalitoCreate = z.object({
  metodoId: z.string().uuid(),
  codigo: z.string().min(1).max(60),
  nombre: z.string().min(1).max(200),
  unidad: z.string().max(30).optional(),
  formula: FormulaOpcional,
});

const ValidarFormulaDto = z.object({
  formula: z.string(),
  /** Opcional: si se envía, comprueba además que toda variable usada exista. */
  variables: z.array(z.string()).max(200).optional(),
});

@ApiTags("analitos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("analitos")
@RequierePermisoCrud({
  ver: "metodo.ver", // el analito cuelga del método; no existe `analito.ver`
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
})
export class AnalitoController extends BaseCrudController {
  protected createSchema = AnalitoCreate;
  protected updateSchema = AnalitoCreate.partial();
  constructor(protected svc: AnalitoService) { super(); }

  /**
   * POST /analitos/validar-formula · comprobación previa para el editor del
   * catálogo (RF-A06: "validación de sintaxis y vista previa").
   *
   * Responde SIEMPRE 200 con {ok:false, error} cuando la fórmula es inválida:
   * no es un fallo de la petición, es el resultado de la comprobación, y el
   * editor necesita el mensaje para pintarlo bajo el campo. Los 400 quedan para
   * el body mal formado.
   *
   * NO evalúa la fórmula: sólo la parsea (ver `formula.ts`, §seguridad).
   */
  @Post("validar-formula")
  @RequierePermiso("catalogo.gestionar")
  @SinAlcanceDeEscritura()
  @ApiOperation({ summary: "Valida la sintaxis de una fórmula sin guardarla ni evaluarla" })
  validarFormulaAnalito(@Body() body: unknown) {
    const dto = ValidarFormulaDto.parse(body);
    const r = validarFormula(dto.formula, dto.variables);
    return {
      ok: r.ok,
      ...(r.error ? { error: r.error } : {}),
      ...(r.ok ? { variables: r.variables, funciones: r.funciones } : {}),
      funcionesDisponibles: NOMBRES_FUNCION,
    };
  }
}

/* ===================== LÍMITES / ESPECIFICACIONES ===================== */
@Injectable()
export class NormaLimiteService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    // `analito: true` (no anidado): la columna Analito del listado se pinta con
    // etiquetaRef → "código · nombre", que ya está en el propio Analito. Incluir
    // además su `metodo` sería un JOIN de más por fila sin nada que mostrar.
    super(prisma, { model: "normaLimite", search: ["producto"], include: { analito: true }, tenant: false, softDelete: false, orderBy: { id: "asc" } });
  }
}
const NormaLimiteCreate = z.object({
  analitoId: z.string().uuid(),
  producto: z.string().max(200).optional(),
  limiteInf: z.number().optional(),
  nominal: z.number().optional(),
  limiteSup: z.number().optional(),
  unidad: z.string().max(30).optional(),
});
@ApiTags("limites") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("limites")
@RequierePermisoCrud({
  ver: "metodo.ver", // la especificación cuelga del analito/método
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
})
export class NormaLimiteController extends BaseCrudController {
  protected createSchema = NormaLimiteCreate;
  protected updateSchema = NormaLimiteCreate.partial();
  constructor(protected svc: NormaLimiteService) { super(); }
}

/* ===================== RESULTADOS (con estadística y veredicto) ===================== */

/** Contexto de un resultado para alcance, segregación y estado. */
export interface ContextoResultado {
  id: string;
  estado: string;
  analistaId: string | null;
  otId: string | null;
  unidadPrincipal: string | null;
  otCodigo: string | null;
}

@Injectable()
export class ResultadoService extends BaseCrudService {
  // `equipos` se inyecta desde EquiposModule (importado por LaboratorioModule)
  // para aplicar el BLOQUEO por calibración vencida (RF-D04.2) en `capturar()`.
  constructor(
    prisma: PrismaService,
    private readonly equipos: EquiposService,
    // Alcance por ensayo (derivados por orden interna) y segregación revisión ≠ aprobación.
    private readonly alcanceRes?: AlcanceResultadoService,
  ) {
    super(prisma, { model: "resultado", search: [], include: { analito: true, muestra: true }, tenant: false, orderBy: { fecha: "desc" } });
  }
  private estadistica(rep: number[]) {
    const n = rep.length;
    const m = rep.reduce((a, b) => a + b, 0) / n;
    const s = n > 1 ? Math.sqrt(rep.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
    return { promedio: m, desviacion: s, cv: m ? (s / Math.abs(m)) * 100 : 0 };
  }
  /**
   * Veredicto LEGIBLE contra los límites («Cumple / No cumple / Informativo»).
   * Lo que se GUARDA es el código único de `veredicto.ts` (cumple / no_cumple /
   * informativo): ver `capturar()`, que lo normaliza antes de persistir.
   */
  private veredicto(m: number, inf?: number | null, sup?: number | null) {
    return ETIQUETA_VEREDICTO[veredictoNumerico(m, inf, sup)];
  }

  /**
   * Contexto de variables que ve la fórmula del analito (RF-A06/D02.1):
   *   RN1..RNn  · cada réplica, 1-indexada como en la hoja de captura
   *   REPLICAS  · el vector completo → PROMEDIO(REPLICAS), MAX(REPLICAS)…
   *   RN        · alias de REPLICAS («promedio(RN)»)
   *   PROMEDIO  · media aritmética de las réplicas
   *   DE        · desviación estándar muestral (n−1)
   *   CV        · coeficiente de variación en %
   *   N         · nº de réplicas
   *   + las variables del ensayo que envíe el cliente (masa, volumen, factor…)
   *
   * Nótese que la estadística es un paso ANTERIOR a la fórmula, no un
   * sustituto: la fórmula recibe el promedio ya calculado y lo transforma
   * (`ppm = (C·F·100)/g`), o recalcula desde las réplicas si así se define.
   */
  private contextoFormula(rep: number[], st: { promedio: number; desviacion: number; cv: number }, extras?: Record<string, number>) {
    const ctx: Record<string, number | number[]> = {
      REPLICAS: rep,
      // `RN` = el vector de réplicas (alias de REPLICAS). Es la forma en que
      // está escrita la fórmula sembrada de los analitos con límite
      // («promedio(RN)», seed_analitos_limites.sql); sin el alias toda captura
      // de esos analitos fallaba con «Variable no definida: 'RN'».
      RN: rep,
      PROMEDIO: st.promedio,
      DE: st.desviacion,
      CV: st.cv,
      N: rep.length,
    };
    rep.forEach((v, i) => (ctx[`RN${i + 1}`] = v));
    // Las variables del ensayo NO pueden pisar las calculadas: si una fórmula
    // dice PROMEDIO, tiene que ser el promedio de las réplicas de este ensayo y
    // no lo que venga en el body. Se rechaza explícitamente en vez de dejar que
    // una gane en silencio.
    for (const [k, v] of Object.entries(extras ?? {})) {
      if (k.toUpperCase() in ctx || Object.keys(ctx).some((c) => c.toUpperCase() === k.toUpperCase()))
        throw new BadRequestException(`La variable '${k}' es una variable reservada del ensayo (RN, RN1..RNn, REPLICAS, PROMEDIO, DE, CV, N) y no puede redefinirse`);
      ctx[k] = v;
    }
    return ctx;
  }

  /**
   * Cálculo del resultado (sin persistir): estadística → fórmula del analito →
   * veredicto contra el límite del producto. Lo comparten la captura y la
   * corrección de un resultado devuelto.
   */
  private async calcular(dto: { analitoId: string; replicas: number[]; productoLimite?: string; variables?: Record<string, number>; equipoId?: string }, tenantId: string) {
    // --- RF-D04.2 · BLOQUEO POR CALIBRACIÓN VENCIDA ------------------------
    // Se comprueba ANTES de calcular estadística/fórmula y ANTES de persistir:
    // no se puede emitir un resultado con un equipo descalibrado o fuera de
    // servicio (NCh-ISO/IEC 17025). Si el analista informa `equipoId`,
    // `verificarApto` lanza 409 (ConflictException) con el motivo del bloqueo
    // —calibración vencida / sin calibración / equipo no operativo— o 404 si el
    // equipo no existe o es de otro tenant, y el POST no persiste nada. Sólo un
    // equipo APTO deja continuar la captura y su id se guarda en el resultado.
    //
    // Si NO viene `equipoId`, el comportamiento previo queda intacto: la captura
    // procede sin equipo asociado.
    if (dto.equipoId) {
      await this.equipos.verificarApto(dto.equipoId, tenantId);
    }
    // ----------------------------------------------------------------------
    const rep: number[] = dto.replicas;
    const st = this.estadistica(rep);
    const limite = dto.productoLimite
      ? await this.prisma.normaLimite.findFirst({ where: { analitoId: dto.analitoId, producto: dto.productoLimite } })
      : await this.prisma.normaLimite.findFirst({ where: { analitoId: dto.analitoId } });
    const analito = await this.prisma.analito.findUnique({ where: { id: dto.analitoId } });
    if (!analito) throw new NotFoundException(`Analito ${dto.analitoId} no encontrado`);

    // --- Motor de fórmulas -------------------------------------------------
    const formula = analito.formula?.trim();
    let resultadoFinal: number | null = null;
    if (formula) {
      const ctx = this.contextoFormula(rep, st, dto.variables);
      try {
        resultadoFinal = evaluarFormula(formula, ctx);
      } catch (e) {
        // Una fórmula que falla es un problema del dato/catálogo, no del
        // servidor: 400 con el motivo, y NO se persiste nada. Persistir un
        // resultado con la fórmula sin aplicar sería peor que no tenerlo — se
        // informaría el promedio crudo como si fuera el valor del ensayo.
        if (e instanceof FormulaError)
          throw new BadRequestException(
            `No se pudo aplicar la fórmula del analito ${analito.codigo} ('${formula}'): ${e.message}`,
          );
        throw e;
      }
    }
    const valorEnsayo = resultadoFinal ?? st.promedio;
    const inf = limite?.limiteInf != null ? Number(limite.limiteInf) : null;
    const sup = limite?.limiteSup != null ? Number(limite.limiteSup) : null;
    // ----------------------------------------------------------------------
    return {
      replicas: rep,
      promedio: st.promedio,
      desviacion: st.desviacion,
      cv: st.cv,
      resultadoFinal,
      // Copia de la fórmula tal y como estaba AL CAPTURAR: `analito.formula`
      // es editable y el resultado tiene que seguir siendo reproducible.
      formulaAplicada: formula || null,
      unidad: analito.unidad ?? null,
      // Se guarda el código único (cumple / no_cumple / informativo).
      veredicto: normalizarVeredicto(this.veredicto(valorEnsayo, inf, sup)),
    };
  }

  /**
   * Captura réplicas RN1..RNn → promedio/DE/CV → fórmula del analito (si tiene)
   * → veredicto contra el límite del producto.
   *
   * El VALOR DEL ENSAYO es el que devuelve la fórmula cuando el analito tiene
   * una; si no, sigue siendo el promedio crudo. Ese valor es el que se
   * contrasta con el límite y el que se informa. La OT se toma de la muestra si
   * no viene (sin OT el resultado no aparecería en revisión ni en la bandeja).
   */
  async capturar(dto: any, tenantId = DEV_TENANT) {
    const calc = await this.calcular(dto, tenantId);
    let otId: string | null = dto.otId ?? null;
    if (!otId && dto.muestraId) {
      const m = await this.prisma.muestra.findUnique({ where: { id: dto.muestraId }, select: { otId: true } });
      otId = m?.otId ?? null;
    }
    const creado = await conTraza(this.prisma, { usuarioId: dto.analistaId, origen: "captura_replicas" }, (tx) => tx.resultado.create({
      data: {
        otId,
        muestraId: dto.muestraId,
        analitoId: dto.analitoId,
        ...calc,
        analistaId: dto.analistaId ?? null,
        // Equipo APTO con el que se ejecutó el ensayo (RF-D04.1). Ya verificado
        // en calcular(); NULL si no se informó equipo.
        equipoId: dto.equipoId ?? null,
        // Todo resultado nace en 'capturado': el ciclo RF-E01 empieza aquí.
        estado: "capturado",
      },
      include: { analito: true, muestra: true },
    }));
    await recalcularVeredictoMuestra(this.prisma as PrismaService, dto.muestraId);
    return creado;
  }

  /**
   * Corrección de un resultado por réplicas (típicamente uno DEVUELTO): se
   * recalcula en el MISMO registro y vuelve a 'capturado' con el nuevo analista
   * y fecha. No se puede sobre un resultado revisado o aprobado. Misma regla de
   * corrección que la captura por valor (traza.ts): si ya tenía un valor
   * capturado sin revisar, exige motivo (mínimo 5 caracteres); tras una
   * devolución el motivo, si no se indica, es el de la devolución.
   */
  async recapturar(id: string, dto: any, usuarioId: string | undefined, tenantId = DEV_TENANT) {
    const actual = await this.prisma.resultado.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true, estado: true, analitoId: true, motivoDevolucion: true,
        valorNumerico: true, valorTexto: true, resultadoFinal: true, promedio: true,
      },
    });
    if (!actual) throw new NotFoundException(`Resultado ${id} no encontrado`);
    if (!actual.analitoId)
      throw new BadRequestException("Este resultado se captura por valor en «Captura y revisión por OT», no por réplicas.");
    const motivo = motivoNoCapturable(actual.estado);
    if (motivo) throw new ConflictException(motivo);
    const motivoCorreccion = typeof dto.motivo === "string" ? dto.motivo.trim() : "";
    if (exigeMotivoCorreccion(actual.estado, teniaValor(actual)) && motivoCorreccion.length < 5)
      throw new BadRequestException(
        "Este ensayo ya tiene un valor capturado: indique el motivo de la corrección (mínimo 5 caracteres). Queda en el historial del resultado.",
      );
    const calc = await this.calcular({ ...dto, analitoId: actual.analitoId }, tenantId);
    const traza = { usuarioId, motivo: motivoCorreccion || actual.motivoDevolucion, origen: "correccion" };
    const r = await conTraza(this.prisma, traza, (tx) => tx.resultado.update({
      where: { id },
      data: {
        ...calc,
        // Las variables de ESTA corrección o ninguna (no quedan las de la captura anterior).
        variables: variablesDeCaptura(dto.variables) ?? Prisma.DbNull,
        analistaId: usuarioId ?? null,
        equipoId: dto.equipoId ?? null,
        estado: "capturado",
        fecha: new Date(),
      },
      include: { analito: true, muestra: true },
    }));
    await recalcularVeredictoMuestra(this.prisma as PrismaService, r.muestraId);
    return r;
  }

  /** OT, laboratorio y estado de un resultado (404 si no existe o es de otro tenant). */
  async contexto(id: string, tenantId?: string): Promise<ContextoResultado> {
    const filas = await this.prisma.$queryRawUnsafe<
      { id: string; estado: string; analista_id: string | null; ot_id: string | null; unidad_principal: string | null; codigo: string | null }[]
    >(
      `SELECT r.id, r.estado, r.analista_id, o.id AS ot_id, o.unidad_principal, o.codigo
         FROM resultado r
         JOIN muestra m ON m.id = r.muestra_id
         LEFT JOIN orden_trabajo o ON o.id = COALESCE(r.ot_id, m.ot_id)
        WHERE r.id = $1::uuid AND r.deleted_at IS NULL
          AND ($2::uuid IS NULL OR m.tenant_id = $2::uuid)`,
      id,
      tenantId ?? null,
    );
    const f = filas[0];
    if (!f) throw new NotFoundException(`Resultado ${id} no encontrado`);
    return { id: f.id, estado: f.estado, analistaId: f.analista_id, otId: f.ot_id, unidadPrincipal: f.unidad_principal, otCodigo: f.codigo };
  }

  /* ---------------------- RF-E01 · Aprobación escalonada ---------------------- */

  /**
   * Aplica una transición del ciclo de vida del resultado y sella quién y
   * cuándo. Toda la política vive aquí para que los endpoints no puedan
   * divergir.
   *
   * SEGREGACIÓN DE FUNCIONES (NCh-ISO/IEC 17025):
   * quien captura un resultado NO puede revisarlo ni aprobarlo. La comprobación
   * es `usuario != resultado.analistaId` → 409 Conflict si coinciden. Un 403
   * sería engañoso: el usuario SÍ tiene el permiso, lo que no puede es
   * ejercerlo sobre ESTE resultado — es un conflicto de estado, no falta de
   * autorización.
   */
  private async transitar(
    id: string,
    nuevo: "revisado_n1" | "aprobado" | "devuelto",
    usuarioId: string | undefined,
    opts: { motivo?: string; exigeIndependencia: boolean },
  ) {
    const actual = await this.prisma.resultado.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, estado: true, analistaId: true, revisadoPor: true, veredicto: true, muestra: { select: { tenantId: true } } },
    });
    if (!actual) throw new NotFoundException(`Resultado ${id} no encontrado`);

    // 1. ¿Permite la máquina de estados este paso? (common/estados.ts)
    validarTransicion("resultado", actual.estado, nuevo);

    // 2. Segregación de funciones.
    if (opts.exigeIndependencia && usuarioId && actual.analistaId && usuarioId === actual.analistaId)
      throw new ConflictException(
        "Segregación de funciones (ISO/IEC 17025): quien captura un resultado no puede revisarlo ni aprobarlo. " +
          "Debe hacerlo otro usuario con el permiso correspondiente.",
      );

    // 3. Sin veredicto no se revisa ni se aprueba (recorrido MP-02, D02-03): un
    //    «< 10» que no se puede decidir contra el requisito lo resuelve el revisor
    //    con «Decidir…» o se devuelve al analista; si no, el informe saldría con
    //    la condición «Pendiente».
    if (nuevo !== "devuelto" && motivoSinVeredicto(actual.veredicto, nuevo))
      throw new ConflictException(motivoSinVeredicto(actual.veredicto, nuevo)!);

    // 4. Revisión y aprobación por personas distintas (recorrido MP-06, D06-05).
    if (nuevo === "aprobado" && this.alcanceRes && actual.revisadoPor && actual.revisadoPor === usuarioId) {
      const cfg = await this.alcanceRes.segregacion(actual.muestra?.tenantId);
      const lab = (await this.alcanceRes.labs([id])).get(id)?.unidadCodigo ?? null;
      const m = motivoMismoRevisor(actual, usuarioId, cfg, lab);
      if (m) throw new ConflictException(m);
    }

    const ahora = new Date();
    const data: Record<string, unknown> = { estado: nuevo };
    if (nuevo === "revisado_n1") {
      data.revisadoPor = usuarioId ?? null;
      data.revisadoAt = ahora;
      data.motivoDevolucion = null; // una devolución previa queda saldada
    }
    if (nuevo === "aprobado") {
      data.aprobadoPor = usuarioId ?? null;
      data.aprobadoAt = ahora;
    }
    if (nuevo === "devuelto") {
      data.motivoDevolucion = opts.motivo ?? null;
      // Quien devuelve queda como último revisor: es el rastro de quién lo
      // miró y lo devolvió (y cuándo).
      data.revisadoPor = usuarioId ?? null;
      data.revisadoAt = ahora;
    }

    const origen = nuevo === "revisado_n1" ? "revision" : nuevo === "aprobado" ? "aprobacion" : "devolucion";
    const r = await conTraza(this.prisma, { usuarioId, motivo: opts.motivo ?? null, origen }, (tx) => tx.resultado.update({
      where: { id },
      data,
      include: { analito: true, muestra: true },
    }));
    // Avisos «No cumple» / «Contaminado» (contrato §4.2.6, frente r4c): se avisa tras confirmar.
    if (nuevo === "aprobado") emitirEvento("resultado.aprobado", { resultadoId: id, usuarioId: usuarioId ?? null });
    return r;
  }

  revisar(id: string, usuarioId?: string) {
    return this.transitar(id, "revisado_n1", usuarioId, { exigeIndependencia: true });
  }
  aprobar(id: string, usuarioId?: string) {
    return this.transitar(id, "aprobado", usuarioId, { exigeIndependencia: true });
  }
  /** Devolver es un acto correctivo: no exige independencia, pero sí motivo. */
  devolver(id: string, motivo: string, usuarioId?: string) {
    return this.transitar(id, "devuelto", usuarioId, { motivo, exigeIndependencia: false });
  }

  /**
   * Reabre un resultado APROBADO en el que se detectó un error (al revisar o
   * firmar el informe). Lo hace la jefatura (`resultado.reabrir`) con motivo:
   *  · el resultado vuelve a `devuelto` (el analista lo corrige y se repite
   *    revisión y aprobación, con la misma segregación de funciones);
   *  · los documentos vigentes de la OT (en firma u oficiales) se ANULAN con el
   *    motivo: tras aprobar de nuevo se reemiten como nueva versión;
   *  · queda la traza en la OT (historial) y en el resultado (quién, cuándo, por qué,
   *    valor y aprobación anteriores).
   * Reglas puras: flujo-resultado.ts · planReapertura.
   */
  async reabrir(id: string, motivo: string, usuarioId: string | undefined, tenantId?: string) {
    const ctx = await this.contexto(id, tenantId);
    const r = await this.prisma.resultado.findFirst({
      where: { id, deletedAt: null },
      include: { muestra: { select: { codigo: true, tenantId: true } }, analito: { select: { nombre: true } }, catAnalito: { select: { nombre: true } } },
    });
    if (!r) throw new NotFoundException(`Resultado ${id} no encontrado`);
    const ot = ctx.otId
      ? await this.prisma.ordenTrabajo.findFirst({ where: { id: ctx.otId }, select: { id: true, codigo: true, estado: true, tenantId: true } })
      : null;
    const docs = ot
      ? await this.prisma.certificado.findMany({
          where: { otId: ot.id, deletedAt: null },
          select: { id: true, numero: true, codigo: true, estado: true, entregadoAt: true },
        })
      : [];
    const plan = planReapertura(
      r.estado,
      ot,
      docs.map((d) => ({ id: d.id, numero: d.numero ?? d.codigo, estado: d.estado, entregadoAt: d.entregadoAt })),
    );
    if (plan.error) throw new ConflictException(plan.error);

    const ahora = new Date();
    const ensayo = r.catAnalito?.nombre ?? r.analito?.nombre ?? "ensayo";
    const texto = motivo.trim();
    // Ensayo derivado con la orden interna ya cerrada: la orden vuelve a «recibida»
    // para que el destino lo corrija y lo apruebe de nuevo (alcance-resultado.ts).
    const dueno = this.alcanceRes ? (await this.alcanceRes.labs([id])).get(id) : undefined;
    const reabrirOi = dueno?.derivado && dueno.oiEstado === "cerrada" ? dueno : null;
    const anterior = {
      valorNumerico: r.valorNumerico ?? null,
      valorTexto: r.valorTexto ?? null,
      promedio: r.promedio,
      veredicto: r.veredicto,
      analistaId: r.analistaId,
      revisadoPor: r.revisadoPor,
      revisadoAt: r.revisadoAt,
      aprobadoPor: r.aprobadoPor,
      aprobadoAt: r.aprobadoAt,
    };
    await conTraza(this.prisma, { usuarioId, motivo: texto, origen: "reapertura" }, async (tx) => {
      await tx.resultado.update({
        where: { id },
        data: {
          estado: "devuelto",
          motivoDevolucion: `Reabierto tras su aprobación: ${texto}`,
          revisadoPor: usuarioId ?? null,
          revisadoAt: ahora,
          aprobadoPor: null,
          aprobadoAt: null,
          reabiertoPor: usuarioId ?? null,
          reabiertoAt: ahora,
          reabiertoMotivo: texto,
          reaperturas: { increment: 1 },
        },
      });
      if (reabrirOi?.ordenInternaId) {
        await tx.$executeRawUnsafe(
          `UPDATE orden_interna SET estado = 'recibida', cerrada_at = NULL, cerrada_por = NULL,
                  aceptada_at = NULL, aceptada_por = NULL, updated_at = now()
            WHERE id = $1::uuid AND estado = 'cerrada'`,
          reabrirOi.ordenInternaId,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO orden_interna_historial (tenant_id, orden_interna_id, accion, detalle, usuario_id)
           SELECT tenant_id, id, 'estado', $2::jsonb, $3::uuid FROM orden_interna WHERE id = $1::uuid`,
          reabrirOi.ordenInternaId,
          JSON.stringify({ de: "cerrada", a: "recibida", motivo: `Resultado reabierto (${r.muestra?.codigo ?? ""} · ${ensayo}): ${texto}` }),
          usuarioId ?? null,
        );
      }
      for (const d of plan.anular) {
        await tx.certificado.update({
          where: { id: d.id },
          data: {
            estado: "anulado",
            anuladoAt: ahora,
            anuladoPor: usuarioId ?? null,
            anuladoMotivo: `Resultado reabierto (${r.muestra?.codigo ?? ""} · ${ensayo}): ${texto}`,
          },
        });
        await tx.documentoFirma.updateMany({ where: { certificadoId: d.id, estado: "pendiente" }, data: { estado: "anulado" } });
      }
      if (ot)
        await tx.$executeRawUnsafe(
          `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id)
           VALUES ($1::uuid, $2::uuid, 'reapertura_resultado', $3::jsonb, $4::uuid)`,
          ot.tenantId,
          ot.id,
          JSON.stringify({
            resultadoId: id,
            muestra: r.muestra?.codigo ?? null,
            ensayo,
            motivo: texto,
            anterior,
            documentosAnulados: plan.anular.map((d) => ({ id: d.id, numero: d.numero, estado: d.estado })),
          }),
          usuarioId ?? null,
        );
    });
    const actualizado = await this.prisma.resultado.findFirst({ where: { id }, include: { analito: true, muestra: true } });
    return { ...actualizado, documentosAnulados: plan.anular, avisos: plan.avisos };
  }

  /**
   * Revisar / aprobar TODOS los resultados de una OT que estén en la etapa
   * correspondiente, salvo los capturados por el propio usuario (segregación):
   * esos se informan como omitidos, con el motivo.
   */
  async accionOt(otId: string, accion: AccionRevision, usuarioId: string | undefined, req?: any) {
    const todas = await this.prisma.resultado.findMany({
      where: { otId, deletedAt: null },
      select: { id: true, estado: true, analistaId: true },
    });
    // Solo los ensayos que el usuario puede revisar o aprobar: los derivados a otro
    // laboratorio los trabaja ese laboratorio (recorrido MP-02, D02-04).
    let filas = todas;
    let deOtrosLaboratorios = 0;
    if (this.alcanceRes && req) {
      const duenos = await this.alcanceRes.labs(todas.map((r) => r.id));
      const ve = await this.alcanceRes.veUnidad(req, accion === "revisar" ? "resultado.revisar" : "resultado.aprobar");
      filas = todas.filter((r) => {
        const d = duenos.get(r.id);
        const ok = !d || decidirAccionResultado(d, accion as AccionResultado, ve).permitido;
        if (!ok && r.estado === (accion === "revisar" ? "capturado" : "revisado_n1")) deOtrosLaboratorios++;
        return ok;
      });
    }
    const { aplicables, omitidos } = clasificarParaAccion(filas, accion, usuarioId);
    const hechos: string[] = [];
    for (const id of aplicables) {
      try {
        await (accion === "revisar" ? this.revisar(id, usuarioId) : this.aprobar(id, usuarioId));
        hechos.push(id);
      } catch (e: any) {
        omitidos.push({ id, motivo: e?.message ?? "No se pudo aplicar." });
      }
    }
    return { accion, hechos: hechos.length, omitidos, deOtrosLaboratorios };
  }

  /**
   * Veredicto manual del revisor para un resultado que el sistema no pudo
   * decidir (p. ej. un texto frente a límites numéricos). Solo sobre resultados
   * capturados (antes de revisar).
   */
  async fijarVeredicto(id: string, veredicto: string, usuarioId?: string, motivo?: string) {
    const v = normalizarVeredicto(veredicto);
    if (!v || v === "pendiente") throw new BadRequestException("Veredicto no válido: cumple, no_cumple o informativo.");
    const actual = await this.prisma.resultado.findFirst({ where: { id, deletedAt: null }, select: { estado: true, analistaId: true, veredicto: true } });
    if (!actual) throw new NotFoundException(`Resultado ${id} no encontrado`);
    // Lo decide el revisor (capturado) o, si quedó sin decidir, el aprobador (revisado).
    const sinDecidir = normalizarVeredicto(actual.veredicto) == null || normalizarVeredicto(actual.veredicto) === "pendiente";
    if (!(actual.estado === "capturado" || (actual.estado === "revisado_n1" && sinDecidir)))
      throw new ConflictException("Solo se puede fijar el veredicto de un resultado capturado y aún no revisado.");
    if (usuarioId && actual.analistaId === usuarioId)
      throw new ConflictException("Quien capturó el ensayo no decide su veredicto: lo hace otra persona (segregación de funciones).");
    // B-032: la decisión del revisor se justifica (bitácora e informe).
    const errMotivo = errorMotivoVeredicto(motivo);
    if (errMotivo) throw new BadRequestException(errMotivo);
    const r = await conTraza(this.prisma, { usuarioId, origen: "veredicto_manual", motivo: motivo!.trim() }, (tx) =>
      tx.resultado.update({
        where: { id },
        data: { veredicto: v, veredictoMotivo: motivo!.trim(), veredictoDecididoPor: usuarioId ?? null, veredictoDecididoAt: new Date() },
      }),
    );
    await recalcularVeredictoMuestra(this.prisma as PrismaService, r.muestraId);
    return r;
  }
}

const ReplicasCampos = {
  /** Réplicas ya numéricas … */
  replicas: z.array(z.number().finite()).min(1).optional(),
  /**
   * … o el texto tal como lo escribió el analista («12,4 12,6; 12,5»). Se lee
   * con la regla de `replicas.ts` (coma decimal chilena sin ambigüedad).
   */
  replicasTexto: z.string().max(4000).optional(),
  productoLimite: z.string().optional(),
  /**
   * RF-D04.1/D04.2 · Equipo con el que se ejecuta el ensayo. OPCIONAL. Si se
   * informa, la captura verifica su aptitud (calibración vigente + operativo) y
   * BLOQUEA con 409 si no es apto antes de persistir. Ver ResultadoService.calcular().
   */
  equipoId: z.string().uuid().optional(),
  /**
   * Variables extra del ensayo para la fórmula del analito (masa, volumen,
   * factor, concentración del titulante…). Las claves deben ser identificadores
   * válidos; los valores, números finitos. Las reservadas (RN1..RNn, REPLICAS,
   * PROMEDIO, DE, CV, N) se rechazan en `contextoFormula`.
   */
  variables: z
    .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Nombre de variable no válido"), z.number().finite())
    .optional(),
};

/** Réplicas finales: las numéricas o las leídas del texto (400 con el trozo que no se entiende). */
function replicasDe(dto: { replicas?: number[]; replicasTexto?: string }): number[] {
  if (dto.replicas?.length) return dto.replicas;
  if (dto.replicasTexto != null) {
    const { valores, invalidos } = leerReplicas(dto.replicasTexto);
    if (invalidos.length)
      throw new BadRequestException(
        `No se entiende como número: ${invalidos.map((t) => `«${t}»`).join(", ")}. ` +
          "Use coma o punto decimal (12,4 o 12.4) y separe las réplicas con espacio, punto y coma o «, ».",
      );
    if (valores.length) return valores;
  }
  throw new BadRequestException("Indique al menos una réplica.");
}

const ResultadoCreate = z.object({
  otId: z.string().uuid().optional(),
  muestraId: z.string().uuid(),
  analitoId: z.string().uuid(),
  analistaId: z.string().uuid().optional(),
  ...ReplicasCampos,
});

const ResultadoRecaptura = z.object({
  ...ReplicasCampos,
  /** Motivo de la corrección (queda en el historial; si falta, el de la devolución). */
  motivo: z.string().trim().max(1000).optional(),
});

const DevolverDto = z.object({
  /** RF-E01 exige rechazo MOTIVADO: sin motivo el analista no sabe qué corregir. */
  motivo: z.string().trim().min(5, "Indique el motivo de la devolución (mínimo 5 caracteres)").max(1000),
});

const ReabrirDto = z.object({
  motivo: z.string().trim().min(5, "Indique el motivo de la reapertura (mínimo 5 caracteres)").max(1000),
});

const VeredictoDto = z.object({ veredicto: z.string().min(1).max(20), motivo: z.string().max(500).optional() });

/**
 * Comprueba que el resultado es del tenant y que el usuario puede hacer la
 * acción sobre él: alcance por ENSAYO (rbac/alcance-resultado.ts). Un derivado
 * por orden interna lo trabaja el laboratorio de destino mientras la orden está
 * recibida; el responsable de la OT lo ve en solo lectura.
 */
async function exigirAlcanceResultado(
  svc: ResultadoService,
  alcanceRes: AlcanceResultadoService,
  id: string,
  req: any,
  accion: AccionResultado,
  permiso?: string,
) {
  const ctx = await svc.contexto(id, req?.user?.tenantId);
  await alcanceRes.exigir(req, id, accion, permiso, ctx.otCodigo ? `el resultado de la OT ${ctx.otCodigo}` : "el resultado");
  return ctx;
}

/**
 * Bandeja de revisión y acciones sobre la OT completa. Controlador PROPIO y
 * declarado ANTES del CRUD de /resultados para que `GET /resultados/bandeja`
 * gane al `GET /resultados/:id` heredado (si no, ParseUUIDPipe daría 400).
 *
 *   GET  /resultados/bandeja?estado=capturado|revisado_n1|devuelto|rechazado|pendiente
 *        &mios=1 (capturados por mí) &asignados=1 (asignados a mí) &otId= &q= &page= &limit=
 *        &derivados=1 (derivados a sus laboratorios por una orden interna recibida)
 *   POST /resultados/ot/:otId/revisar · resultado.revisar
 *   POST /resultados/ot/:otId/aprobar · resultado.aprobar
 */
@ApiTags("resultados") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("resultados")
export class ResultadoBandejaController {
  constructor(
    private readonly svc: ResultadoService,
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly alcanceRes: AlcanceResultadoService,
  ) {}

  @Get("bandeja")
  @RequierePermiso("resultado.ver")
  @ApiOperation({ summary: "Resultados por estado (por revisar, por aprobar, devueltos…) en el alcance del usuario" })
  async bandeja(@Query() q: Record<string, string>, @Req() req: any) {
    const tenantId = req?.user?.tenantId ?? null;
    const unidades = await this.alcance.filtroUnidades(req);
    const yo = req?.user?.sub ?? null;
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const estados = (q.estado ?? "capturado").split(",").map((s) => s.trim()).filter(Boolean);
    const texto = (q.q ?? "").trim();
    const where = `
        r.deleted_at IS NULL
        AND r.estado = ANY($1::text[])
        AND ($2::uuid IS NULL OR m.tenant_id = $2::uuid)
        AND ($3::uuid[] IS NULL OR lr.unidad_id = ANY($3::uuid[]))
        AND ($4::boolean IS FALSE OR r.analista_id = $5::uuid)
        AND ($6::boolean IS FALSE OR r.asignado_a = $5::uuid
             OR (r.asignado_a IS NULL AND EXISTS (SELECT 1 FROM ot_analista oa WHERE oa.ot_id = o.id AND oa.usuario_id = $5::uuid)))
        AND ($7::uuid IS NULL OR o.id = $7::uuid)
        AND ($8::text = '' OR o.codigo ILIKE '%' || $8 || '%' OR m.codigo ILIKE '%' || $8 || '%'
             OR COALESCE(ca.nombre, a.nombre, '') ILIKE '%' || $8 || '%')
        AND ($9::boolean IS FALSE OR (lr.derivado AND lr.oi_estado = 'recibida'))`;
    const params = [
      estados,
      tenantId,
      unidades,
      q.mios === "1",
      yo,
      q.asignados === "1",
      q.otId && /^[0-9a-f-]{36}$/i.test(q.otId) ? q.otId : null,
      texto,
      // Ensayos derivados a sus laboratorios por una orden interna recibida (D02-25).
      q.derivados === "1",
    ];
    const from = `
         FROM resultado r
         JOIN muestra m ON m.id = r.muestra_id
         JOIN orden_trabajo o ON o.id = COALESCE(r.ot_id, m.ot_id)
         -- Laboratorio dueño del ensayo: el destino si se derivó por orden interna (D02-04).
         JOIN LATERAL lims_lab_de_resultado(r.id) lr ON TRUE
         LEFT JOIN cat_analito ca ON ca.id = r.cat_analito_id
         LEFT JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
         LEFT JOIN analito a ON a.id = r.analito_id
         LEFT JOIN unidad un ON un.id = lr.unidad_id`;
    const [filas, total] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT r.id, r.estado, r.veredicto, r.unidad, r.replicas, r.promedio, r.desviacion, r.cv, r.resultado_final AS "resultadoFinal",
                r.valor_numerico AS "valorNumerico", r.valor_texto AS "valorTexto",
                r.limite_inf AS "limiteInf", r.nominal, r.limite_sup AS "limiteSup",
                r.fecha, r.analista_id AS "analistaId", r.revisado_n1_por AS "revisadoPor", r.revisado_n1_at AS "revisadoAt",
                r.aprobado_por AS "aprobadoPor", r.aprobado_at AS "aprobadoAt", r.motivo_devolucion AS "motivoDevolucion",
                r.asignado_a AS "asignadoA", r.analito_id AS "analitoId",
                r.tipo_dato AS "tipoDato", r.requisito, r.observacion, r.formula, r.formula_aplicada AS "formulaAplicada",
                r.espec_origen AS "especOrigen", r.espec_catalogo AS "especCatalogo",
                r.espec_editada_por AS "especEditadaPor", r.espec_editada_at AS "especEditadaAt",
                o.id AS "otId", o.codigo AS "otCodigo", un.codigo AS "unidadCodigo",
                m.id AS "muestraId", m.codigo AS "muestraCodigo", m.nombre AS "muestraNombre",
                COALESCE(ca.nombre, a.nombre) AS "analitoNombre", COALESCE(ca.codigo, a.codigo) AS "analitoCodigo",
                cm.nombre AS "metodoNombre", cm.codigo AS "metodoCodigo"
         ${from}
         WHERE ${where}
         ORDER BY o.codigo, m.codigo, r.fecha
         LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        ...params,
      ),
      this.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n ${from} WHERE ${where}`, ...params),
    ]);
    const data = await conNombres(this.prisma, filas);
    const n = Number(total[0]?.n ?? 0);
    return { data, meta: { page, limit, total: n, totalPages: Math.max(1, Math.ceil(n / limit)) } };
  }

  @Post("ot/:otId/revisar")
  @RequierePermiso("resultado.revisar")
  @ApiOperation({ summary: "Revisa todos los resultados capturados de la OT (salvo los propios)" })
  async revisarOt(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    await this.otEnAlcance(otId, req, "resultado.revisar");
    return this.svc.accionOt(otId, "revisar", req?.user?.sub, req);
  }

  @Post("ot/:otId/aprobar")
  @RequierePermiso("resultado.aprobar")
  @ApiOperation({ summary: "Aprueba todos los resultados revisados de la OT (salvo los propios)" })
  async aprobarOt(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    await this.otEnAlcance(otId, req, "resultado.aprobar");
    return this.svc.accionOt(otId, "aprobar", req?.user?.sub, req);
  }

  /** La OT del laboratorio del usuario, o una OT con ensayos derivados a su laboratorio. */
  private async otEnAlcance(otId: string, req: any, permiso: string) {
    const tenantId = req?.user?.tenantId;
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, codigo: true, unidadPrincipal: true },
    });
    if (!ot) throw new NotFoundException(`OT ${otId} no encontrada`);
    await this.alcanceRes.alcanceEnOt(req, ot, permiso);
  }
}

/**
 * Añade los nombres de quien capturó, revisó, aprobó y de a quién está asignado
 * cada resultado (las columnas guardan solo el id del usuario).
 */
export async function conNombres<T extends Record<string, any>>(prisma: PrismaService, filas: T[]) {
  const ids = new Set<string>();
  for (const f of filas) for (const k of ["analistaId", "revisadoPor", "aprobadoPor", "asignadoA", "especEditadaPor"]) if (f[k]) ids.add(f[k]);
  const usuarios = ids.size
    ? await prisma.usuario.findMany({ where: { id: { in: [...ids] } }, select: { id: true, nombreCompleto: true } })
    : [];
  const nom = new Map(usuarios.map((u) => [u.id, u.nombreCompleto]));
  return filas.map((f) => ({
    ...f,
    analistaNombre: f.analistaId ? nom.get(f.analistaId) ?? null : null,
    revisadoPorNombre: f.revisadoPor ? nom.get(f.revisadoPor) ?? null : null,
    aprobadoPorNombre: f.aprobadoPor ? nom.get(f.aprobadoPor) ?? null : null,
    asignadoNombre: f.asignadoA ? nom.get(f.asignadoA) ?? null : null,
    especEditadaPorNombre: f.especEditadaPor ? nom.get(f.especEditadaPor) ?? null : null,
  }));
}

/**
 * Separación de deberes (NCh-ISO/IEC 17025):
 *   ver      · resultado.ver
 *   crear    · resultado.crear     (era la brecha: un LECTOR podía fabricar resultados)
 *   editar   · resultado.revisar   (tocar el veredicto a mano es un acto de revisión)
 *   eliminar · resultado.aprobar   (el más restrictivo: SUPERADMIN, DIRECTOR, JEFE_LAB)
 *
 * MÁQUINA DE ESTADOS (RF-E01) · ACTIVA.
 *   pendiente ─captura─▶ capturado ──revisar──▶ revisado_n1 ──aprobar──▶ aprobado (final)
 *                            ▲                       │
 *                            └──── devuelto ◀────────┴── devolver (también desde capturado)
 *
 *   POST /resultados/:id/revisar     · resultado.revisar  → revisado_n1
 *   POST /resultados/:id/aprobar     · resultado.aprobar  → aprobado
 *   POST /resultados/:id/devolver    · resultado.revisar  → devuelto (con motivo)
 *   POST /resultados/:id/recapturar  · resultado.crear    → capturado (corrige un devuelto por réplicas)
 *   POST /resultados/:id/veredicto   · resultado.revisar  → veredicto manual de un capturado
 *
 * Todas comprueban que el resultado es de un laboratorio del alcance del
 * usuario (403 si no). SEGREGACIÓN DE FUNCIONES: revisar y aprobar exigen que
 * el usuario NO sea el analista que capturó (409). Ver `ResultadoService.transitar`.
 *
 * `resultado.revisar` lo tienen REVISOR, ANALISTA_SR, JEFE_LAB, JEFE_SECCION,
 * JEFE_DEPTO, DIRECTOR, SUBDIRECTOR y ADMIN; `resultado.aprobar`, JEFE_LAB,
 * JEFE_SECCION, JEFE_DEPTO, DIRECTOR y SUBDIRECTOR (más SUPERADMIN).
 */
@ApiTags("resultados") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("resultados")
@RequierePermisoCrud({
  ver: "resultado.ver",
  crear: "resultado.crear",
  editar: "resultado.revisar",
  eliminar: "resultado.aprobar",
})
export class ResultadoController extends BaseCrudController {
  // Edición manual del resultado (veredicto/unidad/analista). El recálculo desde
  // réplicas se hace vía POST (capturar / recapturar), no por PATCH.
  protected updateSchema = z.object({
    veredicto: z
      .string()
      .max(20)
      .optional()
      .transform((v) => (v === undefined ? undefined : normalizarVeredicto(v) ?? v)),
    unidad: z.string().max(30).optional(),
  }).strict();
  constructor(
    protected svc: ResultadoService,
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly alcanceRes: AlcanceResultadoService,
  ) { super(); }

  /**
   * Captura. `analistaId` cae por defecto en el usuario autenticado: es quien
   * está capturando, y sin ese dato la segregación de funciones de RF-E01 no
   * tendría contra quién comparar (un resultado sin analista sería aprobable
   * por cualquiera, incluido quien lo capturó). La muestra debe ser de una OT
   * del alcance del usuario.
   */
  @Post()
  @RequierePermiso("resultado.crear")
  async crear(@Body() body: unknown, @Req() req: any) {
    const dto = ResultadoCreate.parse(body);
    const replicas = replicasDe(dto);
    const muestra = await this.prisma.muestra.findFirst({
      where: { id: dto.muestraId, ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}) },
      select: { otId: true },
    });
    if (!muestra) throw new NotFoundException(`Muestra ${dto.muestraId} no encontrada`);
    const otId = dto.otId ?? muestra.otId ?? null;
    const ot = otId
      ? await this.prisma.ordenTrabajo.findFirst({ where: { id: otId }, select: { unidadPrincipal: true } })
      : null;
    await this.alcance.exigirUnidad(req, ot?.unidadPrincipal ?? null, "la muestra");
    // El analista es SIEMPRE quien captura: si se pudiera indicar otro, el que
    // capturó podría después revisar y aprobar su propio resultado.
    if (dto.analistaId && dto.analistaId !== req?.user?.sub)
      throw new BadRequestException("El analista de un ensayo es quien lo captura: no se puede registrar a nombre de otra persona.");
    return (this.svc as ResultadoService).capturar(
      { ...dto, otId, replicas, analistaId: req?.user?.sub ?? null },
      req?.user?.tenantId ?? DEV_TENANT,
    );
  }

  /** Listado acotado a los resultados de OT del alcance del usuario. */
  @Get()
  async listar(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("search") search?: string,
    @Req() req?: any,
  ) {
    const filtro = await this.alcance.filtroUnidades(req);
    let where: any;
    if (filtro) {
      const ots = await this.prisma.ordenTrabajo.findMany({ where: { unidadPrincipal: { in: filtro } }, select: { id: true } });
      where = { otId: { in: ots.map((o) => o.id) } };
    }
    return this.svc.listar({ page: parseInt(page), limit: parseInt(limit), search, where }, req?.user?.tenantId);
  }

  /** Detalle con alcance por laboratorio (antes cualquier lector abría cualquier resultado por id). */
  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await exigirAlcanceResultado(this.svc as ResultadoService, this.alcanceRes, id, req, "ver");
    return this.svc.detalle(id, req?.user?.tenantId);
  }

  /**
   * Edición manual (veredicto/unidad) con alcance por laboratorio. Queda en el
   * historial del resultado. No cambia el analista ni deja que quien capturó
   * decida el veredicto, y lo aprobado no se toca (motivoEdicionManual).
   */
  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await exigirAlcanceResultado(this.svc as ResultadoService, this.alcanceRes, id, req, "revisar");
    const cuerpo = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const actual = await this.prisma.resultado.findFirst({ where: { id, deletedAt: null }, select: { estado: true, analistaId: true } });
    if (!actual) throw new NotFoundException(`Resultado ${id} no encontrado`);
    const bloqueo = motivoEdicionManual(actual, req?.user?.sub, cuerpo);
    if (bloqueo?.status === 400) throw new BadRequestException(bloqueo.motivo);
    if (bloqueo) throw new ConflictException(bloqueo.motivo);
    const datos = this.updateSchema.parse(body);
    await this.svc.detalle(id, req?.user?.tenantId);
    return conTraza(this.prisma, { usuarioId: req?.user?.sub, origen: "edicion_manual" }, (tx) =>
      tx.resultado.update({ where: { id }, data: datos }),
    );
  }

  /** Eliminación (resultado.aprobar): el disparador deja la baja con lo que tenía en el historial. */
  @Delete(":id")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await exigirAlcanceResultado(this.svc as ResultadoService, this.alcanceRes, id, req, "aprobar");
    await this.svc.detalle(id, req?.user?.tenantId);
    return conTraza(this.prisma, { usuarioId: req?.user?.sub, origen: "eliminacion" }, (tx) => tx.resultado.delete({ where: { id } }));
  }

  @Post(":id/recapturar")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "Corrige un resultado por réplicas (devuelto/capturado): recalcula y vuelve a capturado" })
  async recapturar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = ResultadoRecaptura.parse(body ?? {});
    await exigirAlcanceResultado(this.svc as ResultadoService, this.alcanceRes, id, req, "capturar");
    return (this.svc as ResultadoService).recapturar(id, { ...dto, replicas: replicasDe(dto) }, req?.user?.sub, req?.user?.tenantId ?? DEV_TENANT);
  }

  @Post(":id/revisar")
  @RequierePermiso("resultado.revisar")
  @ApiOperation({ summary: "Revisión N1: capturado → revisado_n1 (no puede ser el propio analista)" })
  async revisar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await exigirAlcanceResultado(this.svc as ResultadoService, this.alcanceRes, id, req, "revisar");
    return (this.svc as ResultadoService).revisar(id, req?.user?.sub);
  }

  @Post(":id/aprobar")
  @RequierePermiso("resultado.aprobar")
  @ApiOperation({ summary: "Aprobación final: revisado_n1 → aprobado (no puede ser el propio analista)" })
  async aprobar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await exigirAlcanceResultado(this.svc as ResultadoService, this.alcanceRes, id, req, "aprobar");
    return (this.svc as ResultadoService).aprobar(id, req?.user?.sub);
  }

  /**
   * Devolución motivada al analista. Exige `resultado.revisar` —el permiso del
   * escalón más bajo del circuito— para que tanto el revisor como el aprobador
   * puedan devolver (JEFE_LAB y DIRECTOR ya lo tienen sembrado).
   */
  @Post(":id/devolver")
  @RequierePermiso("resultado.revisar")
  @ApiOperation({ summary: "Devuelve el resultado al analista con un motivo → devuelto" })
  async devolver(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = DevolverDto.parse(body);
    await exigirAlcanceResultado(this.svc as ResultadoService, this.alcanceRes, id, req, "revisar");
    return (this.svc as ResultadoService).devolver(id, dto.motivo, req?.user?.sub);
  }

  /**
   * Reabre un resultado aprobado (jefatura, motivo obligatorio). Anula los
   * documentos en firma u oficiales de la OT, que se reemiten tras aprobar de nuevo.
   */
  @Post(":id/reabrir")
  @RequierePermiso("resultado.reabrir")
  @ApiOperation({ summary: "Reabre un resultado aprobado → devuelto (anula los documentos vigentes de la OT)" })
  async reabrir(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = ReabrirDto.parse(body ?? {});
    await exigirAlcanceResultado(this.svc as ResultadoService, this.alcanceRes, id, req, "reabrir");
    return (this.svc as ResultadoService).reabrir(id, dto.motivo, req?.user?.sub, req?.user?.tenantId);
  }

  @Post(":id/veredicto")
  @RequierePermiso("resultado.revisar")
  @ApiOperation({ summary: "Veredicto manual de un resultado capturado que el sistema no pudo decidir" })
  async veredicto(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = VeredictoDto.parse(body ?? {});
    await exigirAlcanceResultado(this.svc as ResultadoService, this.alcanceRes, id, req, "revisar");
    return (this.svc as ResultadoService).fijarVeredicto(id, dto.veredicto, req?.user?.sub, dto.motivo);
  }
}

@Module({
  // EquiposModule aporta EquiposService (exportado) para el BLOQUEO por
  // calibración vencida en ResultadoService.calcular() (RF-D04.2).
  imports: [EquiposModule],
  // ResultadoBandejaController ANTES que ResultadoController: su ruta estática
  // /resultados/bandeja debe registrarse antes que /resultados/:id.
  controllers: [
    TipoMuestraController, MuestraController, MetodoController, AnalitoController, NormaLimiteController, ResultadoBandejaController, ResultadoController,
    // Planilla de registros y cálculos (auditable) y de costos reales por OT (planillas-ot.ts).
    PlanillaCalculosController, CostosRealesController,
  ],
  providers: [TipoMuestraService, MuestraService, MetodoService, AnalitoService, NormaLimiteService, ResultadoService, PlanillaCalculosService, CostosRealesService],
  exports: [ResultadoService],
})
export class LaboratorioModule {}
