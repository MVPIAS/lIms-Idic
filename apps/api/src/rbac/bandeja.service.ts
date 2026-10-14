import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { ContextoAlcance } from "./alcance.service";
import { Perfil } from "./rbac.constants";

export type Severidad = "info" | "warn" | "alta";

export interface ItemBandeja {
  clave: string;
  titulo: string;
  descripcion: string;
  cantidad: number;
  ruta: string;
  severidad: Severidad;
}

/** Estados de OT que ya no requieren trabajo de laboratorio. */
const OT_TERMINADA = `('cerrada','anulada','finalizada','informada')`;

/**
 * Bandeja «qué tengo pendiente» por perfil. Cada conteo es una consulta SQL
 * independiente y DEFENSIVA: si la tabla o columna no existe en esta BD (BD
 * antigua sin algún align_*.sql), ese ítem vale 0 y no se cae la bandeja.
 * Los conteos de laboratorio se acotan a las unidades visibles del usuario.
 */
@Injectable()
export class BandejaService {
  private readonly log = new Logger(BandejaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Ejecuta un COUNT; 0 si la consulta falla (tabla/columna inexistente). */
  private async contar(sql: string, ...params: unknown[]): Promise<number> {
    try {
      const filas = await this.prisma.$queryRawUnsafe<{ n: bigint | number }[]>(sql, ...params);
      return Number(filas?.[0]?.n ?? 0);
    } catch (e: any) {
      this.log.debug(`bandeja: consulta omitida (${e?.message?.split("\n")[0]})`);
      return 0;
    }
  }

  private async filas<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    try {
      return await this.prisma.$queryRawUnsafe<T[]>(sql, ...params);
    } catch {
      return [];
    }
  }

