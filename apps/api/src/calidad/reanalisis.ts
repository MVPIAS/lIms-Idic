/**
 * Advertencia y re-análisis en la captura (contrato §4.2.6 / §4.3.9) · acceso a
 * BD compartido por la captura (flujo-real), la revisión (laboratorio) y el
 * módulo de calidad. Reglas puras en laboratorio/advertencia.ts.
 */
import { ConflictException } from "@nestjs/common";
import { emitirEvento } from "../common/eventos";
import { hoyCl } from "../ot/plazos";
import { advertenciaNumerica, configResultados, debeReanalizar, motivoReanalisisAbierto, motivoReanalisisAutomatico, type ConfigResultados } from "../laboratorio/advertencia";

type Db = { $queryRawUnsafe: <T = unknown>(q: string, ...p: unknown[]) => Promise<T>; $executeRawUnsafe: (q: string, ...p: unknown[]) => Promise<number> };

export async function leerConfigResultados(db: Db, tenantId: string): Promise<ConfigResultados> {
  const filas = await db
    .$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
      `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'resultados'`,
      tenantId,
    )
    .catch(() => []);
  return configResultados(filas);
}

export interface ReanalisisAbierto {
  id: string;
  motivo: string;
  origen: string;
  solicitadoAt: string;
}

export async function reanalisisAbierto(db: Db, resultadoId: string): Promise<ReanalisisAbierto | null> {
  const [r] = await db.$queryRawUnsafe<ReanalisisAbierto[]>(
    `SELECT id, motivo, origen, solicitado_at AS "solicitadoAt" FROM resultado_reanalisis WHERE resultado_id = $1::uuid AND estado = 'solicitado'`,
    resultadoId,
  );
  return r ?? null;
}

/**
 * Deja sin efecto el re-análisis AUTOMÁTICO abierto de un ensayo cuando su
 * causa desapareció o no aplica (p. ej. el «No cumple» venía de una
 * especificación vacía y la orden ya fijó la suya, o la permisibilidad de un
 * arma, que no se repite). Queda «descartado» con quién y por qué. Los
 * re-análisis pedidos a mano no se tocan. Devuelve true si cerró alguno.
 */
export async function cerrarReanalisisAutomatico(
  db: Db,
  p: { resultadoId: string; usuarioId: string | null; motivo: string },
): Promise<boolean> {
  const n = await db.$executeRawUnsafe(
    `UPDATE resultado_reanalisis SET estado = 'descartado', cerrado_por = $2::uuid, cerrado_at = now(), cierre_motivo = $3
      WHERE resultado_id = $1::uuid AND estado = 'solicitado' AND origen = 'automatico'`,
    p.resultadoId,
    p.usuarioId,
    p.motivo,
  );
  return n > 0;
}

/** 409 si el ensayo tiene un re-análisis abierto (no se revisa ni se aprueba). */
export async function exigirSinReanalisis(db: Db, resultadoId: string): Promise<void> {
  const m = motivoReanalisisAbierto(await reanalisisAbierto(db, resultadoId));
  if (m) throw new ConflictException(m);
}

/** Advertencia del valor capturado (null = no). */
export async function advertenciaDeCaptura(
  db: Db,
  cfg: ConfigResultados,
  r: { catMetodoId: string | null; limiteInf: string | null; limiteSup: string | null; tipoDato: string },
  calc: { veredicto: string | null; resultadoFinal?: unknown; valorNumerico?: unknown },
): Promise<string | null> {
  if (calc.veredicto !== "cumple" || r.tipoDato === "atributo") return null;
  const v = calc.resultadoFinal ?? calc.valorNumerico;
  const valor = v == null ? null : Number(v);
  let margenMetodo: number | null = null;
  if (r.catMetodoId) {
    const [m] = await db.$queryRawUnsafe<{ m: string | null }[]>(`SELECT margen_advertencia_pct::text AS m FROM cat_metodo WHERE id = $1::uuid`, r.catMetodoId);
    margenMetodo = m?.m != null ? Number(m.m) : null;
  }
  return advertenciaNumerica(valor, r.limiteInf, r.limiteSup, cfg.margenPct, margenMetodo);
}

/**
 * Después de guardar una captura: cierra el re-análisis abierto (esta captura
 * es la repetición) o abre uno automático si el dictamen lo pide (una sola vez
 * por ensayo: si ya se re-analizó, el nuevo No cumple se mantiene). Avisa al
 * laboratorio de la advertencia o del re-análisis.
 */
