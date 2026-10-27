import { BadRequestException, Body, Controller, ConflictException, Module, Post, UseGuards, Injectable } from "@nestjs/common";
import { fichaDesdeContactoPrincipal } from "../cliente/contacto-principal";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { validaRut } from "../common/rut.validator";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermisoCrud } from "../auth/permisos.decorator";
import { ListaPrecioDetalleController, ListaPrecioDetalleService } from "../lista-precio/lista-precio-detalle.controller";
import { MSJ_MONEDA, esMonedaHistorica, esMonedaOperacion, zMoneda } from "../common/moneda";
import { diaChile } from "../common/fecha-chile";

/* ===================== PROVEEDORES ===================== */
@Injectable()
export class ProveedorService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "proveedor", search: ["razonSocial", "rut", "rubro"] });
  }
}
const ProveedorCreate = z.object({
  rut: z.string().refine(validaRut, { message: "RUT inválido (módulo 11)" }),
  razonSocial: z.string().min(1).max(200),
  rubro: z.string().max(200).optional(),
  contacto: z.string().max(120).optional(),
  telefono: z.string().max(40).optional(),
  email: z.string().email().optional(),
  condicionPago: z.string().max(40).optional(),
  estado: z.enum(["habilitado", "en_evaluacion", "inhabilitado"]).default("habilitado"),
});
// Proveedores = compras (Abastecimiento): `compra.ver` / `compra.gestionar`
// (align_correcciones_manuales.sql). Antes usaban `factura.*`, lo que obligaba a
// dar a Abastecimiento el permiso de emitir facturas.
@ApiTags("proveedores") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("proveedores")
@RequierePermisoCrud({
  ver: "compra.ver",
  crear: "compra.gestionar",
  editar: "compra.gestionar",
  eliminar: "compra.gestionar",
})
export class ProveedorController extends BaseCrudController {
  protected createSchema = ProveedorCreate;
  protected updateSchema = ProveedorCreate.partial();
  constructor(protected svc: ProveedorService) { super(); }
}

/* ===================== CONTACTOS (de cliente) ===================== */
@Injectable()
export class ContactoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "contacto", search: ["nombre", "email"], tenant: false });
  }

  // B-038: un solo contacto principal por cliente, y la ficha del cliente toma sus datos.
  async crear(data: any, tenantId?: string) {
    const c = await super.crear(data, tenantId);
    if (data?.principal === true) await fichaDesdeContactoPrincipal(this.prisma, c.id);
    return c;
  }

  async actualizar(id: string, data: any, tenantId?: string) {
    const c = await super.actualizar(id, data, tenantId);
    if (data?.principal === true) await fichaDesdeContactoPrincipal(this.prisma, id);
    else if (data?.principal === false) await this.prisma.$executeRawUnsafe(`UPDATE contacto SET es_principal = false WHERE id = $1::uuid`, id);
    return c;
  }
}
const ContactoCreate = z.object({
  clienteId: z.string().uuid(),
  nombre: z.string().min(1).max(160),
  cargo: z.string().max(120).optional(),
  email: z.string().email().optional(),
  telefono: z.string().max(40).optional(),
  principal: z.preprocess((v) => (v === "si" || v === "true" ? true : v === "no" || v === "false" ? false : v), z.boolean()).default(false),
});
// El contacto cuelga del cliente → permisos del dominio cliente.
@ApiTags("contactos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("contactos")
@RequierePermisoCrud({
  ver: "cliente.ver",
  crear: "cliente.editar",
  editar: "cliente.editar",
  eliminar: "cliente.editar",
})
export class ContactoController extends BaseCrudController {
  protected createSchema = ContactoCreate;
  protected updateSchema = ContactoCreate.partial();
  constructor(protected svc: ContactoService) { super(); }
}

/* ===================== CENTROS DE COSTO ===================== */
@Injectable()
export class CentroCostoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "centroCosto", search: ["codigo", "nombre"] });
  }
}
const CentroCostoCreate = z.object({
  codigo: z.string().min(1).max(30),
  nombre: z.string().min(1).max(200),
  laboratorio: z.string().max(20).optional(),
  // Comercial R2: grupo del combo, texto base de condiciones y validez propia del lab.
  tipo: z.enum(["laboratorio", "sucursal_bpch", "delegacion_bpch"]).optional(),
  condicionesBase: z.string().max(2000).nullable().optional(),
  validezParticularDias: z.coerce.number().int().positive().nullable().optional(),
  activo: z.boolean().default(true),
});
// Centro de costo = dato maestro económico: lectura con `factura.ver`,
// mantenimiento con `catalogo.gestionar`.
@ApiTags("centros-costo") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("centros-costo")
@RequierePermisoCrud({
  ver: "factura.ver",
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
})
export class CentroCostoController extends BaseCrudController {
  protected createSchema = CentroCostoCreate;
  protected updateSchema = CentroCostoCreate.partial();
  constructor(protected svc: CentroCostoService) { super(); }
}

