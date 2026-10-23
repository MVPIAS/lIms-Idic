/**
 * Fecha de compromiso por defecto de TODA OT al nacer (B-010, recorrido MP-10
 * D10-02): hoy en Chile + el plazo configurado en «Parámetros del sistema».
 *
 *   ot_plazo_laboratorio.<LAB>  · plazo del laboratorio responsable (manda)
 *   ot_plazo.<origen>_dias      · plazo del origen (internacion, produccion_nacional,
 *                                 prototipo, reinspeccion, cotizacion, institucional…)
 *   ot_plazo.defecto_dias       · el resto
 *
 * La OT que nace de una cotización NO se toca: toma el plazo de la cotización
 * (disparador fn_ot_fecha_compromiso) y, si la cotización no lo trae, queda en
 * la tarjeta «OT sin plazo · Asignar plazo» para que Comercial lo fije.
 *
 * Los valores por defecto (10 días corridos) están POR CONFIRMAR con el IDIC
 * (carta de consultas MET-09, plazo estándar). La jefatura sigue pudiendo fijar
 * otra fecha a mano; una OT que ya trae fecha (p. ej. desde la cotización) no
 * se toca. Reglas puras en `diasPorDefecto`, probadas en plazo-defecto.spec.ts.
 */
import { fechaCompromisoDesdePlazo } from "./plazos";

/** Cualquier cliente que ejecute SQL crudo (servicio, transacción o el cliente del SAEC). */
type Db = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valores: any[]): PromiseLike<T>;
  $executeRawUnsafe(sql: string, ...valores: any[]): PromiseLike<number>;
};

/** Código del parámetro de plazo de un origen de OT («PRODUCCION_NACIONAL» → «produccion_nacional_dias»). */
export const codigoPlazoOrigen = (origen: string | null | undefined) => (origen ? `${origen.trim().toLowerCase()}_dias` : "");

const diasValidos = (v: string | null | undefined): number | null => {
  const n = Math.trunc(Number(String(v ?? "").trim()));
  return Number.isFinite(n) && n > 0 && n <= 365 ? n : null;
};

/** Días de plazo: laboratorio > origen > defecto. null = sin plazo configurado. */
export function diasPorDefecto(
  plazos: { codigo: string; valor: string | null }[],
  porLaboratorio: { codigo: string; valor: string | null }[],
  origen: string | null | undefined,
  laboratorio: string | null | undefined,
): number | null {
  const lab = laboratorio ? porLaboratorio.find((p) => p.codigo.toUpperCase() === laboratorio.toUpperCase()) : undefined;
  const deLab = diasValidos(lab?.valor);
  if (deLab) return deLab;
  const cod = codigoPlazoOrigen(origen);
  const deOrigen = cod ? diasValidos(plazos.find((p) => p.codigo === cod)?.valor) : null;
  if (deOrigen) return deOrigen;
  return diasValidos(plazos.find((p) => p.codigo === "defecto_dias")?.valor);
}

/**
 * Fija la fecha de compromiso por defecto de la OT recién creada si aún no la
 * tiene. Se llama dentro de la transacción que la crea. Devuelve la fecha o null.
 */
export async function fijarPlazoPorDefecto(db: Db, tenantId: string, otId: string, ahora: Date = new Date()): Promise<string | null> {
  const [ot] = await db.$queryRawUnsafe<{ fecha: Date | null; origen: string | null; lab: string | null }[]>(
    `SELECT o.fecha_compromiso AS fecha, o.origen_trabajo AS origen, u.codigo AS lab
       FROM orden_trabajo o LEFT JOIN unidad u ON u.id = o.unidad_principal
      WHERE o.id = $1::uuid`,
    otId,
  );
  if (!ot || ot.fecha) return null;
  const params = await db.$queryRawUnsafe<{ categoria: string; codigo: string; valor: string | null }[]>(
    `SELECT categoria, codigo, valor FROM parametro_sistema
      WHERE tenant_id = $1::uuid AND categoria IN ('ot_plazo', 'ot_plazo_laboratorio') AND activo`,
    tenantId,
  );
  const dias = diasPorDefecto(
    params.filter((p) => p.categoria === "ot_plazo"),
    params.filter((p) => p.categoria === "ot_plazo_laboratorio"),
    ot.origen,
    ot.lab,
  );
  const f = dias ? fechaCompromisoDesdePlazo(null, dias, ahora) : null;
  if (!f) return null;
  await db.$executeRawUnsafe(`UPDATE orden_trabajo SET fecha_compromiso = $2::date, fecha_compromiso_origen = 'plazo_defecto', fecha_compromiso_at = now()
      WHERE id = $1::uuid AND fecha_compromiso IS NULL`, otId, f);
  return f;
}
