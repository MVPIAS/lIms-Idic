import { faltantesCierreArmas } from "../saec/d11/cierre-d11";
import { SQL_OT_LISTA_PARA_CERRAR } from "./lista-cierre";
import { faltantesNotificacionDgmn } from "../bpch/notificacion-dgmn/notificacion-dgmn.module";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { FacturaService } from "../facturacion/facturacion.module";
import { pasosActuales, esOficial } from "../plantilla-render/reglas-emision";
import {
  OT_ESTADOS_TERMINADOS,
  UMBRAL_POR_VENCER_DIAS,
  caminoEstadosOt,
  diaDe,
  faltantesParaCerrar,
  fechaCompromisoDesdePlazo,
  hoyCl,
  semaforoPlazo,
  sumarDias,
  validarFechaCompromiso,
} from "./plazos";
import { hechosCobertura } from "../plantilla-render/cobertura-ot";
import { metrologiaParaCierre } from "../metrologia/metrologia-ot.datos";
import { documentosDeCalibraciones, faltantesInstrumentos } from "../metrologia/metrologia-ot.reglas";

const FechaCompromiso = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD"),
  motivo: z.string().max(500).optional(),
});
const SEMAFOROS = ["vencida", "por_vencer", "en_plazo", "sin_fecha"] as const;

function tienePermiso(req: any, codigo: string): boolean {
  const u = req?.user ?? {};
  return (u.roles ?? []).includes("SUPERADMIN") || (u.permisos ?? []).includes(codigo);
}

/**
 * Plazos y cierre de la OT (docs/FLUJO_FIRMA_CIERRE.md). Fichero propio para no
 * tocar las rutas de `ot.controller.ts`. Se registra ANTES que OtController en
 * OtModule para que GET /ot/plazos no lo capture la ruta GET /ot/:id.
 */
