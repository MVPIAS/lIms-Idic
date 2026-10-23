import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { contactoPrincipalDesdeFicha } from "./contacto-principal";
import { PrismaClient } from "@prisma/client";
import { DEV_TENANT } from "../common/base-crud.service";
import { validarTipoCliente, type OpcionTipoCliente } from "./tipo-cliente";

@Injectable()
export class ClienteService {
  private prisma = new PrismaClient();

  /** Lista parametrizable de tipos de cliente (activos e inactivos) del tenant. */
  async tiposCliente(tenantId?: string): Promise<OpcionTipoCliente[]> {
    return this.prisma.parametroSistema.findMany({
      where: { categoria: "tipo_cliente", ...(tenantId ? { tenantId } : {}) },
      orderBy: { orden: "asc" },
      select: { codigo: true, etiqueta: true, activo: true },
    });
  }

  /** Valida `tipo` contra la lista vigente (400 con mensaje claro si no vale). */
  private async exigirTipo(tipo: string | null | undefined, tenantId?: string, tipoActual?: string | null) {
    const r = validarTipoCliente(tipo, await this.tiposCliente(tenantId), tipoActual);
    if (!r.ok) throw new BadRequestException(r.mensaje);
  }

  async listar(opts: {
    page: number;
    limit: number;
    search?: string;
    tipo?: string;
    tenantId?: string;
  }) {
    const skip = (opts.page - 1) * opts.limit;
    const where: any = { deletedAt: null };
    if (opts.tenantId) where.tenantId = opts.tenantId; // aislamiento por tenant
    if (opts.search) {
      where.OR = [
        { razonSocial: { contains: opts.search, mode: "insensitive" } },
        { rut: { contains: opts.search } },
      ];
    }
    if (opts.tipo) where.tipo = opts.tipo;

    const [data, total] = await Promise.all([
      this.prisma.cliente.findMany({
        where,
        skip,
        take: opts.limit,
        orderBy: { razonSocial: "asc" },
        include: {
          plantas: { take: 1 },
        },
      }),
      this.prisma.cliente.count({ where }),
    ]);
    // Etiqueta legible del tipo (la lista guarda el código).
    const tipos = new Map((await this.tiposCliente(opts.tenantId)).map((t) => [t.codigo, t]));

    return {
      data: data.map((c) => ({
        ...c,
        tipoEtiqueta: c.tipo ? tipos.get(c.tipo)?.etiqueta ?? c.tipo : null,
        tipoVigente: c.tipo ? tipos.get(c.tipo)?.activo ?? false : false,
      })),
      meta: {
        page: opts.page,
        limit: opts.limit,
        total,
        totalPages: Math.ceil(total / opts.limit),
      },
    };
  }

