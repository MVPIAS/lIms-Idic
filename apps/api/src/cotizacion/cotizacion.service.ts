import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { fijarPlazoPorDefecto } from "../ot/plazo-defecto";
import { PrismaService } from "../common/prisma.service";
import { DEV_TENANT } from "../common/base-crud.service";
import { validarTransicion } from "../common/estados";
import { generarCodigoOt } from "../common/codigo";
import {
  calcularValidez,
  reglaDeTipoCliente,
  soloFecha,
  hoyEnChile,
  ZONA_IDIC,
  DIAS_PARTICULAR_DEF,
  MESES_EJERCITO_OCT_DIC_DEF,
  isoFecha,
  type ResultadoValidez,
  type ReglaValidez,
} from "./validez";
import { elegirPrecio, itemsListaVigente } from "../lista-precio/precio-lista";
import { calcularOpiPendiente, origenDesdeAceptacion, valorInicialOt } from "../ot/reglas-ot";
import { puedeRegistrarAceptacion } from "./permisos-cotizacion";
import { LaboratorioOtService } from "../ot/laboratorio-ot.service";
import { paginacion } from "../ot/lista-ot";
import { hoyCl, sumarDias } from "../ot/plazos";
import { Prisma } from "@prisma/client";
import { generarNumeroCotizacion } from "./numeracion-cotizacion";
import { motivoNoAceptable, motivoNoEditable } from "./circuito-cotizacion";
import { estadoCircuitoDe, leerConfigCircuito } from "./circuito-config";
import { claveLibre, precioDeLinea, type Existentes } from "./precio-ficha";
import { revisarOc } from "./aceptacion-oc";
import { heredarDeCotizacion } from "../ot/encargo/encargo.module";
import { entero, valoresCategoria } from "../common/parametros-r4d";
import { guardarAdjunto, leerAdjunto, listarAdjuntos, type ArchivoAdjunto } from "../common/adjuntos";
import { validarOportunidad, enlazarOportunidad, ganarOportunidadDeCotizacion, guardarDatosSolicitud, leerDatosSolicitud, type DatosSolicitud } from "./cotizacion-extra";

/** Cada cuánto el proceso periódico pasa a «Vencida» las cotizaciones fuera de validez. */
const INTERVALO_VENCIMIENTO_MS = Number(process.env.COTIZACION_VENCIMIENTO_MIN ?? 60) * 60_000;

/**
 * Estados del flujo comercial vigente; el resto es histórico de solo lectura.
 * 'expirada' («Vencida») es vigente: una Abierta fuera de validez pasa sola a ella.
 */
const ESTADOS_VIGENTES = ["abierta", "aceptada", "anulada", "expirada"] as const;

/** Días de aviso de «cotización por vencer» (igual que la tarjeta de Mi bandeja). */
const DIAS_POR_VENCER = 7;

/**
 * «Por vencer»: Abierta (o 'enviada' histórica) cuya validez termina entre hoy y
 * hoy + 7 días, con la fecha de Chile. Mismo criterio que la bandeja comercial.
 */
export function filtroPorVencer(ahora: Date = new Date()): Prisma.CotizacionWhereInput {
  const hoy = new Date(`${hoyCl(ahora)}T00:00:00Z`);
  const hasta = new Date(`${sumarDias(hoyCl(ahora), DIAS_POR_VENCER)}T00:00:00Z`);
  return {
    estado: { in: ["abierta", "enviada"] },
    OR: [{ validaHasta: { gte: hoy, lte: hasta } }, { validaHasta: null, expiraAt: { gte: hoy, lte: hasta } }],
  };
}

/** Estado inicial de toda cotización nueva (R1: Abierta / Aceptada / Anulada). */
export const ESTADO_ABIERTA = "abierta";

/** Grupo visible del combo de centros de costo (SVT2). */
export function grupoCentroCosto(tipo?: string | null): string {
  return tipo === "sucursal_bpch" || tipo === "delegacion_bpch" ? "Sucursales y Delegación BPCH" : "Laboratorios";
}

export interface LineaEntrada {
  tipo?: string;
  catEnsayoId?: string;
  ensayoCodigo?: string;
  descripcion?: string;
  categoria?: string;
  cantidad?: number;
  diasOHoras?: number;
  precioUnitario?: number;
  tramo?: string;
}

/** Campos de cabecera comunes a crear/editar (ya validados por zod en el controller). */
export interface CabeceraCotizacion {
  clienteId?: string;
  plantaId?: string;
  centroCostoId?: string | null;
  formato?: string;
  formaPago?: string | null;
  medioEnvio?: string | null;
  moneda?: "CLP" | "USD";
  dolarValor?: number | null;
  dolarFecha?: string | Date | null;
  dolarMotivo?: string | null;
  referencia?: string | null;
  descripcionTecnica?: string | null;
  condicionesAdicionales?: string | null;
  plazoEntregaDias?: number | null;
  observacionesInternas?: string | null;
  notas?: string | null;
  gastosAdminPct?: number;
  ivaPct?: number;
  descuentoPct?: number;
  validezDias?: number;
  fechaEmision?: string | Date;
  lineas?: LineaEntrada[];
  /** Solicitante y documento de solicitud (EP-01 0.1). */
  solicitud?: DatosSolicitud;
  /** Oportunidad del CRM desde la que se cotiza (EP-00 0.3). */
  oportunidadId?: string | null;
}

export interface AceptacionEntrada {
  /** Monto de la orden de compra, para compararlo con el total cotizado (EP-00 4.2). */
  montoOc?: number;
  /** Discrepancia registrada cuando la O/C difiere de la cotización. */
  discrepancia?: string;
  /** Adjunto ya subido (POST /cotizaciones/:id/adjuntos, clase «aceptacion»). */
  adjuntoId?: string;
  tipo?: string;
  numero?: string;
  fecha?: string | Date;
  adjunto?: string;
  conCobro?: boolean;
  /** Laboratorio responsable de la OT que se genera (si no se puede deducir, es obligatorio). */
  unidadPrincipalId?: string;
}