/* ===================== LISTAS DE PRECIO ===================== */
@Injectable()
export class ListaPrecioService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "listaPrecio", search: ["codigo", "nombre"], include: { items: true } });
  }

  /**
   * Frente f5 · una lista guardada en una moneda que ya no se usa (UF, EUR…,
   * datos migrados) es histórica: se ve tal cual, sin convertir. Solo se puede
   * activar o desactivar; cambiar su código, nombre o moneda se rechaza.
   */
  async actualizar(id: string, data: any, tenantId?: string) {
    const actual: any = await this.detalle(id, tenantId);
    if (esMonedaHistorica(actual.moneda)) {
      const valor = (v: unknown) => (v instanceof Date ? diaChile(v) ?? "" : String(v ?? ""));
      const cambia = (["codigo", "nombre", "moneda", "vigenteDesde"] as const).filter((k) => data?.[k] !== undefined && valor(data[k]) !== valor(actual[k]));
      if (cambia.length)
        throw new ConflictException(
          `La lista ${actual.codigo} está en ${actual.moneda}, una moneda histórica: es de solo lectura (solo se puede activar o desactivar). ${MSJ_MONEDA} Para precios nuevos cree una lista en CLP o USD.`,
        );
    } else if (data?.moneda !== undefined && data.moneda !== actual.moneda && !esMonedaOperacion(data.moneda)) {
      throw new BadRequestException(MSJ_MONEDA);
    } else if (data?.moneda !== undefined && data.moneda !== actual.moneda && (actual.items?.length ?? 0) > 0) {
      // Los precios no se convierten: cambiar la moneda de una lista con ítems los falsearía.
      throw new ConflictException(`La lista ${actual.codigo} ya tiene ítems en ${actual.moneda}: su moneda no cambia (los precios no se convierten). Cree otra lista en ${data.moneda}.`);
    }
    return super.actualizar(id, data, tenantId);
  }

  async eliminar(id: string, tenantId?: string) {
    const actual: any = await this.detalle(id, tenantId);
    if (esMonedaHistorica(actual.moneda))
      throw new ConflictException(`La lista ${actual.codigo} está en ${actual.moneda}, una moneda histórica: no se borra (es un dato histórico). Desactívela si no debe usarse.`);
    return super.eliminar(id, tenantId);
  }
}
const ListaPrecioCreate = z.object({
  codigo: z.string().min(1).max(30),
  nombre: z.string().min(1).max(200),
  // Frente f5: solo CLP y USD (common/moneda.ts); las listas antiguas en UF quedan como históricas.
  moneda: zMoneda.default("CLP"),
  // AAAA-MM-DD; sin ella, la base pone hoy (antes el alta fallaba: vigente_desde es obligatoria).
  vigenteDesde: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").transform((s) => new Date(`${s}T00:00:00Z`)).optional()),
  activa: z.boolean().default(true),
});
// Las listas de precio alimentan la cotización. Frente f6: se leen con su
// permiso propio `lista_precio.ver` (antes `cotizacion.ver`: Calidad las
// mantenía sin poder verlas) y se mantienen como dato maestro
// (`catalogo.gestionar` con alcance global: Calidad y Administración).
@ApiTags("listas-precio") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("listas-precio")
@RequierePermisoCrud({
  ver: "lista_precio.ver",
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
})
export class ListaPrecioController extends BaseCrudController {
  protected createSchema = ListaPrecioCreate;
  // La edición puede traer la moneda guardada de una lista histórica (UF) sin cambiarla:
  // el servicio rechaza un CAMBIO a una moneda que no sea CLP o USD.
  protected updateSchema = ListaPrecioCreate.partial().extend({
    moneda: z.string().trim().max(3).transform((s) => s.toUpperCase()).optional(),
  });
  constructor(protected svc: ListaPrecioService) { super(); }
}