  async detalle(id: string, tenantId?: string) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id, deletedAt: null, ...(tenantId ? { tenantId } : {}) },
      include: {
        plantas: true,
        cotizaciones: {
          take: 10,
          orderBy: { createdAt: "desc" },
        },
        ots: {
          take: 10,
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!cliente) throw new NotFoundException(`Cliente ${id} no encontrado`);
    return cliente;
  }

  async crear(data: any, tenantId?: string) {
    // tenantId sale del JWT; se ignora cualquier tenantId del body.
    const { tenantId: _ignore, ...rest } = data ?? {};
    await this.exigirTipo(rest.tipo ?? null, tenantId ?? DEV_TENANT);
    const cliente = await this.prisma.cliente.create({
      data: {
        ...rest,
        tenantId: tenantId ?? DEV_TENANT,
      },
    });
    // B-038: el contacto principal de la ficha aparece en Contactos.
    await contactoPrincipalDesdeFicha(this.prisma, cliente.id);
    return cliente;
  }

  async actualizar(id: string, data: any, tenantId?: string) {
    const actual = await this.detalle(id, tenantId); // valida existencia + pertenencia al tenant
    const { tenantId: _ignore, ...rest } = data ?? {};
    // Un cliente con tipo antiguo (pre-R2) se puede editar sin reclasificarlo;
    // si se cambia el tipo, el nuevo debe estar vigente.
    await this.exigirTipo(rest.tipo, actual.tenantId, actual.tipo);
    const cliente = await this.prisma.cliente.update({
      where: { id },
      data: rest,
    });
    if (["contactoNombre", "contactoCargo", "contactoEmail", "contactoTelefono"].some((k) => k in rest))
      await contactoPrincipalDesdeFicha(this.prisma, id);
    return cliente;
  }

  async bloquear(id: string, motivo: string, tenantId?: string) {
    await this.detalle(id, tenantId); // valida pertenencia al tenant
    return this.prisma.cliente.update({
      where: { id },
      data: { bloqueado: true, motivoBloqueo: motivo },
    });
  }

  async desbloquear(id: string, motivo: string, tenantId?: string) {
    await this.detalle(id, tenantId); // valida pertenencia al tenant
    // TODO: registrar en cliente_desbloqueo con autorización
    return this.prisma.cliente.update({
      where: { id },
      data: { bloqueado: false, motivoBloqueo: null },
    });
  }

  /** Contactos vigentes del cliente (solicitante de la cotización, EP-01 0.1). */
  async contactos(clienteId: string, tenantId?: string) {
    await this.detalle(clienteId, tenantId);
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, nombre, cargo, email, telefono, COALESCE(principal, es_principal, false) AS principal
         FROM contacto WHERE cliente_id = $1::uuid AND deleted_at IS NULL AND COALESCE(activo, true)
        ORDER BY COALESCE(principal, es_principal, false) DESC, nombre`,
      clienteId,
    );
  }

  /* ------------------------------------------------ plantas (EP-00 0.1, BL-172) --- */

  /** Plantas del cliente (activas primero). */
  async plantas(clienteId: string, tenantId?: string) {
    await this.detalle(clienteId, tenantId);
    return this.prisma.planta.findMany({ where: { clienteId }, orderBy: [{ activa: "desc" }, { codigo: "asc" }] });
  }

  /** Alta de una planta. Sin código se numera P01, P02… dentro del cliente. */
  async crearPlanta(clienteId: string, data: DatosPlanta, tenantId?: string) {
    await this.detalle(clienteId, tenantId);
    const existentes = await this.prisma.planta.findMany({ where: { clienteId }, select: { codigo: true, nombre: true } });
    const codigo = (data.codigo ?? "").trim().toUpperCase() || siguienteCodigoPlanta(existentes.map((e) => e.codigo));
    if (existentes.some((e) => e.codigo.toUpperCase() === codigo))
      throw new BadRequestException(`El cliente ya tiene una planta con el código ${codigo}.`);
    if (existentes.some((e) => e.nombre.trim().toLowerCase() === data.nombre.trim().toLowerCase()))
      throw new BadRequestException(`El cliente ya tiene una planta llamada «${data.nombre.trim()}».`);
    return this.prisma.planta.create({ data: { ...limpiarPlanta(data), codigo, clienteId } });
  }

  /** Corrige una planta o la desactiva (no se borra: puede estar citada en cotizaciones y OT). */
  async actualizarPlanta(clienteId: string, plantaId: string, data: Partial<DatosPlanta> & { activa?: boolean }, tenantId?: string) {
    await this.detalle(clienteId, tenantId);
    const p = await this.prisma.planta.findFirst({ where: { id: plantaId, clienteId } });
    if (!p) throw new NotFoundException("La planta no existe o no es de este cliente.");
    if (data.nombre) {
      const otra = await this.prisma.planta.findFirst({ where: { clienteId, id: { not: plantaId }, nombre: { equals: data.nombre.trim(), mode: "insensitive" } } });
      if (otra) throw new BadRequestException(`El cliente ya tiene una planta llamada «${data.nombre.trim()}».`);
    }
    const { codigo: _c, ...resto } = data;
    return this.prisma.planta.update({ where: { id: plantaId }, data: limpiarPlanta(resto) });
  }
}

export interface DatosPlanta {
  codigo?: string;
  nombre: string;
  direccion?: string | null;
  ciudad?: string | null;
  region?: string | null;
  telefono?: string | null;
}

/** Siguiente código libre P01, P02… (ignora los códigos que no siguen ese patrón). */
export function siguienteCodigoPlanta(codigos: string[]): string {
  const max = codigos.reduce((m, c) => {
    const x = /^P(\d+)$/i.exec(c.trim());
    return x ? Math.max(m, Number(x[1])) : m;
  }, 0);
  return `P${String(max + 1).padStart(2, "0")}`;
}

function limpiarPlanta<T extends Record<string, any>>(d: T): T {
  const o: Record<string, any> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    o[k] = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v;
  }
  return o as T;
}
