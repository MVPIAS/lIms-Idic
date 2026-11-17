import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ESTADOS_FACTURA_IMPAGA, evaluarMorosidad, puedeBloquearClientes } from "./bloqueo-cliente";
import { entero, valoresCategoria } from "../common/parametros-r4d";
import { hoyChile } from "../common/fecha-chile";
import { contactoPrincipalDesdeFicha } from "./contacto-principal";
import { PrismaClient } from "@prisma/client";
import { DEV_TENANT } from "../common/base-crud.service";
import { validarTipoCliente, type OpcionTipoCliente } from "./tipo-cliente";
import { MSJ_MONEDA, esMonedaOperacion } from "../common/moneda";

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

  /**
   * Contrato 4.1.3 · la lista de precios propia tiene que existir en el tenant,
   * no estar borrada y estar en una moneda de la operación (CLP o USD).
   */
  private async exigirListaPrecio(listaPrecioId: unknown, tenantId: string) {
    if (typeof listaPrecioId !== "string") return;
    const l = await this.prisma.listaPrecio.findFirst({ where: { id: listaPrecioId, tenantId, deletedAt: null }, select: { codigo: true, moneda: true } });
    if (!l) throw new BadRequestException("La lista de precios elegida no existe o fue eliminada.");
    if (!esMonedaOperacion(String(l.moneda ?? "CLP").toUpperCase()))
      throw new BadRequestException(`La lista ${l.codigo} está en ${l.moneda}, una moneda histórica: no puede asignarse a un cliente. ${MSJ_MONEDA}`);
  }

  /** Código y nombre de la lista propia de cada cliente (la relación no está en Prisma). */
  private async conListaPrecio<T extends { listaPrecioId?: string | null }>(filas: T[]): Promise<(T & { listaPrecio: { id: string; codigo: string; nombre: string; especial: boolean } | null })[]> {
    const ids = [...new Set(filas.map((f) => f.listaPrecioId).filter((x): x is string => !!x))];
    const ls = ids.length ? await this.prisma.listaPrecio.findMany({ where: { id: { in: ids } }, select: { id: true, codigo: true, nombre: true, especial: true } }) : [];
    const porId = new Map(ls.map((l) => [l.id, l]));
    return filas.map((f) => ({ ...f, listaPrecio: f.listaPrecioId ? porId.get(f.listaPrecioId) ?? null : null }));
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
      data: (await this.conListaPrecio(data)).map((c) => ({
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
    return (await this.conListaPrecio([cliente]))[0];
  }

  async crear(data: any, tenantId?: string) {
    // tenantId sale del JWT; se ignora cualquier tenantId del body.
    const { tenantId: _ignore, ...rest } = data ?? {};
    await this.exigirTipo(rest.tipo ?? null, tenantId ?? DEV_TENANT);
    await this.exigirListaPrecio(rest.listaPrecioId, tenantId ?? DEV_TENANT);
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
    await this.exigirListaPrecio(rest.listaPrecioId, actual.tenantId);
    const cliente = await this.prisma.cliente.update({
      where: { id },
      data: rest,
    });
    if (["contactoNombre", "contactoCargo", "contactoEmail", "contactoTelefono"].some((k) => k in rest))
      await contactoPrincipalDesdeFicha(this.prisma, id);
    return cliente;
  }

  /**
   * Reunión 2: bloquear es atribución del Jefe del Departamento Comercial
   * (titular, subrogante o con el rol de jefatura en el DCO). SUPERADMIN pasa.
   */
  private async exigirJefeDco(req: any, tenantId: string) {
    const roles: string[] = req?.user?.roles ?? [];
    const permisos: string[] = req?.user?.permisos ?? [];
    const yo = req?.user?.sub ?? null;
    const f = yo
      ? await this.prisma.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM unidad d
            WHERE d.codigo = 'DCO' AND d.tenant_id = $1::uuid
              AND (EXISTS (SELECT 1 FROM unidad_jefe j WHERE j.unidad_id = d.id AND j.usuario_id = $2::uuid)
                   OR EXISTS (SELECT 1 FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id
                               WHERE ur.usuario_id = $2::uuid AND ur.unidad_id = d.id AND COALESCE(r.alias_de, r.codigo) = 'JEFE_DEPTO'))`,
          tenantId,
          yo,
        ).catch(() => [{ n: 0 }])
      : [{ n: 0 }];
    const ok = puedeBloquearClientes({ superadmin: roles.includes("SUPERADMIN"), tienePermiso: permisos.includes("cliente.bloquear"), esJefeDco: (f[0]?.n ?? 0) > 0 });
    if (!ok) throw new ForbiddenException("Bloquear o desbloquear clientes es atribución del Jefe del Departamento Comercial.");
  }

  async bloquear(id: string, motivo: string, tenantId?: string, req?: any) {
    const c = await this.detalle(id, tenantId); // valida pertenencia al tenant
    await this.exigirJefeDco(req, c.tenantId);
    if (c.bloqueado) throw new BadRequestException(`El cliente ${c.razonSocial} ya está bloqueado.`);
    const mora = await this.morosidadDe(c.tenantId, [id]);
    const r = await this.prisma.cliente.update({ where: { id }, data: { bloqueado: true, motivoBloqueo: motivo } });
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO cliente_bloqueo (tenant_id, cliente_id, motivo, monto_pendiente, contador_no_pago, bloqueado_por, activo)
       VALUES ($1::uuid, $2::uuid, $3, $4::numeric, $5::int, $6::uuid, TRUE)`,
      c.tenantId,
      id,
      motivo,
      mora.get(id)?.montoVencido ?? 0,
      mora.get(id)?.facturasVencidas ?? 0,
      req?.user?.sub ?? null,
    ).catch(() => undefined);
    return r;
  }

  async desbloquear(id: string, motivo: string, tenantId?: string, req?: any) {
    const c = await this.detalle(id, tenantId); // valida pertenencia al tenant
    await this.exigirJefeDco(req, c.tenantId);
    if (!c.bloqueado) throw new BadRequestException(`El cliente ${c.razonSocial} no está bloqueado.`);
    const r = await this.prisma.cliente.update({ where: { id }, data: { bloqueado: false, motivoBloqueo: null } });
    await this.prisma.$executeRawUnsafe(
      `UPDATE cliente_bloqueo SET activo = FALSE, desbloqueado_at = now() WHERE cliente_id = $1::uuid AND activo`,
      id,
    ).catch(() => undefined);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO cliente_desbloqueo (tenant_id, cliente_id, motivo, autorizado_por) VALUES ($1::uuid, $2::uuid, $3, $4::uuid)`,
      c.tenantId,
      id,
      motivo,
      req?.user?.sub ?? null,
    ).catch(() => undefined);
    return r;
  }

  /** Bloqueos y desbloqueos del cliente, del más reciente al más antiguo. */
  async historialBloqueos(id: string, tenantId?: string) {
    await this.detalle(id, tenantId);
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT 'bloqueo' AS accion, b.bloqueado_at AS fecha, b.motivo, u.nombre_completo AS usuario, b.monto_pendiente AS "montoPendiente"
         FROM cliente_bloqueo b LEFT JOIN usuario u ON u.id = b.bloqueado_por WHERE b.cliente_id = $1::uuid
       UNION ALL
       SELECT 'desbloqueo', d.fecha, d.motivo, u.nombre_completo, NULL
         FROM cliente_desbloqueo d LEFT JOIN usuario u ON u.id = d.autorizado_por WHERE d.cliente_id = $1::uuid
       ORDER BY 2 DESC`,
      id,
    ).catch(() => []);
  }

  /** Facturas impagas vencidas por cliente (bloqueo-cliente.ts), con la gracia del parámetro cliente_moroso.dias_gracia. */
  private async morosidadDe(tenantId: string, clienteIds: string[] | null) {
    const gracia = entero((await valoresCategoria(this.prisma, tenantId, "cliente_moroso")).dias_gracia, 0, 0, 3650);
    const filas = await this.prisma.$queryRawUnsafe<{ cliente_id: string; fv: string | null; saldo: number; estado: string }[]>(
      `SELECT f.cliente_id::text AS cliente_id, to_char(f.fecha_vencimiento, 'YYYY-MM-DD') AS fv, COALESCE(f.saldo, f.total, 0)::float8 AS saldo, f.estado
         FROM factura f
        WHERE f.tenant_id = $1::uuid AND f.deleted_at IS NULL AND f.estado = ANY($2::text[])
          AND ($3::uuid[] IS NULL OR f.cliente_id = ANY($3::uuid[]))`,
      tenantId,
      [...ESTADOS_FACTURA_IMPAGA],
      clienteIds,
    );
    const hoy = hoyChile();
    const por = new Map<string, { fechaVencimiento: string | null; saldo: number; estado: string }[]>();
    for (const f of filas) {
      const l = por.get(f.cliente_id) ?? [];
      l.push({ fechaVencimiento: f.fv, saldo: Number(f.saldo), estado: f.estado });
      por.set(f.cliente_id, l);
    }
    return new Map([...por].map(([k, v]) => [k, evaluarMorosidad(v, hoy, gracia)]));
  }

  /** Clientes con facturas impagas vencidas (propuesta de bloqueo) y los ya bloqueados. */
  async morosos(tenantId?: string, todos = false) {
    const t = tenantId ?? DEV_TENANT;
    const mora = await this.morosidadDe(t, null);
    const conMora = [...mora].filter(([, m]) => m.sugiereBloqueo).map(([id]) => id);
    const clientes = await this.prisma.cliente.findMany({
      where: { tenantId: t, deletedAt: null, ...(todos ? {} : { OR: [{ bloqueado: true }, { id: { in: conMora } }] }) },
      select: { id: true, rut: true, razonSocial: true, tipo: true, bloqueado: true, motivoBloqueo: true },
      orderBy: { razonSocial: "asc" },
      take: 500,
    });
    return clientes
      .map((c) => ({ ...c, morosidad: mora.get(c.id) ?? { facturasVencidas: 0, montoVencido: 0, diasMoraMax: 0, sugiereBloqueo: false } }))
      .sort((a, b) => b.morosidad.montoVencido - a.morosidad.montoVencido);
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
