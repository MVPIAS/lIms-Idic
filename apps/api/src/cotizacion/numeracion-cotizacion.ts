/**
 * Número real de la cotización (EP-00 2.1 · formato del Sistema Comercial
 * «2026-14324»). Reglas puras en `formatearNumeroCotizacion` y `serieDe`
 * (numeracion-cotizacion.spec.ts); el correlativo se obtiene con un contador
 * atómico por tenant y serie (`cotizacion_correlativo`, align_cotizacion_circuito.sql),
 * la misma técnica que el correlativo de OT (common/codigo.ts).
 *
 * Parámetros editables (Administración › Parámetros, categoría
 * `numeracion_cotizacion`). COM-11 (respuesta IDIC 17-11-2026): «año vigente +
 * correlativo que reinicia todos los años».
 *   · formato     «{AAAA}-{N}»  ({AAAA} = año de emisión, {N} = correlativo)
 *   · digitos     5             (relleno con ceros a la izquierda)
 *   · reinicio    anual | global
 *   · inicio      0             (último número usado en el Sistema Comercial)
 *   · inicio_anio año al que se aplica «inicio» con reinicio anual: los demás
 *                 años arrancan en 1. Vacío o 0 con «inicio» > 0 = el año en curso
 *                 (se fija solo con el primer número emitido).
 */

import { anioChile } from "../common/fecha-chile";

export interface ConfigNumeracion {
  formato: string;
  digitos: number;
  reinicio: "global" | "anual";
  inicio: number;
  /** Con reinicio anual, «inicio» solo vale para este año (null = para ninguno). */
  inicioAnio: number | null;
}

export const NUMERACION_DEF: ConfigNumeracion = { formato: "{AAAA}-{N}", digitos: 5, reinicio: "anual", inicio: 0, inicioAnio: null };

/** Normaliza los valores leídos de parametro_sistema (texto) con sus valores por defecto. */
export function configNumeracion(valores: Record<string, string | null | undefined>): ConfigNumeracion {
  const formato = (valores.formato ?? "").trim();
  const digitos = Number(valores.digitos);
  const inicio = Number(valores.inicio);
  const reinicio = String(valores.reinicio ?? "").trim().toLowerCase();
  const txtAnio = String(valores.inicio_anio ?? "").trim();
  const inicioAnio = /^\d{4}$/.test(txtAnio) ? Number(txtAnio) : null;
  return {
    formato: formato.includes("{N}") ? formato.slice(0, 40) : NUMERACION_DEF.formato,
    digitos: Number.isInteger(digitos) && digitos >= 1 && digitos <= 10 ? digitos : NUMERACION_DEF.digitos,
    reinicio: reinicio === "anual" || reinicio === "global" ? reinicio : NUMERACION_DEF.reinicio,
    inicio: Number.isInteger(inicio) && inicio >= 0 ? inicio : NUMERACION_DEF.inicio,
    inicioAnio,
  };
}

/** Serie del contador: una sola («global») o una por año. */
export function serieDe(cfg: ConfigNumeracion, anio: number): string {
  return cfg.reinicio === "anual" ? String(anio) : "global";
}

/**
 * «Último número usado» que rige la serie del año. Correlativo global: siempre
 * `inicio`. Reinicio anual: `inicio` solo para el año `inicioAnio` (p. ej. para
 * continuar en 2026 la numeración del Sistema Comercial); cualquier otro año
 * vuelve a 1 (COM-11). Antes se aplicaba a cada año y en 2027 la serie habría
 * arrancado en inicio + 1.
 */
export function inicioDeSerie(cfg: ConfigNumeracion, anio: number): number {
  if (cfg.reinicio !== "anual") return cfg.inicio;
  // Auditoría 17-11-2026: «inicio» sin año (0 o vacío, p. ej. la instalación
  // nueva, align_fx5_a.sql) rige en el año en curso; generarNumeroCotizacion
  // fija ese año en «inicio_anio» la primera vez, para que el año siguiente
  // vuelva a partir en 1.
  if (cfg.inicioAnio === null) return cfg.inicio;
  return cfg.inicioAnio === anio ? cfg.inicio : 0;
}

