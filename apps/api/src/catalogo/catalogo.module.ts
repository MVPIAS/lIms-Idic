import { Controller, Module, UseGuards, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermisoCrud } from "../auth/permisos.decorator";
import { estadosValidos, validarTransicion } from "../common/estados";

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

/* ===================== CERTIFICADOS / INFORMES emitidos ===================== */
@Injectable()
export class CertificadoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    // `ot` anidado con su cliente: la etiqueta de la columna OT en /certificados
    // es "código · razón social del cliente" (etiquetaOt), así que con `ot: true`
    // a secas se quedaría sin el desempate del cliente.
    super(prisma, { model: "certificado", search: ["codigo", "tipo"], include: { plantilla: true, ot: { include: { cliente: true } } } });
  }

  /**
   * Un certificado emitido es un documento con valor legal: no se "edita" de
   * vuelta a emitido ni se reactiva una vez anulado. Se valida la transición
   * emitido → anulado antes de tocar la fila.
   */
  async actualizar(id: string, data: any, tenantId?: string) {
    if (data?.estado !== undefined) {
      const actual = await this.detalle(id, tenantId); // valida tenant + existencia
      validarTransicion("certificado", actual.estado, data.estado);
    }
    return super.actualizar(id, data, tenantId);
  }
}
const CertificadoCreate = z.object({
  otId: z.string().uuid(),
  codigo: z.string().min(1).max(40),
  tipo: z.string().max(40).optional(),
  plantillaId: z.string().uuid().optional(),
  hashSha256: z.string().max(64).optional(),
  urlVerificacion: z.string().max(300).optional(),
  estado: z.enum(estadosValidos("certificado") as [string, ...string[]]).default("emitido"),
});
/**
 * No existe `certificado.ver` en el RBAC sembrado: el certificado es el
 * entregable de la OT, así que se lee con `ot.ver` (lo tienen todos los roles
 * operativos). Emitir/editar → `certificado.emitir`; borrar → `certificado.firmar`,
 * el más restrictivo del dominio (SUPERADMIN, DIRECTOR, JEFE_LAB).
 */
@ApiTags("certificados") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("certificados")
@RequierePermisoCrud({
  ver: "ot.ver",
  crear: "certificado.emitir",
  editar: "certificado.emitir",
  eliminar: "certificado.firmar",
})
export class CertificadoController extends BaseCrudController {
  protected createSchema = CertificadoCreate;
  protected updateSchema = CertificadoCreate.partial();
  constructor(protected svc: CertificadoService) { super(); }
}

@Module({
  controllers: [GranGrupoController, GrupoController, PlantillaInformeController, CertificadoController],
  providers: [GranGrupoService, GrupoService, PlantillaInformeService, CertificadoService],
})
export class CatalogoModule {}
