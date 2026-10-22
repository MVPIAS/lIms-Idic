import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { ContextoAlcance } from "./alcance.service";
import { Perfil, codigoCanonico } from "./rbac.constants";
import { MAX_INTENTOS_FALLIDOS } from "../auth/bloqueo";

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
 * Permiso que exige la pantalla a la que lleva cada tarjeta (el mismo que el
 * menú, apps/web/lib/navegacion.ts). Se busca el prefijo más largo de la ruta.
 */
const PERMISO_DE_RUTA: [string, string][] = [
  ["/informes/por-firmar", "documento.firmar"],
  ["/informes", "certificado.emitir"],
  ["/captura-ot", "resultado.ver"],
  ["/certificados", "ot.ver"],
  ["/ot", "ot.ver"],
  ["/cotizaciones/por-responder", "cotizacion.costear"],
  ["/cotizaciones", "cotizacion.ver"],
  ["/encuestas", "encuesta.ver"],
  ["/facturas", "factura.ver"],
  ["/ordenes-compra", "compra.ver"],
  ["/no-conformidades", "nc.ver"],
  ["/admin", "admin.usuarios"],
  ["/recepcion", "muestra.crear"],
  ["/bpch/internaciones", "bpch.internacion.ver"],
  ["/preparacion-trabajo", "ot.preparacion.aprobar"],
];

/**
 * Quita las tarjetas que el usuario no podría abrir (p. ej. Recepción, perfil
 * «analista», no ve «Resultados devueltos» porque no tiene `resultado.ver`).
 * Sin lista de permisos no filtra; SUPERADMIN lo ve todo.
 */
