import { All, Controller, GoneException, Module, UseGuards, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermisoCrud } from "../auth/permisos.decorator";
import { TIPOS_DOCUMENTO } from "../rbac/rbac.constants";

/* ===================== GRAN GRUPO (eje producto) ===================== */
@Injectable()
export class GranGrupoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "granGrupo", search: ["codigo", "nombre"], include: { grupos: true }, softDelete: false, orderBy: { codigo: "asc" } });
  }
}
const GranGrupoCreate = z.object({ codigo: z.string().min(1).max(10), nombre: z.string().min(1).max(120), activo: z.boolean().default(true) });
// Clasificación de producto: la leen todos los roles operativos (se usa para
// clasificar muestras) y solo la gestiona quien tiene `catalogo.gestionar`.
@ApiTags("gran-grupos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("gran-grupos")
@RequierePermisoCrud({
  ver: "muestra.ver",
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
})
export class GranGrupoController extends BaseCrudController {
  protected createSchema = GranGrupoCreate;
  protected updateSchema = GranGrupoCreate.partial();
  constructor(protected svc: GranGrupoService) { super(); }
}

/* ===================== GRUPO ===================== */
@Injectable()
export class GrupoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "grupo", search: ["nombre", "cgrupo"], include: { granGrupo: true }, softDelete: false, orderBy: { nombre: "asc" } });
  }
}
const GrupoCreate = z.object({ granGrupoId: z.string().uuid(), cgrupo: z.string().max(10).optional(), nombre: z.string().min(1).max(160), activo: z.boolean().default(true) });
@ApiTags("grupos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("grupos")
@RequierePermisoCrud({
  ver: "muestra.ver",
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
})
export class GrupoController extends BaseCrudController {
  protected createSchema = GrupoCreate;
  protected updateSchema = GrupoCreate.partial();
  constructor(protected svc: GrupoService) { super(); }
}

/* ===================== PLANTILLAS DE INFORME ===================== */
@Injectable()
export class PlantillaInformeService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "plantillaInforme", search: ["repid", "nombre", "tipo"] });
  }
}
const PlantillaCreate = z.object({
  repid: z.string().min(1).max(20),
  nombre: z.string().min(1).max(160),
  tipo: z.enum(["CERTIFICADO", "I.ENSAYO", "I.TECNICO", "IVC", "PLANILLA", "BOLETIN", "OTRO"]),
  emision: z.enum(["conjunto", "individual"]).default("conjunto"),
  archivoRef: z.string().max(200).optional(),
  /** Tipo de documento de la matriz (firmas y numeración) que emite la plantilla; vacío = automático (B-022). */
  tipoDocumento: z.preprocess((v) => (v === "" ? null : v), z.enum(TIPOS_DOCUMENTO).nullable().optional()),
  version: z.string().max(10).default("v1"),
  activo: z.boolean().default(true),
});
@ApiTags("plantillas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("plantillas")
@RequierePermisoCrud({
  ver: "plantilla.ver",
  crear: "plantilla.gestionar",
  editar: "plantilla.gestionar",
  eliminar: "plantilla.gestionar",
})
export class PlantillaInformeController extends BaseCrudController {
  protected createSchema = PlantillaCreate;
  protected updateSchema = PlantillaCreate.partial();
  constructor(protected svc: PlantillaInformeService) { super(); }
}

/* ===================== CERTIFICADOS (ruta heredada, RETIRADA) ===================== */
/**
 * `/certificados` era un CRUD genérico de solo lectura sobre la tabla
 * `certificado` que NO filtraba por laboratorio: cualquier perfil con `ot.ver`
 * listaba y abría los informes de todo el instituto (auditoría de roles, C3).
 * Ninguna pantalla lo usa: «Informes y certificados» lee
 * `GET /informes/documentos` (acotado al alcance) y el Panel de indicadores
 * también. Se retira y responde 410 Gone con la ruta que lo sustituye.
 */
@ApiTags("certificados") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("certificados")
export class CertificadoRetiradoController {
  @All()
  raiz(): never {
    throw retirada();
  }

  @All("*")
  resto(): never {
    throw retirada();
  }
}

function retirada() {
  return new GoneException({
    statusCode: 410,
    message:
      "Esta ruta se retiró. Los informes y certificados se consultan en GET /informes/documentos (y el circuito de cada uno en GET /informes/:id/circuito), acotados a su alcance por laboratorio.",
    sustituta: "/informes/documentos",
  });
}

@Module({
  controllers: [GranGrupoController, GrupoController, PlantillaInformeController, CertificadoRetiradoController],
  providers: [GranGrupoService, GrupoService, PlantillaInformeService],
})
export class CatalogoModule {}