/** ¿La captura abre un re-análisis automático? (una sola vez por ensayo; nunca si la captura no es repetible: F045). */
export function abreReanalisisAutomatico(p: {
  yaHubo: boolean;
  veredicto: string | null;
  advertencia: boolean;
  modo: ConfigResultados["reanalisis"];
  sinReanalisis?: boolean;
}): boolean {
  if (p.sinReanalisis || p.yaHubo) return false;
  return debeReanalizar(p.veredicto, p.advertencia, p.modo);
}

export async function trasCaptura(
  db: Db,
  p: {
    tenantId: string;
    resultadoId: string;
    otId: string | null;
    usuarioId: string | null;
    cfg: ConfigResultados;
    veredicto: string | null;
    advertencia: string | null;
    valor: { numerico: unknown; texto: unknown };
    abierto: ReanalisisAbierto | null;
    /**
     * F045: la captura no es una determinación que se pueda repetir (p. ej. la
     * permisibilidad IT05 que fija la clasificación del arma): no abre re-análisis
     * ni avisa de repetirla.
     */
    sinReanalisis?: boolean;
  },
): Promise<{ reanalisis: "realizado" | "solicitado" | null }> {
  const valor = JSON.stringify({ numerico: p.valor.numerico ?? null, texto: p.valor.texto ?? null, veredicto: p.veredicto, advertencia: !!p.advertencia });
  if (p.abierto) {
    await db.$executeRawUnsafe(
      `UPDATE resultado_reanalisis SET estado = 'realizado', valor_nuevo = $2::jsonb, cerrado_por = $3::uuid, cerrado_at = now(),
              cierre_motivo = 'Determinación repetida y capturada.'
        WHERE id = $1::uuid AND estado = 'solicitado'`,
      p.abierto.id,
      valor,
      p.usuarioId,
    );
    return { reanalisis: "realizado" };
  }
  const [ya] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM resultado_reanalisis WHERE resultado_id = $1::uuid AND origen = 'automatico'`,
    p.resultadoId,
  );
  let abre = false;
  if (abreReanalisisAutomatico({ yaHubo: !!ya?.n, veredicto: p.veredicto, advertencia: !!p.advertencia, modo: p.cfg.reanalisis, sinReanalisis: p.sinReanalisis })) {
    const motivo = motivoReanalisisAutomatico(p.veredicto, p.advertencia);
    const n = await db.$executeRawUnsafe(
      `INSERT INTO resultado_reanalisis (tenant_id, resultado_id, ot_id, origen, motivo, valor_anterior, solicitado_por)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'automatico', $4, $5::jsonb, $6::uuid)
       ON CONFLICT (resultado_id) WHERE estado = 'solicitado' DO NOTHING`,
      p.tenantId,
      p.resultadoId,
      p.otId,
      motivo,
      valor,
      p.usuarioId,
    );
    abre = n > 0;
  }
  if (abre || p.advertencia)
    emitirEvento("resultado.alerta", {
      resultadoId: p.resultadoId,
      tenantId: p.tenantId,
      usuarioId: p.usuarioId,
      tipo: abre ? "reanalisis" : "advertencia",
      origen: "automatico",
      motivo: abre && p.veredicto === "no_cumple" ? "No cumple" : p.advertencia ?? "",
      correo: p.cfg.avisarAdvertencia,
    });
  return { reanalisis: abre ? "solicitado" : null };
}

/**
 * Para la pantalla de captura: advertencia y re-análisis abierto de cada ensayo,
 * POE vigentes y acreditación del método (vigente hoy).
 */
export async function calidadDeResultados(db: Db, tenantId: string, resultadoIds: string[], metodoIds: string[]) {
  const [adv, rea, poe, acr, labAcr] = await Promise.all([
    resultadoIds.length
      ? db.$queryRawUnsafe<{ id: string; advertencia: boolean; advertencia_motivo: string | null }[]>(
          `SELECT id, advertencia, advertencia_motivo FROM resultado WHERE id = ANY($1::uuid[]) AND advertencia`,
          resultadoIds,
        )
      : [],
    resultadoIds.length
      ? db.$queryRawUnsafe<{ resultado_id: string; id: string; motivo: string; origen: string; estado: string }[]>(
          `SELECT DISTINCT ON (resultado_id) resultado_id, id, motivo, origen, estado FROM resultado_reanalisis
            WHERE resultado_id = ANY($1::uuid[]) ORDER BY resultado_id, solicitado_at DESC`,
          resultadoIds,
        )
      : [],
    metodoIds.length
      ? db.$queryRawUnsafe<{ cat_metodo_id: string; documento_id: string; codigo: string; titulo: string; version: number | null; archivo: string | null }[]>(
          `SELECT p.cat_metodo_id, d.id AS documento_id, d.codigo, d.titulo, d.version_publicada AS version,
                  (SELECT v.nombre_archivo FROM doc_version v WHERE v.documento_id = d.id AND v.numero = d.version_publicada) AS archivo
             FROM cat_metodo_poe p JOIN doc_documento d ON d.id = p.documento_id AND d.deleted_at IS NULL
            WHERE p.cat_metodo_id = ANY($1::uuid[]) ORDER BY p.principal DESC, d.codigo`,
          metodoIds,
        )
      : [],
    metodoIds.length ? metodosAcreditados(db, tenantId, metodoIds) : new Map<string, { numero: string; organismo: string }>(),
    // Ensayos cuyo laboratorio tiene una acreditación vigente hoy (propia o de todo
    // el IDIC): los que no están en su alcance se marcan «No acreditado».
    resultadoIds.length
      ? db.$queryRawUnsafe<{ id: string }[]>(
          `SELECT r.id FROM resultado r LEFT JOIN LATERAL lims_lab_de_resultado(r.id) lr ON TRUE
            WHERE r.id = ANY($1::uuid[])
              AND EXISTS (SELECT 1 FROM acreditacion a
                           WHERE a.tenant_id = $2::uuid AND a.deleted_at IS NULL
                             AND (a.unidad_id IS NULL OR a.unidad_id = lr.unidad_id)
                             AND (a.vigente_desde IS NULL OR a.vigente_desde <= $3::date)
                             AND (a.vigente_hasta IS NULL OR a.vigente_hasta >= $3::date))`,
          resultadoIds,
          tenantId,
          hoyCl(),
        )
      : [],
  ]);
  const labAcreditado = new Set(labAcr.map((x) => x.id));
  const advDe = new Map(adv.map((a) => [a.id, a.advertencia_motivo]));
  const reaDe = new Map(rea.map((r) => [r.resultado_id, { id: r.id, motivo: r.motivo, origen: r.origen, estado: r.estado }]));
  // `archivo`: nombre real del archivo publicado (con su extensión) para descargarlo.
  const poeDe = new Map<string, { documentoId: string; codigo: string; titulo: string; version: number | null; archivo: string | null }[]>();
  for (const p of poe)
    (poeDe.get(p.cat_metodo_id) ?? poeDe.set(p.cat_metodo_id, []).get(p.cat_metodo_id)!).push({
      documentoId: p.documento_id,
      codigo: p.codigo,
      titulo: p.titulo,
      version: p.version,
      archivo: p.archivo,
    });
  return {
    fila: (resultadoId: string, metodoId: string | null) => ({
      advertencia: advDe.has(resultadoId),
      advertenciaMotivo: advDe.get(resultadoId) ?? null,
      reanalisis: reaDe.get(resultadoId) ?? null,
      poe: metodoId ? poeDe.get(metodoId) ?? [] : [],
      acreditacion: metodoId ? acr.get(metodoId) ?? null : null,
      laboratorioAcreditado: labAcreditado.has(resultadoId),
    }),
  };
}

/** Métodos con alcance acreditado VIGENTE hoy (hora de Chile). */
export async function metodosAcreditados(db: Db, tenantId: string, metodoIds: string[]) {
  const filas = await db.$queryRawUnsafe<{ cat_metodo_id: string; numero: string; organismo: string }[]>(
    `SELECT DISTINCT ON (aa.cat_metodo_id) aa.cat_metodo_id, a.numero, a.organismo
       FROM acreditacion_alcance aa JOIN acreditacion a ON a.id = aa.acreditacion_id AND a.deleted_at IS NULL
      WHERE a.tenant_id = $1::uuid AND aa.cat_metodo_id = ANY($2::uuid[])
        AND (a.vigente_desde IS NULL OR a.vigente_desde <= $3::date)
        AND (a.vigente_hasta IS NULL OR a.vigente_hasta >= $3::date)
      ORDER BY aa.cat_metodo_id, a.vigente_hasta DESC NULLS FIRST`,
    tenantId,
    metodoIds,
    hoyCl(),
  );
  return new Map(filas.map((f) => [f.cat_metodo_id, { numero: f.numero, organismo: f.organismo }]));
}
