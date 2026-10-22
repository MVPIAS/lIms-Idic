/**
 * Faltantes propios para cerrar una OT de armas de la D11 (EP-11 §8 y 11.27):
 * cada arma registrada entregada al importador (las prohibidas quedan a la
 * espera del destino que decida la DGMN, 11.24). Función sin inyección para
 * que la use el cierre general (ot/ot-cierre.controller.ts) con la base o con
 * su transacción. Una base sin align_r4b_d11.sql no tiene faltantes.
 */
import { faltantesCierreD11 } from "./reglas-d11";

type Sql = { $queryRawUnsafe<T = unknown>(q: string, ...v: any[]): Promise<T> };

export async function faltantesCierreArmas(db: Sql, otId: string): Promise<string[]> {
  try {
    const filas = await db.$queryRawUnsafe<{ muestra: string; entregada: boolean; prohibida: boolean }[]>(
      `SELECT m.codigo AS muestra, (a.entrega_id IS NOT NULL) AS entregada, (a.permisibilidad = 'prohibida') AS prohibida
         FROM d11_arma_ot a JOIN muestra m ON m.id = a.muestra_id AND m.deleted_at IS NULL
        WHERE a.ot_id = $1::uuid ORDER BY a.orden`,
      otId,
    );
    return faltantesCierreD11(filas);
  } catch {
    return [];
  }
}
