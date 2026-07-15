import { Body, Controller, Module, Post, UseGuards, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService, DEV_TENANT } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";

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
      include: { hijos: true },
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
    super(prisma, { model: "analito", search: ["codigo", "nombre"], include: { limites: true }, tenant: false });
  }
}
const AnalitoCreate = z.object({
  metodoId: z.string().uuid(),
  codigo: z.string().min(1).max(60),
  nombre: z.string().min(1).max(200),
  unidad: z.string().max(30).optional(),
  formula: z.string().optional(),
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
}

/* ===================== LÍMITES / ESPECIFICACIONES ===================== */
@Injectable()
export class NormaLimiteService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "normaLimite", search: ["producto"], tenant: false, softDelete: false, orderBy: { id: "asc" } });
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
  constructor(prisma: PrismaService) {
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
  /** Captura réplicas RN1..RNn → calcula promedio/DE/CV y evalúa contra el límite del producto. */
  async capturar(dto: any, tenantId = DEV_TENANT) {
    const rep: number[] = dto.replicas;
    const st = this.estadistica(rep);
    const limite = dto.productoLimite
      ? await this.prisma.normaLimite.findFirst({ where: { analitoId: dto.analitoId, producto: dto.productoLimite } })
      : await this.prisma.normaLimite.findFirst({ where: { analitoId: dto.analitoId } });
    const analito = await this.prisma.analito.findUnique({ where: { id: dto.analitoId } });
    return this.prisma.resultado.create({
      data: {
        otId: dto.otId ?? null,
        muestraId: dto.muestraId,
        analitoId: dto.analitoId,
        replicas: rep,
        promedio: st.promedio,
        desviacion: st.desviacion,
        cv: st.cv,
        unidad: analito?.unidad ?? null,
        veredicto: this.veredicto(st.promedio, limite?.limiteInf ? Number(limite.limiteInf) : null, limite?.limiteSup ? Number(limite.limiteSup) : null),
        analistaId: dto.analistaId ?? null,
      },
      include: { analito: true, muestra: true },
    });
  }
}
const ResultadoCreate = z.object({
  otId: z.string().uuid().optional(),
  muestraId: z.string().uuid(),
  analitoId: z.string().uuid(),
  replicas: z.array(z.number()).min(1),
  productoLimite: z.string().optional(),
  analistaId: z.string().uuid().optional(),
});
/**
 * Separación de deberes (NCh-ISO/IEC 17025):
 *   ver      · resultado.ver
 *   crear    · resultado.crear     (era la brecha: un LECTOR podía fabricar resultados)
 *   editar   · resultado.revisar   (tocar el veredicto a mano es un acto de revisión)
 *   eliminar · resultado.aprobar   (el más restrictivo: SUPERADMIN, DIRECTOR, JEFE_LAB)
 *
 * SIN MÁQUINA DE ESTADOS. `schema.sql:873` define para `resultado` los estados
 * capturado → revisado_n1 → aprobado (+rechazado/devuelto) y están en
 * `common/estados.ts`, PERO el modelo Prisma `Resultado` NO declara la columna
 * `estado` (ni `tenant_id`, ni los campos revisado_n1_por/aprobado_por de la
 * tabla de schema.sql): el modelo Prisma y esa tabla son dos diseños distintos.
 * La API escribe contra el contrato Prisma, así que hoy no hay dónde guardar el
 * estado ni, por tanto, transición que validar. Habilitarlo exige migración
 * (columna + modelo) y los endpoints revisar/aprobar/devolver: queda anotado.
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
  @Post()
  @RequierePermiso("resultado.crear")
  crear(@Body() body: unknown) {
    return (this.svc as ResultadoService).capturar(ResultadoCreate.parse(body));
  }
}

@Module({
  controllers: [TipoMuestraController, MuestraController, MetodoController, AnalitoController, NormaLimiteController, ResultadoController],
  providers: [TipoMuestraService, MuestraService, MetodoService, AnalitoService, NormaLimiteService, ResultadoService],
})
export class LaboratorioModule {}
