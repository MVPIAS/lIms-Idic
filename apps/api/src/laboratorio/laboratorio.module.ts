import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  Injectable,
} from "@nestjs/common";
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
  constructor(protected svc: MuestraService) { super(); }
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
@Injectable()
export class ResultadoService extends BaseCrudService {
  // `equipos` se inyecta desde EquiposModule (importado por LaboratorioModule)
  // para aplicar el BLOQUEO por calibración vencida (RF-D04.2) en `capturar()`.
  constructor(prisma: PrismaService, private readonly equipos: EquiposService) {
    super(prisma, { model: "resultado", search: [], include: { analito: true, muestra: true }, tenant: false, orderBy: { fecha: "desc" } });
  }
  private estadistica(rep: number[]) {
    const n = rep.length;
    const m = rep.reduce((a, b) => a + b, 0) / n;
    const s = n > 1 ? Math.sqrt(rep.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
    return { promedio: m, desviacion: s, cv: m ? (s / Math.abs(m)) * 100 : 0 };
  }
  private veredicto(m: number, inf?: number | null, sup?: number | null) {
    if (inf != null && m < inf) return "No cumple";
    if (sup != null && m > sup) return "No cumple";
    if (inf == null && sup == null) return "Informativo";
    return "Cumple";
  }

  /**
   * Contexto de variables que ve la fórmula del analito (RF-A06/D02.1):
   *   RN1..RNn  · cada réplica, 1-indexada como en la hoja de captura
   *   REPLICAS  · el vector completo → PROMEDIO(REPLICAS), MAX(REPLICAS)…
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
        throw new BadRequestException(`La variable '${k}' es una variable reservada del ensayo (RN1..RNn, REPLICAS, PROMEDIO, DE, CV, N) y no puede redefinirse`);
      ctx[k] = v;
    }
    return ctx;
  }

  /**
   * Captura réplicas RN1..RNn → promedio/DE/CV → fórmula del analito (si tiene)
   * → veredicto contra el límite del producto.
   *
   * El VALOR DEL ENSAYO es el que devuelve la fórmula cuando el analito tiene
   * una; si no, sigue siendo el promedio crudo (comportamiento previo intacto,
   * que es el de los 3.118 analitos sin fórmula). Ese valor es el que se
   * contrasta con el límite y el que se informa.
   */
  async capturar(dto: any, tenantId = DEV_TENANT) {
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
    // procede sin equipo asociado (los 3.118 analitos y los flujos que no
    // informan equipo siguen funcionando igual). La obligatoriedad de informar
    // equipo, cuando se decida, se impone en el DTO/flujo, no aquí.
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
    // ----------------------------------------------------------------------

    return this.prisma.resultado.create({
      data: {
        otId: dto.otId ?? null,
        muestraId: dto.muestraId,
        analitoId: dto.analitoId,
        replicas: rep,
        promedio: st.promedio,
        desviacion: st.desviacion,
        cv: st.cv,
        resultadoFinal,
        // Copia de la fórmula tal y como estaba AL CAPTURAR: `analito.formula`
        // es editable y el resultado tiene que seguir siendo reproducible.
        formulaAplicada: formula || null,
        unidad: analito.unidad ?? null,
        veredicto: this.veredicto(valorEnsayo, limite?.limiteInf ? Number(limite.limiteInf) : null, limite?.limiteSup ? Number(limite.limiteSup) : null),
        analistaId: dto.analistaId ?? null,
        // Equipo APTO con el que se ejecutó el ensayo (RF-D04.1). Ya verificado
        // arriba; NULL si no se informó equipo.
        equipoId: dto.equipoId ?? null,
        // Todo resultado nace en 'capturado': el ciclo RF-E01 empieza aquí.
        estado: "capturado",
      },
      include: { analito: true, muestra: true },
    });
  }

  /* ---------------------- RF-E01 · Aprobación escalonada ---------------------- */

  /**
   * Aplica una transición del ciclo de vida del resultado y sella quién y
   * cuándo. Toda la política vive aquí para que los tres endpoints no puedan
   * divergir.
   *
   * SEGREGACIÓN DE FUNCIONES (NCh-ISO/IEC 17025):
   * quien captura un resultado NO puede revisarlo ni aprobarlo. La comprobación
   * es `usuario != resultado.analistaId` → 409 Conflict si coinciden. Un 403
   * sería engañoso: el usuario SÍ tiene el permiso, lo que no puede es
   * ejercerlo sobre ESTE resultado — es un conflicto de estado, no falta de
   * autorización. El encargo sólo exigía la regla en `aprobar`; se aplica
   * también en `revisar` porque el circuito de RF-E01 es analista → jefe de
   * laboratorio → jefe de departamento, y un revisor que se revisa a sí mismo
   * vacía de contenido el primer escalón igual que lo haría en el segundo.
   */
  private async transitar(
    id: string,
    nuevo: "revisado_n1" | "aprobado" | "devuelto",
    usuarioId: string | undefined,
    opts: { motivo?: string; exigeIndependencia: boolean },
  ) {
    const actual = await this.prisma.resultado.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, estado: true, analistaId: true },
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
      // Se conserva revisadoPor/At: es el rastro de quién lo miró y lo devolvió.
    }