  async construir(ctx: ContextoAlcance, perfil: Perfil, tenantId: string | undefined): Promise<ItemBandeja[]> {
    // $1 = tenant (o NULL), $2 = unidades visibles (o NULL = todas), $3 = usuario
    const tenant = tenantId ?? null;
    const unidades = ctx.esGlobal ? null : ctx.unidadIds;
    const yo = ctx.usuarioId;
    const otScope = `o.tenant_id = COALESCE($1::uuid, o.tenant_id) AND ($2::uuid[] IS NULL OR o.unidad_principal = ANY($2::uuid[]))`;

    const q = {
      otAbiertas: () =>
        this.contar(`SELECT count(*) AS n FROM orden_trabajo o WHERE ${otScope} AND o.estado NOT IN ${OT_TERMINADA}`, tenant, unidades),
      otVencidas: () =>
        this.contar(
          `SELECT count(*) AS n FROM orden_trabajo o WHERE ${otScope} AND o.estado NOT IN ${OT_TERMINADA} AND o.fecha_compromiso < CURRENT_DATE`,
          tenant,
          unidades,
        ),
      otPorVencer: () =>
        this.contar(
          `SELECT count(*) AS n FROM orden_trabajo o WHERE ${otScope} AND o.estado NOT IN ${OT_TERMINADA} AND o.fecha_compromiso BETWEEN CURRENT_DATE AND CURRENT_DATE + 3`,
          tenant,
          unidades,
        ),
      // Asignada = analista de la OT (ot_analista) o de un ensayo concreto
      // (resultado.asignado_a). Misma regla que GET /ot?mias=1.
      otAsignadas: () =>
        this.contar(
          `SELECT count(*) AS n FROM orden_trabajo o
            WHERE ${otScope} AND o.estado NOT IN ${OT_TERMINADA}
              AND (EXISTS (SELECT 1 FROM ot_analista oa WHERE oa.ot_id = o.id AND oa.usuario_id = $3::uuid)
                   OR EXISTS (SELECT 1 FROM resultado r WHERE r.ot_id = o.id AND r.asignado_a = $3::uuid AND r.deleted_at IS NULL))`,
          tenant,
          unidades,
          yo,
        ),
      otSinAsignar: () =>
        this.contar(
          `SELECT count(*) AS n FROM orden_trabajo o
            WHERE ${otScope} AND o.estado NOT IN ${OT_TERMINADA}
              AND NOT EXISTS (SELECT 1 FROM ot_analista oa WHERE oa.ot_id = o.id)`,
          tenant,
          unidades,
        ),
      resultadosEstado: (estados: string[]) =>
        this.contar(
          `SELECT count(*) AS n FROM resultado r JOIN orden_trabajo o ON o.id = r.ot_id
            WHERE r.deleted_at IS NULL AND r.estado = ANY($3::text[]) AND ${otScope}`,
          tenant,
          unidades,
          estados,
        ),
      resultadosDevueltosMios: () =>
        this.contar(
          `SELECT count(*) AS n FROM resultado r JOIN orden_trabajo o ON o.id = r.ot_id
            WHERE r.deleted_at IS NULL AND r.estado IN ('devuelto','rechazado') AND r.analista_id = $3::uuid AND ${otScope}`,
          tenant,
          unidades,
          yo,
        ),
      firmasPendientes: () =>
        this.contar(`SELECT count(*) AS n FROM ot_firma f WHERE f.usuario_id = $1::uuid AND f.estado = 'pendiente'`, yo),
      boletinesEnRevision: () =>
        this.contar(
          `SELECT count(*) AS n FROM boletin_analisis b JOIN orden_trabajo o ON o.id = b.ot_id
            WHERE b.estado = 'en_revision' AND ${otScope}`,
          tenant,
          unidades,
        ),
      cotizacionesPorVencer: () =>
        this.contar(
          `SELECT count(*) AS n FROM cotizacion c WHERE c.tenant_id = COALESCE($1::uuid, c.tenant_id)
              AND c.estado IN ('borrador','enviada') AND c.expira_at BETWEEN now() AND now() + interval '7 days'`,
          tenant,
        ),
      cotizacionesSinOt: () =>
        this.contar(
          `SELECT count(*) AS n FROM cotizacion c WHERE c.tenant_id = COALESCE($1::uuid, c.tenant_id)
              AND c.estado = 'aceptada'
              AND NOT EXISTS (SELECT 1 FROM orden_trabajo o WHERE o.cotizacion_id = c.id)`,
          tenant,
        ),
      otCerradasSinFactura: () =>
        this.contar(
          `SELECT count(*) AS n FROM orden_trabajo o WHERE ${otScope} AND o.estado IN ('cerrada','finalizada','informada')
              AND NOT EXISTS (SELECT 1 FROM factura f WHERE f.ot_id = o.id AND f.deleted_at IS NULL)`,
          tenant,
          unidades,
        ),
      facturasPorCobrar: () =>
        this.contar(
          `SELECT count(*) AS n FROM factura f WHERE f.tenant_id = COALESCE($1::uuid, f.tenant_id) AND f.deleted_at IS NULL
              AND f.estado IN ('emitida','aviso_1','aviso_2','aviso_3','prejudicial')`,
          tenant,
        ),
      ocPendientes: () =>
        this.contar(
          `SELECT count(*) AS n FROM orden_compra oc WHERE oc.tenant_id = COALESCE($1::uuid, oc.tenant_id) AND oc.deleted_at IS NULL
              AND oc.estado IN ('borrador','aprobada','en_proceso')`,
          tenant,
        ),
      ncAbiertas: () =>
        this.contar(
          `SELECT count(*) AS n FROM no_conformidad nc WHERE nc.tenant_id = COALESCE($1::uuid, nc.tenant_id)
              AND nc.estado IN ('abierta','en_proceso','verificacion','reabierta')`,
          tenant,
        ),
      usuariosSinRol: () =>
        this.contar(
          `SELECT count(*) AS n FROM usuario u WHERE u.tenant_id = COALESCE($1::uuid, u.tenant_id) AND u.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM usuario_rol ur WHERE ur.usuario_id = u.id)`,
          tenant,
        ),
      usuariosBloqueados: () =>
        this.contar(
          `SELECT count(*) AS n FROM usuario u WHERE u.tenant_id = COALESCE($1::uuid, u.tenant_id) AND u.deleted_at IS NULL AND u.estado = 'bloqueado'`,
          tenant,
        ),
      unidadesSinJefe: () =>
        this.contar(
          `SELECT count(*) AS n FROM unidad un WHERE un.tenant_id = COALESCE($1::uuid, un.tenant_id) AND un.activa
              AND un.tipo IN ('LABORATORIO','SUCURSAL','DELEGACION','SECCION','DEPARTAMENTO')
              AND un.jefe_usuario_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM unidad_jefe j WHERE j.unidad_id = un.id)`,
          tenant,
        ),
    };

    const item = (
      clave: string,
      titulo: string,
      descripcion: string,
      cantidad: number,
      ruta: string,
      sevSiHay: Severidad = "warn",
    ): ItemBandeja => ({ clave, titulo, descripcion, cantidad, ruta, severidad: cantidad > 0 ? sevSiHay : "info" });

    const vencidasPorLab = async (): Promise<ItemBandeja[]> => {
      const filas = await this.filas<{ codigo: string; nombre: string; n: bigint | number }>(
        `SELECT u.codigo, u.nombre, count(*) AS n FROM orden_trabajo o JOIN unidad u ON u.id = o.unidad_principal
          WHERE ${otScope} AND o.estado NOT IN ${OT_TERMINADA} AND o.fecha_compromiso < CURRENT_DATE
          GROUP BY u.codigo, u.nombre ORDER BY n DESC LIMIT 10`,
        tenant,
        unidades,
      );
      return filas.map((f) =>
        item(
          `ot_vencidas_${f.codigo}`,
          `OT vencidas · ${f.codigo}`,
          `OT con fecha compromiso vencida en ${f.nombre}`,
          Number(f.n),
          `/ot?unidad=${encodeURIComponent(f.codigo)}&vencidas=1`,
          "alta",
        ),
      );
    };

    const firmas = async () =>
      item("firmas_pendientes", "Documentos por firmar", "Firmas de OT/informes asignadas a usted", await q.firmasPendientes(), "/informes", "warn");
    const vencidas = async () =>
      item("ot_vencidas", "OT vencidas", "OT abiertas con fecha compromiso vencida", await q.otVencidas(), "/ot?vencidas=1", "alta");
    const porVencer = async () =>
      item("ot_por_vencer", "OT por vencer", "OT que vencen en los próximos 3 días", await q.otPorVencer(), "/ot?porVencer=1", "warn");
    const abiertas = async () =>
      item("ot_abiertas", "OT abiertas", "OT en curso en su alcance (indicador)", await q.otAbiertas(), "/ot", "info");
    // Las tarjetas de resultados abren «Captura y revisión por OT» ya filtrada.
    const porRevisar = async () =>
      item("resultados_por_revisar", "Resultados por revisar", "Resultados capturados pendientes de revisión nivel 1", await q.resultadosEstado(["capturado"]), "/captura-ot?estado=capturado", "warn");
    const porAprobar = async () =>
      item("resultados_por_aprobar", "Resultados por aprobar", "Resultados revisados pendientes de aprobación", await q.resultadosEstado(["revisado_n1"]), "/captura-ot?estado=revisado_n1", "warn");
    const asignadas = async () =>
      item("ot_asignadas", "OT asignadas a mí", "OT abiertas donde usted figura como analista (de la OT o de un ensayo)", await q.otAsignadas(), "/ot?mias=1&estado=abiertas", "warn");
    const devueltos = async () =>
      item("resultados_devueltos", "Resultados devueltos", "Resultados suyos devueltos o rechazados para corregir", await q.resultadosDevueltosMios(), "/captura-ot?estado=devuelto,rechazado&mios=1", "alta");
    const sinAsignar = async () =>
      item("ot_sin_asignar", "OT sin analista", "OT abiertas de su laboratorio a las que aún no se asignó analista", await q.otSinAsignar(), "/ot?sinAsignar=1&estado=abiertas", "warn");
    const porOficializar = async () =>
      item("informes_por_oficializar", "Informes por oficializar", "Boletines/informes en revisión en su ámbito", await q.boletinesEnRevision(), "/informes?estado=en_revision", "warn");
    const sinOt = async () =>
      item("cotizaciones_aceptadas_sin_ot", "Cotizaciones aceptadas sin OT", "Cotizaciones aceptadas a las que aún no se les creó OT", await q.cotizacionesSinOt(), "/cotizaciones?estado=aceptada&sinOt=1", "warn");
    const nc = async () =>
      item("nc_abiertas", "No conformidades abiertas", "NC abiertas, en proceso o en verificación", await q.ncAbiertas(), "/qc", "warn");

    const all = (fs: (() => Promise<ItemBandeja | ItemBandeja[]>)[]) =>
      Promise.all(fs.map((f) => f())).then((r) => r.flat());

    switch (perfil) {
      case "ANALISTA":
        return all([
          asignadas,
          async () => item("ot_en_curso", "OT en curso", "OT abiertas de sus laboratorios", await q.otAbiertas(), "/ot?estado=abiertas", "info"),
          devueltos,
          firmas,
        ]);
      case "REVISOR":
        return all([porRevisar, asignadas, devueltos, porVencer, firmas]);
      case "JEFE_LAB":
        return all([sinAsignar, porRevisar, porAprobar, firmas, vencidas, porVencer, porOficializar]);
      case "JEFE_SECCION":
      case "JEFE_DEPTO":
        return all([firmas, porOficializar, porAprobar, vencidas, vencidasPorLab, abiertas]);
      case "DIRECTOR":
        return all([firmas, porOficializar, vencidas, vencidasPorLab, abiertas, nc, sinOt]);
      case "COMERCIAL":
        return all([
          async () => item("cotizaciones_por_vencer", "Cotizaciones por vencer", "Cotizaciones abiertas que expiran en 7 días", await q.cotizacionesPorVencer(), "/cotizaciones?porVencer=1", "warn"),
          sinOt,
          porVencer,
        ]);
      case "PLANIFICACION":
        return all([vencidas, vencidasPorLab, porVencer, abiertas, sinOt]);
      case "FINANZAS":
        return all([
          async () => item("ot_cerradas_sin_factura", "OT cerradas sin factura", "OT terminadas que aún no tienen factura", await q.otCerradasSinFactura(), "/facturas?pendientes=1", "alta"),
          async () => item("facturas_por_cobrar", "Facturas por cobrar", "Facturas emitidas o con aviso de cobranza", await q.facturasPorCobrar(), "/facturas?estado=emitida", "warn"),
        ]);
      case "ABASTECIMIENTO":
        return all([
          async () => item("oc_pendientes", "Órdenes de compra pendientes", "OC en borrador, aprobadas o en proceso", await q.ocPendientes(), "/ordenes-compra", "warn"),
        ]);
      case "CALIDAD":
        return all([nc, porOficializar, vencidas]);
      case "ADMIN":
        return all([
          async () => item("usuarios_sin_rol", "Usuarios sin rol", "Usuarios activos sin ninguna asignación de rol", await q.usuariosSinRol(), "/usuarios?sinRol=1", "warn"),
          async () => item("usuarios_bloqueados", "Usuarios bloqueados", "Cuentas en estado bloqueado", await q.usuariosBloqueados(), "/usuarios?estado=bloqueado", "warn"),
          async () => item("unidades_sin_jefe", "Unidades sin jefe", "Laboratorios, secciones o departamentos sin jefe asignado", await q.unidadesSinJefe(), "/usuarios?vista=estructura", "info"),
        ]);
      case "LECTOR":
      default:
        return all([abiertas]);
    }
  }
}