/** ¿Hay que fijar «inicio_anio» al año en curso? (reinicio anual, «inicio» > 0 y sin año). */
export const fijarAnioDeInicio = (cfg: ConfigNumeracion) => cfg.reinicio === "anual" && cfg.inicioAnio === null && cfg.inicio > 0;

/** Aplica el formato: «{AAAA}-{N}» con año 2026 y n 14324 → «2026-14324». */
export function formatearNumeroCotizacion(cfg: ConfigNumeracion, anio: number, n: number): string {
  return cfg.formato.replace(/\{AAAA\}/g, String(anio)).replace(/\{N\}/g, String(n).padStart(cfg.digitos, "0"));
}

/**
 * Número del Formulario de cotización (FORM05) de una cotización:
 * FORM-<nº cotización>/00n (maqueta: FORM-2026-14596/001).
 */
export function numeroFormulario(codigoCotizacion: string, n: number): string {
  return `FORM-${codigoCotizacion}/${String(n).padStart(3, "0")}`;
}

/**
 * Siguiente número de cotización, atómico: INSERT … ON CONFLICT DO UPDATE …
 * RETURNING incrementa y devuelve el valor en una sola sentencia. Si el
 * parámetro «inicio» sube (p. ej. para continuar la numeración del Sistema
 * Comercial), el contador salta a inicio + 1 (con reinicio anual, solo en el
 * año «inicio_anio»: ver inicioDeSerie). `db` = PrismaService o una
 * transacción. Si el número ya existe (datos migrados), toma el siguiente.
 */
export async function generarNumeroCotizacion(db: any, tenantId: string, fecha: Date = new Date()): Promise<string> {
  const filas: { codigo: string; valor: string | null }[] = await db.$queryRawUnsafe(
    `SELECT codigo, valor FROM parametro_sistema
      WHERE tenant_id = $1::uuid AND categoria = 'numeracion_cotizacion' AND activo`,
    tenantId,
  );
  const cfg = configNumeracion(Object.fromEntries(filas.map((f) => [f.codigo, f.valor])));
  const anio = anioChile(fecha);
  const serie = serieDe(cfg, anio);
  const inicio = inicioDeSerie(cfg, anio);
  if (fijarAnioDeInicio(cfg)) {
    // «inicio» sin año: rige en este año y queda fijado (con su historial).
    await db.$queryRawUnsafe(
      `INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden, activo)
       VALUES ($1::uuid, 'numeracion_cotizacion', 'inicio_anio', 'Año del último número usado', '0', 90, TRUE)
       ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING`,
      tenantId,
    );
    await db.$queryRawUnsafe(
      `WITH upd AS (
         UPDATE parametro_sistema SET valor = $2, activo = TRUE, updated_at = now()
          WHERE tenant_id = $1::uuid AND categoria = 'numeracion_cotizacion' AND codigo = 'inicio_anio'
            AND btrim(COALESCE(valor, '')) IN ('', '0')
         RETURNING id, tenant_id
       )
       INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
       SELECT tenant_id, id, 'numeracion_cotizacion', 'inicio_anio', '0', $2,
              'Fijado con la primera cotización numerada: «Último número ya usado» rige solo en el año en curso (COM-11).', NULL
         FROM upd`,
      tenantId,
      String(anio),
    );
  }
  for (let intento = 0; intento < 50; intento++) {
    const r: { ultimo: number }[] = await db.$queryRawUnsafe(
      `INSERT INTO cotizacion_correlativo (tenant_id, serie, ultimo)
       VALUES ($1::uuid, $2, $3::int + 1)
       ON CONFLICT (tenant_id, serie)
       DO UPDATE SET ultimo = GREATEST(cotizacion_correlativo.ultimo, $3::int) + 1, updated_at = now()
       RETURNING ultimo`,
      tenantId,
      serie,
      inicio,
    );
    const codigo = formatearNumeroCotizacion(cfg, anio, Number(r[0]?.ultimo ?? 1));
    const usado: unknown[] = await db.$queryRawUnsafe(
      `SELECT 1 FROM cotizacion WHERE tenant_id = $1::uuid AND codigo = $2 LIMIT 1`,
      tenantId,
      codigo,
    );
    if (!usado.length) return codigo;
  }
  throw new Error("No se pudo obtener un número de cotización libre: revise el parámetro numeracion_cotizacion.inicio.");
}
