import { Body, Controller, Module, Post, UseGuards, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { validaRut } from "../common/rut.validator";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermisoCrud } from "../auth/permisos.decorator";

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
// No hay permisos `proveedor.*` sembrados. Compras/proveedores es una función
// económica: se lee con `factura.ver` y se gestiona con `factura.emitir`
// (SUPERADMIN, ADMIN, COBRANZA). Anotado como permiso "prestado" del dominio.
@ApiTags("proveedores") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("proveedores")
@RequierePermisoCrud({
  ver: "factura.ver",
  crear: "factura.emitir",
  editar: "factura.emitir",
  eliminar: "factura.emitir",
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
}
const ContactoCreate = z.object({
  clienteId: z.string().uuid(),
  nombre: z.string().min(1).max(160),
  cargo: z.string().max(120).optional(),
  email: z.string().email().optional(),
  telefono: z.string().max(40).optional(),
  principal: z.boolean().default(false),
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
}
const ListaPrecioCreate = z.object({
  codigo: z.string().min(1).max(30),
  nombre: z.string().min(1).max(200),
  moneda: z.enum(["CLP", "USD", "UF", "EUR"]).default("CLP"),
  activa: z.boolean().default(true),
});
// Las listas de precio alimentan la cotización: se leen con `cotizacion.ver` y
// se mantienen como dato maestro (`catalogo.gestionar`).
@ApiTags("listas-precio") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("listas-precio")
@RequierePermisoCrud({
  ver: "cotizacion.ver",
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
})
export class ListaPrecioController extends BaseCrudController {
  protected createSchema = ListaPrecioCreate;
  protected updateSchema = ListaPrecioCreate.partial();
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
}
const ItemCreate = z.object({
  listaPrecioId: z.string().uuid(),
  codigo: z.string().min(1).max(30),
  descripcion: z.string().min(1).max(300),
  cc: z.string().max(20).optional(),
  tipo: z.enum(["servicio", "HH", "HM", "viatico", "insumo"]).default("servicio"),
  precio: z.number().nonnegative(),
});
@ApiTags("lista-precio-items") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("lista-precio-items")
@RequierePermisoCrud({
  ver: "cotizacion.ver",
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
  controllers: [ProveedorController, ContactoController, CentroCostoController, ListaPrecioController, ListaPrecioItemController],
  providers: [ProveedorService, ContactoService, CentroCostoService, ListaPrecioService, ListaPrecioItemService],
})
export class ComercialModule {}