/* ===================== ÍTEMS DE LISTA DE PRECIO ===================== */
@Injectable()
export class ListaPrecioItemService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    // OJO: la relación se llama `lista` en el modelo Prisma (la FK es
    // listaPrecioId, pero el campo de navegación NO es `listaPrecio`), así que
    // el include y el renderRef del front tienen que usar `lista`.
    // ListaPrecioItem no tiene relación a `metodo`: sus líneas son de texto
    // libre (codigo/descripcion/tipo), no apuntan al catálogo de métodos.
    super(prisma, { model: "listaPrecioItem", search: ["codigo", "descripcion"], include: { lista: true }, tenant: false, softDelete: false, orderBy: { codigo: "asc" } });
  }

  /** Frente f5: los ítems de una lista en moneda histórica (UF, EUR…) no se crean, cambian ni borran. */
  private async exigirListaVigenteEnMoneda(listaPrecioId: string | undefined, tenantId?: string) {
    if (!listaPrecioId) return;
    const l = await this.prisma.listaPrecio.findFirst({ where: { id: listaPrecioId, ...(tenantId ? { tenantId } : {}) }, select: { codigo: true, moneda: true } });
    if (l && esMonedaHistorica(l.moneda))
      throw new ConflictException(`La lista ${l.codigo} está en ${l.moneda}, una moneda histórica: sus ítems son de solo lectura. ${MSJ_MONEDA}`);
  }

  async crear(data: any, tenantId?: string) {
    await this.exigirListaVigenteEnMoneda(data?.listaPrecioId, tenantId);
    return super.crear(data, tenantId);
  }

  async actualizar(id: string, data: any, tenantId?: string) {
    const actual: any = await this.detalle(id, tenantId);
    await this.exigirListaVigenteEnMoneda(actual.listaPrecioId, tenantId);
    if (data?.listaPrecioId && data.listaPrecioId !== actual.listaPrecioId) await this.exigirListaVigenteEnMoneda(data.listaPrecioId, tenantId);
    return super.actualizar(id, data, tenantId);
  }

  async eliminar(id: string, tenantId?: string) {
    const actual: any = await this.detalle(id, tenantId);
    await this.exigirListaVigenteEnMoneda(actual.listaPrecioId, tenantId);
    return super.eliminar(id, tenantId);
  }
}
const ItemCreate = z.object({
  listaPrecioId: z.string().uuid(),
  codigo: z.string().min(1).max(30),
  descripcion: z.string().min(1).max(300),
  cc: z.string().max(20).optional(),
  tipo: z.enum(["servicio", "HH", "HM", "viatico", "insumo"]).default("servicio"),
  precio: z.coerce.number().nonnegative(),
});
@ApiTags("lista-precio-items") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("lista-precio-items")
@RequierePermisoCrud({
  ver: "lista_precio.ver",
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
})
export class ListaPrecioItemController extends BaseCrudController {
  protected createSchema = ItemCreate;
  protected updateSchema = ItemCreate.partial();
  constructor(protected svc: ListaPrecioItemService) { super(); }
}

@Module({
  controllers: [ProveedorController, ContactoController, CentroCostoController, ListaPrecioController, ListaPrecioItemController, ListaPrecioDetalleController],
  providers: [ProveedorService, ContactoService, CentroCostoService, ListaPrecioService, ListaPrecioItemService, ListaPrecioDetalleService],
})
export class ComercialModule {}