export function filtrarPorPermiso(items: ItemBandeja[], permisos?: string[] | null, roles: string[] = []): ItemBandeja[] {
  if (!permisos || roles.includes("SUPERADMIN")) return items;
  const tiene = new Set(permisos);
  return items.filter((i) => {
    const ruta = i.ruta.split("?")[0];
    const regla = PERMISO_DE_RUTA.filter(([p]) => ruta === p || ruta.startsWith(`${p}/`)).sort((a, b) => b[0].length - a[0].length)[0];
    return !regla || tiene.has(regla[1]);
  });
}

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

  /** Bandeja del perfil, sin las tarjetas cuya pantalla el usuario no puede abrir (si se pasan sus permisos). */
  async construir(
    ctx: ContextoAlcance,
    perfil: Perfil,
    tenantId: string | undefined,
    permisos?: string[] | null,
    roles: string[] = [],
  ): Promise<ItemBandeja[]> {
    return filtrarPorPermiso(await this.tarjetas(ctx, perfil, tenantId), permisos, roles);
  }

  private async tarjetas(ctx: ContextoAlcance, perfil: Perfil, tenantId: string | undefined): Promise<ItemBandeja[]> {
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
      // Por el laboratorio DUEÑO del ensayo (lims_lab_de_resultado): un derivado por
      // orden interna cuenta para el destino, no para el responsable de la OT
      // (recorrido MP-02, D02-04). Misma regla que GET /resultados/bandeja.
      resultadosEstado: (estados: string[]) =>
        this.contar(
          `SELECT count(*) AS n FROM resultado r JOIN orden_trabajo o ON o.id = r.ot_id
             JOIN LATERAL lims_lab_de_resultado(r.id) lr ON TRUE
            WHERE r.deleted_at IS NULL AND r.estado = ANY($3::text[])
              AND o.tenant_id = COALESCE($1::uuid, o.tenant_id) AND ($2::uuid[] IS NULL OR lr.unidad_id = ANY($2::uuid[]))`,
          tenant,
          unidades,
          estados,
        ),
      // Ensayos que una orden interna RECIBIDA derivó a sus laboratorios y aún
      // esperan su valor (D02-25): el analista del destino llega así a su captura.
      derivadosPorCapturar: () =>
        this.contar(
          `SELECT count(*) AS n FROM resultado r JOIN orden_trabajo o ON o.id = r.ot_id
             JOIN LATERAL lims_lab_de_resultado(r.id) lr ON TRUE
            WHERE r.deleted_at IS NULL AND r.estado IN ('pendiente','devuelto','rechazado')
              AND lr.derivado AND lr.oi_estado = 'recibida'
              AND o.tenant_id = COALESCE($1::uuid, o.tenant_id) AND ($2::uuid[] IS NULL OR lr.unidad_id = ANY($2::uuid[]))`,
          tenant,
          unidades,
        ),
      resultadosDevueltosMios: () =>
        this.contar(
          `SELECT count(*) AS n FROM resultado r JOIN orden_trabajo o ON o.id = r.ot_id
             JOIN LATERAL lims_lab_de_resultado(r.id) lr ON TRUE
            WHERE r.deleted_at IS NULL AND r.estado IN ('devuelto','rechazado') AND r.analista_id = $3::uuid
              AND o.tenant_id = COALESCE($1::uuid, o.tenant_id) AND ($2::uuid[] IS NULL OR lr.unidad_id = ANY($2::uuid[]))`,
          tenant,
          unidades,
          yo,
        ),
      // Recepción (recorrido MP-02, D02-11): lo mismo que la «Bandeja de entrada del
      // laboratorio» (recepcion.service.ts · bandeja): OT abiertas sin muestras o con
      // la recepción incompleta, más las órdenes internas por recibir de sus laboratorios.
      otPorRecepcionar: () =>
        this.contar(
          `SELECT (SELECT count(*) FROM orden_trabajo o
                    WHERE o.tenant_id = COALESCE($1::uuid, o.tenant_id) AND o.estado NOT IN ('cerrada', 'anulada')
                      AND ($2::uuid[] IS NULL OR o.unidad_principal = ANY($2::uuid[]))
                      AND (NOT EXISTS (SELECT 1 FROM muestra m WHERE m.ot_id = o.id AND m.deleted_at IS NULL)
                           OR EXISTS (SELECT 1 FROM muestra m WHERE m.ot_id = o.id AND m.deleted_at IS NULL
                                        AND (m.toma_muestra IS NULL OR m.condicion_recepcion IS NULL))))
                + (SELECT count(*) FROM orden_interna oi
                     JOIN cat_familia f ON f.id = oi.destino_lab
                     JOIN unidad ud ON ud.tenant_id = oi.tenant_id AND ud.codsucdel = f.codsucdel
                    WHERE oi.tenant_id = COALESCE($1::uuid, oi.tenant_id) AND oi.deleted_at IS NULL AND oi.estado = 'abierta'
                      AND ($2::uuid[] IS NULL OR ud.id = ANY($2::uuid[]))) AS n`,
          tenant,
          unidades,
        ),
      // Internaciones BPCH (EP-06 6.1 y 6.6; recorrido MP-06, D06-02). La SCC
      // analiza las de todas las sucursales (como bpch-comun.filtroExpedientes).
      internacionesPorAnalizar: () =>
        this.contar(
          `SELECT count(*) AS n FROM bpch_internacion i
            WHERE i.tenant_id = COALESCE($1::uuid, i.tenant_id) AND i.estado IN ('registrada', 'antecedentes_pendientes')
              AND ($2::uuid[] IS NULL OR i.unidad_inspeccion_id = ANY($2::uuid[])
                   OR EXISTS (SELECT 1 FROM unidad s WHERE s.codigo = 'SCC' AND s.tenant_id = i.tenant_id AND s.id = ANY($2::uuid[])))`,
          tenant,
          unidades,
        ),
      lotesPorInspeccionar: () =>
        this.contar(
          `SELECT count(*) AS n FROM bpch_internacion i JOIN orden_trabajo o ON o.id = i.ot_id
            WHERE i.tenant_id = COALESCE($1::uuid, i.tenant_id) AND i.estado = 'ot_generada' AND o.estado NOT IN ${OT_TERMINADA}
              AND ($2::uuid[] IS NULL OR i.unidad_inspeccion_id = ANY($2::uuid[]))
              AND NOT EXISTS (SELECT 1 FROM muestra m WHERE m.ot_id = o.id AND m.deleted_at IS NULL)`,
          tenant,
          unidades,
        ),
      // ¿El usuario trabaja en la rama del BPCH (o es global)? Solo entonces ve las tarjetas de internación.
      enBpch: () =>
        this.contar(
          `WITH RECURSIVE r AS (
             SELECT id FROM unidad WHERE codigo = 'BPCH' AND tenant_id = COALESCE($1::uuid, tenant_id)
             UNION ALL SELECT u.id FROM unidad u JOIN r ON u.padre_id = r.id)
           SELECT count(*) AS n FROM r WHERE $2::uuid[] IS NOT NULL AND r.id = ANY($2::uuid[])`,
          tenant,
          unidades,
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
      // Documentos del circuito de firma que aún no son oficiales, en el ámbito
      // del usuario (mismo alcance que GET /informes/documentos: la unidad del
      // documento o, si no la tiene, la de su OT). Antes contaba registros del
      // módulo antiguo de boletines, que el circuito nuevo ya no usa.
      documentosEnFirma: () =>
        this.contar(
          `SELECT count(*) AS n FROM certificado c JOIN orden_trabajo o ON o.id = c.ot_id
            WHERE c.estado = 'en_firma' AND c.deleted_at IS NULL AND c.tenant_id = COALESCE($1::uuid, c.tenant_id)
              AND ($2::uuid[] IS NULL OR c.unidad_id = ANY($2::uuid[]) OR (c.unidad_id IS NULL AND o.unidad_principal = ANY($2::uuid[])))`,
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
      // Circuito de la cotización (frente r1c · align_cotizacion_circuito.sql).
      // Solicitudes de Comercial a los laboratorios del alcance, por estado.
      solicitudesLab: (estados: string[]) =>
        this.contar(
          `SELECT count(*) AS n FROM solicitud_costeo s JOIN cotizacion c ON c.id = s.cotizacion_id
            WHERE s.deleted_at IS NULL AND c.estado = 'abierta' AND s.tenant_id = COALESCE($1::uuid, s.tenant_id)
              AND s.estado = ANY($3::text[]) AND ($2::uuid[] IS NULL OR s.unidad_id = ANY($2::uuid[]))`,
          tenant,
          unidades,
          estados,
        ),
      // Por firmar: solo para quien firma según la matriz COTIZACION por defecto
      // (Jefe de Departamento del Depto. Comercial, titular, subrogante o asignado).
      firmaCotizaciones: () =>
        this.contar(
          `SELECT count(*) AS n FROM unidad d
            WHERE d.codigo = 'DCO' AND d.tenant_id = COALESCE($1::uuid, d.tenant_id)
              AND (EXISTS (SELECT 1 FROM unidad_jefe j WHERE j.unidad_id = d.id AND j.usuario_id = $2::uuid)
                   OR EXISTS (SELECT 1 FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id
                               WHERE ur.usuario_id = $2::uuid AND ur.unidad_id = d.id AND r.codigo = 'JEFE_DEPTO'))`,
          tenant,
          yo,
        ),
      cotizacionesPorFirmar: () =>
        this.contar(
          `SELECT count(*) AS n FROM cotizacion c
            WHERE c.tenant_id = COALESCE($1::uuid, c.tenant_id) AND c.estado = 'abierta' AND c.firma_estado = 'pendiente'`,
          tenant,
        ),
      cotizacionesFirma: (estado: string, sinEnviar = false) =>
        this.contar(
          `SELECT count(*) AS n FROM cotizacion c WHERE c.tenant_id = COALESCE($1::uuid, c.tenant_id)
              AND c.estado = 'abierta' AND c.firma_estado = $2 AND ($3::boolean = FALSE OR c.enviada_at IS NULL)`,
          tenant,
          estado,
          sinEnviar,
        ),
      encuestasPendientes: () =>
        this.contar(
          `SELECT count(*) AS n FROM encuesta_satisfaccion e WHERE e.tenant_id = COALESCE($1::uuid, e.tenant_id) AND e.estado = 'pendiente'`,
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
          // Bloqueadas por el administrador o por intentos fallidos (auth/bloqueo.ts).
          `SELECT count(*) AS n FROM usuario u WHERE u.tenant_id = COALESCE($1::uuid, u.tenant_id) AND u.deleted_at IS NULL
              AND (u.estado = 'bloqueado' OR u.intentos_fallidos >= $2::int)`,
          tenant,
          MAX_INTENTOS_FALLIDOS,
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

    // Órdenes internas (frente r1b): las que LLEGAN a sus laboratorios (destino) y
    // las que volvieron con su informe a las OT de sus laboratorios (origen).
    const destinoOi = `JOIN cat_familia f ON f.id = oi.destino_lab
           JOIN unidad u ON u.tenant_id = f.tenant_id AND u.activa
            AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))`;
    const qOi = {
      porAtender: () =>
        this.contar(
          `SELECT count(DISTINCT oi.id) AS n FROM orden_interna oi ${destinoOi}
            WHERE oi.tenant_id = COALESCE($1::uuid, oi.tenant_id) AND oi.deleted_at IS NULL AND oi.estado IN ('abierta', 'recibida')
              AND ($2::uuid[] IS NULL OR u.id = ANY($2::uuid[]))`,
          tenant,
          unidades,
        ).catch(() => 0),
      porIntegrar: () =>
        this.contar(
          `SELECT count(*) AS n FROM orden_interna oi JOIN orden_trabajo o ON o.id = oi.ot_id
            WHERE ${otScope} AND oi.deleted_at IS NULL AND oi.estado = 'cerrada' AND oi.aceptada_at IS NULL`,
          tenant,
          unidades,
        ).catch(() => 0),
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
      item("ot_abiertas", "OT abiertas", "OT en curso en su alcance (indicador)", await q.otAbiertas(), "/ot?estado=abiertas", "info");
    // Las tarjetas de resultados abren «Captura y revisión por OT» ya filtrada.
    const porRevisar = async () =>
      item("resultados_por_revisar", "Resultados por revisar", "Resultados capturados pendientes de revisión nivel 1", await q.resultadosEstado(["capturado"]), "/captura-ot?estado=capturado", "warn");
    const porAprobar = async () =>
      item("resultados_por_aprobar", "Resultados por aprobar", "Resultados revisados pendientes de aprobación", await q.resultadosEstado(["revisado_n1"]), "/captura-ot?estado=revisado_n1", "warn");
    const asignadas = async () =>
      item("ot_asignadas", "OT asignadas a mí", "OT abiertas donde usted figura como analista (de la OT o de un ensayo)", await q.otAsignadas(), "/ot?mias=1&estado=abiertas", "warn");
    const devueltos = async () =>
      item("resultados_devueltos", "Resultados devueltos", "Resultados suyos devueltos o rechazados para corregir", await q.resultadosDevueltosMios(), "/captura-ot?estado=devuelto,rechazado&mios=1", "alta");
    const derivados = async () =>
      item(
        "derivados_por_capturar",
        "Ensayos derivados por capturar",
        "Ensayos que otro laboratorio le pidió por orden interna (ya recibida) y esperan su resultado",
        await q.derivadosPorCapturar(),
        "/captura-ot?estado=pendiente,devuelto,rechazado&derivados=1",
        "warn",
      );
    const sinAsignar = async () =>
      item("ot_sin_asignar", "OT sin analista", "OT abiertas de su laboratorio a las que aún no se asignó analista", await q.otSinAsignar(), "/ot?sinAsignar=1&estado=abiertas", "warn");
    const porOficializar = async () =>
      item("informes_por_oficializar", "Informes por oficializar", "Informes y certificados de su ámbito que esperan firmas: aún no son oficiales", await q.documentosEnFirma(), "/certificados?estado=en_firma", "warn");
    const sinOt = async () =>
      item("cotizaciones_aceptadas_sin_ot", "Cotizaciones aceptadas sin OT", "Cotizaciones aceptadas a las que aún no se les creó OT", await q.cotizacionesSinOt(), "/cotizaciones?estado=aceptada&sinOt=1", "warn");
    const oiPorAtender = async () =>
      item("oi_por_atender", "Órdenes internas por atender", "Órdenes internas de otros laboratorios por recibir o responder", await qOi.porAtender(), "/ordenes-internas", "warn");
    const oiPorIntegrar = async () =>
      item("oi_por_integrar", "Informes internos por integrar", "Órdenes internas que volvieron con su informe: déles por recibido", await qOi.porIntegrar(), "/ordenes-internas?vista=todas&estado=cerrada", "warn");
    // Tarjetas por rol dentro del perfil (RECEPCION e INSPECTOR comparten el perfil ANALISTA).
    const rolesVigentes = new Set((ctx.asignacionesVigentes ?? []).map((a) => codigoCanonico(a.rolCodigo)));
    const porRecepcionar = async (): Promise<ItemBandeja[]> =>
      rolesVigentes.has("RECEPCION")
        ? [item("ot_por_recepcionar", "OT por recepcionar", "OT y órdenes internas de sus laboratorios con muestras por recibir o con la recepción incompleta", await q.otPorRecepcionar(), "/recepcion", "warn")]
        : [];
    const enBpch = async () => (await q.enBpch()) > 0;
    const internacionesPorAnalizar = async (): Promise<ItemBandeja[]> =>
      (await enBpch())
        ? [item("internaciones_por_analizar", "Internaciones por analizar", "Resoluciones DGMN registradas que esperan el análisis técnico de la SCC", await q.internacionesPorAnalizar(), "/bpch/internaciones?pendiente=analisis", "warn")]
        : [];
    const lotesPorInspeccionar = async (): Promise<ItemBandeja[]> =>
      (await enBpch())
        ? [item("lotes_por_inspeccionar", "Lotes por inspeccionar", "Internaciones con OT generada cuyos lotes aún no se programan ni registran", await q.lotesPorInspeccionar(), "/bpch/internaciones?pendiente=inspeccion", "warn")]
        : [];
    const nc = async () =>
      item("nc_abiertas", "No conformidades abiertas", "NC abiertas, en proceso o en verificación", await q.ncAbiertas(), "/no-conformidades", "warn");

    const porResponder = async () =>
      item("cotizaciones_por_responder", "Cotizaciones por responder", "Comercial pide fechas y costo a su laboratorio: responda con el programa y el costeo", await q.solicitudesLab(["solicitado", "devuelto"]), "/cotizaciones/por-responder?estado=por_responder", "warn");
    const vbLab = async () =>
      item("cotizaciones_vb_lab", "Costeos por dar V°B°", "Respuestas de costeo de su laboratorio que esperan el V°B° del Jefe de Laboratorio", await q.solicitudesLab(["respondido"]), "/cotizaciones/por-responder?estado=vb", "warn");
    const vbDepto = async () =>
      item("cotizaciones_vb_depto", "Costeos por dar V°B° del departamento", "Respuestas de costeo con V°B° del laboratorio que esperan el del Jefe de Departamento", await q.solicitudesLab(["vb_lab"]), "/cotizaciones/por-responder?estado=vb", "warn");
    // Solo para quien firma según la matriz COTIZACION por defecto (Jefe del Depto. Comercial).
    const porFirmarCot = async (): Promise<ItemBandeja[]> =>
      (await q.firmaCotizaciones()) === 0 ? [] : [item("cotizaciones_por_firmar", "Cotizaciones por firmar", "Cotizaciones enviadas a su firma (Jefe del Departamento Comercial)", await q.cotizacionesPorFirmar(), "/cotizaciones?estado=abierta&firma=pendiente", "warn")];
    const encuestas = async () =>
      item("encuestas_pendientes", "Encuestas por registrar", "OT cerradas cuya encuesta de satisfacción aún no se registra", await q.encuestasPendientes(), "/encuestas?estado=pendiente", "info");

    // Documentación del trabajo del DSA que espera la decisión de esta jefatura (EP-05 2.3, frente r2a):
    // Jefe de Lab aprueba (LRB, SVM…); en el LEM en terreno valida la Sección y aprueba el Departamento.
    const trabajoPorAprobar = (estado: "en_aprobacion" | "validada", lem: boolean, titulo: string) => async () =>
      item(
        `trabajo_${estado}${lem ? "_lem" : ""}`,
        titulo,
        "Documentación del trabajo (planilla, plan o Proyecto de Párrafo) que espera su decisión antes de ejecutar",
        await this.contar(
          `SELECT count(*) AS n FROM registro_especializado r JOIN orden_trabajo o ON o.id = r.ot_id
            WHERE ${otScope} AND r.variante = 'trabajo' AND r.estado = $3 AND (r.clave = 'LEM') = $4::boolean`,
          tenant,
          unidades,
          estado,
          lem,
        ).catch(() => 0),
        "/preparacion-trabajo",
        "warn",
      );

    const all = (fs: (() => Promise<ItemBandeja | ItemBandeja[]>)[]) =>
      Promise.all(fs.map((f) => f())).then((r) => r.flat());

    switch (perfil) {
      case "ANALISTA":
        return all([
          porRecepcionar,
          lotesPorInspeccionar,
          asignadas,
          derivados,
          async () => item("ot_en_curso", "OT en curso", "OT abiertas de sus laboratorios", await q.otAbiertas(), "/ot?estado=abiertas", "info"),
          devueltos,
          firmas,
        ]);
      case "REVISOR":
        return all([porRevisar, asignadas, derivados, devueltos, porVencer, firmas]);
      case "JEFE_LAB":
        return all([internacionesPorAnalizar, lotesPorInspeccionar, sinAsignar, trabajoPorAprobar("en_aprobacion", false, "Documentación del trabajo por aprobar"), porRevisar, porAprobar, oiPorAtender, derivados, oiPorIntegrar, firmas, porEntregar, listasCerrar, vencidas, porVencer, porOficializar, porResponder, vbLab]);
      case "JEFE_SECCION":
        return all([internacionesPorAnalizar, trabajoPorAprobar("en_aprobacion", true, "Proyectos de Párrafo por validar"), firmas, porOficializar, porAprobar, vencidas, vencidasPorLab, abiertas, porResponder]);
      case "JEFE_DEPTO":
        return all([trabajoPorAprobar("validada", true, "Proyectos de Párrafo por aprobar"), firmas, porOficializar, porAprobar, vencidas, vencidasPorLab, abiertas, porFirmarCot, vbDepto, porResponder]);
      case "DIRECTOR":
        return all([firmas, porOficializar, vencidas, vencidasPorLab, abiertas, nc, sinOt]);
      case "COMERCIAL":
        return all([
          async () => item("cotizaciones_por_vencer", "Cotizaciones por vencer", "Cotizaciones abiertas que vencen en los próximos 7 días", await q.cotizacionesPorVencer(), "/cotizaciones?porVencer=1", "warn"),
          sinOt,
          porVencer,
          porEntregar,
          async () => item("cotizaciones_devueltas_firma", "Cotizaciones devueltas por el Jefe DCO", "Corrija lo observado y vuelva a enviarlas a firma", await q.cotizacionesFirma("devuelta"), "/cotizaciones?estado=abierta&firma=devuelta", "alta"),
          async () => item("cotizaciones_firmadas_sin_enviar", "Cotizaciones firmadas sin enviar", "Firmadas por el Jefe DCO: envíelas al cliente", await q.cotizacionesFirma("firmada", true), "/cotizaciones?estado=abierta&firma=firmada&enviada=0", "warn"),
          encuestas,
        ]);
      case "PLANIFICACION":
        return all([vencidas, vencidasPorLab, porVencer, listasCerrar, porEntregar, abiertas, sinOt, encuestas]);
      case "FINANZAS":
        return all([
          async () => item("facturas_pendientes", "Pendientes de facturar", "Facturas en borrador generadas al cerrar OT con cobro: revíselas y emítalas", await q.facturasPendientes(), "/facturas?estado=pendiente", "alta"),
          async () => item("facturas_por_cobrar", "Facturas por cobrar", "Facturas emitidas, con pago parcial o con aviso de cobranza", await q.facturasPorCobrar(), "/facturas?estado=por_cobrar", "warn"),
          async () => item("ot_cerradas_sin_factura", "OT cerradas sin factura", "OT con cobro cerradas sin factura (anteriores al cierre automático)", await q.otCerradasSinFactura(), "/ot?estado=cerrada&sinFactura=1", "warn"),
        ]);
      case "ABASTECIMIENTO":
        return all([
          async () => item("oc_pendientes", "Órdenes de compra pendientes", "OC en borrador, aprobadas o en proceso", await q.ocPendientes(), "/ordenes-compra", "warn"),
        ]);
      case "CALIDAD":
        return all([firmas, nc, porOficializar, vencidas]);
      case "ADMIN":
        return all([
          async () => item("usuarios_sin_rol", "Usuarios sin rol", "Usuarios activos sin ninguna asignación de rol", await q.usuariosSinRol(), "/admin/usuarios?sinRol=1", "warn"),
          async () => item("usuarios_bloqueados", "Usuarios bloqueados", "Cuentas bloqueadas por el administrador o por intentos fallidos de inicio de sesión", await q.usuariosBloqueados(), "/admin/usuarios?estado=bloqueado", "warn"),
          async () => item("unidades_sin_jefe", "Unidades sin jefe", "Laboratorios, secciones o departamentos sin jefe asignado", await q.unidadesSinJefe(), "/admin/estructura", "info"),
        ]);
      case "LECTOR":
      default:
        return all([abiertas]);
    }
  }
}