    return this.prisma.resultado.update({
      where: { id },
      data,
      include: { analito: true, muestra: true },
    });
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
}
const ResultadoCreate = z.object({
  otId: z.string().uuid().optional(),
  muestraId: z.string().uuid(),
  analitoId: z.string().uuid(),
  replicas: z.array(z.number().finite()).min(1),
  productoLimite: z.string().optional(),
  analistaId: z.string().uuid().optional(),
  /**
   * RF-D04.1/D04.2 · Equipo con el que se ejecuta el ensayo. OPCIONAL. Si se
   * informa, la captura verifica su aptitud (calibración vigente + operativo) y
   * BLOQUEA con 409 si no es apto antes de persistir. Ver ResultadoService.capturar().
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
});

const DevolverDto = z.object({
  /** RF-E01 exige rechazo MOTIVADO: sin motivo el analista no sabe qué corregir. */
  motivo: z.string().trim().min(5, "Indique el motivo de la devolución (mínimo 5 caracteres)").max(1000),
});
/**
 * Separación de deberes (NCh-ISO/IEC 17025):
 *   ver      · resultado.ver
 *   crear    · resultado.crear     (era la brecha: un LECTOR podía fabricar resultados)
 *   editar   · resultado.revisar   (tocar el veredicto a mano es un acto de revisión)
 *   eliminar · resultado.aprobar   (el más restrictivo: SUPERADMIN, DIRECTOR, JEFE_LAB)
 *
 * MÁQUINA DE ESTADOS (RF-E01) · ACTIVA.
 *   capturado ──revisar──▶ revisado_n1 ──aprobar──▶ aprobado (final)
 *       ▲                       │
 *       └──────devolver─────────┴──devolver──┐
 *       └──────────── capturado ◀── devuelto ┘
 *
 *   POST /resultados/:id/revisar   · resultado.revisar  → revisado_n1
 *   POST /resultados/:id/aprobar   · resultado.aprobar  → aprobado
 *   POST /resultados/:id/devolver  · resultado.revisar  → devuelto (con motivo)
 *
 * Las transiciones las valida `validarTransicion("resultado", …)` contra el
 * mapa de `common/estados.ts` (vocabulario de schema.sql:873; el estado
 * intermedio es `revisado_n1`, no `revisado`). Un salto ilegal —aprobar algo
 * que sigue en 'capturado', reabrir un 'aprobado'— da 400 explicando qué se
 * permite desde el estado actual.
 *
 * SEGREGACIÓN DE FUNCIONES: revisar y aprobar exigen que el usuario NO sea el
 * analista que capturó (409). Ver `ResultadoService.transitar`.
 *
 * `resultado.aprobar` lo tienen SUPERADMIN, DIRECTOR y JEFE_LAB; `resultado.revisar`,
 * SUPERADMIN y ADMIN. Son los permisos ya sembrados en seed_rbac.sql: no se
 * inventa ninguno.
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
  // réplicas se hace vía POST (capturar), no por PATCH.
  protected updateSchema = z.object({
    veredicto: z.string().max(20).optional(),
    unidad: z.string().max(30).optional(),
    analistaId: z.string().uuid().optional(),
  });
  constructor(protected svc: ResultadoService) { super(); }

  /**
   * Captura. `analistaId` cae por defecto en el usuario autenticado: es quien
   * está capturando, y sin ese dato la segregación de funciones de RF-E01 no
   * tendría contra quién comparar (un resultado sin analista sería aprobable
   * por cualquiera, incluido quien lo capturó).
   */
  @Post()
  @RequierePermiso("resultado.crear")
  crear(@Body() body: unknown, @Req() req: any) {
    const dto = ResultadoCreate.parse(body);
    return (this.svc as ResultadoService).capturar(
      { ...dto, analistaId: dto.analistaId ?? req?.user?.sub },
      req?.user?.tenantId ?? DEV_TENANT,
    );
  }

  @Post(":id/revisar")
  @RequierePermiso("resultado.revisar")
  @ApiOperation({ summary: "Revisión N1: capturado → revisado_n1 (no puede ser el propio analista)" })
  revisar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return (this.svc as ResultadoService).revisar(id, req?.user?.sub);
  }

  @Post(":id/aprobar")
  @RequierePermiso("resultado.aprobar")
  @ApiOperation({ summary: "Aprobación final: revisado_n1 → aprobado (no puede ser el propio analista)" })
  aprobar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return (this.svc as ResultadoService).aprobar(id, req?.user?.sub);
  }

  /**
   * Devolución motivada al analista. Exige `resultado.revisar` —el permiso del
   * escalón más bajo del circuito— para que tanto el revisor como el aprobador
   * puedan devolver: quien tiene `resultado.aprobar` sin `resultado.revisar`
   * (DIRECTOR, JEFE_LAB) podría aprobar pero no rechazar, que es justo el
   * incentivo perverso que la 17025 quiere evitar.
   *   ⚠️ Requiere sembrar `resultado.revisar` a DIRECTOR y JEFE_LAB en
   *   seed_rbac.sql (hoy sólo lo tienen SUPERADMIN y ADMIN); queda fuera del
   *   alcance de este cambio porque el RBAC sembrado es de otro dominio.
   */
  @Post(":id/devolver")
  @RequierePermiso("resultado.revisar")
  @ApiOperation({ summary: "Devuelve el resultado al analista con un motivo → devuelto" })
  devolver(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = DevolverDto.parse(body);
    return (this.svc as ResultadoService).devolver(id, dto.motivo, req?.user?.sub);
  }
}

@Module({
  // EquiposModule aporta EquiposService (exportado) para el BLOQUEO por
  // calibración vencida en ResultadoService.capturar() (RF-D04.2).
  imports: [EquiposModule],
  controllers: [TipoMuestraController, MuestraController, MetodoController, AnalitoController, NormaLimiteController, ResultadoController],
  providers: [TipoMuestraService, MuestraService, MetodoService, AnalitoService, NormaLimiteService, ResultadoService],
})
export class LaboratorioModule {}
