import { Body, Controller, Module, Post, UseGuards, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService, DEV_TENANT } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";

/* ===================== TIPOS DE MUESTRA (árbol) ===================== */
@Injectable()
export class TipoMuestraService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "tipoMuestra", search: ["codigo", "nombre"], include: { hijos: true } });
  }
}
const TipoMuestraCreate = z.object({
  parentId: z.string().uuid().optional(),
  codigo: z.string().min(1).max(60),
  nombre: z.string().min(1).max(200),
  activo: z.boolean().default(true),
});
@ApiTags("tipos-muestra") @ApiBearerAuth() @UseGuards(AuthGuard("jwt")) @Controller("tipos-muestra")
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
@ApiTags("muestras") @ApiBearerAuth() @UseGuards(AuthGuard("jwt")) @Controller("muestras")
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
@ApiTags("metodos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt")) @Controller("metodos")
export class MetodoController extends BaseCrudController {
  protected createSchema = MetodoCreate;
  protected updateSchema = MetodoCreate.partial();
  constructor(protected svc: MetodoService) { super(); }
}

/* ===================== ANALITOS ===================== */
@Injectable()
export class AnalitoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "analito", search: ["codigo", "nombre"], include: { limites: true } });
  }
}
const AnalitoCreate = z.object({
  metodoId: z.string().uuid(),
  codigo: z.string().min(1).max(60),
  nombre: z.string().min(1).max(200),
  unidad: z.string().max(30).optional(),
  formula: z.string().optional(),
});
@ApiTags("analitos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt")) @Controller("analitos")
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
@ApiTags("limites") @ApiBearerAuth() @UseGuards(AuthGuard("jwt")) @Controller("limites")
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
@ApiTags("resultados") @ApiBearerAuth() @UseGuards(AuthGuard("jwt")) @Controller("resultados")
export class ResultadoController extends BaseCrudController {
  constructor(protected svc: ResultadoService) { super(); }
  @Post()
  crear(@Body() body: unknown) {
    return (this.svc as ResultadoService).capturar(ResultadoCreate.parse(body));
  }
}

@Module({
  controllers: [TipoMuestraController, MuestraController, MetodoController, AnalitoController, NormaLimiteController, ResultadoController],
  providers: [TipoMuestraService, MuestraService, MetodoService, AnalitoService, NormaLimiteService, ResultadoService],
})
export class LaboratorioModule {}