@Injectable()
export class CotizacionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CotizacionService.name);
  private temporizador?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly labs: LaboratorioOtService,
  ) {}

  // --------------------------------------------------------------------------
  // Vencimiento: Abierta (o 'enviada' histórica) fuera de validez → 'expirada'
  // (etiqueta «Vencida»). Lo hace el SISTEMA, no el usuario: por eso no pasa por
  // el mapa de transiciones de common/estados.ts (que no permite abierta →
  // expirada a mano). Se ejecuta al consultar (listar/detalle) y cada hora.
  // --------------------------------------------------------------------------

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || !(INTERVALO_VENCIMIENTO_MS > 0)) return;
    this.temporizador = setInterval(() => void this.vencerFueraDeValidez().catch(() => undefined), INTERVALO_VENCIMIENTO_MS);
    this.temporizador.unref?.();
    void this.vencerFueraDeValidez().catch(() => undefined);
  }

  onModuleDestroy() {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  /**
   * Pasa a 'expirada' las cotizaciones Abiertas/enviadas cuya validez
   * (valida_hasta, inclusive; o expira_at en las históricas) terminó según la
   * fecha de Chile. Deja traza en audit_log. Devuelve las cotizaciones vencidas.
   */
  async vencerFueraDeValidez(tenantId?: string | null, id?: string): Promise<{ id: string; codigo: string; tenant_id: string }[]> {
    let vencidas: { id: string; codigo: string; tenant_id: string }[] = [];
    try {
      vencidas = await this.prisma.$queryRawUnsafe(
        `UPDATE cotizacion c
            SET estado = 'expirada', vencida_at = now(), updated_at = now()
          WHERE c.estado IN ('abierta', 'enviada')
            AND COALESCE(c.valida_hasta, c.expira_at) < (now() AT TIME ZONE '${ZONA_IDIC}')::date
            AND ($1::uuid IS NULL OR c.tenant_id = $1::uuid)
            AND ($2::uuid IS NULL OR c.id = $2::uuid)
        RETURNING c.id, c.codigo, c.tenant_id`,
        tenantId ?? null,
        id ?? null,
      );
    } catch (e: any) {
      // BD sin align_comercial_usuarios.sql (falta vencida_at): no se cae la consulta.
      this.log.warn(`vencimiento de cotizaciones omitido: ${e?.message?.split("\n")[0]}`);
      return [];
    }
    if (vencidas.length) {
      this.log.log(`${vencidas.length} cotización(es) pasaron a Vencida: ${vencidas.map((v) => v.codigo).join(", ")}`);
      try {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO audit_log (tenant_id, username, accion, entidad_tipo, entidad_id, entidad_codigo, motivo, metadata)
           SELECT x.tenant_id, 'sistema', 'vencer', 'cotizaciones', x.id, x.codigo,
                  'Fuera de validez (IT DCO-PG01-P01-IT02)', jsonb_build_object('estado', 'expirada')
             FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, codigo text, tenant_id uuid)`,
          JSON.stringify(vencidas),
        );
      } catch (e: any) {
        this.log.warn(`no se pudo registrar el vencimiento en audit_log: ${e?.message?.split("\n")[0]}`);
      }
    }
    return vencidas;
  }

  /**
   * Lista paginada con búsqueda y filtros en el servidor (antes: las 50 más
   * recientes, filtradas en el navegador). Devuelve `{ data, meta, conteos }`;
   * `conteos` = nº por estado con la búsqueda aplicada (para los chips).
   *   q        · N° de cotización, cliente (razón social) o referencia
   *   estado   · estado exacto (también `expirada` = Vencida), o `historico` (borrador/enviada/rechazada)
   *   sinOt    · 1 = aceptadas a las que aún no se les generó OT
   *   porVencer· 1 = abiertas que vencen en los próximos 7 días (fecha de Chile)
   */
  async listar(tenantId?: string, f: { q?: string; search?: string; estado?: string; sinOt?: string; porVencer?: string; firma?: string; enviada?: string; page?: string; limit?: string } = {}) {
    await this.vencerFueraDeValidez(tenantId ?? null);
    const { page, limit, skip } = paginacion(f.page, f.limit);
    const base: Prisma.CotizacionWhereInput = tenantId ? { tenantId } : {};
    const and: Prisma.CotizacionWhereInput[] = [base];
    const texto = (f.q ?? f.search ?? "").trim();
    if (texto) {
      const c = { contains: texto, mode: "insensitive" as const };
      and.push({ OR: [{ codigo: c }, { referencia: c }, { cliente: { razonSocial: c } }] });
    }
    const conBusqueda: Prisma.CotizacionWhereInput = { AND: [...and] };

    if (f.estado === "historico") and.push({ estado: { notIn: [...ESTADOS_VIGENTES] } });
    else if (f.estado) and.push({ estado: f.estado });
    if (f.sinOt === "1") {
      const conOt = await this.prisma.ordenTrabajo.findMany({
        where: { cotizacionId: { not: null }, ...(tenantId ? { tenantId } : {}) },
        select: { cotizacionId: true },
      });
      and.push({ estado: "aceptada", id: { notIn: conOt.map((o) => o.cotizacionId as string) } });
    }
    if (f.porVencer === "1") and.push(filtroPorVencer());
    // Circuito de firma y envío (columnas fuera del modelo Prisma): ?firma=pendiente|firmada|devuelta|sin_firma, ?enviada=0|1.
    if (f.firma || f.enviada) {
      const ids: { id: string }[] = await this.prisma.$queryRawUnsafe(
        `SELECT id FROM cotizacion
          WHERE ($1::uuid IS NULL OR tenant_id = $1::uuid)
            AND ($2::text IS NULL OR ($2 = 'sin_firma' AND firma_estado IS NULL AND circuito = 'r1') OR firma_estado = $2)
            AND ($3::text IS NULL OR ($3 = '1') = (enviada_at IS NOT NULL))`,
        tenantId ?? null,
        f.firma && ["pendiente", "firmada", "devuelta", "sin_firma"].includes(f.firma) ? f.firma : null,
        f.enviada === "1" || f.enviada === "0" ? f.enviada : null,
      );
      and.push({ id: { in: ids.map((x) => x.id) } });
    }
    const where: Prisma.CotizacionWhereInput = { AND: and };

    const [cots, total, porEstado, nPorVencer] = await Promise.all([
      this.prisma.cotizacion.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { cliente: true, lineas: true },
      }),
      this.prisma.cotizacion.count({ where }),
      this.prisma.cotizacion.groupBy({ by: ["estado"], where: conBusqueda, _count: { _all: true } }),
      this.prisma.cotizacion.count({ where: { AND: [conBusqueda, filtroPorVencer()] } }),
    ]);
    // OT generada por cada cotización (sin relación Prisma): una sola consulta.
    const ids = cots.map((c) => c.id);
    const ots = ids.length
      ? await this.prisma.ordenTrabajo.findMany({
          where: { cotizacionId: { in: ids }, ...(tenantId ? { tenantId } : {}) },
          select: {
            id: true, codigo: true, cotizacionId: true, opiPendiente: true, conCobro: true, origenTrabajo: true,
            unidad: { select: { id: true, codigo: true, nombre: true } },
          },
        })
      : [];
    const porCot = new Map(ots.map((o) => [o.cotizacionId, o]));
    const circuito = await estadoCircuitoDe(this.prisma, ids);
    const conteos: Record<string, number> = {};
    for (const g of porEstado) conteos[g.estado] = g._count._all;
    // No es un estado: el chip «Por vencer (7 días)» de la lista.
    conteos.porVencer = nPorVencer;
    return {
      data: cots.map((c) => ({ ...c, ...(circuito.get(c.id) ?? {}), ot: porCot.get(c.id) ?? null })),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      conteos,
    };
  }

  async detalle(id: string, tenantId?: string) {
    await this.vencerFueraDeValidez(tenantId ?? null, id);
    const cot = await this.prisma.cotizacion.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: {
        cliente: true,
        lineas: { orderBy: { orden: "asc" } },
        ejecutivo: { select: { id: true, nombreCompleto: true, username: true } },
      },
    });
    if (!cot) throw new NotFoundException();
    // OT generada (si la hay): la cotización no tiene relación Prisma hacia la OT.
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { cotizacionId: id, tenantId: cot.tenantId },
      select: { id: true, codigo: true, estado: true, opiPendiente: true, conCobro: true, origenTrabajo: true },
    });
    const circuito = (await estadoCircuitoDe(this.prisma, [id])).get(id);
    const solicitud = await leerDatosSolicitud(this.prisma, id).catch(() => null);
    const adjuntos = await listarAdjuntos(this.prisma, cot.tenantId, "cotizacion", [id]).catch(() => []);
    return { ...cot, ...(circuito ?? {}), ot, solicitud, adjuntos };
  }

  // --------------------------------------------------------------------------
  // Configuración del formulario (combos + centros de costo agrupados)
  // --------------------------------------------------------------------------

  /** Valores de un combo de parámetros de negocio (solo activos por defecto). */
  private async parametros(tenantId: string, categoria: string, soloActivos = true) {
    return this.prisma.parametroSistema.findMany({
      where: { tenantId, categoria, ...(soloActivos ? { activo: true } : {}) },
      orderBy: { orden: "asc" },
      select: { codigo: true, etiqueta: true, valor: true, activo: true },
    });
  }

  private async numeroParametro(tenantId: string, codigo: string, def: number): Promise<number> {
    const p = await this.prisma.parametroSistema.findFirst({
      where: { tenantId, categoria: "validez_cotizacion", codigo, activo: true },
      select: { valor: true },
    });
    const n = Number(p?.valor);
    return Number.isFinite(n) && n > 0 ? n : def;
  }

  async config(tenantId?: string) {
    const t = tenantId ?? DEV_TENANT;
    const cats = ["tipo_cliente", "forma_pago", "formato_cotizacion", "moneda", "medio_envio", "aceptacion_tipo", "estado_cotizacion", "origen_trabajo"];
    const parametros: Record<string, any[]> = {};
    for (const c of cats) parametros[c] = await this.parametros(t, c, c !== "estado_cotizacion");

    const centros = await this.prisma.centroCosto.findMany({
      where: { tenantId: t, activo: true, deletedAt: null },
      orderBy: [{ tipo: "asc" }, { codigo: "asc" }],
    });
    return {
      parametros,
      // EP-05 0.2: unidades de reposición que se suman al lote del LRB (parámetro cotizacion_lrb.reposicion).
      reposicionLrb: entero((await valoresCategoria(this.prisma, t, "cotizacion_lrb")).reposicion, 4, 0, 50),
      centrosCosto: centros.map((c) => ({
        id: c.id,
        codigo: c.codigo,
        nombre: c.nombre,
        tipo: c.tipo ?? "laboratorio",
        grupo: grupoCentroCosto(c.tipo),
        laboratorio: c.laboratorio,
        condicionesBase: c.condicionesBase,
        validezParticularDias: c.validezParticularDias,
      })),
      validez: {
        particularDias: await this.numeroParametro(t, "particular_dias", DIAS_PARTICULAR_DEF),
        ejercitoMesesOctDic: await this.numeroParametro(t, "ejercito_meses_oct_dic", MESES_EJERCITO_OCT_DIC_DEF),
      },
      condicionesMax: 2000,
      // Circuito de la cotización (V°B°, firma): la UI decide qué botones ofrece.
      circuito: await leerConfigCircuito(this.prisma, t),
    };
  }

  /**
   * Validez automática (IT DCO-PG01-P01-IT02) para un cliente y centro de costo.
   * Lee la regla del tipo de cliente (parametro_sistema.valor) y la validez
   * propia del laboratorio (centro_costo.validez_particular_dias).
   */
  async calcularValidezPara(
    tenantId: string,
    clienteId: string,
    centroCostoId?: string | null,
    fechaEmision?: string | Date,
  ): Promise<ResultadoValidez & { tipoClienteCodigo: string | null }> {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, tenantId },
      select: { tipo: true },
    });
    if (!cliente) throw new BadRequestException("clienteId no existe o no pertenece al tenant");
    const tipo = cliente.tipo ?? null;
    const param = tipo
      ? await this.prisma.parametroSistema.findFirst({
          where: { tenantId, categoria: "tipo_cliente", codigo: tipo },
          select: { valor: true },
        })
      : null;
    let diasLab: number | null = null;
    if (centroCostoId) {
      const cc = await this.prisma.centroCosto.findFirst({
        where: { id: centroCostoId, tenantId },
        select: { validezParticularDias: true },
      });
      if (!cc) throw new BadRequestException("centroCostoId no existe o no pertenece al tenant");
      diasLab = cc.validezParticularDias ?? null;
    }
    const r = calcularValidez({
      fechaEmision: fechaEmision ?? new Date(),
      regla: reglaDeTipoCliente(tipo, param?.valor),
      diasParticular: await this.numeroParametro(tenantId, "particular_dias", DIAS_PARTICULAR_DEF),
      diasParticularLab: diasLab,
      mesesEjercitoOctDic: await this.numeroParametro(tenantId, "ejercito_meses_oct_dic", MESES_EJERCITO_OCT_DIC_DEF),
    });
    return { ...r, tipoClienteCodigo: tipo };
  }

  // --------------------------------------------------------------------------
  // Líneas: ensayo del catálogo (código EN) valorizado por su ficha
  // --------------------------------------------------------------------------

  /**
   * Resuelve las líneas: las que traen `catEnsayoId` toman código, descripción y
   * PRECIO: el de la lista de precios vigente a la fecha de emisión si el ensayo
   * está en ella (neto para un particular; para el Ejército según el parámetro
   * `precio_ejercito`) y, si no, la ficha (cat_ensayo.precio). En USD se
   * convierte con el dólar congelado de la cotización. Las líneas libres
   * (HH/HM/viático…) se siguen aceptando por compatibilidad.
   */
  private async resolverLineas(
    tenantId: string,
    lineas: LineaEntrada[],
    moneda: string,
    dolar: number | null,
    existentes: Existentes | undefined,
    ctx: { regla: ReglaValidez; fecha: string },
  ) {
    const ids = lineas.map((l) => l.catEnsayoId).filter((x): x is string => Boolean(x));
    const ensayos = ids.length
      ? await this.prisma.catEnsayo.findMany({
          where: { id: { in: ids }, tenantId, deletedAt: null },
          select: { id: true, codigo: true, nombre: true, precio: true },
        })
      : [];
    const porId = new Map(ensayos.map((e) => [e.id, e]));
    const lista = await itemsListaVigente(this.prisma, tenantId, [...porId.keys()], ctx.fecha);
    const cfg = ids.length ? await leerConfigCircuito(this.prisma, tenantId) : null;

    return lineas.map((l, i) => {
      let descripcion = l.descripcion;
      let ensayoCodigo = l.ensayoCodigo;
      let precioFicha: number | null = null;
      let fuente: string | undefined;
      if (l.catEnsayoId) {
        const e = porId.get(l.catEnsayoId);
        if (!e) throw new BadRequestException(`Línea ${i + 1}: el ensayo ${l.catEnsayoId} no existe en el catálogo.`);
        ensayoCodigo = e.codigo;
        descripcion = descripcion || `${e.codigo} · ${e.nombre}`;
        const elegido = elegirPrecio(lista.get(e.id), e.precio != null ? Number(e.precio) : null, ctx.regla, cfg!.precioEjercito);
        const clp = elegido?.precio ?? null;
        if (elegido?.origen === "lista") fuente = `la lista de precios vigente (${elegido.lista!.nombre}, ${elegido.lista!.itemCodigo})`;
        precioFicha = clp != null && clp > 0 ? (moneda === "USD" ? Math.round((clp / (dolar || 1)) * 100) / 100 : clp) : null;
      }
      // EP-00 2.2 (BL-149): el ensayo se valoriza con la lista vigente o su ficha; sin ensayo, solo gastos tipificados.
      const r = precioDeLinea({ ...l, ensayoCodigo, descripcion }, precioFicha, i + 1, existentes, fuente);
      if (r.error !== undefined) throw new BadRequestException(r.error);
      const precio = r.precio;
      const cantidad = l.cantidad ?? 1;
      return {
        tipo: l.catEnsayoId ? "producto" : l.tipo ?? "producto",
        descripcion: descripcion ?? null,
        categoria: l.categoria ?? null,
        cantidad,
        diasOHoras: l.diasOHoras ?? null,
        precioUnitario: Number(precio),
        descuentoPct: 0,
        subtotal: cantidad * Number(precio),
        tramo: l.tramo ?? null,
        orden: i + 1,
        catEnsayoId: l.catEnsayoId ?? null,
        ensayoCodigo: ensayoCodigo ?? null,
      };
    });
  }

  /**
   * Precio de cada ensayo para un cliente (vista previa del formulario de la
   * cotización; misma regla que al guardar). GET /cotizaciones/precios-ensayo.
   */
  async preciosEnsayo(tenantId: string, clienteId: string, catEnsayoIds: string[], fecha?: string) {
    const fechaEmision = isoFecha(soloFecha(fecha ?? hoyEnChile()));
    const validez = await this.calcularValidezPara(tenantId, clienteId, null, fechaEmision);
    const ensayos = catEnsayoIds.length
      ? await this.prisma.catEnsayo.findMany({ where: { id: { in: catEnsayoIds }, tenantId, deletedAt: null }, select: { id: true, codigo: true, precio: true } })
      : [];
    const lista = await itemsListaVigente(this.prisma, tenantId, ensayos.map((e) => e.id), fechaEmision);
    const cfg = await leerConfigCircuito(this.prisma, tenantId);
    return {
      regla: validez.regla,
      fecha: fechaEmision,
      precioEjercito: cfg.precioEjercito,
      precios: Object.fromEntries(
        ensayos.map((e) => {
          const p = elegirPrecio(lista.get(e.id), e.precio != null ? Number(e.precio) : null, validez.regla, cfg.precioEjercito);
          return [e.id, p ? { precio: p.precio, origen: p.origen, columna: p.columna ?? null, lista: p.lista ?? null } : { precio: null, origen: null, columna: null, lista: null }];
        }),
      ),
    };
  }

  /**
   * Totales (réplica de SIS_COMERCIAL, ADM/imprimir.php:300-338, IVA EXENTO):
   *   total = SUMA(líneas) [+ gastos admin si se piden] [+ IVA si se pide].
   * R1: la cotización ya NO tiene descuento (descuento = 0 siempre).
   */
  private totales(lineas: { subtotal: number }[], gastosAdminPct = 0, ivaPct = 0) {
    const subtotal = lineas.reduce((a, l) => a + l.subtotal, 0);
    const gastosAdminMonto = subtotal * (gastosAdminPct / 100);
    const neto = subtotal + gastosAdminMonto;
    const ivaMonto = neto * (ivaPct / 100);
    return {
      subtotal,
      descuentoPct: 0,
      descuentoMonto: 0,
      gastosAdminPct,
      gastosAdminMonto,
      neto,
      ivaPct,
      ivaMonto,
      total: neto + ivaMonto,
    };
  }

  private validarCondiciones(texto?: string | null) {
    if (texto && texto.length > 2000)
      throw new BadRequestException(`Condiciones adicionales: máximo 2000 caracteres (tiene ${texto.length}).`);
  }

  /**
   * Crea la cotización en estado **Abierta** con sus líneas, totales y la
   * validez automática calculada (y congelada) a la fecha de emisión.
   */
  async crear(data: CabeceraCotizacion & { clienteId: string; lineas: LineaEntrada[] }, tenantId?: string, usuarioId?: string) {
    const tenantIdFromJWT = tenantId ?? DEV_TENANT;
    this.validarCondiciones(data.condicionesAdicionales);
    const moneda = data.moneda ?? "CLP";
    const dolar = moneda === "USD" ? Number(data.dolarValor) : null;
    if (moneda === "USD" && !(dolar && dolar > 0))
      throw new BadRequestException("Cotización en USD: indique el valor del dólar del día (dolarValor).");

    // «Hoy» es el de Chile (con new Date() a las 21:00 ya era mañana en UTC: D02-18).
    const fechaEmision = soloFecha(data.fechaEmision ?? hoyEnChile());
    const validez = await this.calcularValidezPara(tenantIdFromJWT, data.clienteId, data.centroCostoId, fechaEmision);
    if (data.oportunidadId) await validarOportunidad(this.prisma, tenantIdFromJWT, data.clienteId, data.oportunidadId);
    const lineas = await this.resolverLineas(tenantIdFromJWT, data.lineas, moneda, dolar, undefined, { regla: validez.regla, fecha: isoFecha(fechaEmision) });
    const tot = this.totales(lineas, Number(data.gastosAdminPct ?? 0), Number(data.ivaPct ?? 0));
    // Número real (EP-00 2.1 · «2026-14324»), correlativo atómico por tenant.
    const codigo = await generarNumeroCotizacion(this.prisma, tenantIdFromJWT, fechaEmision);
    // Ejecutivo = usuario autenticado, solo si existe (FK a usuario).
    const ejecutivo = usuarioId
      ? await this.prisma.usuario.findFirst({ where: { id: usuarioId }, select: { id: true } })
      : null;

    const creada = await this.prisma.cotizacion.create({
      data: {
        tenantId: tenantIdFromJWT,
        codigo,
        clienteId: data.clienteId,
        plantaId: data.plantaId,
        centroCostoId: data.centroCostoId ?? null,
        formato: data.formato,
        formaPago: data.formaPago ?? null,
        medioEnvio: data.medioEnvio ?? null,
        moneda,
        dolarValor: dolar,
        dolarFecha: moneda === "USD" ? soloFecha(data.dolarFecha ?? fechaEmision) : null,
        referencia: data.referencia ?? null,
        descripcionTecnica: data.descripcionTecnica ?? null,
        condicionesAdicionales: data.condicionesAdicionales ?? null,
        plazoEntregaDias: data.plazoEntregaDias ?? null,
        observacionesInternas: data.observacionesInternas ?? null,
        notas: data.notas ?? null,
        fechaEmision,
        validaHasta: soloFecha(validez.validaHasta),
        expiraAt: soloFecha(validez.validaHasta),
        validezDias: validez.dias,
        tipoClienteCodigo: validez.tipoClienteCodigo,
        ejecutivoId: ejecutivo?.id ?? null,
        ...tot,
        estado: ESTADO_ABIERTA,
        lineas: { create: lineas },
      },
      include: { lineas: true, cliente: true },
    });
    if (data.solicitud) await guardarDatosSolicitud(this.prisma, creada.id, data.solicitud);
    if (data.oportunidadId) await enlazarOportunidad(this.prisma, tenantIdFromJWT, creada.id, data.clienteId, data.oportunidadId);
    return creada;
  }

  /**
   * Editar una cotización. El CONTENIDO solo se edita mientras está **Abierta**
   * (las aceptadas, anuladas y las históricas son de solo lectura).
   * `estado` se admite por compatibilidad, validado como transición; la
   * aceptación y la anulación tienen sus propios endpoints con datos obligatorios.
   */
  async actualizar(id: string, data: CabeceraCotizacion & { estado?: string }, tenantId?: string) {
    const actual = await this.detalle(id, tenantId); // existencia + tenant
    const { estado, ...resto } = data;
    const { solicitud, oportunidadId: _o, ...restoCab } = resto;
    const tocaContenido = Object.values(restoCab).some((v) => v !== undefined);

    if (estado !== undefined) {
      if (estado === "aceptada") throw new BadRequestException("Use POST /cotizaciones/:id/aceptar (exige documento de aceptación).");
      if (estado === "anulada") throw new BadRequestException("Use POST /cotizaciones/:id/anular (exige motivo).");
      validarTransicion("cotizacion", actual.estado, estado);
    }
    if (solicitud) {
      if (actual.estado !== ESTADO_ABIERTA) throw new ConflictException("Solo se corrigen los datos de la solicitud de una cotización Abierta.");
      await guardarDatosSolicitud(this.prisma, id, solicitud);
    }
    if (!tocaContenido) {
      return this.prisma.cotizacion.update({ where: { id }, data: { ...(estado ? { estado } : {}) } });
    }
    const noEditable = motivoNoEditable((actual as any).firmaEstado ?? null);
    if (noEditable && actual.estado === ESTADO_ABIERTA) throw new ConflictException(noEditable);
    if (actual.estado !== ESTADO_ABIERTA) {
      throw new ConflictException(
        `Solo se puede editar una cotización Abierta (esta está '${actual.estado}'${["borrador", "enviada", "rechazada", "expirada"].includes(actual.estado) ? ", histórica de solo lectura" : ""}).`,
      );
    }
    this.validarCondiciones(resto.condicionesAdicionales);

    const moneda = resto.moneda ?? (actual.moneda as "CLP" | "USD");
    const dolarActual = actual.dolarValor !== null && actual.dolarValor !== undefined ? Number(actual.dolarValor) : null;
    let dolar = moneda === "USD" ? (resto.dolarValor !== undefined && resto.dolarValor !== null ? Number(resto.dolarValor) : dolarActual) : null;
    if (moneda === "USD" && !(dolar && dolar > 0))
      throw new BadRequestException("Cotización en USD: indique el valor del dólar del día (dolarValor).");
    // El dólar queda CONGELADO al emitir: cambiarlo después exige motivo.
    const cambiaDolar = moneda === "USD" && dolarActual !== null && dolar !== dolarActual;
    if (cambiaDolar && !resto.dolarMotivo?.trim())
      throw new BadRequestException("El valor del dólar quedó congelado al emitir: indique el motivo del cambio (dolarMotivo).");
    if (moneda === "CLP") dolar = null;

    const centroCostoId = resto.centroCostoId !== undefined ? resto.centroCostoId : actual.centroCostoId;
    const validez = await this.calcularValidezPara(actual.tenantId, actual.clienteId, centroCostoId, actual.fechaEmision);

    const upd: Record<string, any> = {
      centroCostoId,
      formato: resto.formato ?? undefined,
      formaPago: resto.formaPago !== undefined ? resto.formaPago : undefined,
      medioEnvio: resto.medioEnvio !== undefined ? resto.medioEnvio : undefined,
      referencia: resto.referencia !== undefined ? resto.referencia : undefined,
      descripcionTecnica: resto.descripcionTecnica !== undefined ? resto.descripcionTecnica : undefined,
      condicionesAdicionales: resto.condicionesAdicionales !== undefined ? resto.condicionesAdicionales : undefined,
      plazoEntregaDias: resto.plazoEntregaDias !== undefined ? resto.plazoEntregaDias : undefined,
      observacionesInternas: resto.observacionesInternas !== undefined ? resto.observacionesInternas : undefined,
      notas: resto.notas !== undefined ? resto.notas : undefined,
      moneda,
      dolarValor: dolar,
      dolarFecha: moneda === "USD" ? (resto.dolarFecha ? soloFecha(resto.dolarFecha) : actual.dolarFecha ?? actual.fechaEmision) : null,
      ...(cambiaDolar ? { dolarMotivo: resto.dolarMotivo } : {}),
      validaHasta: soloFecha(validez.validaHasta),
      expiraAt: soloFecha(validez.validaHasta),
      validezDias: validez.dias,
      ...(estado ? { estado } : {}),
      updatedAt: new Date(),
    };

    if (resto.lineas) {
      if (!resto.lineas.length) throw new BadRequestException("La cotización debe tener al menos una línea.");
      // Las líneas ya cotizadas conservan su precio aunque la ficha cambie (precio-ficha.ts).
      const existentes: Existentes = {
        ensayos: new Map(actual.lineas.filter((x: any) => x.catEnsayoId).map((x: any) => [x.catEnsayoId, Number(x.precioUnitario)])),
        libres: new Set(actual.lineas.filter((x: any) => !x.catEnsayoId).map((x: any) => claveLibre(x.tipo, x.descripcion, Number(x.precioUnitario)))),
      };
      const lineas = await this.resolverLineas(actual.tenantId, resto.lineas, moneda, dolar, existentes, { regla: validez.regla, fecha: isoFecha(soloFecha(actual.fechaEmision ?? hoyEnChile())) });
      const tot = this.totales(lineas, Number(resto.gastosAdminPct ?? actual.gastosAdminPct ?? 0), Number(resto.ivaPct ?? actual.ivaPct ?? 0));
      return this.prisma.$transaction(async (tx) => {
        await tx.lineaCotizacion.deleteMany({ where: { cotizacionId: id } });
        return tx.cotizacion.update({
          where: { id },
          data: { ...upd, ...tot, lineas: { create: lineas } },
          include: { lineas: true, cliente: true },
        });
      });
    }
    return this.prisma.cotizacion.update({ where: { id }, data: upd, include: { lineas: true, cliente: true } });
  }

  /**
   * Anular (R1): Abierta → Anulada con motivo. Se conserva `DELETE /:id` como
   * alias (sin motivo) por compatibilidad. No hay borrado físico.
   */
  async anular(id: string, tenantId?: string, motivo?: string) {
    const actual = await this.detalle(id, tenantId);
    validarTransicion("cotizacion", actual.estado, "anulada");
    if (actual.ot)
      throw new ConflictException(`La cotización ya generó la OT ${actual.ot.codigo}: anule primero la OT.`);
    return this.prisma.cotizacion.update({
      where: { id },
      data: {
        estado: "anulada",
        anulacionMotivo: motivo ?? null,
        anuladaAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  async cambiarEstado(id: string, nuevoEstado: string, tenantId?: string) {
    const actual = await this.detalle(id, tenantId); // valida pertenencia al tenant
    validarTransicion("cotizacion", actual.estado, nuevoEstado);
    return this.prisma.cotizacion.update({
      where: { id },
      data: { estado: nuevoEstado },
    });
  }

  /**
   * Registrar la aceptación (RF-B04.1 · flujo F03 · SVT6). En UNA transacción:
   *   1. Valida la transición → 'aceptada' y el documento de aceptación.
   *   2. Marca la cotización aceptada con su documento (tipo/número/fecha/adjunto)
   *      y si lleva cobro.
   *   3. CREA la OT asociada (idempotente: si ya existe, se devuelve la misma).
   *      Hereda cliente/planta/tenant/centro de costo, `origen_trabajo`
   *      (COTIZACION, o DISPOSICION si se aceptó por disposición del Director),
   *      `con_cobro` y `opi_pendiente` (SVT7).
   *   4. Fija el LABORATORIO RESPONSABLE de la OT (unidad_principal): el
   *      indicado en `unidadPrincipalId` o el deducido del centro de costo y de
   *      los ensayos de la cotización. Si no se puede deducir, 400 pidiendo
   *      elegirlo (sin él ningún laboratorio vería la OT).
   *
   * Compatibilidad: una cotización HISTÓRICA en estado 'enviada' se puede
   * aceptar sin documento (comportamiento previo). Una 'abierta' exige `tipo`.
   */
  async aceptar(id: string, tenantId?: string, doc: AceptacionEntrada = {}, usuarioId?: string) {
    const cot = await this.detalle(id, tenantId); // si venció, detalle ya la pasó a 'expirada'
    const vigencia = puedeRegistrarAceptacion(cot, hoyEnChile());
    if (!vigencia.ok) throw new ConflictException(vigencia.mensaje);
    validarTransicion("cotizacion", cot.estado, "aceptada");
    // Circuito R1: la aceptación exige la cotización firmada por el Jefe DCO (configurable).
    const noAceptable = motivoNoAceptable(
      { codigo: cot.codigo, estado: cot.estado, circuito: (cot as any).circuito ?? null, firmaEstado: (cot as any).firmaEstado ?? null, lineas: cot.lineas.length },
      await leerConfigCircuito(this.prisma, cot.tenantId),
    );
    if (noAceptable) throw new ConflictException(noAceptable);
    if (cot.estado === ESTADO_ABIERTA && !doc.tipo)
      throw new BadRequestException("Indique el documento de aceptación (tipo: OPI_RESOLUCION, OC, CORREO, PAGO_ADELANTADO o DISPOSICION_DIRECTOR).");
    if ((doc.tipo === "OPI_RESOLUCION" || doc.tipo === "OC") && !doc.numero?.trim())
      throw new BadRequestException(`El documento ${doc.tipo === "OC" ? "Orden de compra" : "OPI / Resolución"} requiere número.`);

    // EP-00 4.2 (BL-150): la O/C se compara con el total cotizado; si difiere hay que registrar la discrepancia.
    const tolerancia = entero((await valoresCategoria(this.prisma, cot.tenantId, "aceptacion_oc")).tolerancia, 0);
    const oc = revisarOc({ tipo: doc.tipo, montoOc: doc.montoOc, totalCotizado: Number(cot.total ?? 0), tolerancia, discrepancia: doc.discrepancia });
    if (oc.error) throw new ConflictException(oc.error);
    // EP-00 4.1 (BL-209): el documento de aceptación es un archivo adjunto de la cotización.
    let adjuntoNombre: string | null = null;
    if (doc.adjuntoId) {
      const a = await this.prisma.$queryRawUnsafe<{ nombre: string }[]>(
        `SELECT nombre FROM registro_adjunto WHERE id = $1::uuid AND entidad = 'cotizacion' AND entidad_id = $2::uuid AND clase = 'aceptacion' AND deleted_at IS NULL`,
        doc.adjuntoId,
        id,
      );
      if (!a[0]) throw new BadRequestException("El adjunto indicado no es un documento de aceptación de esta cotización.");
      adjuntoNombre = a[0].nombre;
    }

    const conCobro = doc.conCobro ?? true;
    const tenantIdOt = cot.tenantId ?? tenantId ?? DEV_TENANT;
    const fechaDoc = doc.tipo ? soloFecha(doc.fecha ?? new Date()) : null;
    const origen = origenDesdeAceptacion(doc.tipo);
    const opiNumero = doc.tipo === "OPI_RESOLUCION" ? doc.numero?.trim() ?? null : null;
    const opiPendiente = calcularOpiPendiente({ origen, aceptacionTipo: doc.tipo, conCobro, opiNumero });

    // Laboratorio responsable: se resuelve ANTES de tocar nada (si falta, no se
    // acepta a medias). Una OT ya generada (reintento) conserva el suyo.
    const otPrevia = await this.prisma.ordenTrabajo.findFirst({
      where: { cotizacionId: id, tenantId: tenantIdOt },
      select: { id: true, unidadPrincipal: true },
    });
    const unidad =
      otPrevia?.unidadPrincipal && !doc.unidadPrincipalId
        ? null
        : await this.labs.resolverParaAlta(tenantIdOt, doc.unidadPrincipalId, { cotizacionId: id });

    // Valor inicial de la OT (EP-00 4.2: VALORINICIAL = total de la cotización) y
    // horas hombre de las respuestas de costeo del laboratorio (recorrido MP-02, D02-09).
    const costeos = await this.prisma.$queryRawUnsafe<{ horas: number | null; costo: number | null }[]>(
      `SELECT horas_hombre::float8 AS horas, costo_directo::float8 AS costo FROM solicitud_costeo
        WHERE cotizacion_id = $1::uuid AND deleted_at IS NULL AND respondida_at IS NOT NULL`,
      id,
    ).catch(() => []);
    const inicial = valorInicialOt(Number(cot.total ?? 0), costeos);

    const { cotizacion, ot } = await this.prisma.$transaction(async (tx) => {
      const existente = await tx.ordenTrabajo.findFirst({
        where: { cotizacionId: id, tenantId: tenantIdOt },
        include: { cliente: true },
      });

      const cotizacion = await tx.cotizacion.update({
        where: { id },
        data: {
          estado: "aceptada",
          ...(doc.tipo
            ? {
                aceptacionTipo: doc.tipo,
                aceptacionNumero: doc.numero?.trim() || null,
                aceptacionFecha: fechaDoc,
                aceptacionAdjunto: adjuntoNombre ?? (doc.adjunto?.trim() || null),
              }
            : {}),
          conCobro,
          aceptadaAt: new Date(),
          aceptadaPor: usuarioId ?? null,
          updatedAt: new Date(),
        },
        include: { cliente: true, lineas: true },
      });

      if (existente) {
        // OT de un intento anterior sin laboratorio: se completa ahora.
        if (!existente.unidadPrincipal && unidad)
          await this.labs.fijar(tx, { tenantId: tenantIdOt, otId: existente.id, unidad, usuarioId, origen: "aceptacion_cotizacion" });
        return { cotizacion, ot: existente };
      }

      const ot = await tx.ordenTrabajo.create({
        data: {
          tenantId: tenantIdOt,
          codigo: await generarCodigoOt(tx, tenantIdOt),
          clienteId: cot.clienteId,
          plantaId: cot.plantaId ?? null,
          cotizacionId: cot.id,
          cotizacionNumero: cot.codigo,
          centroCostoId: cot.centroCostoId ?? null,
          prioridad: "normal",
          estado: "recepcionada", // estado inicial real (default del modelo)
          fechaRecepcion: new Date(),
          origenTrabajo: origen,
          conCobro,
          opiPendiente,
          costoEstimado: inicial.costoEstimado,
          horasHombre: inicial.horasHombre,
          ...(doc.tipo === "OC" ? { ocNumero: doc.numero?.trim() ?? null } : {}),
          ...(opiNumero ? { opiNumero, opiFecha: fechaDoc, opiRegistradaAt: new Date() } : {}),
          ...(doc.tipo === "DISPOSICION_DIRECTOR"
            ? { disposicionRef: doc.numero?.trim() || "Disposición del Director", disposicionFecha: fechaDoc }
            : {}),
          notas: `Generada automáticamente al aceptar la cotización ${cot.codigo}.`,
        },
        include: { cliente: true },
      });
      if (unidad)
        await this.labs.fijar(tx, {
          tenantId: tenantIdOt,
          otId: ot.id,
          unidad,
          usuarioId,
          origen: doc.unidadPrincipalId ? "aceptacion_indicado" : "aceptacion_deducido",
        });
      // B-010 (frente c1): sin plazo en la cotización, el plazo por defecto de la OT.
      await fijarPlazoPorDefecto(tx, tenantIdOt, ot.id);

      return { cotizacion, ot };
    });
    // EP-00 5.1 (BL-159): la OT hereda moneda, forma de pago, referencia, descripción técnica, valor y paridad.
    await heredarDeCotizacion(this.prisma, tenantIdOt, ot.id, id);
    if (oc.aplica)
      await this.hito(cot.tenantId, id, oc.hayDiscrepancia ? "discrepancia_oc" : "oc_conforme", usuarioId, doc.discrepancia?.trim() || null, {
        numero: doc.numero?.trim() ?? null,
        montoOc: doc.montoOc,
        total: Number(cot.total ?? 0),
        diferencia: oc.diferencia,
      });
    // CRM (EP-00 0.3): la oportunidad de la cotización queda «ganada» con su OT.
    await ganarOportunidadDeCotizacion(this.prisma, id, ot.id).catch(() => undefined);

    const extra = ot.opiPendiente ? " Queda con OPI PENDIENTE (disposición del Director con cobro)." : "";
    const otFinal = await this.prisma.ordenTrabajo.findUnique({
      where: { id: ot.id },
      include: { cliente: true, unidad: { select: { id: true, codigo: true, nombre: true, tipo: true } } },
    });
    const lab = otFinal?.unidad ? ` Laboratorio responsable: ${otFinal.unidad.codigo} · ${otFinal.unidad.nombre}.` : "";
    return {
      ok: true,
      cotizacion,
      ot: otFinal ?? ot,
      mensaje: `Cotización aceptada. Orden de trabajo ${ot.codigo} creada.${lab}${extra}`,
    };
  }

  /** Hito de la cotización (bitácora `cotizacion_evento`). */
  private async hito(tenantId: string, cotizacionId: string, accion: string, usuarioId: string | undefined, comentario: string | null, detalle: object) {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO cotizacion_evento (tenant_id, cotizacion_id, accion, comentario, detalle, usuario_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::uuid)`,
      tenantId,
      cotizacionId,
      accion,
      comentario,
      JSON.stringify(detalle),
      usuarioId ?? null,
    );
  }

  /**
   * «Anular orden del cliente» (EP-00 4.2): la O/C no corresponde a la
   * cotización. Queda el hito con el motivo; la cotización sigue Abierta para
   * recibir otra orden o anularse.
   */
  async anularOrdenCliente(id: string, tenantId: string | undefined, d: { numero: string; montoOc?: number; motivo: string }, usuarioId?: string) {
    const cot = await this.detalle(id, tenantId);
    if (cot.estado !== ESTADO_ABIERTA) throw new ConflictException(`La cotización ${cot.codigo} no está Abierta (está '${cot.estado}').`);
    await this.hito(cot.tenantId, id, "orden_cliente_anulada", usuarioId, d.motivo.trim(), {
      numero: d.numero.trim(),
      montoOc: d.montoOc ?? null,
      total: Number(cot.total ?? 0),
    });
    return { ok: true, mensaje: `Orden del cliente ${d.numero.trim()} anulada. La cotización ${cot.codigo} sigue Abierta.` };
  }

  /** Adjunto de la cotización: documento de solicitud o de aceptación (EP-00 1.1 y 4.1). */
  async adjuntar(id: string, tenantId: string | undefined, clase: string, archivo: ArchivoAdjunto | undefined, usuarioId?: string) {
    const cot = await this.detalle(id, tenantId);
    if (!["solicitud", "aceptacion"].includes(clase)) throw new BadRequestException("Clase de adjunto: «solicitud» o «aceptacion».");
    return guardarAdjunto(this.prisma, { tenantId: cot.tenantId, entidad: "cotizacion", entidadId: id, clase, archivo, usuarioId: usuarioId ?? null });
  }

  async adjuntos(id: string, tenantId: string) {
    return listarAdjuntos(this.prisma, tenantId, "cotizacion", [id]);
  }

  async adjunto(id: string, tenantId: string, adjuntoId: string) {
    const a = await leerAdjunto(this.prisma, tenantId, ["cotizacion"], adjuntoId);
    if (a.entidadId !== id) throw new NotFoundException("Adjunto no encontrado.");
    return a;
  }

  /** Rechazo: solo cotizaciones históricas ('enviada'); las nuevas se anulan. */
  async rechazar(id: string, motivo: string, tenantId?: string) {
    const actual = await this.detalle(id, tenantId); // valida pertenencia al tenant
    validarTransicion("cotizacion", actual.estado, "rechazada");
    return this.prisma.cotizacion.update({
      where: { id },
      data: { estado: "rechazada", notas: motivo },
    });
  }

}
