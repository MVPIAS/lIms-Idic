/**
 * Plazo de la OT ligado a la vigencia de la resolución · sesión R3 (BPCH y
 * Delegación Nº 11, 28-10-2026): «la resolución dura 180 días, por lo que la OT
 * no puede durar más; las sucursales y la Delegación 11 no deberían tener OT
 * sin plazo».
 *
 *  · Vigencia: fecha de la resolución + `bpch_resolucion.vigencia_dias` (180 por
 *    defecto). Sin fecha de resolución conocida, cuenta desde el ingreso de la OT.
 *  · La fecha de compromiso de una OT del BPCH o la D11 nunca pasa la vigencia
 *    (se recorta al crearla y se rechaza al cambiarla) y no puede quedar vacía.
 *
 * Reglas PURAS en las funciones exportadas sin `db` (plazo-resolucion.spec.ts).
 */

type Db = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valores: any[]): PromiseLike<T>;
  $executeRawUnsafe(sql: string, ...valores: any[]): PromiseLike<number>;
};

export const VIGENCIA_RESOLUCION_DIAS = 180;

/** Días de vigencia del parámetro (1 a 730); si falta o no se entiende, 180. */
export function diasVigencia(valor: string | null | undefined): number {
  const n = Math.trunc(Number(String(valor ?? "").trim()));
  return Number.isFinite(n) && n >= 1 && n <= 730 ? n : VIGENCIA_RESOLUCION_DIAS;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** «AAAA-MM-DD» + n días corridos. */
export function sumarDias(dia: string, n: number): string {
  if (!DIA.test(dia)) throw new Error(`Fecha no válida: ${dia}`);
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Último día de vigencia de la resolución. */
export function vigenciaHasta(fechaResolucion: string, dias: number): string {
  return sumarDias(fechaResolucion, dias);
}

/**
 * Fecha de compromiso que debe quedar al crear la OT: la propuesta (plazo por
 * defecto) recortada a la vigencia; sin propuesta, el último día de vigencia.
 */
export function plazoAjustado(propuesta: string | null, vigencia: string): { fecha: string; recortada: boolean } {
  if (!propuesta) return { fecha: vigencia, recortada: false };
  return propuesta > vigencia ? { fecha: vigencia, recortada: true } : { fecha: propuesta, recortada: false };
}

/** Error al cambiar la fecha de compromiso de una OT del BPCH o la D11 (null = válida). */
export function errorCambioPlazo(nueva: string | null, vigencia: string | null, exigePlazo: boolean): string | null {
  if (!nueva) return exigePlazo ? "Las OT del BPCH y de la Delegación Nº 11 no pueden quedar sin plazo: indique la fecha de compromiso." : null;
  if (vigencia && nueva > vigencia)
    return `La fecha de compromiso no puede pasar la vigencia de la resolución (hasta el ${vigencia.split("-").reverse().join("-")}).`;
  return null;
}

/** Día AAAA-MM-DD de un Date o texto de la base (las fechas DATE vienen a medianoche UTC). */
function dia(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  return v.toISOString().slice(0, 10);
}

/**
 * Fija la vigencia de la resolución en la OT del BPCH o la D11 recién creada y
 * ajusta su fecha de compromiso (dentro de la transacción que la crea). Sin
 * fecha de resolución, la vigencia cuenta desde el ingreso de la OT.
 */
export async function aplicarVigenciaResolucion(db: Db, tenantId: string, otId: string, fechaResolucion: Date | string | null): Promise<{ vigencia: string; fecha: string } | null> {
  const [ot] = await db.$queryRawUnsafe<{ fecha: Date | null; recepcion: Date | null; creada: Date }[]>(
    `SELECT fecha_compromiso AS fecha, fecha_recepcion AS recepcion, created_at AS creada FROM orden_trabajo WHERE id = $1::uuid`,
    otId,
  );
  if (!ot) return null;
  const [p] = await db.$queryRawUnsafe<{ valor: string | null }[]>(
    `SELECT valor FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'bpch_resolucion' AND codigo = 'vigencia_dias' AND activo`,
    tenantId,
  );
  const base = dia(fechaResolucion) ?? dia(ot.recepcion) ?? dia(ot.creada)!;
  const vigencia = vigenciaHasta(base, diasVigencia(p?.valor));
  const { fecha } = plazoAjustado(dia(ot.fecha), vigencia);
  await db.$executeRawUnsafe(
    `UPDATE orden_trabajo SET vigencia_resolucion_hasta = $2::date, fecha_compromiso = $3::date WHERE id = $1::uuid`,
    otId,
    vigencia,
    fecha,
  );
  return { vigencia, fecha };
}
