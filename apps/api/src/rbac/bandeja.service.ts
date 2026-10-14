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
 * Plazos (fecha de compromiso con el cliente): cuentan todas las OT no cerradas
 * ni anuladas, y «hoy» es el día en Chile. Mismos cortes que el semáforo de la
 * lista de OT (apps/api/src/ot/plazos.ts: vencida / por vencer en 3 días).
 */
const OT_CERRADA = `('cerrada','anulada')`;
const HOY_CL = `(now() AT TIME ZONE 'America/Santiago')::date`;

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
          `SELECT count(*) AS n FROM orden_trabajo o WHERE ${otScope} AND o.estado NOT IN ${OT_CERRADA} AND o.fecha_compromiso < ${HOY_CL}`,
          tenant,
          unidades,
        ),
      otPorVencer: () =>
        this.contar(
          `SELECT count(*) AS n FROM orden_trabajo o WHERE ${otScope} AND o.estado NOT IN ${OT_CERRADA} AND o.fecha_compromiso BETWEEN ${HOY_CL} AND ${HOY_CL} + 3`,
          tenant,
          unidades,
        ),
      otListasParaCerrar: () =>
        this.contar(
          `SELECT count(*) AS n FROM orden_trabajo o WHERE ${otScope} AND o.estado NOT IN ${OT_CERRADA}
              AND EXISTS (SELECT 1 FROM certificado c WHERE c.ot_id = o.id AND c.deleted_at IS NULL AND c.estado IN ('oficial','emitido'))
              AND NOT EXISTS (SELECT 1 FROM certificado c WHERE c.ot_id = o.id AND c.deleted_at IS NULL
                                AND (c.estado IN ('en_firma','devuelto') OR (c.estado IN ('oficial','emitido') AND c.entregado_at IS NULL)))
              AND NOT EXISTS (SELECT 1 FROM resultado r WHERE r.ot_id = o.id AND r.deleted_at IS NULL AND r.estado <> 'aprobado')`,
          tenant,
          unidades,
        ),
      documentosPorEntregar: () =>
        this.contar(
          `SELECT count(*) AS n FROM certificado c JOIN orden_trabajo o ON o.id = c.ot_id
            WHERE ${otScope} AND c.deleted_at IS NULL AND c.estado IN ('oficial','emitido') AND c.entregado_at IS NULL
              AND o.estado NOT IN ${OT_CERRADA}`,
          tenant,
          unidades,
        ),
      otAsignadas: () =>
        this.contar(
          `SELECT count(DISTINCT oa.ot_id) AS n FROM ot_analista oa JOIN orden_trabajo o ON o.id = oa.ot_id
            WHERE oa.usuario_id = $3::uuid AND ${otScope} AND o.estado NOT IN ${OT_TERMINADA}`,
          tenant,
          unidades,
          yo,
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
      // Documentos (informes/certificados) cuyo paso ACTUAL de la matriz de
      // firmas tiene al usuario como responsable (plantilla-render/firma-documento.service.ts).
      firmasPendientes: () =>
        this.contar(
          `SELECT count(DISTINCT df.certificado_id) AS n FROM documento_firma df JOIN certificado c ON c.id = df.certificado_id
            WHERE c.estado = 'en_firma' AND c.deleted_at IS NULL AND c.tenant_id = COALESCE($1::uuid, c.tenant_id)
              AND df.estado = 'pendiente'
              AND df.responsables @> jsonb_build_array(jsonb_build_object('usuarioId', $2::text))
              AND df.orden = (SELECT min(x.orden) FROM documento_firma x WHERE x.certificado_id = df.certificado_id AND x.estado = 'pendiente')`,
          tenant,
          yo,
        ),
      facturasPendientes: () =>
        this.contar(
          `SELECT count(*) AS n FROM factura f WHERE f.tenant_id = COALESCE($1::uuid, f.tenant_id) AND f.deleted_at IS NULL
              AND f.estado = 'pendiente'`,
          tenant,
        ),
      boletinesEnRevision: () =>
        this.contar(
          `SELECT count(*) AS n FROM boletin_analisis b JOIN orden_trabajo o ON o.id = b.ot_id
            WHERE b.estado = 'en_revision' AND ${otScope}`,
          tenant,
          unidades,
        ),
      cotizacionesPorVencer: () =>
        this.contar(
          // Abiertas (y 'enviada' del histórico) que vencen entre hoy y 7 días (fecha de Chile).
          `SELECT count(*) AS n FROM cotizacion c WHERE c.tenant_id = COALESCE($1::uuid, c.tenant_id)
              AND c.estado IN ('abierta','enviada')
              AND COALESCE(c.valida_hasta, c.expira_at) BETWEEN (now() AT TIME ZONE 'America/Santiago')::date
                                                            AND (now() AT TIME ZONE 'America/Santiago')::date + 7`,
          tenant,
        ),
      cotizacionesSinOt: () =>
        this.contar(
          `SELECT count(*) AS n FROM cotizacion c WHERE c.tenant_id = COALESCE($1::uuid, c.tenant_id)
              AND c.estado = 'aceptada'
              AND NOT EXISTS (SELECT 1 FROM orden_trabajo o WHERE o.cotizacion_id = c.id)`,
          tenant,
        ),
      // OT cerradas CON COBRO sin ninguna factura viva (p. ej. cerradas antes
      // de que el cierre generara el borrador). Las nuevas ya nacen con él.
      otCerradasSinFactura: () =>
        this.contar(
          `SELECT count(*) AS n FROM orden_trabajo o WHERE ${otScope} AND o.estado = 'cerrada' AND o.con_cobro
              AND NOT EXISTS (SELECT 1 FROM factura f WHERE f.ot_id = o.id AND f.deleted_at IS NULL AND f.estado <> 'anulada')`,
          tenant,
          unidades,
        ),
      facturasPorCobrar: () =>
        this.contar(
          `SELECT count(*) AS n FROM factura f WHERE f.tenant_id = COALESCE($1::uuid, f.tenant_id) AND f.deleted_at IS NULL
              AND f.estado IN ('emitida','parcial','aviso_1','aviso_2','aviso_3','prejudicial')`,
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
          // Acotadas al alcance: una NC sin unidad (transversal) la ven todos los que ven NC.
          `SELECT count(*) AS n FROM no_conformidad nc WHERE nc.tenant_id = COALESCE($1::uuid, nc.tenant_id)
              AND nc.estado IN ('abierta','en_proceso','verificacion','reabierta')
              AND ($2::uuid[] IS NULL OR nc.unidad_id IS NULL OR nc.unidad_id = ANY($2::uuid[]))`,
          tenant,
          unidades,
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
          WHERE ${otScope} AND o.estado NOT IN ${OT_CERRADA} AND o.fecha_compromiso < ${HOY_CL}
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
          `/ot?semaforo=vencida&unidad=${encodeURIComponent(f.codigo)}`,
          "alta",
        ),
      );
    };

    const firmas = async () =>
      item("firmas_pendientes", "Documentos por firmar", "Informes y certificados que esperan su firma", await q.firmasPendientes(), "/informes/por-firmar", "warn");
    const vencidas = async () =>
      item("ot_vencidas", "OT vencidas", "OT abiertas con fecha compromiso vencida", await q.otVencidas(), "/ot?semaforo=vencida", "alta");
    const porVencer = async () =>
      item("ot_por_vencer", "OT por vencer", "OT que vencen hoy o en los próximos 3 días", await q.otPorVencer(), "/ot?semaforo=por_vencer", "warn");
    const listasCerrar = async () =>
      item("ot_listas_cerrar", "OT listas para cerrar", "Documentos oficiales y entregados: falta cerrar la OT", await q.otListasParaCerrar(), "/ot?listasCierre=1", "warn");
    const porEntregar = async () =>
      item("documentos_por_entregar", "Documentos por entregar", "Informes oficiales sin entrega registrada", await q.documentosPorEntregar(), "/certificados?estado=por_entregar", "warn");
    const abiertas = async () =>
      item("ot_abiertas", "OT abiertas", "OT en curso en su alcance (indicador)", await q.otAbiertas(), "/ot", "info");
    const porRevisar = async () =>
      item("resultados_por_revisar", "Resultados por revisar", "Resultados capturados pendientes de revisión nivel 1", await q.resultadosEstado(["capturado"]), "/captura?estado=capturado", "warn");
    const porAprobar = async () =>
      item("resultados_por_aprobar", "Resultados por aprobar", "Resultados revisados pendientes de aprobación", await q.resultadosEstado(["revisado_n1"]), "/captura?estado=revisado_n1", "warn");
    const porOficializar = async () =>
      item("informes_por_oficializar", "Informes por oficializar", "Boletines/informes en revisión en su ámbito", await q.boletinesEnRevision(), "/informes?estado=en_revision", "warn");
    const sinOt = async () =>
      item("cotizaciones_aceptadas_sin_ot", "Cotizaciones aceptadas sin OT", "Cotizaciones aceptadas a las que aún no se les creó OT", await q.cotizacionesSinOt(), "/cotizaciones?estado=aceptada&sinOt=1", "warn");
    const nc = async () =>
      item("nc_abiertas", "No conformidades abiertas", "NC abiertas, en proceso o en verificación", await q.ncAbiertas(), "/no-conformidades", "warn");

    const all = (fs: (() => Promise<ItemBandeja | ItemBandeja[]>)[]) =>
      Promise.all(fs.map((f) => f())).then((r) => r.flat());

    switch (perfil) {
      case "ANALISTA":
        return all([
          async () => item("ot_asignadas", "OT asignadas a mí", "OT abiertas donde usted figura como analista", await q.otAsignadas(), "/captura-ot", "warn"),
          async () => item("ot_en_curso", "OT en curso", "OT abiertas de sus laboratorios", await q.otAbiertas(), "/ot", "info"),
          async () => item("resultados_devueltos", "Resultados devueltos", "Resultados suyos devueltos o rechazados para corregir", await q.resultadosDevueltosMios(), "/captura?estado=devuelto", "alta"),
          firmas,
        ]);
      case "REVISOR":
        return all([
          porRevisar,
          async () => item("ot_asignadas", "OT asignadas a mí", "OT abiertas donde usted figura como analista", await q.otAsignadas(), "/captura-ot", "warn"),
          async () => item("resultados_devueltos", "Resultados devueltos", "Resultados suyos devueltos o rechazados para corregir", await q.resultadosDevueltosMios(), "/captura?estado=devuelto", "alta"),
          porVencer,
          firmas,
        ]);
      case "JEFE_LAB":
        return all([porRevisar, porAprobar, firmas, porEntregar, listasCerrar, vencidas, porVencer, porOficializar]);
      case "JEFE_SECCION":
      case "JEFE_DEPTO":
        return all([firmas, porOficializar, porAprobar, vencidas, vencidasPorLab, abiertas]);
      case "DIRECTOR":
        return all([firmas, porOficializar, vencidas, vencidasPorLab, abiertas, nc, sinOt]);
      case "COMERCIAL":
        return all([
          async () => item("cotizaciones_por_vencer", "Cotizaciones por vencer", "Cotizaciones abiertas que vencen en los próximos 7 días", await q.cotizacionesPorVencer(), "/cotizaciones?porVencer=1", "warn"),
          sinOt,
          porVencer,
          porEntregar,
        ]);
      case "PLANIFICACION":
        return all([vencidas, vencidasPorLab, porVencer, listasCerrar, porEntregar, abiertas, sinOt]);
      case "FINANZAS":
        return all([
          async () => item("facturas_pendientes", "Pendientes de facturar", "Facturas en borrador generadas al cerrar OT con cobro: revíselas y emítalas", await q.facturasPendientes(), "/facturas?estado=pendiente", "alta"),
          async () => item("facturas_por_cobrar", "Facturas por cobrar", "Facturas emitidas, con pago parcial o con aviso de cobranza", await q.facturasPorCobrar(), "/facturas?estado=por_cobrar", "warn"),
          async () => item("ot_cerradas_sin_factura", "OT cerradas sin factura", "OT con cobro cerradas sin factura (anteriores al cierre automático)", await q.otCerradasSinFactura(), "/ot", "warn"),
        ]);
      case "ABASTECIMIENTO":
        return all([
          async () => item("oc_pendientes", "Órdenes de compra pendientes", "OC en borrador, aprobadas o en proceso", await q.ocPendientes(), "/ordenes-compra", "warn"),
        ]);
      case "CALIDAD":
        return all([firmas, nc, porOficializar, vencidas]);
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