@Injectable()
export class OtCierreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly facturas: FacturaService,
  ) {}

  private async cargarOt(id: string, req: any) {
    const tenantId = req?.user?.tenantId;
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: { cliente: { select: { id: true, razonSocial: true, email: true } } },
    });
    if (!ot) throw new NotFoundException(`OT ${id} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    return ot;
  }

  /** Columnas de plazo que no están en el modelo Prisma de la OT (align_firma_cierre.sql). */
  private async extrasOt(id: string) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.fecha_compromiso_origen AS origen, o.fecha_compromiso_at AS "fijadaAt",
              u.nombre_completo AS "fijadaPor", o.cerrada_por AS "cerradaPor",
              c.codigo AS "cotizacionCodigo", c.plazo_entrega_dias AS "plazoDias", c.estado AS "cotizacionEstado"
         FROM orden_trabajo o
         LEFT JOIN usuario u ON u.id = o.fecha_compromiso_por
         LEFT JOIN cotizacion c ON c.id = o.cotizacion_id
        WHERE o.id = $1::uuid`,
      id,
    );
    return f[0] ?? {};
  }

  /**
   * Con documentos por muestra, producto o laboratorio, cada uno con resultados
   * debe tener el suyo (o su «no emitido») para cerrar (docs/FLUJO_DOCUMENTOS_POR_OT.md).
   */
  private async coberturaPendiente(otId: string, tenantId: string, db: any = this.prisma): Promise<string[]> {
    try {
      return (await hechosCobertura(db, otId, tenantId)).pendientes;
    } catch {
      return []; // BD sin align_r1b_documentos_ot.sql: un documento por OT
    }
  }

  /** Documentos de la OT con lo necesario para el cierre. */
  private async documentos(otId: string) {
    const docs = await this.prisma.certificado.findMany({
      where: { otId, deletedAt: null },
      orderBy: { fecha: "asc" },
      select: {
        id: true,
        numero: true,
        codigo: true,
        version: true,
        estado: true,
        tipo: true,
        fecha: true,
        oficialAt: true,
        entregadoAt: true,
        entregaMedio: true,
        entregaDestinatario: true,
        plantilla: { select: { nombre: true, repid: true } },
        firmas: { select: { id: true, orden: true, estado: true, accion: true, rolNombre: true, responsables: true } },
      },
    });
    return docs.map(({ firmas, ...d }) => {
      const actuales = d.estado === "en_firma" ? pasosActuales(firmas) : [];
      const pendienteDe = actuales
        .map((p) => {
          const nombres = Array.isArray(p.responsables) ? (p.responsables as any[]).map((r) => r?.nombre).filter(Boolean) : [];
          return `${p.rolNombre ?? p.accion}${nombres.length ? `: ${nombres.join(" o ")}` : ""}`;
        })
        .join("; ");
      return {
        ...d,
        numero: d.numero ?? d.codigo,
        oficial: esOficial(d.estado),
        firmasHechas: firmas.filter((x) => x.estado === "firmado").length,
        firmasTotal: firmas.filter((x) => x.estado !== "anulado").length,
        pendienteDe: pendienteDe || null,
      };
    });
  }

  /** Estado de cierre de la OT: plazo, documentos, resultados, factura y qué falta. */
  async estadoCierre(id: string, req: any) {
    const ot = await this.cargarOt(id, req);
    const [extras, documentos, resultados, factura, metro] = await Promise.all([
      this.extrasOt(id),
      this.documentos(id),
      this.prisma.resultado.groupBy({ by: ["estado"], where: { otId: id, deletedAt: null }, _count: { _all: true } }),
      this.prisma.factura.findFirst({
        where: { otId: id, deletedAt: null, NOT: { estado: "anulada" } },
        orderBy: { createdAt: "desc" },
        select: { id: true, numero: true, estado: true, total: true, moneda: true },
      }),
      // Metrología (EP-04): los certificados de calibración y los instrumentos de la OT cuentan para el cierre.
      metrologiaParaCierre(this.prisma, id, ot.tenantId),
    ]);
    const totalRes = resultados.reduce((a, r) => a + r._count._all, 0);
    const aprobados = resultados.find((r) => r.estado === "aprobado")?._count._all ?? 0;
    const faltantes = [
      ...faltantesParaCerrar({
        estado: ot.estado,
        documentos: [
          ...documentos.map((d) => ({ numero: d.numero, estado: d.estado, entregadoAt: d.entregadoAt, pendienteDe: d.pendienteDe })),
          ...documentosDeCalibraciones(metro.cals),
        ],
        resultadosNoAprobados: totalRes - aprobados,
        coberturaPendiente: await this.coberturaPendiente(id, ot.tenantId),
      }),
      ...(ot.estado === "cerrada" ? [] : faltantesInstrumentos(metro.items, metro.cals, metro.exigeDevolucion)),
      // EP-10 10.15/10.17: incumplimiento oficial notificado a DGMN; EP-11 11.27: armas entregadas.
      ...(ot.estado === "cerrada" ? [] : await faltantesNotificacionDgmn(this.prisma, id)),
      ...(ot.estado === "cerrada" ? [] : await faltantesCierreArmas(this.prisma, id)),
    ];
    const camino = caminoEstadosOt(ot.estado);
    if (!faltantes.length && camino === null)
      faltantes.push(`La OT está en un estado ('${ot.estado}') desde el que no se puede llegar a «cerrada».`);
    return {
      ot: {
        id: ot.id,
        codigo: ot.codigo,
        estado: ot.estado,
        conCobro: ot.conCobro,
        cotizacionId: ot.cotizacionId ?? null,
        origenTrabajo: ot.origenTrabajo ?? null,
        cliente: ot.cliente?.razonSocial ?? null,
        emailCliente: ot.cliente?.email ?? null,
        fechaRecepcion: ot.fechaRecepcion,
        fechaCierre: ot.fechaCierre,
      },
      plazo: {
        fechaCompromiso: diaDe(ot.fechaCompromiso),
        origen: extras.origen ?? null,
        fijadaAt: extras.fijadaAt ?? null,
        fijadaPor: extras.fijadaPor ?? null,
        sugerida: fechaCompromisoDesdePlazo(ot.fechaRecepcion, extras.plazoDias ?? null),
        plazoDiasCotizacion: extras.plazoDias ?? null,
        cotizacionCodigo: extras.cotizacionCodigo ?? null,
        ...semaforoPlazo(ot.fechaCompromiso, ot.estado),
      },
      resultados: { total: totalRes, aprobados },
      documentos,
      calibraciones: metro.cals
        .filter((c) => c.estado !== "reemplazada")
        .map((c) => ({ id: c.id, numero: c.numeroCertificado ?? c.codigo, estado: c.estado, entregadoAt: c.entregadoAt ?? null })),
      factura: factura ? { ...factura, total: Number(factura.total) } : null,
      faltantes,
      puedeCerrar: faltantes.length === 0,
      caminoEstados: camino ?? [],
      puedo: {
        planificar: tienePermiso(req, "ot.planificar") && !(OT_ESTADOS_TERMINADOS as readonly string[]).includes(ot.estado),
        cerrar: tienePermiso(req, "ot.cerrar"),
        emitir: tienePermiso(req, "certificado.emitir"),
        entregar: tienePermiso(req, "certificado.entregar"),
      },
    };
  }

  /** Planificación / jefatura fija o corrige la fecha de compromiso (origen «manual»). */
  async fijarFechaCompromiso(id: string, dto: { fecha: string; motivo?: string }, req: any) {
    const ot = await this.cargarOt(id, req);
    if ((OT_ESTADOS_TERMINADOS as readonly string[]).includes(ot.estado))
      throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}: su plazo ya no se modifica.`);
    // Sin fecha de recepción (OT antiguas), el límite es el alta de la OT.
    const error = validarFechaCompromiso(dto.fecha, ot.fechaRecepcion ?? ot.createdAt);
    if (error) throw new BadRequestException(error);
    const nota = dto.motivo?.trim()
      ? `[${hoyCl()}] Fecha de compromiso ${diaDe(ot.fechaCompromiso) ?? "sin fecha"} → ${dto.fecha}: ${dto.motivo.trim()}`
      : null;
    await this.prisma.$executeRawUnsafe(
      `UPDATE orden_trabajo
          SET fecha_compromiso = $2::date, fecha_compromiso_origen = 'manual',
              fecha_compromiso_por = $3::uuid, fecha_compromiso_at = now(), updated_at = now(),
              notas = CASE WHEN $4::text IS NULL THEN notas ELSE concat_ws(E'\\n', notas, $4::text) END
        WHERE id = $1::uuid`,
      id,
      dto.fecha,
      req?.user?.sub ?? null,
      nota,
    );
    return this.estadoCierre(id, req);
  }

  /**
   * Cierra la OT: comprueba (con la OT bloqueada) que todos sus documentos
   * están oficiales y entregados, recorre la máquina de estados hasta
   * «cerrada», fija fecha de cierre y, si la OT es con cobro, crea la factura
   * en borrador para Finanzas. Todo en una transacción.
   */
  async cerrar(id: string, req: any) {
    const ot = await this.cargarOt(id, req);
    const usuarioId: string | null = req?.user?.sub ?? null;
    const resultado = await this.prisma.$transaction(async (tx) => {
      // Bloqueo de la fila: dos cierres simultáneos no generan dos facturas.
      const filas = await tx.$queryRawUnsafe<{ estado: string }[]>(
        `SELECT estado FROM orden_trabajo WHERE id = $1::uuid FOR UPDATE`,
        id,
      );
      const estado = filas[0]?.estado ?? ot.estado;
      const docs = await tx.certificado.findMany({
        where: { otId: id, deletedAt: null },
        select: { numero: true, codigo: true, estado: true, entregadoAt: true },
      });
      const noAprobados = await tx.resultado.count({ where: { otId: id, deletedAt: null, NOT: { estado: "aprobado" } } });
      const metro = await metrologiaParaCierre(tx, id, ot.tenantId);
      const faltantes = [
        ...faltantesParaCerrar({
          estado,
          documentos: [
            ...docs.map((d) => ({ numero: d.numero ?? d.codigo, estado: d.estado, entregadoAt: d.entregadoAt })),
            ...documentosDeCalibraciones(metro.cals),
          ],
          resultadosNoAprobados: noAprobados,
          coberturaPendiente: await this.coberturaPendiente(id, ot.tenantId, tx),
        }),
        ...(estado === "cerrada" ? [] : faltantesInstrumentos(metro.items, metro.cals, metro.exigeDevolucion)),
        ...(estado === "cerrada" ? [] : await faltantesNotificacionDgmn(tx, id)),
        ...(estado === "cerrada" ? [] : await faltantesCierreArmas(tx, id)),
      ];
      const camino = caminoEstadosOt(estado);
      if (!faltantes.length && camino === null)
        faltantes.push(`La OT está en un estado ('${estado}') desde el que no se puede llegar a «cerrada».`);
      if (faltantes.length) throw new ConflictException(`No se puede cerrar la OT ${ot.codigo}. ${faltantes.join(" ")}`);

      const ahora = new Date();
      await tx.ordenTrabajo.update({
        where: { id },
        data: { estado: "cerrada", fechaCierre: ahora, updatedAt: ahora },
      });
      await tx.$executeRawUnsafe(`UPDATE orden_trabajo SET cerrada_por = $2::uuid WHERE id = $1::uuid`, id, usuarioId);

      const factura = ot.conCobro
        ? await this.facturas.crearBorradorDesdeOt(
            tx,
            {
              id: ot.id,
              codigo: ot.codigo,
              tenantId: ot.tenantId,
              clienteId: ot.clienteId,
              cotizacionId: ot.cotizacionId,
              centroCostoId: ot.centroCostoId,
            },
            usuarioId,
          )
        : null;
      return { recorrido: [estado, ...(camino ?? [])], factura };
    });
    const estadoFinal = await this.estadoCierre(id, req);
    return {
      ...estadoFinal,
      recorrido: resultado.recorrido,
      facturaCreada: resultado.factura
        ? { id: resultado.factura.id, numero: resultado.factura.numero, estado: resultado.factura.estado, total: Number(resultado.factura.total) }
        : null,
    };
  }

  /**
   * OT «listas para cerrar»: documento oficial, todos entregados, ninguno en
   * firma ni devuelto y todos los resultados aprobados. Mismo criterio que la
   * tarjeta de Mi bandeja (rbac/bandeja.service.ts) y que GET /ot?listasCierre=1.
   */
  async idsListasParaCerrar(tenantId?: string | null): Promise<string[]> {
    // Misma condición que la tarjeta de Mi bandeja (ot/lista-cierre.ts, B-017).
    const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT o.id FROM orden_trabajo o
        WHERE o.tenant_id = COALESCE($1::uuid, o.tenant_id) AND ${SQL_OT_LISTA_PARA_CERRAR}`,
      tenantId ?? null,
    );
    return filas.map((r) => r.id);
  }

  /** OT cerradas CON COBRO sin ninguna factura viva (tarjeta de Finanzas). */
  async idsCerradasSinFactura(tenantId?: string | null): Promise<string[]> {
    const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT o.id FROM orden_trabajo o
        WHERE o.tenant_id = COALESCE($1::uuid, o.tenant_id) AND o.estado = 'cerrada' AND o.con_cobro
          AND NOT EXISTS (SELECT 1 FROM factura f WHERE f.ot_id = o.id AND f.deleted_at IS NULL AND f.estado <> 'anulada')`,
      tenantId ?? null,
    );
    return filas.map((r) => r.id);
  }

  /**
   * OT abiertas con su semáforo de plazo. `?semaforo=` filtra (vencida |
   * por_vencer | en_plazo | sin_fecha), con los mismos cortes que la bandeja.
   * Misma forma que GET /ot (con cliente), acotado por alcance.
   */
  async plazos(req: any, semaforo?: string, listasCierre = false, unidadCodigo?: string) {
    const tenantId = req?.user?.tenantId;
    let filtro = await this.alcance.filtroUnidades(req);
    if (unidadCodigo) {
      const u = await this.prisma.unidad.findFirst({
        where: { codigo: unidadCodigo, ...(tenantId ? { tenantId } : {}) },
        select: { id: true },
      });
      const id = u?.id ?? "00000000-0000-0000-0000-000000000000";
      filtro = filtro ? filtro.filter((x) => x === id) : [id];
    }
    // «OT listas para cerrar»: mismo criterio que la tarjeta de la bandeja.
    const listas = listasCierre ? await this.idsListasParaCerrar(tenantId) : null;
    const hoy = hoyCl();
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const condFecha: any =
      semaforo === "vencida"
        ? { fechaCompromiso: { lt: d(hoy) } }
        : semaforo === "por_vencer"
          ? { fechaCompromiso: { gte: d(hoy), lte: d(sumarDias(hoy, UMBRAL_POR_VENCER_DIAS)) } }
          : semaforo === "en_plazo"
            ? { fechaCompromiso: { gt: d(sumarDias(hoy, UMBRAL_POR_VENCER_DIAS)) } }
            : semaforo === "sin_fecha"
              ? { fechaCompromiso: null }
              : {};
    const ots = await this.prisma.ordenTrabajo.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(filtro ? { unidadPrincipal: { in: filtro } } : {}),
        estado: { notIn: [...OT_ESTADOS_TERMINADOS] },
        ...condFecha,
        ...(listas ? { id: { in: listas } } : {}),
      },
      orderBy: [{ fechaCompromiso: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 500,
      include: { cliente: true },
    });
    return ots.map((o) => ({ ...o, plazo: semaforoPlazo(o.fechaCompromiso, o.estado) }));
  }
}

@ApiTags("ot")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ot")
export class OtCierreController {
  constructor(private readonly svc: OtCierreService) {}

  /** OT abiertas con semáforo de plazo (?semaforo=vencida|por_vencer|en_plazo|sin_fecha, ?listasCierre=1). */
  @Get("plazos")
  @RequierePermiso("ot.ver")
  plazos(
    @Req() req: any,
    @Query("semaforo") semaforo?: string,
    @Query("listasCierre") listasCierre?: string,
    @Query("unidad") unidad?: string,
  ) {
    const s = semaforo && (SEMAFOROS as readonly string[]).includes(semaforo) ? semaforo : undefined;
    const u = unidad && /^[A-Za-z0-9_-]{1,40}$/.test(unidad) ? unidad : undefined;
    return this.svc.plazos(req, s, listasCierre === "1" || listasCierre === "true", u);
  }

  /** Plazo, documentos, resultados, factura y qué falta para cerrar. */
  @Get(":id/cierre")
  @RequierePermiso("ot.ver")
  estado(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.estadoCierre(id, req);
  }

  @Put(":id/fecha-compromiso")
  @RequierePermiso("ot.planificar")
  fijar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.fijarFechaCompromiso(id, FechaCompromiso.parse(body ?? {}), req);
  }

  @Post(":id/cerrar")
  @RequierePermiso("ot.cerrar")
  cerrar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.cerrar(id, req);
  }
}
