/**
 * Paso 9 de la Delegación Nº 11 (certificados por arma): una OT enviada al
 * software de armas del BPCH NO emite certificados en el LIMS. Los emite y firma
 * ese sistema (misma vigencia de 4 años, cuño y numeración) y el LIMS solo
 * guarda sus enlaces: emitir en los dos duplicaría la numeración.
 * Sin inyección (lo usa d11.service con la base o su transacción). Una base sin
 * align_integracion_armas.sql no bloquea.
 */
import { MOTIVO_SIN_CERTIFICADO_D11 } from "./reglas-armas";

type Sql = { $queryRawUnsafe<T = unknown>(q: string, ...v: any[]): Promise<T> };

export { MOTIVO_SIN_CERTIFICADO_D11 };

/** ¿La OT está en el software de armas (encolada o enviada)? */
export async function otEnSistemaArmas(db: Sql, otId: string): Promise<boolean> {
  try {
    const f = await db.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM integracion_armas_ot WHERE ot_id = $1::uuid`, otId);
    return f.length > 0;
  } catch {
    return false;
  }
}
