/**
 * Lectura de los instrumentos y calibraciones de una OT (sin reglas): la usan el
 * cierre de la OT (ot-cierre.controller.ts), la Ruta de la OT
 * (avance-ot.controller.ts) y la pestaña «Instrumentos» (metrologia-ot.controller.ts).
 * Las tablas met_* no están en Prisma: SQL crudo con parámetros.
 */
import type { CalibracionOt, DocumentoNoCalibrable, InstrumentoOt } from "./metrologia-ot.reglas";
import { configFicha } from "./ficha.reglas";

/** Cliente mínimo: PrismaService o la transacción `tx`. */
export interface ConsultaCruda {
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Promise<T>;
}

/** Laboratorios de la Sección Metrología (los mismos del módulo de Metrología). */
export const LABS_SAM = ["LMT", "LMTE", "LNF", "LCAD"];

export interface InstrumentoFila extends InstrumentoOt {
  otId: string;
  marca: string | null; modelo: string | null; serie: string | null; idEspecial: string | null;
  capacidad: string | null; resolucion: string | null; rango: string | null;
  procesoCodigo: string | null; sentido: string | null; puntos: string | null; intervaloMeses: number | null;
  equipoId: string | null; equipoCodigo: string | null; lineaCotizacionId: string | null;
  metrologoId: string | null; metrologoNombre: string | null; fechaPrevista: string | null; asignadoAt: Date | null;
  recibidoPorNombre: string | null; entregadoPor: string | null; estadoFisico: string | null; estadoFisicoObs: string | null;
  accesorios: any[]; ubicacion: string | null; acondicionamientoH: number | null; tempAmbiente: number | null; etiqueta: string | null;
  motivoNoCalibrable: string | null; requiereExterno: boolean | null;
  devueltoRecibe: string | null; devueltoEstado: string | null; devueltoObs: string | null; devueltoGuia: string | null;
  devueltoPorNombre: string | null; anuladoMotivo: string | null; createdAt: Date;
}

export interface CalibracionFila extends CalibracionOt {
  procesoCodigo: string; autorId: string | null; autorNombre: string | null;
  entregaMedio: string | null; entregaDestinatario: string | null; entregaObservacion: string | null; entregadoPorNombre: string | null;
  devueltoMotivo: string | null; reemplazaNumero: string | null;
}

export async function instrumentosDeOt(db: ConsultaCruda, otId: string): Promise<InstrumentoFila[]> {
  const filas = await db.$queryRawUnsafe<any[]>(
    `SELECT i.id, i.ot_id AS "otId", i.numero, i.descripcion, i.marca, i.modelo, i.serie, i.id_especial AS "idEspecial",
            i.capacidad, i.resolucion, i.rango, i.proceso_codigo AS "procesoCodigo", i.sentido, i.puntos,
            i.intervalo_meses AS "intervaloMeses", i.equipo_id AS "equipoId", e.codigo AS "equipoCodigo",
            i.linea_cotizacion_id AS "lineaCotizacionId",
            i.metrologo_id AS "metrologoId", um.nombre_completo AS "metrologoNombre",
            to_char(i.fecha_prevista, 'YYYY-MM-DD') AS "fechaPrevista", i.asignado_at AS "asignadoAt",
            i.estado, i.recibido_at AS "recibidoAt", ur.nombre_completo AS "recibidoPorNombre", i.entregado_por AS "entregadoPor",
            i.estado_fisico AS "estadoFisico", i.estado_fisico_obs AS "estadoFisicoObs", i.accesorios, i.ubicacion,
            i.acondicionamiento_h::float8 AS "acondicionamientoH", i.temp_ambiente::float8 AS "tempAmbiente", i.etiqueta,
            i.calibrable, i.motivo_no_calibrable AS "motivoNoCalibrable", i.requiere_externo AS "requiereExterno",
            i.devuelto_at AS "devueltoAt", i.devuelto_recibe AS "devueltoRecibe", i.devuelto_estado AS "devueltoEstado",
            i.devuelto_obs AS "devueltoObs", i.devuelto_guia AS "devueltoGuia", ud.nombre_completo AS "devueltoPorNombre",
            i.anulado_motivo AS "anuladoMotivo", i.created_at AS "createdAt"
       FROM met_ot_instrumento i
       LEFT JOIN usuario um ON um.id = i.metrologo_id
       LEFT JOIN usuario ur ON ur.id = i.recibido_por
       LEFT JOIN usuario ud ON ud.id = i.devuelto_por
       LEFT JOIN equipo e ON e.id = i.equipo_id
      WHERE i.ot_id = $1::uuid
      ORDER BY i.numero`,
    otId,
  );
  return filas.map((f) => ({ ...f, accesorios: Array.isArray(f.accesorios) ? f.accesorios : [] }));
}

