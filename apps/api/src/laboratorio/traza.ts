/**
 * Traza de los cambios de un resultado · LIMS IDIC.
 *
 * El disparador `trg_resultado_historial` (align_quimicos_recepcion_calculo.sql)
 * anota en `resultado_historial` todo cambio de valor, especificación, fórmula,
 * factor, veredicto o estado de un resultado: campo, valor anterior y nuevo,
 * cuándo. Quién lo hizo, por qué y desde dónde los pone la API en la MISMA
 * transacción con `conTraza` (set_config local a la transacción). Si algún
 * camino no usa `conTraza`, el cambio igual queda anotado, sin usuario.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

export interface ContextoTraza {
  usuarioId?: string | null;
  motivo?: string | null;
  /** captura · correccion · especificacion · factor · revision · aprobacion · devolucion · reapertura · … */
  origen: string;
}

type Tx = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ejecuta `fn` en una transacción que deja quién, por qué y el origen para el historial. */
export async function conTraza<T>(prisma: PrismaClient | any, ctx: ContextoTraza, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx: Tx) => {
    const usuario = ctx.usuarioId && UUID.test(ctx.usuarioId) ? ctx.usuarioId : "";
    await tx.$queryRaw`SELECT set_config('lims.usuario_id', ${usuario}, true),
                              set_config('lims.motivo', ${(ctx.motivo ?? "").slice(0, 2000)}, true),
                              set_config('lims.origen', ${ctx.origen.slice(0, 40)}, true)`;
    return fn(tx);
  });
}

/**
 * ¿Hay que pedir motivo para guardar este valor? Corregir un valor ya capturado
 * (aún sin revisar) es una corrección y exige motivo (17025 §7.5: los cambios
 * se registran con su razón). La primera captura no lo pide, y tras una
 * devolución o una reapertura el motivo ya es el de la devolución.
 */
export function exigeMotivoCorreccion(estado: string, teniaValor: boolean): boolean {
  return estado === "capturado" && teniaValor;
}

/** ¿El resultado ya tenía un valor capturado? */
export function teniaValor(r: { valorNumerico?: unknown; valorTexto?: unknown; resultadoFinal?: unknown; promedio?: unknown }): boolean {
  const lleno = (v: unknown) => v != null && String(v).trim() !== "";
  return lleno(r.valorNumerico) || lleno(r.valorTexto) || lleno(r.resultadoFinal) || lleno(r.promedio);
}
