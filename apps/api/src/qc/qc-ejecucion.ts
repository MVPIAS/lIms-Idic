/**
 * QC obligatorio en la EJECUCIÓN del análisis · contrato §4.2.4 / §4.3.8
 * («Impedir la ejecución de análisis o la publicación de resultados si el QC
 * requerido no fue aprobado»).
 *
 * Hasta ahora el QC exigido por un método (cat_metodo.qc_requerido, tipos en
 * qc_tipos) solo bloqueaba la EMISIÓN del informe (QcService.verificarGate).
 * Con el parámetro `qc.bloqueo` = «ejecucion» (por defecto) tampoco se pueden
 * CAPTURAR, REVISAR ni APROBAR resultados de ese método en la OT mientras falte
 * el QC exigido aprobado y vigente; con «informe» se vuelve a la regla anterior
 * (solo la emisión).
 *
 * QC VIGENTE para un resultado (misma regla que el gate de emisión):
 *   · un qc_control de la MISMA OT y del MISMO método (cat_metodo) del resultado
 *     — la OT es el lote analítico del LIMS: los controles se registran contra
 *     la OT y el método en «Control de calidad (QC)» (qc_control.ot_id +
 *     cat_metodo_id) y no hay otra corrida o lote al que atarlos;
 *   · con resultado «aprobado» por OTRA persona que quien lo registró (reglas-qc.ts);
 *   · no retirado (deleted_at nulo). Un control que se vuelve a «pendiente» o se
 *     «rechaza» deja de contar al instante;
 *   · uno APROBADO de cada tipo que exige el método (qc_tipos); sin tipos
 *     marcados, uno aprobado de cualquier tipo.
 * No se exige además que sea del mismo día: una OT puede analizarse en varias
 * jornadas y el criterio por ensayo lo entrega el IDIC (EP-01 §10 P11). Si el
 * IDIC pide controles por jornada, el filtro se añade aquí (created_at ≥ hoy).
 *
 * Todas las capturas pasan por PuenteAnalisisService.capturarValor (formularios
 * especializados, D11/SAEC, BPCH e importación de instrumentos incluidos) y la
 * revisión y la aprobación por ResultadoService.transitar: ahí se llama a
 * exigirQcParaEjecutar. La pantalla de captura recibe el mismo motivo por
 * ensayo (bloqueosQcDeOt) para avisar antes de intentar.
 */
import { ConflictException } from "@nestjs/common";
import { tiposQcFaltantes } from "./reglas-qc";

type Db = { $queryRawUnsafe: <T = unknown>(q: string, ...p: unknown[]) => Promise<T> };

/* ------------------------------------------------------------ reglas puras --- */

export type ModoBloqueoQc = "ejecucion" | "informe";
export type EtapaQc = "captura" | "revision" | "aprobacion";

/** Valor del parámetro qc.bloqueo: «informe» o, por defecto (contrato §4.2.4), «ejecucion». */
export function modoBloqueoQc(valor: string | null | undefined): ModoBloqueoQc {
  return String(valor ?? "").trim().toLowerCase() === "informe" ? "informe" : "ejecucion";
}

/** Nombre en español de cada tipo de control (mensajes del servidor). */
export const NOMBRE_TIPO_QC: Record<string, string> = {
  blanco: "blanco",
  estandar: "estándar",
  curva: "curva de calibración",
  duplicado: "duplicado",
  mrc: "material de referencia certificado (MRC)",
  patron: "patrón de verificación",
  positivo: "control positivo",
  negativo: "control negativo",
  cualquiera: "un control aprobado de cualquier tipo",
};

const QUE_HACE: Record<EtapaQc, string> = {
  captura: "capturar",
  revision: "revisar",
  aprobacion: "aprobar",
};

/** Lo que falta, legible: «blanco, curva de calibración». */
export function textoFaltantes(faltan: string[]): string {
  return faltan.map((t) => NOMBRE_TIPO_QC[t] ?? t).join(", ");
}

/** Frase completa que ve el analista (y el revisor) cuando el QC bloquea la acción. */
export function mensajeBloqueoQc(
  metodo: { codigo: string; nombre: string },
  faltan: string[],
  etapa: EtapaQc,
  otCodigo?: string | null,
): string {
  return (
    `Control de calidad pendiente: el método ${metodo.codigo} · ${metodo.nombre} exige un control de calidad aprobado ` +
    `${otCodigo ? `en la OT ${otCodigo} ` : "en esta OT "}antes de ${QUE_HACE[etapa]} sus resultados (falta: ${textoFaltantes(faltan)}). ` +
    "Registre el control en «Control de calidad (QC)» y pida a otra persona (revisor o jefatura) que lo apruebe."
  );
}