export async function calibracionesDeOt(db: ConsultaCruda, otId: string): Promise<CalibracionFila[]> {
  return db.$queryRawUnsafe<CalibracionFila[]>(
    `SELECT c.id, c.ot_instrumento_id AS "instrumentoId", c.codigo, c.numero_certificado AS "numeroCertificado", c.estado,
            c.emitido_at AS "emitidoAt", c.entregado_at AS "entregadoAt", pr.codigo AS "procesoCodigo",
            c.created_by AS "autorId", ua.nombre_completo AS "autorNombre",
            c.entrega_medio AS "entregaMedio", c.entrega_destinatario AS "entregaDestinatario", c.entrega_observacion AS "entregaObservacion",
            ue.nombre_completo AS "entregadoPorNombre", c.devuelto_motivo AS "devueltoMotivo", r.numero_certificado AS "reemplazaNumero"
       FROM met_calibracion c
       JOIN met_proceso pr ON pr.id = c.proceso_id
       LEFT JOIN usuario ua ON ua.id = c.created_by
       LEFT JOIN usuario ue ON ue.id = c.entregado_por
       LEFT JOIN met_calibracion r ON r.id = c.reemplaza_id
      WHERE c.ot_id = $1::uuid AND c.deleted_at IS NULL
      ORDER BY c.created_at`,
    otId,
  );
}

/** Parámetro «el cierre exige la devolución del instrumento» (por defecto sí). */
export async function cierreExigeDevolucion(db: ConsultaCruda, tenantId: string): Promise<boolean> {
  const p = await db.$queryRawUnsafe<{ valor: string | null; activo: boolean }[]>(
    `SELECT valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'metrologia' AND codigo = 'cierre_exige_devolucion' LIMIT 1`,
    tenantId,
  );
  if (!p.length || !p[0].activo) return true;
  return !/^(no|n|false|0)$/i.test(String(p[0].valor ?? "si").trim());
}

/**
 * Parámetro metrologia_ficha.no_apto_exige_documento (por defecto no): el cierre técnico y el
 * final exigen el informe técnico emitido o el servicio externo validado del no calibrable (D04-31).
 */
export async function noAptoExigeDocumentoDe(db: ConsultaCruda, tenantId: string): Promise<boolean> {
  const filas = await db.$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
    `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'metrologia_ficha' AND codigo = 'no_apto_exige_documento'`,
    tenantId,
  );
  return configFicha(filas).noAptoExigeDocumento;
}

/**
 * Informe técnico y certificado externo de cada ítem no calibrable (sin anulados ni
 * rechazados). Base sin align_r4a_metrologia_ficha.sql: ninguno. Se comprueba la
 * tabla antes de consultar porque también corre dentro de la transacción del cierre
 * (un error abortaría la transacción).
 */
export async function documentosNoCalibrablesDeOt(db: ConsultaCruda, otId: string): Promise<DocumentoNoCalibrable[]> {
  const t = await db.$queryRawUnsafe<{ ok: boolean }[]>(
    `SELECT (to_regclass('met_informe_tecnico') IS NOT NULL AND to_regclass('met_servicio_externo') IS NOT NULL) AS ok`);
  if (!t[0]?.ok) return [];
  return db.$queryRawUnsafe<DocumentoNoCalibrable[]>(
    `SELECT ot_instrumento_id AS "instrumentoId", 'informe_tecnico' AS tipo, numero, estado, entregado_at AS "entregadoAt", entrega_medio AS "entregaMedio"
       FROM met_informe_tecnico WHERE ot_id = $1::uuid AND estado <> 'anulado'
     UNION ALL
     SELECT ot_instrumento_id, 'certificado_externo', certificado_numero, estado, entregado_at, entrega_medio
       FROM met_servicio_externo WHERE ot_id = $1::uuid AND estado NOT IN ('anulado', 'rechazado')`,
    otId,
  );
}

/** Todo lo de Metrología que cuenta para el cierre de una OT. */
export async function metrologiaParaCierre(db: ConsultaCruda, otId: string, tenantId: string) {
  // En serie: también se llama dentro de una transacción (una sola conexión).
  const items = await instrumentosDeOt(db, otId);
  const cals = await calibracionesDeOt(db, otId);
  const docsNoCalibrables = await documentosNoCalibrablesDeOt(db, otId);
  const exigeDevolucion = await cierreExigeDevolucion(db, tenantId);
  const noAptoExigeDocumento = await noAptoExigeDocumentoDe(db, tenantId);
  return { items, cals, docsNoCalibrables, exigeDevolucion, noAptoExigeDocumento };
}
