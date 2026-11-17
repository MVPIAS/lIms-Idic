/**
 * Lee el parámetro avisos.dias_por_vencer (Administración › Parámetros) para el
 * semáforo de plazos (COM-23). Si falla la lectura, el valor por defecto.
 */
import { configAvisos } from "../avisos/reglas-avisos";
import { UMBRAL_POR_VENCER_DIAS } from "./plazos";

export async function diasPorVencerDe(db: any, tenantId?: string | null): Promise<number> {
  try {
    const filas: { codigo: string; valor: string | null; activo: boolean }[] = await db.$queryRawUnsafe(
      `SELECT codigo, valor, activo FROM parametro_sistema
        WHERE categoria = 'avisos' AND codigo = 'dias_por_vencer'
          AND ($1::uuid IS NULL OR tenant_id = $1::uuid)
        ORDER BY created_at LIMIT 1`,
      tenantId ?? null,
    );
    return configAvisos(filas).diasPorVencer;
  } catch {
    return UMBRAL_POR_VENCER_DIAS;
  }
}