/**
 * Qué falta del QC de un método en la OT (vacío = nada, se puede ejecutar).
 * `requerido` false → nunca bloquea.
 */
export function faltantesQcMetodo(requerido: boolean, tiposExigidos: string[] | null | undefined, tiposAprobados: string[]): string[] {
  if (!requerido) return [];
  return tiposQcFaltantes(tiposExigidos ?? [], tiposAprobados);
}

/* ----------------------------------------------------------- acceso a BD --- */

export async function leerModoBloqueoQc(db: Db, tenantId: string): Promise<ModoBloqueoQc> {
  const f = await db
    .$queryRawUnsafe<{ valor: string | null }[]>(
      `SELECT valor FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'qc' AND codigo = 'bloqueo' AND activo`,
      tenantId,
    )
    .catch(() => [] as { valor: string | null }[]);
  return modoBloqueoQc(f[0]?.valor);
}

export interface BloqueoQc {
  metodoId: string;
  codigo: string;
  nombre: string;
  /** Tipos que faltan aprobar («cualquiera» si basta uno de cualquier tipo). */
  faltan: string[];
  otCodigo: string | null;
  /** Texto de la etapa de captura (la pantalla lo muestra tal cual). */
  mensaje: string;
}

/**
 * Métodos (de los indicados) que hoy bloquean la ejecución en la OT por QC.
 * Vacío si el parámetro está en «informe» o si todos tienen su QC vigente.
 */
export async function bloqueosQcDeOt(db: Db, tenantId: string, otId: string, metodoIds: string[]): Promise<Map<string, BloqueoQc>> {
  const out = new Map<string, BloqueoQc>();
  const ids = [...new Set(metodoIds.filter(Boolean))];
  if (!ids.length) return out;
  if ((await leerModoBloqueoQc(db, tenantId)) === "informe") return out;
  const metodos = await db.$queryRawUnsafe<{ id: string; codigo: string; nombre: string; qc_tipos: string[] | null }[]>(
    `SELECT id, codigo, nombre, qc_tipos FROM cat_metodo WHERE id = ANY($1::uuid[]) AND qc_requerido AND deleted_at IS NULL`,
    ids,
  );
  if (!metodos.length) return out;
  const aprobados = await db.$queryRawUnsafe<{ cat_metodo_id: string; tipo: string }[]>(
    `SELECT DISTINCT cat_metodo_id, tipo FROM qc_control
      WHERE ot_id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL AND resultado = 'aprobado'
        AND cat_metodo_id = ANY($3::uuid[])`,
    otId,
    tenantId,
    metodos.map((m) => m.id),
  );
  const [ot] = await db.$queryRawUnsafe<{ codigo: string }[]>(`SELECT codigo FROM orden_trabajo WHERE id = $1::uuid`, otId);
  for (const m of metodos) {
    const faltan = faltantesQcMetodo(true, m.qc_tipos, aprobados.filter((a) => a.cat_metodo_id === m.id).map((a) => a.tipo));
    if (faltan.length)
      out.set(m.id, { metodoId: m.id, codigo: m.codigo, nombre: m.nombre, faltan, otCodigo: ot?.codigo ?? null, mensaje: mensajeBloqueoQc(m, faltan, "captura", ot?.codigo) });
  }
  return out;
}

/**
 * Lanza 409 (código QC_PENDIENTE) si el método del resultado exige QC y en su
 * OT no está aprobado y vigente. Sin método de catálogo, sin OT o con el
 * parámetro en «informe», no hace nada.
 */
export async function exigirQcParaEjecutar(db: Db, tenantId: string | null | undefined, resultadoId: string, etapa: EtapaQc): Promise<void> {
  const [r] = await db.$queryRawUnsafe<{ cat_metodo_id: string | null; ot_id: string | null; tenant_id: string }[]>(
    `SELECT r.cat_metodo_id, COALESCE(r.ot_id, m.ot_id) AS ot_id, m.tenant_id
       FROM resultado r JOIN muestra m ON m.id = r.muestra_id
      WHERE r.id = $1::uuid`,
    resultadoId,
  );
  if (!r?.cat_metodo_id || !r.ot_id) return;
  const tid = tenantId ?? r.tenant_id;
  const b = (await bloqueosQcDeOt(db, tid, r.ot_id, [r.cat_metodo_id])).get(r.cat_metodo_id);
  if (!b) return;
  throw new ConflictException({
    statusCode: 409,
    error: "Control de calidad pendiente",
    codigo: "QC_PENDIENTE",
    message: mensajeBloqueoQc(b, b.faltan, etapa, b.otCodigo),
    otId: r.ot_id,
    metodo: { id: b.metodoId, codigo: b.codigo, nombre: b.nombre },
    faltan: b.faltan,
  });
}
