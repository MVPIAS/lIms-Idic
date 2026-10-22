/**
 * Hechos de la documentación del trabajo del DSA para la «Ruta de la OT»
 * (ot/avance-ot.ts): si el laboratorio la aprueba antes de ejecutar y en qué
 * estado está. Solo lectura.
 */
import { exigeAprobacion, FORMULARIOS_TRABAJO, LABS_DSA, leerConfigTrabajo, TEXTO_ESTADO_TRABAJO, type EstadoTrabajo } from "./trabajo";

type Db = { $queryRawUnsafe<T = unknown>(q: string, ...v: unknown[]): Promise<T> };

export interface TrabajoAvance {
  laboratorio: string;
  titulo: string;
  exige: boolean;
  estado: EstadoTrabajo | null;
  texto: string;
}

export async function trabajoDsaDe(db: Db, ot: { id: string; tenantId: string; laboratorio: string | null }): Promise<TrabajoAvance | null> {
  if (!ot.laboratorio || !(LABS_DSA as readonly string[]).includes(ot.laboratorio)) return null;
  const [cfg, reg] = await Promise.all([
    db.$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
      `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'preparacion_trabajo'`,
      ot.tenantId,
    ),
    db.$queryRawUnsafe<{ estado: string; datos: any }[]>(
      `SELECT estado, datos FROM registro_especializado WHERE ot_id = $1::uuid AND variante = 'trabajo' AND clave = $2`,
      ot.id,
      ot.laboratorio,
    ),
  ]);
  const estado = (reg[0]?.estado as EstadoTrabajo) ?? null;
  return {
    laboratorio: ot.laboratorio,
    titulo: FORMULARIOS_TRABAJO[ot.laboratorio]?.titulo ?? "Documentación del trabajo",
    exige: exigeAprobacion(ot.laboratorio, reg[0]?.datos?.documentacion ?? {}, leerConfigTrabajo(cfg)),
    estado,
    texto: estado ? TEXTO_ESTADO_TRABAJO[estado] : "Sin preparar",
  };
}
